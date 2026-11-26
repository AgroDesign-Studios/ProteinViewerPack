"""Unit tests for the restricted unpickler that patch 0006 adds to chempy/pkl.py,
and for patch 0014's bundled-data branch of PKL.fromFile in the same file.

Standard library only, and run against the PATCHED PyMOL source tree itself,
never a copy of the code:

    python3 -I -B tests/test_restricted_unpickler.py <pymol checkout>/modules

build.sh runs this right after the patches apply and stops the build if any
case fails. `pymol` (whose __init__ needs the wasm _cmd module) and numpy are
replaced by stub modules that carry just the names the allow-list resolves.

What is pinned (TN0110 §4.2-6, §7-29, D2/D3/D5):
  - session-shaped pickles load through every replaced entry point, at every
    protocol PyMOL can meet;
  - PyMOL 2.x-era names (__builtin__.bytearray, copy_reg._reconstructor) load,
    because _compat_pickle mapping runs BEFORE the allow-list check;
  - os.system / posix.system / eval / exec / getattr are refused through every
    opcode that names a global, also after mapping, also when a session nests
    them in its session['wizard'] pickle, also through pickle.loads (the C++
    PConvPickleLoads path) and not only through chempy;
  - the allow-list is exactly the 18 names of §4.2-6, cPickle.load is untouched,
    and nothing a caller passes turns the restriction off;
  - patch 0014: PKL.fromFile reads a file whose realpath lies inside the
    realpath of $PYMOL_DATA with the stdlib C unpickler, and every other file
    (outside, a ".." escape, a symlink pointing out, $PYMOL_DATA unset or
    empty, a URL) with cPickle.load as before, told apart by effect; every
    session entry point still refuses a payload stored inside $PYMOL_DATA.
Every refusal case is paired with a positive control that runs the same bytes
through the stdlib C unpickler (left unrestricted) and observes the payload's
side effect, so a refusal cannot pass because the payload was inert.
"""

import collections
import copyreg
import importlib
import io
import os
import pickle
import pickletools
import shutil
import sys
import tempfile
import types
import unittest

if len(sys.argv) < 2 or not os.path.isdir(os.path.join(sys.argv[1], "chempy")):
    sys.exit("usage: python3 -I -B test_restricted_unpickler.py <pymol checkout>/modules")
MODULES_DIR = os.path.abspath(sys.argv.pop(1))
sys.path.insert(0, MODULES_DIR)

# The stdlib objects patch 0006 must replace or must leave alone, captured
# before chempy.pkl is imported.
ORIG_C_LOADS = pickle.loads
ORIG_PY_LOADS = pickle._loads
ORIG_PY_LOAD = pickle._load
ORIG_LOAD = pickle.load
ORIG_C_UNPICKLER = pickle.Unpickler
ORIG_PY_UNPICKLER = pickle._Unpickler
ORIG_PY_FIND_CLASS = pickle._Unpickler.find_class

EXPECTED_ALLOWED = frozenset(
    {
        ("pymol", "Session_Storage"),
        ("_codecs", "encode"),
        ("chempy", "Storage"),
        ("chempy", "Atom"),
        ("chempy", "Bond"),
        ("chempy.models", "Indexed"),
        ("chempy.models", "Connected"),
        ("builtins", "bytearray"),
        ("builtins", "bytes"),
        ("builtins", "complex"),
        ("collections", "OrderedDict"),
        ("copyreg", "_reconstructor"),
        ("numpy", "dtype"),
        ("numpy", "ndarray"),
        ("numpy.core.multiarray", "_reconstruct"),
        ("numpy._core.multiarray", "_reconstruct"),
        ("numpy._core.multiarray", "scalar"),
        ("numpy.core.multiarray", "scalar"),
    }
)


def _module(name, **attrs):
    mod = types.ModuleType(name)
    for key, value in attrs.items():
        if isinstance(value, type) or isinstance(value, types.FunctionType):
            value.__module__ = name
        setattr(mod, key, value)
    sys.modules[name] = mod
    return mod


# --- stubs -------------------------------------------------------------------
class Session_Storage:  # same shape as pymol/__init__.py:Session_Storage
    def __reduce__(self):
        return (self.__class__, (), self.__dict__)


class CmdException(Exception):
    pass


class Mutagenesis:  # stands in for a real wizard class; never allow-listed
    pass


_module("pymol", Session_Storage=Session_Storage, CmdException=CmdException)
_module("pymol.wizard")
_module("pymol.wizard.mutagenesis", Mutagenesis=Mutagenesis)


class ndarray:
    pass


class dtype:
    pass


def _reconstruct(*args):
    return ("numpy-reconstruct", args)


def scalar(*args):
    return ("numpy-scalar", args)


_module("numpy", ndarray=ndarray, dtype=dtype)
_module("numpy.core")
_module("numpy.core.multiarray", _reconstruct=_reconstruct, scalar=scalar)
_module("numpy._core")
_module("numpy._core.multiarray", _reconstruct=_reconstruct, scalar=scalar)

# Payloads record here; a hit means the payload's code really ran.
MARKER = _module("_pw_marker")
MARKER.hits = []

import chempy  # noqa: E402  (after the stubs and sys.path)
import chempy.models  # noqa: E402
import chempy.pkl  # noqa: E402

try:
    import chempy.io as chempy_io  # noqa: E402

    WIZARD_PKL = chempy_io.pkl  # what wizarding.session_restore_wizard calls
except Exception:  # chempy.io pulls every format module; fall back to the same class
    WIZARD_PKL = chempy.pkl.PKL()

cPickle = chempy.pkl.cPickle
RESTRICTED_ENTRY_POINTS = {
    "chempy.pkl.cPickle.loads": cPickle.loads,
    "pickle.loads": pickle.loads,
    "pickle._loads": pickle._loads,
    "chempy.pkl.PKL.fromString": chempy.pkl.PKL().fromString,  # load_pse's call
}


class _ReduceTo:
    """Pickles as ``func(*args)`` (a REDUCE of ``func``), for testing which
    globals the unpickler is willing to invoke directly."""

    def __init__(self, func, args):
        self._func = func
        self._args = args

    def __reduce__(self):
        return (self._func, self._args)


def _exec_code(tag):
    return f"import sys; sys.modules['_pw_marker'].hits.append({tag!r})"


def _p0_call(module, name, text_arg):
    """Protocol-0 GLOBAL + REDUCE: module.name(text_arg)."""
    return f"c{module}\n{name}\n(V{text_arg}\ntR.".encode("raw_unicode_escape")


def _p2_call(module, name, text_arg):
    """Protocol-2 GLOBAL + REDUCE (the form PyMOL 2.x-era pickles take)."""
    return b"\x80\x02" + _p0_call(module, name, text_arg)


def _sbu(s):
    data = s.encode("utf-8")
    return b"\x8c" + bytes([len(data)]) + data


def _p4_call(module, name, text_arg):
    """Protocol-4 STACK_GLOBAL + REDUCE."""
    return b"\x80\x04" + _sbu(module) + _sbu(name) + b"\x93" + _sbu(text_arg) + b"\x85R."


def _inst_call(module, name, text_arg):
    """Protocol-0 INST: instantiates module.name(text_arg)."""
    return f"(V{text_arg}\ni{module}\n{name}\n.".encode("raw_unicode_escape")


def _obj_call(module, name, text_arg):
    """Protocol-1 OBJ: calls module.name(text_arg)."""
    return f"(c{module}\n{name}\nV{text_arg}\no.".encode("raw_unicode_escape")


CALL_FORMS = {"GLOBAL/p0": _p0_call, "GLOBAL/p2": _p2_call, "STACK_GLOBAL/p4": _p4_call, "INST": _inst_call, "OBJ": _obj_call}


class _Recorder:
    """Swapped in for os.system & co. so a broken restriction is observed, never executed."""

    def __init__(self):
        self.calls = []

    def __call__(self, *args, **kwargs):
        self.calls.append(args)
        return 0


class _Base(unittest.TestCase):
    def setUp(self):
        MARKER.hits.clear()

    def assertRefused(self, data, entry_points=None, msg_part=None):
        for label, fn in (entry_points or RESTRICTED_ENTRY_POINTS).items():
            with self.subTest(entry_point=label):
                with self.assertRaises(pickle.UnpicklingError) as cm:
                    fn(data)
                if msg_part:
                    self.assertIn(msg_part, str(cm.exception))
        self.assertEqual(MARKER.hits, [], "a refused payload still ran")


# --- the patch is installed, and only where it should be --------------------
class TestInstallation(unittest.TestCase):
    def test_allow_list_is_exactly_the_18_names(self):
        self.assertEqual(chempy.pkl.RESTRICTED_GLOBALS, EXPECTED_ALLOWED)
        self.assertEqual(len(EXPECTED_ALLOWED), 18)
        self.assertIsInstance(chempy.pkl.RESTRICTED_GLOBALS, frozenset)

    def test_never_called_directly_is_ndarray_only(self):
        self.assertEqual(chempy.pkl._NEVER_CALLED_DIRECTLY, frozenset([("numpy", "ndarray")]))
        # every blocked name is also a resolvable (allow-listed) name
        self.assertTrue(chempy.pkl._NEVER_CALLED_DIRECTLY <= chempy.pkl.RESTRICTED_GLOBALS)

    def test_stdlib_loads_entry_points_are_replaced(self):
        self.assertIs(pickle.loads, chempy.pkl.restricted_loads)
        self.assertIs(pickle._loads, chempy.pkl.restricted_loads)
        self.assertIsNot(pickle.loads, ORIG_C_LOADS)
        # PConvPickleLoads does PyImport_ImportModule("pickle") then .loads:
        self.assertIs(importlib.import_module("pickle").loads, chempy.pkl.restricted_loads)

    def test_file_load_and_base_classes_are_untouched(self):
        # cPickle.load reads the bundled, trusted fragments / mutagenesis data
        self.assertIs(cPickle.load, ORIG_PY_LOAD)
        self.assertIs(pickle._load, ORIG_PY_LOAD)
        self.assertIs(pickle.load, ORIG_LOAD)
        self.assertIs(pickle.Unpickler, ORIG_C_UNPICKLER)
        self.assertIs(pickle._Unpickler, ORIG_PY_UNPICKLER)
        self.assertIs(pickle._Unpickler.find_class, ORIG_PY_FIND_CLASS)

    def test_restricted_unpickler_is_the_python_implementation(self):
        # so chempy's py2 string decoding keeps applying to sessions
        self.assertTrue(issubclass(chempy.pkl.RestrictedUnpickler, pickle._Unpickler))
        self.assertIs(chempy.pkl.RestrictedUnpickler._decode_string, pickle._Unpickler._decode_string)


# --- legitimate sessions load ------------------------------------------------
def _session(proto):
    store = Session_Storage()
    store.note = "kept across save/load"
    atom = chempy.Atom()
    atom.name, atom.resn, atom.coord = "CA", "ALA", [1.0, 2.0, 3.0]
    session = {
        "version": 3020000,
        "main": [800, 600, 1, 0],
        "settings": [[1, 1, 0.5], [2, 5, "text"], [3, 4, [0.1, 0.2, 0.3]]],
        "names": [None, ["obj01", 0, 1, [[-1.0, 1.0], [0, 1]], 1, [1, 2, 3]]],
        "colors": [["custom", 1, (0.1, 0.2, 0.3)]],
        "view": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -50.0, 1.0, 2.0, 3.0, 40.0, 60.0, -20.0],
        "view_dict": {},
        "movie": [0, 0, None, 0, None, None],
        "editor": None,
        "wizard": pickle.dumps([], 1),  # session_save_wizard always stores a pickle
        "session": store,
        "cache": [],
        "blob": b"\x00\x01\xfe\xff",
        "label": "ACE",
        "flags": (True, False, None),
        "bytearray": bytearray(b"\x00abc"),
        "complex": complex(1.5, -2.0),
        "ordered": collections.OrderedDict([("b", 1), ("a", 2)]),
        "atom": atom,
    }
    if proto >= 2:
        # plain classes pickle via copyreg.__newobj__ (NEWOBJ) from protocol 2;
        # at 0/1 they would need builtins.object, which no session carries
        bond = chempy.Bond()
        bond.index, bond.order = [0, 1], 2
        session["bond"] = bond
        session["storage"] = chempy.Storage()
    return session


def _norm(obj):
    if isinstance(obj, (Session_Storage, chempy.Atom, chempy.Bond, chempy.Storage)):
        return (type(obj).__name__, _norm(dict(obj.__dict__)))
    if isinstance(obj, collections.OrderedDict):
        return ("OrderedDict", [(k, _norm(v)) for k, v in obj.items()])
    if isinstance(obj, dict):
        return {k: _norm(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return (type(obj).__name__, [_norm(v) for v in obj])
    return (type(obj).__name__, obj)


class TestLegitimateSessions(_Base):
    def test_session_round_trips_through_every_entry_point_and_protocol(self):
        for proto in range(pickle.HIGHEST_PROTOCOL + 1):
            session = _session(proto)
            data = pickle.dumps(session, proto)
            for label, fn in RESTRICTED_ENTRY_POINTS.items():
                with self.subTest(proto=proto, entry_point=label):
                    self.assertEqual(_norm(fn(data)), _norm(session))

    def test_pymol_save_path_protocol_1_through_cpickle(self):
        # exporting.py writes sessions with cPickle.dumps(session, 1)
        session = _session(1)
        self.assertEqual(_norm(cPickle.loads(cPickle.dumps(session, 1))), _norm(session))

    def test_legacy_py2_string_dump_loads(self):
        # pse_export_version < 1.9 writes py2 STRING opcodes; chempy decodes them
        cPickle.configure_legacy_dump(True)
        try:
            data = cPickle.dumps({"name": "obj01", "raw": b"\x00\xff", "n": [1, 2.5]}, 1)
        finally:
            cPickle.configure_legacy_dump(False)
        out = cPickle.loads(data)
        self.assertEqual(out, {"name": "obj01", "raw": b"\x00\xff", "n": [1, 2.5]})

    def test_cpickle_loads_still_accepts_str_input(self):
        self.assertEqual(cPickle.loads(pickle.dumps([1, "a"], 0).decode("ascii")), [1, "a"])

    def test_numpy_names_resolve(self):
        for module, name in sorted(n for n in EXPECTED_ALLOWED if n[0].startswith("numpy")):
            with self.subTest(name=f"{module}.{name}"):
                data = f"c{module}\n{name}\n.".encode()
                self.assertIs(pickle.loads(data), getattr(sys.modules[module], name))

    def test_wizard_bytes_survive_as_bytes(self):
        inner = pickle.dumps([], 1)
        out = cPickle.loads(cPickle.dumps({"wizard": inner}, 1))
        self.assertEqual(out["wizard"], inner)
        self.assertEqual(WIZARD_PKL.fromString(out["wizard"]), [])


class TestPyMOL2Names(_Base):
    """D3: map with _compat_pickle first, then check the allow-list."""

    def test_builtin_bytearray_loads(self):
        data = pickle.dumps(bytearray(b"xyz"), 2)
        self.assertIn(b"c__builtin__\nbytearray\n", data)
        for label, fn in RESTRICTED_ENTRY_POINTS.items():
            with self.subTest(entry_point=label):
                self.assertEqual(fn(data), bytearray(b"xyz"))

    def test_builtin_complex_loads_at_protocols_0_to_2(self):
        for proto in (0, 1, 2):
            data = pickle.dumps(complex(1, 2), proto)
            self.assertIn(b"__builtin__\ncomplex\n", data)
            self.assertEqual(pickle.loads(data), complex(1, 2))

    def test_copy_reg_reconstructor_resolves(self):
        for data in (b"ccopy_reg\n_reconstructor\n.", b"\x80\x02ccopy_reg\n_reconstructor\n."):
            for label, fn in RESTRICTED_ENTRY_POINTS.items():
                with self.subTest(entry_point=label, data=data):
                    self.assertIs(fn(data), copyreg._reconstructor)

    def test_copy_reg_reconstructor_call_with_allowed_classes(self):
        data = b"ccopy_reg\n_reconstructor\n(ccollections\nOrderedDict\nccollections\nOrderedDict\n(ltR."
        out = pickle.loads(data)
        self.assertEqual(out, collections.OrderedDict())
        self.assertIs(type(out), collections.OrderedDict)

    def test_empty_bytes_loads_at_every_protocol(self):
        """builtins.bytes is allow-listed (owner, 2026-10-12) so pse_binary_dump
        sessions whose zero-length array pickles as builtins.bytes() load.

        Below protocol 3 an EMPTY bytes object pickles as builtins.bytes(), not
        _codecs.encode; PyMOL writes one with pse_binary_dump on for a
        zero-length array (e.g. the bond blob of an object with no bonds)."""
        data = pickle.dumps({"blob": b""}, 1)
        self.assertIn(b"__builtin__\nbytes\n", data)  # the py2-mapped name
        for p in range(pickle.HIGHEST_PROTOCOL + 1):
            with self.subTest(proto=p):
                self.assertEqual(pickle.loads(pickle.dumps({"blob": b""}, p)), {"blob": b""})

    def test_mapping_is_skipped_from_protocol_4(self):
        # a py2 name never appears in a protocol-4 pickle, and is not mapped there
        data = b"\x80\x04" + _sbu("__builtin__") + _sbu("bytearray") + b"\x93."
        self.assertRefused(data, msg_part="__builtin__.bytearray")


# --- dangerous globals are refused -------------------------------------------
class TestRefusals(_Base):
    def setUp(self):
        super().setUp()
        import posix
        import subprocess

        self.recorder = _Recorder()
        self._saved = [(os, "system", os.system), (posix, "system", posix.system), (subprocess, "getoutput", subprocess.getoutput)]
        for mod, attr, _ in self._saved:
            setattr(mod, attr, self.recorder)

    def tearDown(self):
        for mod, attr, value in self._saved:
            setattr(mod, attr, value)
        self.assertEqual(self.recorder.calls, [], "a shell/subprocess call got through")

    def test_positive_control_payloads_run_without_the_restriction(self):
        for form, build in CALL_FORMS.items():
            with self.subTest(form=form):
                MARKER.hits.clear()
                ORIG_C_LOADS(build("builtins", "exec", _exec_code(form)))
                self.assertEqual(MARKER.hits, [form])
        MARKER.hits.clear()
        ORIG_C_LOADS(_p0_call("os", "system", "true"))
        self.assertEqual(len(self.recorder.calls), 1)
        self.recorder.calls.clear()

    def test_exec_and_eval_refused_through_every_opcode(self):
        for form, build in CALL_FORMS.items():
            for name in ("exec", "eval"):
                with self.subTest(form=form, name=name):
                    self.assertRefused(build("builtins", name, _exec_code(form)), msg_part=f"builtins.{name}")

    def test_os_and_posix_system_refused(self):
        for form, build in CALL_FORMS.items():
            for module in ("os", "posix", "nt", "subprocess"):
                with self.subTest(form=form, module=module):
                    self.assertRefused(build(module, "system", "true"))

    def test_getattr_refused(self):
        # builtins.getattr(<allowed class>, '__init__') would walk to __globals__
        data = b"cbuiltins\ngetattr\n(cchempy\nAtom\nV__init__\ntR."
        self.assertRefused(data, msg_part="builtins.getattr")
        self.assertRefused(b"\x80\x02c__builtin__\ngetattr\n(cchempy\nAtom\nV__init__\ntR.", msg_part="builtins.getattr")

    def test_refused_after_compat_mapping(self):
        cases = [
            ("__builtin__", "eval", "builtins.eval"),
            ("__builtin__", "getattr", "builtins.getattr"),
            ("__builtin__", "__import__", "builtins.__import__"),
            ("posix", "system", "posix.system"),
            ("commands", "getoutput", "subprocess.getoutput"),
        ]
        for module, name, mapped in cases:
            with self.subTest(name=f"{module}.{name}"):
                self.assertRefused(_p2_call(module, name, _exec_code(name)), msg_part=mapped)
                self.assertRefused(_p0_call(module, name, _exec_code(name)), msg_part=mapped)

    def test_dotted_names_never_walk_attributes(self):
        for module, name in (("chempy", "Atom.__init__"), ("chempy", "Atom.__init__.__globals__"), ("builtins", "bytearray.fromhex"), ("pymol", "Session_Storage.__reduce__")):
            with self.subTest(name=f"{module}.{name}"):
                self.assertRefused(b"\x80\x04" + _sbu(module) + _sbu(name) + b"\x93.", msg_part=f"{module}.{name}")

    def test_refused_module_is_never_imported(self):
        sys.modules.pop("this", None)  # importing `this` prints the Zen of Python
        self.assertRefused(b"cthis\ns\n.", msg_part="this.s")
        self.assertNotIn("this", sys.modules)

    def test_extension_codes_go_through_find_class(self):
        code = 0x7FFFF0
        copyreg.add_extension("os", "system", code)
        try:
            data = b"\x80\x02\x84" + code.to_bytes(4, "little") + b"Vtrue\n\x85R."
            self.assertRefused(data, msg_part="os.system")
            # an entry some earlier, unrestricted unpickler cached must not be reused
            copyreg._extension_cache[code] = self.recorder
            self.assertRefused(data, msg_part="os.system")
        finally:
            copyreg._extension_cache.pop(code, None)
            copyreg.remove_extension("os", "system", code)
        self.assertRefused(b"\x80\x02\x82\x07.")  # unregistered code

    def test_persistent_ids_refused(self):
        self.assertRefused(b"Pany\n.", msg_part="persistent")
        self.assertRefused(b"\x80\x02X\x03\x00\x00\x00anyQ.", msg_part="persistent")

    def test_build_cannot_rewrite_an_allowed_class(self):
        data = b"cchempy.models\nIndexed\n(N(dVpw_polluted\nI1\nstb."
        # positive control: the stdlib unpickler really does set it on the class
        ORIG_C_LOADS(data)
        self.assertEqual(getattr(chempy.models.Indexed, "pw_polluted", None), 1)
        del chempy.models.Indexed.pw_polluted
        self.assertRefused(data, msg_part="BUILD on a global")
        self.assertFalse(hasattr(chempy.models.Indexed, "pw_polluted"))
        # the same through a memo reference, and on an allowed function
        self.assertRefused(b"cpymol\nSession_Storage\np0\n0g0\n(N(dVx\nI1\nstb.", msg_part="BUILD on a global")
        self.assertRefused(b"ccopy_reg\n_reconstructor\n(dVx\nI1\nsb.", msg_part="BUILD on a global")
        self.assertFalse(hasattr(Session_Storage, "x"))
        self.assertFalse(hasattr(copyreg._reconstructor, "x"))

    def test_build_on_an_instance_still_works(self):
        atom = chempy.Atom()
        atom.name = "N"
        self.assertEqual(pickle.loads(pickle.dumps(atom, 2)).name, "N")


class TestNeverCalledDirectly(_Base):
    """numpy.ndarray may be resolved and passed as an argument, but never
    invoked as a callable (the object-dtype-buffer crash, decision A 2026-10-12).
    numpy is stubbed here, so this pins the MECHANISM; the real crash and the
    real array round-trip are pinned by smoke_wheel.mjs."""

    def setUp(self):
        super().setUp()
        self.ndarray = sys.modules["numpy"].ndarray
        self.reconstruct = sys.modules["numpy._core.multiarray"]._reconstruct

    def test_reduce_call_of_ndarray_refused(self):
        data = pickle.dumps(_ReduceTo(self.ndarray, ((1,), "dt", b"\x00\x10\x00\x00")), 2)
        self.assertIn(b"numpy\nndarray\n", data)
        self.assertRefused(data, msg_part="numpy.ndarray")

    def test_newobj_of_ndarray_refused(self):
        # proto-2 STACK-less NEWOBJ: GLOBAL ndarray, EMPTY_TUPLE, NEWOBJ
        data = b"\x80\x02cnumpy\nndarray\n)\x81."
        self.assertRefused(data, msg_part="numpy.ndarray")

    def test_inst_of_ndarray_refused(self):
        data = b"(inumpy\nndarray\n."  # MARK, INST numpy ndarray
        self.assertRefused(data, msg_part="numpy.ndarray")

    def test_ndarray_allowed_as_reconstruct_argument(self):
        # _reconstruct(ndarray, (1,), 'dt') -> the stub returns a marker tuple;
        # ndarray is resolved and passed, never called.
        data = pickle.dumps(_ReduceTo(self.reconstruct, (self.ndarray, (1,), "dt")), 2)
        for label, fn in RESTRICTED_ENTRY_POINTS.items():
            with self.subTest(entry_point=label):
                out = fn(data)
                self.assertEqual(out[0], "numpy-reconstruct")
                self.assertIs(out[1][0], self.ndarray)
        self.assertEqual(MARKER.hits, [])

    def test_ndarray_still_resolves_as_a_bare_global(self):
        # resolve-only (GLOBAL + STOP) is how it reaches the stack as an argument
        self.assertIs(pickle.loads(b"cnumpy\nndarray\n."), self.ndarray)


class TestNestedWizard(_Base):
    """D5: the nested session['wizard'] pickle must go through the restricted loader too."""

    def _outer(self, inner):
        return cPickle.dumps({"version": 3020000, "names": [None], "wizard": inner}, 1)

    def test_positive_control_nested_payload_runs_without_the_restriction(self):
        inner = _p2_call("builtins", "exec", _exec_code("wizard"))
        ORIG_C_LOADS(ORIG_C_LOADS(self._outer(inner))["wizard"])
        self.assertEqual(MARKER.hits, ["wizard"])

    def test_bad_global_in_nested_wizard_refused(self):
        for form, build in CALL_FORMS.items():
            with self.subTest(form=form):
                session = cPickle.loads(self._outer(build("builtins", "exec", _exec_code(form))))
                # the outer session loads; its wizard pickle is only bytes until restored
                self.assertIsInstance(session["wizard"], bytes)
                # wizarding.session_restore_wizard -> chempy.io.pkl.fromString
                with self.assertRaises(pickle.UnpicklingError):
                    WIZARD_PKL.fromString(session["wizard"])
                self.assertRefused(session["wizard"])

    def test_real_wizard_objects_are_not_restored(self):
        inner = pickle.dumps([Mutagenesis()], 1)
        session = cPickle.loads(self._outer(inner))
        with self.assertRaises(pickle.UnpicklingError) as cm:
            WIZARD_PKL.fromString(session["wizard"])
        self.assertIn("pymol.wizard.mutagenesis.Mutagenesis", str(cm.exception))


class TestUnconditional(_Base):
    """D7: nothing a caller passes switches the restriction off."""

    def test_keyword_arguments_do_not_disable_it(self):
        data = _p2_call("builtins", "exec", _exec_code("kw"))
        variants = [
            {"fix_imports": False},
            {"encoding": "bytes"},
            {"encoding": "latin1", "errors": "ignore"},
            {"buffers": []},
        ]
        for kwargs in variants:
            for label, fn in (("pickle.loads", pickle.loads), ("pickle._loads", pickle._loads)):
                with self.subTest(entry_point=label, kwargs=kwargs):
                    with self.assertRaises(pickle.UnpicklingError):
                        fn(data, **kwargs)
        self.assertEqual(MARKER.hits, [])

    def test_str_and_bytearray_inputs(self):
        data = _p0_call("builtins", "exec", _exec_code("str"))
        with self.assertRaises(TypeError):
            pickle.loads(data.decode("raw_unicode_escape"))
        with self.assertRaises(pickle.UnpicklingError):
            cPickle.loads(data.decode("raw_unicode_escape"))
        with self.assertRaises(pickle.UnpicklingError):
            pickle.loads(bytearray(data))
        self.assertEqual(MARKER.hits, [])

    def test_out_of_band_buffers_still_work(self):
        self.assertEqual(pickle.loads(pickle.dumps([1, 2, b"x"], 5), buffers=[]), [1, 2, b"x"])

    def test_payloads_are_well_formed(self):
        # guards against a refusal that only "passes" because the bytes are garbage
        for form, build in CALL_FORMS.items():
            with self.subTest(form=form):
                ops = [op.name for op, _, _ in pickletools.genops(build("builtins", "exec", "1"))]
                self.assertEqual(ops[-1], "STOP")


# --- patch 0014: bundled data through the C unpickler ------------------------
# A protocol-0 STRING whose bytes are not printable ASCII tells the two file
# loaders apart by effect: chempy's _decode_string keeps it as bytes on the
# pure-Python path (cPickle.load); the C unpickler decodes it to str.
CANARY = b"S'\\x01ab'\n."
VIA_C, VIA_PY = "\x01ab", b"\x01ab"


class TestBundledFileLoad(_Base):
    """Patch 0014: which loader PKL.fromFile picks, and that the session
    entry points stay restricted whatever $PYMOL_DATA holds."""

    def setUp(self):
        super().setUp()
        self._saved_env = os.environ.get("PYMOL_DATA")
        self._saved_cwd = os.getcwd()
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="pw_pkl_"))
        self.data = os.path.join(self.tmp, "data")
        self.frag = os.path.join(self.data, "chempy", "fragments")
        self.out = os.path.join(self.tmp, "outside")
        for d in (self.frag, self.out, self.data + "-sibling"):
            os.makedirs(d)
            with open(os.path.join(d, "canary.pkl"), "wb") as fh:
                fh.write(CANARY)
        os.environ["PYMOL_DATA"] = self.data

    def tearDown(self):
        os.chdir(self._saved_cwd)
        if self._saved_env is None:
            os.environ.pop("PYMOL_DATA", None)
        else:
            os.environ["PYMOL_DATA"] = self._saved_env
        shutil.rmtree(self.tmp)

    def _via(self, fname):
        """Which loader PKL.fromFile used for fname, read off the canary's type."""
        seen = set()
        for pkl in (chempy.pkl.PKL(), WIZARD_PKL):
            got = pkl.fromFile(fname)
            if type(got) is str and got == VIA_C:
                seen.add("C")
            elif type(got) is bytes and got == VIA_PY:
                seen.add("Python")
            else:
                seen.add(repr(got))
        self.assertEqual(len(seen), 1, seen)
        return seen.pop()

    def test_control_the_canary_tells_the_loaders_apart(self):
        path = os.path.join(self.out, "canary.pkl")
        with open(path, "rb") as fh:
            self.assertEqual(ORIG_LOAD(fh), VIA_C)  # the stdlib C unpickler
        with open(path, "rb") as fh:
            self.assertEqual(cPickle.load(fh), VIA_PY)  # nosemgrep: avoid-cPickle — pure Python, chempy's decoding of the test's own canary file
        self.assertIs(type(VIA_C), str)
        self.assertIs(type(VIA_PY), bytes)

    def test_inside_pymol_data_uses_the_c_unpickler(self):
        self.assertEqual(self._via(os.path.join(self.frag, "canary.pkl")), "C")
        # the form the runtime builds: PYMOL_DATA + '/chempy/fragments/<name>.pkl'
        self.assertEqual(self._via(self.data + "/chempy/fragments/canary.pkl"), "C")

    def test_outside_pymol_data_keeps_the_python_path(self):
        self.assertEqual(self._via(os.path.join(self.out, "canary.pkl")), "Python")
        # a sibling sharing the string prefix ".../data" is still outside
        self.assertEqual(self._via(self.data + "-sibling/canary.pkl"), "Python")

    def test_dotdot_escape_keeps_the_python_path(self):
        self.assertEqual(self._via(self.data + "/chempy/../../outside/canary.pkl"), "Python")
        self.assertEqual(self._via(self.frag + "/../../../outside/canary.pkl"), "Python")
        # ".." that ends inside names a bundled file
        self.assertEqual(self._via(self.out + "/../data/chempy/fragments/canary.pkl"), "C")

    def test_symlink_inside_pointing_outside_keeps_the_python_path(self):
        os.symlink(os.path.join(self.out, "canary.pkl"), os.path.join(self.frag, "link.pkl"))
        os.symlink(self.out, os.path.join(self.frag, "linkdir"))
        self.assertEqual(self._via(os.path.join(self.frag, "link.pkl")), "Python")
        self.assertEqual(self._via(os.path.join(self.frag, "linkdir", "canary.pkl")), "Python")

    def test_symlinked_pymol_data_resolves_on_both_sides(self):
        link = os.path.join(self.tmp, "data-link")
        os.symlink(self.data, link)
        os.environ["PYMOL_DATA"] = link
        self.assertEqual(self._via(os.path.join(link, "chempy", "fragments", "canary.pkl")), "C")
        self.assertEqual(self._via(os.path.join(self.frag, "canary.pkl")), "C")
        self.assertEqual(self._via(os.path.join(self.out, "canary.pkl")), "Python")

    def test_pymol_data_unset_or_empty_keeps_the_python_path(self):
        inside = os.path.join(self.frag, "canary.pkl")
        del os.environ["PYMOL_DATA"]
        self.assertEqual(self._via(inside), "Python")
        os.environ["PYMOL_DATA"] = ""
        self.assertEqual(self._via(inside), "Python")
        os.chdir(self.data)  # an empty value does not mean the working directory
        self.assertEqual(self._via("chempy/fragments/canary.pkl"), "Python")

    def test_relative_names_resolve_against_the_working_directory(self):
        os.chdir(self.data)
        self.assertEqual(self._via("chempy/fragments/canary.pkl"), "C")
        os.chdir(self.out)
        self.assertEqual(self._via("canary.pkl"), "Python")

    def test_a_url_is_never_bundled(self):
        # Storage.my_open fetches any name holding '://', so such a name is not
        # a file under $PYMOL_DATA even when it would resolve inside it.
        os.chdir(self.data)
        os.makedirs(os.path.join(self.data, "http:", "host"))
        self.assertTrue(os.path.realpath("http://host/x.pkl").startswith(self.data + os.sep))
        self.assertFalse(chempy.pkl._bundled_file("http://host/x.pkl"))
        self.assertTrue(chempy.pkl._bundled_file(os.path.join(self.frag, "canary.pkl")))

    def test_session_entry_points_refuse_a_payload_stored_in_pymol_data(self):
        # load_pse is file_read + fromString: a session file placed inside
        # $PYMOL_DATA is still unpickled by restricted_loads.
        path = os.path.join(self.frag, "session.pse")
        for form, build in CALL_FORMS.items():
            with self.subTest(form=form):
                with open(path, "wb") as fh:
                    fh.write(build("builtins", "exec", _exec_code(form)))
                with open(path, "rb") as fh:
                    data = fh.read()
                MARKER.hits.clear()
                ORIG_C_LOADS(data)  # live control: the unrestricted C unpickler runs it
                self.assertEqual(MARKER.hits, [form])
                MARKER.hits.clear()
                self.assertRefused(data)
                if data.isascii():  # fromString also takes str (cPickle.loads encodes it)
                    self.assertRefused(data.decode("ascii"), {"chempy.pkl.PKL.fromString": chempy.pkl.PKL().fromString})

    def test_nested_wizard_of_a_session_stored_in_pymol_data_is_refused(self):
        inner = _p2_call("builtins", "exec", _exec_code("wizard-in-data"))
        path = os.path.join(self.frag, "outer.pse")
        with open(path, "wb") as fh:
            fh.write(cPickle.dumps({"version": 3020000, "wizard": inner}, 1))  # nosemgrep: avoid-cPickle — writes the test's own hostile session, which the next lines must refuse
        with open(path, "rb") as fh:
            session = WIZARD_PKL.fromString(fh.read())
        with self.assertRaises(pickle.UnpicklingError):
            WIZARD_PKL.fromString(session["wizard"])  # wizarding.session_restore_wizard
        self.assertEqual(MARKER.hits, [])
        ORIG_C_LOADS(session["wizard"])  # live control
        self.assertEqual(MARKER.hits, ["wizard-in-data"])

    def test_0006_installation_is_unchanged(self):
        self.assertIs(pickle.loads, chempy.pkl.restricted_loads)
        self.assertIs(pickle._loads, chempy.pkl.restricted_loads)
        self.assertIs(pickle.load, ORIG_LOAD)
        self.assertIs(cPickle.load, ORIG_PY_LOAD)
        self.assertEqual(chempy.pkl.RESTRICTED_GLOBALS, EXPECTED_ALLOWED)


if __name__ == "__main__":
    unittest.main(verbosity=2)
