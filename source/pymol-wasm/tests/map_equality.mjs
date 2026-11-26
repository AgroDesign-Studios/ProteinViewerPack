// Same-output check for patch 0009 (S1-4, layer0/Map.cpp MapSetupExpress + layer0/Triangle.cpp
// TriangleFill): every PyMOL feature that builds or reads the express neighbour table (or the
// surface triangulation), run on ONE wheel; the digests go to a result file. Compare two result
// files (base wheel vs candidate) with map_compare.py. A hand-run tool, not a build gate.
//
// usage:
//   node pymol-wasm/tests/map_equality.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <result.json>
//        --mirror <pdb-mirror-dir> [--structs 1hsg.cif:small,4ake.cif:medium,8jxu.cif:large,1d3z.cif:multi]
//        [--parallel 4] [--timeout 3600]
//
//   --mirror     local PDB mirror (pdb/<h2>/pdb<id>.ent.gz, mmCIF/<h2>/<id>.cif.gz), e.g.
//                "$PDB_MIRROR"; never the network (pymol-wasm/bench/render/lib_inputs.mjs)
//   --structs    structure:tier list; tiers small | medium | large | multi (the default:
//                1,686 / 3,459 / 22,928 atoms and a 10-state NMR ensemble)
//   --parallel   structures run at once (default 4), each in its own worker thread + fresh Pyodide
//   --timeout    seconds per structure (default 3600); a timeout fails that structure
//
// Items (513 on the default set: 129 + 128 + 121 + 135, each counting the `anchors`
// record): bonding at load (connect_mode 0/2/3/4, connect_cutoff), rebond, 18 distance selections,
// distance modes 0-8 and polar contacts, find_pairs, dss, h_add / h_fill, get_area (5 settings,
// probe radius, state), get_sasa_relative, overlap, sculpt, symexp, ray PNGs, every surface setting,
// mesh, dots, sphere modes, map_new (6 kinds), isomesh / isosurface / isodot (plain and carve
// +-2.5), volume carve, map_trim, and the multi-state variants. Values are digests (counts, md5 of
// the index / bond / coordinate lists, VRML and POV-Ray text, partial-session pickles, PNG bytes).
// An item that raises is recorded as its 'ERR ...' text (a value like any other).
// Memory note: 8jxu's get_area.solvent0_density4 needs about the whole 4 GiB wasm heap. On the
// shipped wheel (2026-11-17) it fails mid-run with "Can't get dot representation" (the heap ends
// at 4008 MiB) although the same call in a fresh runtime succeeds. If a candidate that uses less
// memory gets a number there, that one difference is heap headroom, not changed output.
//
// exit: 0 = every structure ran to the end (no trap, no timeout, no host process start);
// 1 = one did not (the result file says which); 2 = usage / unreadable input.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadStructures } from '../bench/render/lib_inputs.mjs';
import { runJobs } from './map_worker.mjs';

const USAGE = 'usage: node map_equality.mjs <pyodide-core-dir> <numpy.whl> <pymol.whl> <result.json> --mirror <dir>'
  + ' [--structs s:tier,...] [--parallel N] [--timeout S]';
const DEFAULT_STRUCTS = '1hsg.cif:small,4ake.cif:medium,8jxu.cif:large,1d3z.cif:multi';
const TIERS = ['small', 'medium', 'large', 'huge', 'multi'];

const START = String.raw`
import pymol, pymol.invocation, pymol2, json, time, hashlib
pymol.invocation.parse_args(['pymol', '-cq'])
_inst = pymol2.SingletonPyMOL(); _inst.start()
from pymol import cmd
cmd.set('max_threads', 1)
def md5(s):
    return hashlib.md5(s if isinstance(s, (bytes, bytearray)) else str(s).encode()).hexdigest()[:16]
`;

// The item list is ported from an earlier study script; only two Python comments that cited line numbers differ.
const ITEMS = String.raw`
import pickle
R = {}; T = {}
def item(name, fn):
    t = time.perf_counter()
    try:
        v = fn()
    except BaseException as e:
        v = 'ERR ' + type(e).__name__ + ': ' + str(e)[:160]
    T[name] = round((time.perf_counter() - t) * 1000, 1)
    R[name] = v

SMALL = TIER == 'small'; MEDIUM = TIER == 'medium'; HUGE = TIER == 'huge'; LARGE = TIER in ('large', 'huge'); MULTI = TIER == 'multi'
ISPDB = STRUCT.endswith('.pdb') or STRUCT.endswith('.pdb.gz')

def bonds_digest(obj):
    m = cmd.get_model(obj)
    b = sorted((x.index[0], x.index[1], x.order) for x in m.bond)
    return [len(m.atom), len(b), md5(repr(b))]

def idx(sel):
    lst = cmd.index(sel)
    return [len(lst), md5(repr(lst))]

def coords_md5(sel, state=1):
    c = cmd.get_coords(sel, state)
    return None if c is None else [int(c.shape[0]), md5(c.tobytes())]

def scene_digest():
    wrl = cmd.get_vrml()
    r = {'vrml_len': len(wrl), 'vrml': md5(wrl), 'tri': wrl.count(' -1,')}
    del wrl
    if not HUGE:
        pov = cmd.get_povray()[1]
        r.update({'pov_mesh2': pov.count('mesh2 {'), 'cyl': pov.count('cylinder'), 'sph': pov.count('sphere{'), 'pov': md5(pov)})
    return r

def obj_sess(name):
    s = cmd.get_session(name, partial=1)
    return md5(pickle.dumps(s['names'], 2))

# ---------------- load + bonding (ObjectMolecule2.cpp connect) ----------------
cmd.load(STRUCT, 'm')
item('load.bonds', lambda: bonds_digest('m'))
item('load.states', lambda: cmd.count_states('m'))
NAT = cmd.count_atoms('m')
if not LARGE:
    for cm in (0, 2, 3, 4):
        def f(cm=cm):
            cmd.set('connect_mode', cm)
            cmd.load(STRUCT, 'c')
            r = bonds_digest('c'); cmd.delete('c'); cmd.set('connect_mode', 0)
            return r
        item('load.connect_mode_%d' % cm, f)
    def f():
        cmd.set('connect_cutoff', 0.6)
        cmd.load(STRUCT, 'c')
        r = bonds_digest('c'); cmd.delete('c'); cmd.set('connect_cutoff', 0.35)
        return r
    item('load.connect_cutoff_0.6', f)
else:
    def f():
        cmd.set('connect_mode', 2)
        cmd.load(STRUCT, 'c')
        r = bonds_digest('c'); cmd.delete('c'); cmd.set('connect_mode', 0)
        return r
    item('load.connect_mode_2', f)
item('pdbstr', lambda: md5(cmd.get_pdbstr('m', state=1)))
def f():
    cmd.create('rb', 'm', 1, 1)
    cmd.unbond('rb', 'rb')
    n0 = len(cmd.get_model('rb').bond)
    cmd.rebond('rb') if hasattr(cmd, 'rebond') else cmd.do('rebond rb')
    r = [n0] + bonds_digest('rb'); cmd.delete('rb'); return r
item('rebond', f)

# ---------------- anchors ----------------
chains = cmd.get_chains('m and polymer') or ['']
CH = chains[0]
resv = sorted(set(a.resi_number for a in cmd.get_model('m and polymer and name CA and chain "%s"' % CH, 1).atom)) if CH else sorted(set(a.resi_number for a in cmd.get_model('m and polymer and name CA', 1).atom))
r0 = resv[0]; rN = resv[-1]
def rng(a, b):
    lo = resv[min(a, len(resv) - 1)]; hi = resv[min(b, len(resv) - 1)]
    return 'm and chain "%s" and resi %d-%d' % (CH, lo, hi) if CH else 'm and resi %d-%d' % (lo, hi)
S20 = rng(0, 19); S60 = rng(0, 59); S120 = rng(0, 119); MID = rng(20, 59)
HET = 'm and hetatm and not solvent' if cmd.count_atoms('m and hetatm and not solvent') else rng(9, 11)
R['anchors'] = {'chain': CH, 'S60_atoms': cmd.count_atoms(S60), 'HET_atoms': cmd.count_atoms(HET), 'nat': NAT}

# ---------------- selections by distance (Selector.cpp MapEIter users) ----------------
sels = {
  'sel.within4_het': 'm within 4 of (%s)' % HET,
  'sel.within8_s20': 'm within 8 of (%s)' % S20,
  'sel.within20_s20': 'm within 20 of (%s)' % S20,
  'sel.within1.2_s60': 'm within 1.2 of (%s)' % S60,
  'sel.around5': '(%s) around 5' % S20,
  'sel.around12': '(%s) around 12' % HET,
  'sel.expand6': '(%s) expand 6' % S20,
  'sel.byres_expand6': 'byres ((%s) expand 6)' % S20,
  'sel.near_to': '(m and name N) near_to 3.5 of (m and name O)',
  'sel.beyond': '(m and name CA) beyond 25 of (%s)' % S20,
  'sel.gap': 'm and ((%s) gap 2)' % S20,
  'sel.w_abbrev': 'm and name CA w. 6.5 of (%s and name CA)' % S60,
  'sel.solvent_near': 'm and solvent within 3.2 of (m and polymer)',
  'sel.neighbor': 'neighbor (%s)' % HET,
  'sel.extend2': '(%s) extend 2' % HET,
  'sel.bound_to': 'bound_to (%s)' % S20,
  'sel.byres_around': 'byres ((%s) around 4.5)' % HET,
  'sel.pepseq_within': 'm within 6 of (m and name SG+SD+FE+ZN+MG+CA and not polymer.nucleic)',
}
for k, s in sels.items():
    item(k, lambda s=s: idx(s))
if cmd.count_states('m') > 1:
    for st in (2, 5):
        item('sel.within4_state%d' % st, lambda st=st: [cmd.count_atoms('m within 4 of (%s)' % S20, state=st)])

# ---------------- distance modes 0-8 (mode 2 = polar contacts; 5-7 use Interactions.cpp) ----------------
D1 = S60 if not SMALL else 'm'
for mode in (0, 1, 2, 3, 4, 5, 6, 7, 8):
    def f(mode=mode):
        nm = 'd%d' % mode
        v = cmd.distance(nm, D1, 'm' if mode in (2, 5, 6, 7) else S120, 3.6 if mode != 4 else 30.0, mode)
        r = [round(float(v), 4), obj_sess(nm), cmd.get_extent(nm)]
        cmd.delete(nm); return r
    item('distance.mode%d' % mode, f)
def f():
    v = cmd.distance('dpol', 'm and polymer' if not LARGE else S120, 'm and polymer' if not LARGE else 'm', mode=2)
    r = [round(float(v), 4), obj_sess('dpol')]; cmd.delete('dpol'); return r
item('distance.polar_all', f)
if cmd.count_states('m') > 1:
    def f():
        v = cmd.distance('dst', S60, 'm', mode=2, state=3)
        r = [round(float(v), 4), obj_sess('dst')]; cmd.delete('dst'); return r
    item('distance.polar_state3', f)

# ---------------- find_pairs ----------------
for mode in (0, 1):
    item('find_pairs.mode%d' % mode, lambda mode=mode: (lambda p: [len(p), md5(repr(p))])(cmd.find_pairs('m and name N', 'm and name O', mode=mode, cutoff=3.5, angle=45)))
item('find_pairs.ca8', lambda: (lambda p: [len(p), md5(repr(p))])(cmd.find_pairs('%s and name CA' % S120, 'm and name CA', cutoff=8.0)))

# ---------------- dss ----------------
def f():
    cmd.alter('m', "ss=''")
    cmd.dss('m')
    st = []
    cmd.iterate('m and name CA', 'st.append(ss)', space={'st': st})
    return [len(st), md5(''.join(x or '-' for x in st))]
item('dss', f)
if cmd.count_states('m') > 1:
    def f():
        cmd.dss('m', state=4)
        st = []
        cmd.iterate('m and name CA', 'st.append(ss)', space={'st': st})
        return [len(st), md5(''.join(x or '-' for x in st))]
    item('dss.state4', f)

# ---------------- h_add / h_fill ----------------
def f():
    cmd.create('mh', S120 if (LARGE or MEDIUM) else 'm', 1, 1)
    cmd.remove('mh and hydro')
    cmd.h_add('mh')
    r = [cmd.count_atoms('mh'), coords_md5('mh'), bonds_digest('mh')]
    cmd.delete('mh'); return r
item('h_add', f)
def f():
    cmd.create('mh', S60, 1, 1)
    cmd.remove('mh and hydro')
    cmd.edit('first (mh and name CA)')
    cmd.h_fill()
    cmd.edit()
    r = [cmd.count_atoms('mh'), coords_md5('mh')]
    cmd.delete('mh'); return r
item('h_fill', f)

# ---------------- get_area (RepDot.cpp) ----------------
AREA = 'm' if not LARGE else S120
for ds, dd in ((0, 2), (1, 2), (1, 3), (1, 4), (0, 4)):
    def f(ds=ds, dd=dd):
        cmd.set('dot_solvent', ds); cmd.set('dot_density', dd)
        v = cmd.get_area(AREA, load_b=1)
        b = []
        cmd.iterate(AREA, 'b_.append(b)', space={'b_': b})
        return [round(float(v), 3), md5(repr([round(x, 4) for x in b]))]
    item('get_area.solvent%d_density%d' % (ds, dd), f)
cmd.set('dot_solvent', 0); cmd.set('dot_density', 2)
if cmd.count_states('m') > 1:
    item('get_area.state2', lambda: round(float(cmd.get_area(S120, state=2)), 3))
def f():
    cmd.set('dot_solvent', 1); cmd.set('solvent_radius', 2.0)
    v = cmd.get_area(S120); cmd.set('solvent_radius', 1.4); cmd.set('dot_solvent', 0)
    return round(float(v), 3)
item('get_area.probe2.0', f)
if hasattr(cmd, 'get_sasa_relative') and not LARGE:
    item('get_sasa_relative', lambda: (lambda d: [len(d), md5(repr(sorted((k, round(v, 4)) for k, v in d.items())))])(cmd.get_sasa_relative(S60)))

# ---------------- overlap / sculpt / symexp ----------------
item('overlap', lambda: round(float(cmd.overlap(S60, 'm and not (%s)' % S60, 1, 1, 0.0)), 4))
if SMALL or MEDIUM:
    def f():
        cmd.create('sc', S20, 1, 1)
        cmd.sculpt_activate('sc')
        e = cmd.sculpt_iterate('sc', cycles=8)
        r = [round(float(e), 4), coords_md5('sc')]
        cmd.sculpt_deactivate('sc'); cmd.delete('sc'); return r
    item('sculpt', f)
def f():
    if cmd.get_symmetry('m') is None: return 'no symmetry'
    cmd.symexp('sy', 'm', S20, 4.0)
    names = cmd.get_names('objects')
    sy = [n for n in names if n.startswith('sy')]
    r = [len(sy), sum(cmd.count_atoms(n) for n in sy), md5(repr(sorted(sy)))]
    cmd.delete('sy*'); return r
item('symexp', f)

# ---------------- ray (Basis.cpp uses MapSetupExpressXYVert / Perp, not the patched function) ----------------
def png_md5(w=96, h=72):
    cmd.png('/tmp/r.png', width=w, height=h, ray=1, quiet=1)
    d = open('/tmp/r.png', 'rb').read()
    return [len(d), md5(d)]
cmd.hide('everything')
cmd.orient('m')
RAYSEL = 'm' if (SMALL or MULTI) else S120
for rep in (('cartoon',) if HUGE else ('cartoon', 'sticks', 'spheres', 'lines')):
    def f(rep=rep):
        cmd.hide('everything'); cmd.show(rep, RAYSEL if rep != 'cartoon' else 'm')
        return png_md5()
    item('ray.' + rep, f)
cmd.hide('everything')

# ---------------- surface settings ----------------
SURF_ALL = 'm'
SURF_SUB = S120 if not SMALL else 'm'
def surf(setup, sel, undo):
    def f():
        cmd.hide('everything'); cmd.rebuild()
        setup(); cmd.show('surface', sel)
        r = scene_digest()
        undo(); cmd.hide('everything')
        return r
    return f
def S(**kw):
    return (lambda: [cmd.set(k, v) for k, v in kw.items()])
def U(**kw):
    return (lambda: [cmd.set(k, v) for k, v in kw.items()])
item('surface.default_all', surf(lambda: None, SURF_ALL, lambda: None))
item('surface.default_sub', surf(lambda: None, SURF_SUB, lambda: None))
item('surface.quality_-1', surf(S(surface_quality=-1), SURF_ALL, U(surface_quality=0)))
if not LARGE:
    item('surface.quality_-2', surf(S(surface_quality=-2), SURF_ALL, U(surface_quality=0)))
item('surface.quality_1', surf(S(surface_quality=1), SURF_SUB if not SMALL else MID, U(surface_quality=0)))
if SMALL:
    item('surface.quality_2', surf(S(surface_quality=2), S20, U(surface_quality=0)))
for st in (1, 2, 3, 4):
    item('surface.type_%d' % st, surf(S(surface_type=st), SURF_SUB, U(surface_type=0)))
item('surface.solvent_1', surf(S(surface_solvent=1), SURF_SUB, U(surface_solvent=0)))
for sm in (1, 2, 3, 4):
    item('surface.mode_%d' % sm, surf(S(surface_mode=sm), MID, U(surface_mode=0)))
for cm in (1, 2):
    item('surface.cavity_mode_%d' % cm, surf(S(surface_cavity_mode=cm), SURF_SUB, U(surface_cavity_mode=0)))
item('surface.cavity_1_radius', surf(S(surface_cavity_mode=1, surface_cavity_radius=5.0, surface_cavity_cutoff=-4.0), SURF_SUB, U(surface_cavity_mode=0, surface_cavity_radius=7.0, surface_cavity_cutoff=-3.0)))
item('surface.solvent_radius_1.0', surf(S(solvent_radius=1.0), SURF_SUB, U(solvent_radius=1.4)))
item('surface.solvent_radius_2.5', surf(S(solvent_radius=2.5), SURF_SUB, U(solvent_radius=1.4)))
item('surface.proximity_0', surf(S(surface_proximity=0), MID, U(surface_proximity=1)))
item('surface.carve', surf(lambda: (cmd.select('carvesel', HET), cmd.set('surface_carve_selection', 'carvesel'), cmd.set('surface_carve_cutoff', 6.0)), SURF_SUB,
                           lambda: (cmd.set('surface_carve_cutoff', 0.0), cmd.set('surface_carve_selection', ''), cmd.delete('carvesel'))))
item('surface.clear', surf(lambda: (cmd.select('clearsel', S20), cmd.set('surface_clear_selection', 'clearsel'), cmd.set('surface_clear_cutoff', 5.0)), SURF_SUB,
                           lambda: (cmd.set('surface_clear_cutoff', 0.0), cmd.set('surface_clear_selection', ''), cmd.delete('clearsel'))))
item('surface.trim', surf(S(surface_trim_cutoff=1.0, surface_trim_factor=2.0), SURF_SUB, U(surface_trim_cutoff=0.2, surface_trim_factor=2.0)))
item('surface.circumscribe_0', surf(S(surface_circumscribe=0), SURF_SUB, U(surface_circumscribe=-1)))
item('surface.color_smoothing_0', surf(lambda: (cmd.set('surface_color_smoothing', 0), cmd.spectrum('b', 'rainbow', 'm')), SURF_SUB, lambda: (cmd.set('surface_color_smoothing', 1), cmd.color('green', 'm'))))
item('surface.color_spectrum', surf(lambda: cmd.spectrum('count', 'rainbow', 'm and name CA'), SURF_SUB, lambda: cmd.color('green', 'm')))
for ao in (1, 2):
    item('surface.ambient_occlusion_%d' % ao, surf(S(ambient_occlusion_mode=ao), SURF_SUB, U(ambient_occlusion_mode=0)))
item('surface.transparency', surf(S(transparency=0.4), MID, U(transparency=0.0)))
item('surface.ramp_above', surf(lambda: (cmd.ramp_new('rmp', 'm', [0, 10], ['red', 'blue'], selection=HET), cmd.set('surface_color', 'rmp', 'm'), cmd.set('surface_ramp_above_mode', 1)), MID,
                                lambda: (cmd.set('surface_ramp_above_mode', 0), cmd.set('surface_color', -1, 'm'), cmd.delete('rmp'))))
def f():
    cmd.hide('everything'); cmd.rebuild()
    cmd.flag('ignore', S20, 'set'); cmd.show('surface', SURF_SUB)
    r = scene_digest(); cmd.flag('ignore', 'm', 'clear'); cmd.hide('everything'); return r
item('surface.flag_ignore', f)
def f():
    cmd.hide('everything'); cmd.rebuild()
    cmd.flag('exfoliate', S20, 'set'); cmd.show('surface', SURF_SUB)
    r = scene_digest(); cmd.flag('exfoliate', 'm', 'clear'); cmd.hide('everything'); return r
item('surface.flag_exfoliate', f)
if cmd.count_states('m') > 1:
    for st in (2, 7):
        def f(st=st):
            cmd.hide('everything'); cmd.rebuild(); cmd.frame(st); cmd.show('surface', 'm')
            r = scene_digest(); cmd.frame(1); cmd.hide('everything'); return r
        item('surface.state_%d' % st, f)
    def f():
        cmd.hide('everything'); cmd.rebuild(); cmd.set('all_states', 1); cmd.show('surface', S60)
        r = scene_digest(); cmd.set('all_states', 0); cmd.hide('everything'); return r
    item('surface.all_states', f)

# ---------------- mesh / dots / spheres reps ----------------
def rep(repname, sel, setup=lambda: None, undo=lambda: None):
    def f():
        cmd.hide('everything'); cmd.rebuild(); setup(); cmd.show(repname, sel)
        r = scene_digest(); undo(); cmd.hide('everything'); return r
    return f
item('mesh.default', rep('mesh', SURF_SUB))
for mt in (1, 2):
    item('mesh.type_%d' % mt, rep('mesh', MID, S(mesh_type=mt), U(mesh_type=0)))
item('mesh.quality_3', rep('mesh', MID, S(mesh_quality=3), U(mesh_quality=2)))
item('mesh.solvent_1', rep('mesh', MID, S(mesh_solvent=1), U(mesh_solvent=0)))
item('mesh.skip', rep('mesh', MID, S(mesh_skip=5), U(mesh_skip=0)))
item('mesh.carve', rep('mesh', SURF_SUB, lambda: (cmd.select('carvesel', HET), cmd.set('mesh_carve_selection', 'carvesel'), cmd.set('mesh_carve_cutoff', 6.0)),
                       lambda: (cmd.set('mesh_carve_cutoff', 0.0), cmd.set('mesh_carve_selection', ''), cmd.delete('carvesel'))))
item('mesh.clear', rep('mesh', SURF_SUB, lambda: (cmd.select('clearsel', S20), cmd.set('mesh_clear_selection', 'clearsel'), cmd.set('mesh_clear_cutoff', 5.0)),
                       lambda: (cmd.set('mesh_clear_cutoff', 0.0), cmd.set('mesh_clear_selection', ''), cmd.delete('clearsel'))))
item('mesh.cutoff', rep('mesh', MID, S(mesh_cutoff=4.0), U(mesh_cutoff=0.0)))
item('dots.default', rep('dots', MID))
item('dots.solvent_density3', rep('dots', MID, S(dot_solvent=1, dot_density=3), U(dot_solvent=0, dot_density=2)))
item('dots.mode_1', rep('dots', MID, S(dot_mode=1), U(dot_mode=0)))
for sm in (5, 6, 7, 8):
    item('spheres.mode_%d' % sm, rep('spheres', MID, S(sphere_mode=sm), U(sphere_mode=9)))
item('spheres.mode_0', rep('spheres', MID, S(sphere_mode=0), U(sphere_mode=9)))
item('cartoon_sticks', rep('cartoon', 'm' if not LARGE else S120, lambda: cmd.show('sticks', S20)))

# ---------------- maps: map_new / isomesh / isosurface / isodot / volume carve ----------------
MAPSEL = S60
def f():
    cmd.map_new('mp', 'gaussian', 1.0, MAPSEL, 3.0)
    ext = cmd.get_extent('mp')
    fld = cmd.get_volume_field('mp') if hasattr(cmd, 'get_volume_field') else None
    return [ext, None if fld is None else [list(fld.shape), md5(fld.tobytes())]]
item('map_new.gaussian', f)
for typ in ('vdw', 'coulomb', 'gaussian_max', 'coulomb_neutral', 'coulomb_local'):
    def f(typ=typ):
        cmd.map_new('mq', typ, 1.5, S20, 3.0)
        fld = cmd.get_volume_field('mq')
        r = [list(fld.shape), md5(fld.tobytes())]; cmd.delete('mq'); return r
    item('map_new.' + typ, f)
def iso(kind, carve):
    def f():
        cmd.hide('everything'); cmd.rebuild()
        fn = getattr(cmd, kind)
        if carve is None: fn('io', 'mp', 1.0)
        else: fn('io', 'mp', 1.0, S20, carve=carve)
        r = scene_digest(); r['sess'] = obj_sess('io'); cmd.delete('io'); return r
    return f
for kind in ('isomesh', 'isosurface', 'isodot'):
    item(kind + '.plain', iso(kind, None))
    item(kind + '.carve2.5', iso(kind, 2.5))
    item(kind + '.carve-2.5', iso(kind, -2.5))
def f():
    cmd.hide('everything')
    cmd.volume('vl', 'mp', '2fofc', S20, carve=2.5)
    cmd.refresh()
    r = [cmd.get_extent('vl'), obj_sess('vl')]; cmd.delete('vl'); return r
item('volume.carve', f)
def f():
    cmd.map_trim('mp', S20, 2.0)
    fld = cmd.get_volume_field('mp')
    return [cmd.get_extent('mp'), list(fld.shape), md5(fld.tobytes())]
item('map_trim', f)
def f():
    return [round(x, 5) for x in cmd.get_volume_histogram('mp', 16)]
item('map.histogram', f)
cmd.delete('mp')

# ---------------- final state ----------------
item('final.pdbstr', lambda: md5(cmd.get_pdbstr('m', state=1)))
item('final.names', lambda: cmd.get_names('all'))
json.dumps({'R': R, 'T': T})
`;

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function usage(msg) {
  console.error(`map_equality: ${msg}\n${USAGE}`);
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  const pos = [];
  const opt = { parallel: 4, timeout: 3600, structs: DEFAULT_STRUCTS, mirror: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--parallel' || a === '--timeout') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1) usage(`${a} needs a positive integer`);
      opt[a.slice(2)] = v;
    } else if (a === '--structs' || a === '--mirror') {
      if (i + 1 >= argv.length) usage(`${a} needs a value`);
      opt[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) {
      usage(`unknown option ${a}`);
    } else {
      pos.push(a);
    }
  }
  if (pos.length !== 4) usage('expected 4 positional arguments');
  if (!opt.mirror) usage('--mirror is required (the local PDB mirror; never the network)');
  const [core, numpy, pymol, resultPath] = pos;
  const plan = opt.structs.split(',').map((s) => {
    const [name, tier] = s.split(':');
    if (!name || !TIERS.includes(tier)) usage(`bad --structs entry ${JSON.stringify(s)} (tiers: ${TIERS.join(', ')})`);
    return { name, tier };
  });
  if (new Set(plan.map((p) => p.name)).size !== plan.length) usage('a structure is listed twice');
  let structs;
  try {
    for (const f of [path.join(core, 'pyodide.mjs'), numpy, pymol]) if (!existsSync(f)) throw new Error(`missing ${f}`);
    structs = loadStructures(plan.map((p) => p.name), opt.mirror);
  } catch (e) {
    usage(String(e.message || e));
  }

  const t0 = performance.now();
  const jobs = plan.map((p) => ({ name: p.name, core, wheels: [numpy, pymol], files: { ['/tmp/' + p.name]: structs.map.get(p.name) },
    globals: { STRUCT: '/tmp/' + p.name, TIER: p.tier }, code: START + ITEMS }));
  const results = await runJobs(jobs, { parallel: opt.parallel, timeoutMs: opt.timeout * 1000 });

  const out = { probe: 'map_equality', ok: false, expectations: {}, wheel: path.resolve(pymol), wheelSha256: sha256(readFileSync(pymol)),
    numpyWheel: path.resolve(numpy), structures: {}, itemCount: 0 };
  for (const [i, r] of results.entries()) {
    const p = plan[i];
    const failed = !!(r.jsError || r.setupError || r.workerError || r.timedOut) || r.alive !== true || !r.value;
    const items = r.value ? r.value.R : null;
    out.structures[p.name] = { tier: p.tier, input: structs.info[p.name], items, ms: r.value ? r.value.T : null,
      itemCount: items ? Object.keys(items).length : 0, heapMB: r.heapMB, wallS: +(r.ms / 1000).toFixed(1),
      jsError: r.jsError, setupError: r.setupError, workerError: r.workerError, timedOut: r.timedOut || undefined,
      hostCalls: r.hostCalls };
    out.itemCount += out.structures[p.name].itemCount;
    out.expectations[`${p.name}: ran to the end`] = !failed;
    out.expectations[`${p.name}: no host process start attempted`] = (r.hostCalls || []).length === 0;
  }
  out.wallS = +((performance.now() - t0) / 1000).toFixed(1);
  out.ok = Object.keys(out.expectations).length > 0 && Object.values(out.expectations).every((v) => v === true);
  writeFileSync(resultPath, JSON.stringify(out, null, 1) + '\n');
  const per = plan.map((p) => `${p.name} ${out.structures[p.name].itemCount}`).join(', ');
  const bad = Object.entries(out.expectations).filter(([, v]) => !v).map(([k]) => k);
  console.log(`map_equality: ${out.itemCount} items (${per}), ${out.wallS} s` + (bad.length ? ` | FAILED: ${bad.join('; ')}` : ' | ok'));
  return out.ok;
}

main().then((ok) => process.exit(ok ? 0 : 1), (e) => {
  console.error(`map_equality: tool failed: ${(e && e.stack) || e}`);
  process.exit(1);
});
