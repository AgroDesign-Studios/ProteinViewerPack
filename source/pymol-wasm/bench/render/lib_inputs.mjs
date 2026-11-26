// Inputs shared by bench/{render,menu,surface}: arguments, usage text, runtime dir, worker.js
// variants, wheel members, structures. Pure file reading (no network, child, Pyodide or Chrome), so
// a node process that loads Pyodide may import it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { REPO, shippedRuntimeDir } from '../lib/repo.mjs';

export { REPO, shippedRuntimeDir };

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** A tool's usage text = its leading `//` comment block (so the header IS the usage). */
export function usageText(moduleUrl) {
  const lines = [];
  for (const l of readFileSync(new URL(moduleUrl), 'utf8').split('\n')) {
    if (!l.startsWith('//')) break;
    lines.push(l.replace(/^\/\/ ?/, ''));
  }
  return lines.join('\n');
}

/** A usage error: print it with the tool's usage text and exit 2 (fail closed). */
export function usageExit(usage, msg) {
  process.stderr.write(`error: ${msg}\n\n${usage}\n`);
  process.exit(2);
}

/**
 * `--key value` / `--flag` parser (`spec.opts`, repeatable `spec.multi`, `spec.flags`); anything
 * else, a missing value or a stray positional is a usage error.
 */
export function parseArgs(argv, spec, usage) {
  const out = { _: [] };
  for (const k of spec.multi || []) out[k] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { process.stdout.write(usage + '\n'); process.exit(0); }
    if (!a.startsWith('--')) {
      if ((spec.positional || 0) > out._.length) { out._.push(a); continue; }
      usageExit(usage, `unexpected argument ${JSON.stringify(a)}`);
    }
    const key = a.slice(2);
    if ((spec.flags || []).includes(key)) { out[key] = true; continue; }
    if ((spec.opts || []).includes(key) || (spec.multi || []).includes(key)) {
      if (i + 1 >= argv.length) usageExit(usage, `--${key} needs a value`);
      const v = argv[++i];
      if ((spec.multi || []).includes(key)) out[key].push(v); else out[key] = v;
      continue;
    }
    usageExit(usage, `unknown option --${key}`);
  }
  if ((spec.positional || 0) !== out._.length) usageExit(usage, `expected ${spec.positional || 0} positional argument(s), got ${out._.length}`);
  return out;
}

const RUNTIME_FILES = ['worker.js', 'pyodide.js', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

/**
 * A runtime directory: the files the worker fetches, the wheels its lock names, and their sha256.
 * Fails closed on a missing file.
 */
export function readRuntime(dir) {
  const abs = path.resolve(dir);
  for (const f of RUNTIME_FILES) {
    if (!existsSync(path.join(abs, f))) throw new Error(`runtime ${abs}: missing ${f}`);
  }
  const lock = JSON.parse(readFileSync(path.join(abs, 'pyodide-lock.json'), 'utf8'));
  if (!lock || typeof lock.packages !== 'object') throw new Error(`runtime ${abs}: pyodide-lock.json has no packages`);
  const wheels = {};
  for (const [name, p] of Object.entries(lock.packages)) {
    if (typeof p.file_name !== 'string' || p.file_name.includes('/')) throw new Error(`runtime ${abs}: bad file_name for ${name}`);
    const f = path.join(abs, p.file_name);
    if (!existsSync(f)) throw new Error(`runtime ${abs}: missing wheel ${p.file_name}`);
    wheels[name] = f;
  }
  const files = {};
  for (const f of [...RUNTIME_FILES, ...Object.values(wheels).map((w) => path.basename(w))]) {
    files[f] = { bytes: statSync(path.join(abs, f)).size, sha256: sha256(readFileSync(path.join(abs, f))) };
  }
  return { dir: abs, lock, wheels, files };
}

/**
 * A worker.js variant: `{"name": "...", "replacements": [{"from": "...", "to": "...", "why": "..."}]}`.
 * Each `from` must occur EXACTLY once (else the run stops); the file on disk is never changed.
 */
export function loadVariant(file) {
  const v = JSON.parse(readFileSync(file, 'utf8'));
  if (!v || typeof v.name !== 'string' || !v.name || !Array.isArray(v.replacements) || v.replacements.length === 0) {
    throw new Error(`variant ${file}: needs a non-empty "name" and a non-empty "replacements" array`);
  }
  for (const [i, r] of v.replacements.entries()) {
    if (typeof r.from !== 'string' || !r.from || typeof r.to !== 'string') throw new Error(`variant ${file}: replacement ${i} needs string "from" (non-empty) and "to"`);
  }
  return { ...v, file: path.resolve(file) };
}

export function applyVariant(src, variant) {
  let out = src;
  const applied = [];
  for (const [i, r] of variant.replacements.entries()) {
    const hits = out.split(r.from).length - 1;
    if (hits !== 1) throw new Error(`variant ${variant.name}: replacement ${i} (${r.why || r.from.slice(0, 60)}) must hit exactly once, hit ${hits} times`);
    out = out.replace(r.from, () => r.to);
    applied.push(`${variant.name}#${i}`);
  }
  return { src: out, applied };
}

/** One member of a zip file (a wheel), read with node's zlib only. */
export function readZipEntry(zipPath, member) {
  const buf = readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${zipPath}: no end of central directory`);
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${zipPath}: bad central directory entry`);
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (name === member) {
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`${zipPath}: bad local header for ${member}`);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + csize);
      const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null;
      if (!data) throw new Error(`${zipPath}: ${member} uses compression method ${method}`);
      if (data.length !== usize) throw new Error(`${zipPath}: ${member} inflated to ${data.length}, expected ${usize}`);
      return data;
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new Error(`${zipPath}: no member ${member}`);
}

/**
 * Input structures: `<name>.pdb` present in the SHIPPED wheel's `pymol/pymol_path/data/tut/` comes
 * from there (never a candidate's); any other `<id>.pdb` / `<id>.cif` from the local mirror
 * (`pdb/<h2>/pdb<id>.ent.gz`, `mmCIF/<h2>/<id>.cif.gz`, h2 = chars 2-3 of the lower-case id). Never
 * the network.
 */
export function loadStructures(names, mirror) {
  const shipped = readRuntime(shippedRuntimeDir());
  const out = new Map();
  const info = {};
  for (const name of names) {
    if (out.has(name)) continue;
    const m = /^([0-9a-z]{4})\.(pdb|cif)$/.exec(name);
    if (!m) throw new Error(`structure ${JSON.stringify(name)}: expected <4-char id>.pdb or <4-char id>.cif (lower case)`);
    const [, id, ext] = m;
    let buf = null, source = null;
    if (ext === 'pdb') {
      try { buf = readZipEntry(shipped.wheels.pymol, `pymol/pymol_path/data/tut/${name}`); source = `shipped wheel pymol/pymol_path/data/tut/${name}`; } catch (e) { buf = null; }
    }
    if (!buf) {
      if (!mirror) throw new Error(`structure ${name} comes from the PDB mirror: pass --mirror <dir>`);
      const f = ext === 'pdb' ? path.join(mirror, 'pdb', id.slice(1, 3), `pdb${id}.ent.gz`) : path.join(mirror, 'mmCIF', id.slice(1, 3), `${id}.cif.gz`);
      if (!existsSync(f)) throw new Error(`structure ${name}: ${f} does not exist`);
      buf = zlib.gunzipSync(readFileSync(f));
      source = f;
    }
    out.set(name, buf);
    info[name] = { source, bytes: buf.length, sha256: sha256(buf) };
  }
  return { map: out, info };
}
