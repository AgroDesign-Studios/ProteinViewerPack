#!/usr/bin/env node
/**
 * viewer_pack_reproduce.mjs — checks that a Protein Viewer Pack release is
 * what its published source builds (PT-9911; docs/runbooks/standalone-viewer-
 * pack-distribution.md §9). Part of the published source, so anyone holding
 * the source and the released files can run it.
 *
 *   node scripts/viewer_pack_reproduce.mjs inputs  --published <dir> --out <new dir>
 *   node scripts/viewer_pack_reproduce.mjs compare --built <dir> --published <dir>
 *
 * <dir> for --published is laid out as the repository and a release build
 * are: latest/*.html (the blank apps), index.html and en/index.html (the
 * sample pages), LICENSE, NOTICE, and release/*.html when given.
 *
 * `inputs` reads back what a build stamps into the files, from the files
 * themselves (viewer_pack_release.mjs says what it stamps): the instant it
 * was made (a blank app's config `exportedAt`), the time zone (the sample
 * page's config `timeZone`), the app version (its version meta), the logo
 * (the blank app's `logo` block, byte for byte) and the sample structure (the
 * sample page's `structure` block). It writes inputs.json, sample.cif and the
 * logo into --out; a build.json beside them (the release's record) must say
 * the same. A rebuild with those inputs, from the source at the
 * release's commit, in the same Node (the clean build's pinned image), makes
 * the same bytes.
 *
 * `compare` holds a rebuilt, unsigned build (--built, with its build.json)
 * against the published files. Each published blank app must be signed, the
 * signature must verify with the public key the source's app carries
 * (build.json `releasePublicKey`) AND, with its signature's text left out —
 * exactly what the signature covers — the file must be the rebuilt one byte
 * for byte; every other file must be byte-identical. `--allow-unsigned`
 * accepts unsigned blank apps equal to the rebuild (two unsigned builds
 * compared in development; the last line then says it is no release). A release/ file the published folder does not hold
 * is skipped (it is the same bytes as its latest/ copy); a latest/ or
 * release/ file the rebuild does not make fails. When the published folder
 * holds the release's build.json (the signed build's record), each file's
 * digest, each blank app's unsigned digest and the made / time zone / version
 * must agree with it too. Exit 0 only when both blank apps were compared and
 * nothing differs.
 *
 * The pure parts are exported for tests; the commands run only when this file is the program.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { logoType, readBlock } from './viewer_pack_release.mjs'
import { signatureRange, signedMessage, verifyHtml } from './viewer_pack_signing.mjs'

const USAGE = 'usage: viewer_pack_reproduce.mjs inputs --published <dir> --out <new dir> | compare --built <dir> --published <dir> [--allow-unsigned]'

const sha256 = buf => createHash('sha256').update(buf).digest('hex')

/** `inputs` or `compare` with its two flags, each once (compare also takes `--allow-unsigned`); throws with USAGE on anything else. */
export function parseArgs(argv) {
  const [command, ...rest] = argv
  const wanted = { inputs: ['--published', '--out'], compare: ['--built', '--published'] }[command]
  if (wanted === undefined) throw new Error(USAGE)
  const out = { command }
  if (command === 'compare') out.allowUnsigned = false
  for (let i = 0; i < rest.length; i += 2) {
    if (command === 'compare' && rest[i] === '--allow-unsigned' && !out.allowUnsigned) {
      out.allowUnsigned = true
      i -= 1
      continue
    }
    const flag = rest[i]
    const value = rest[i + 1]
    if (!wanted.includes(flag) || value === undefined || value === '' || value.startsWith('--') || Object.hasOwn(out, flag.slice(2))) throw new Error(USAGE)
    out[flag.slice(2)] = value
  }
  if (!wanted.every(f => Object.hasOwn(out, f.slice(2)))) throw new Error(USAGE)
  return out
}

/** The app version a page carries (`<meta name="agdb-viewer-pack" content="…">`), or null. */
export function pageVersion(html) {
  const m = /<meta name="agdb-viewer-pack" content="([^"]*)"/.exec(html)
  return m === null ? null : m[1]
}

/** A page's config block, parsed. */
export function pageConfig(html) {
  return JSON.parse(readBlock(html, 'config').toString('utf8'))
}

/** A block's bytes, or null when the page has no such block. */
function optionalBlock(html, name) {
  return html.includes(`id="agdb-${name}"`) ? readBlock(html, name) : null
}

/**
 * The inputs a build stamped into `blank` (a blank app's text) and `sample`
 * (the sample page's text, or null): `{ version, made, edition, timeZone,
 * code, logo, sample }`, the last two as bytes or null. Throws when the blank
 * app is not one (no version meta, a structure block or a PDB code) or the
 * two pages disagree on the version or the instant.
 */
export function readInputs(blank, sample = null) {
  const version = pageVersion(blank)
  if (version === null) throw new Error('the blank app carries no version meta (agdb-viewer-pack)')
  const config = pageConfig(blank)
  if (blank.includes('id="agdb-structure"') || config.code !== null) throw new Error('not a blank app: it carries a structure')
  if (typeof config.exportedAt !== 'string') throw new Error('the blank app has no exportedAt')
  const out = { version, made: config.exportedAt, edition: config.edition, timeZone: null, code: null, logo: optionalBlock(blank, 'logo'), sample: null }
  if (sample !== null) {
    const sc = pageConfig(sample)
    if (pageVersion(sample) !== version) throw new Error(`the sample page is version ${pageVersion(sample)}, the blank app ${version}`)
    if (sc.exportedAt !== out.made) throw new Error(`the sample page was made ${sc.exportedAt}, the blank app ${out.made}: not one build`)
    if (typeof sc.timeZone !== 'string' || sc.timeZone === '') throw new Error('the sample page records no time zone')
    out.timeZone = sc.timeZone
    out.code = sc.code
    out.sample = readBlock(sample, 'structure')
  }
  return out
}

/**
 * How `published` stands against `built` (one file of each): 'same' (byte
 * for byte), 'same-signed' (published signed by `publicKey`, and identical to
 * `built` with its signature's text left out), or why not. A published blank
 * app must be signed: an unsigned one is 'same-unsigned' only with
 * `allowUnsigned` (two unsigned builds compared in development), else a
 * failure — a release whose blank apps carry no signature is no release the
 * app takes as its latest version, however equal its bytes.
 */
export function compareFile(built, published, { blank, publicKey, allowUnsigned = false }) {
  const range = blank ? signatureRange(published) : null
  if (blank && (range === null || range.start === range.end)) {
    if (!published.equals(built)) return { ok: false, how: 'different bytes, and not signed' }
    return allowUnsigned ? { ok: true, how: 'same-unsigned' } : { ok: false, how: 'not signed (a released blank app must carry the signature; --allow-unsigned compares two unsigned builds)' }
  }
  if (!blank) return published.equals(built) ? { ok: true, how: 'same' } : { ok: false, how: 'different bytes' }
  if (typeof publicKey !== 'string' || publicKey === '' || !verifyHtml(published, publicKey)) return { ok: false, how: "signature does not verify with the source's public key" }
  if (!signedMessage(published, range).equals(built)) return { ok: false, how: 'signature verifies, but the signed content is not the rebuilt file' }
  return { ok: true, how: 'same-signed' }
}

/**
 * Every file of `manifest` (the rebuilt build.json) against `read(rel)` (the
 * published bytes, or null when absent), and, when the published folder has
 * one, against its own build.json (`record`: the release's record of each
 * file's digest and of what its signature covers), and `listed` (the
 * published latest/ and release/ files: one the rebuild does not make is
 * extra). Returns the lines to print and whether the release is reproduced:
 * no difference, no missing file other than a release/ copy, no extra one,
 * the record agreeing, and both latest/ blank apps compared.
 */
export function compareBuild(manifest, builtFiles, read, { record = null, listed = [], allowUnsigned = false } = {}) {
  const lines = []
  let ok = true
  const blanks = new Set()
  for (const rel of listed) {
    if (!Object.hasOwn(manifest.files, rel)) {
      ok = false
      lines.push(`EXTRA     ${rel} (published, but the rebuild makes no such file)`)
    }
  }
  for (const rel of Object.keys(manifest.files).sort()) {
    const entry = manifest.files[rel]
    const published = read(rel)
    if (published === null) {
      if (rel.startsWith('release/')) {
        lines.push(`SKIP      ${rel} (not in the published folder; the same bytes as its latest/ copy)`)
        continue
      }
      ok = false
      lines.push(`MISSING   ${rel}`)
      continue
    }
    const r = compareFile(builtFiles.get(rel), published, { blank: entry.blank === true, publicKey: manifest.releasePublicKey, allowUnsigned })
    const said = record?.files?.[rel]
    if (r.ok && said !== undefined && (said.sha256 !== sha256(published) || (entry.blank === true && said.unsignedSha256 !== entry.sha256))) {
      r.ok = false
      r.how = "the published build.json records other bytes for it"
    }
    if (!r.ok) ok = false
    else if (entry.blank === true) blanks.add(rel)
    lines.push(`${r.ok ? { same: 'SAME     ', 'same-signed': 'SAME+SIG ', 'same-unsigned': 'UNSIGNED ' }[r.how] : 'DIFFERENT'} ${rel}${r.ok ? '' : ` — ${r.how}`}`)
  }
  if (record !== null) {
    if (!allowUnsigned && (record.signed !== true || record.publicKey !== manifest.releasePublicKey)) {
      ok = false
      lines.push(`DIFFERENT build.json: the published record is not a release signed with the source's key (signed ${JSON.stringify(record.signed)})`)
    }
    for (const k of ['version', 'made', 'timeZone']) {
      if (record[k] !== manifest[k]) {
        ok = false
        lines.push(`DIFFERENT build.json ${k}: published ${JSON.stringify(record[k])}, rebuilt ${JSON.stringify(manifest[k])}`)
      }
    }
  }
  const latest = [...blanks].filter(r => r.startsWith('latest/'))
  if (latest.length < 2) {
    ok = false
    lines.push(`NOT ENOUGH: ${latest.length} of the 2 latest/ blank apps compared`)
  }
  return { ok, lines }
}

function inputsCommand(args) {
  const pub = path.resolve(args.published)
  const latest = path.join(pub, 'latest')
  const blanks = existsSync(latest) ? readdirSync(latest).filter(f => f.endsWith('.html')).sort() : []
  if (blanks.length === 0) throw new Error(`${latest}: no blank app`)
  const sampleFile = path.join(pub, 'index.html')
  const sample = existsSync(sampleFile) ? readFileSync(sampleFile, 'utf8') : null
  const read = blanks.map(f => readInputs(readFileSync(path.join(latest, f), 'utf8'), sample))
  for (const r of read.slice(1)) {
    if (r.made !== read[0].made || r.version !== read[0].version) throw new Error('the blank apps in latest/ are not of one build')
    if ((r.logo === null) !== (read[0].logo === null) || (r.logo !== null && !r.logo.equals(read[0].logo))) throw new Error('the blank apps in latest/ carry different logos')
  }
  const r = read[0]
  const out = path.resolve(args.out)
  if (existsSync(out) && readdirSync(out).length > 0) throw new Error(`--out ${out} is not empty`)
  const type = r.logo === null ? null : logoType(r.logo)
  if (r.logo !== null && type === null) throw new Error('the logo block is not a PNG or JPEG')
  const logoFile = type === null ? null : type === 'image/png' ? 'logo.png' : 'logo.jpg'
  const record = {
    version: r.version,
    made: r.made,
    timeZone: r.timeZone,
    code: r.code,
    sample: r.sample === null ? null : { file: 'sample.cif', sha256: sha256(r.sample) },
    logo: r.logo === null ? null : { file: logoFile, sha256: sha256(r.logo) },
  }
  const said = existsSync(path.join(pub, 'build.json')) ? JSON.parse(readFileSync(path.join(pub, 'build.json'), 'utf8')) : null
  if (said !== null) {
    // The release's own record must say the same as its files.
    const disagree = [
      said.version !== record.version && 'version',
      said.made !== record.made && 'made',
      said.timeZone !== record.timeZone && 'timeZone',
      (said.sample?.sha256 ?? null) !== (record.sample?.sha256 ?? null) && 'sample',
      (said.logo?.sha256 ?? null) !== (record.logo?.sha256 ?? null) && 'logo',
    ].filter(Boolean)
    if (disagree.length > 0) throw new Error(`the published build.json and the published files disagree on ${disagree.join(', ')}`)
  }
  mkdirSync(out, { recursive: true })
  if (logoFile !== null) writeFileSync(path.join(out, logoFile), r.logo)
  if (r.sample !== null) writeFileSync(path.join(out, 'sample.cif'), r.sample)
  writeFileSync(path.join(out, 'inputs.json'), JSON.stringify({ ...record, record: said === null ? null : 'build.json agrees' }, null, 2) + '\n')
  console.log(`INPUTS version ${record.version}, made ${record.made}, time zone ${record.timeZone ?? '-'}, sample ${record.code ?? '-'}, logo ${record.logo === null ? 'none' : record.logo.sha256.slice(0, 16)}`)
}

function compareCommand(args) {
  const built = path.resolve(args.built)
  const pub = path.resolve(args.published)
  const manifest = JSON.parse(readFileSync(path.join(built, 'build.json'), 'utf8'))
  if (manifest.signed !== false) throw new Error('--built is a signed build: compare an unsigned rebuild against the published files')
  const builtFiles = new Map(Object.keys(manifest.files).map(rel => [rel, readFileSync(path.join(built, rel))]))
  for (const [rel, buf] of builtFiles) if (sha256(buf) !== manifest.files[rel].sha256) throw new Error(`--built ${rel} is not the file its build.json describes`)
  const recordFile = path.join(pub, 'build.json')
  const record = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf8')) : null
  const listed = ['latest', 'release'].flatMap(d => (existsSync(path.join(pub, d)) ? readdirSync(path.join(pub, d)).map(f => `${d}/${f}`) : []))
  const { ok, lines } = compareBuild(manifest, builtFiles, rel => (existsSync(path.join(pub, rel)) ? readFileSync(path.join(pub, rel)) : null), { record, listed, allowUnsigned: args.allowUnsigned })
  for (const l of lines) console.log(l)
  const unsigned = lines.some(l => l.startsWith('UNSIGNED '))
  console.log(ok ? `REPRODUCED version ${manifest.version} (${manifest.sha || 'no commit'}), made ${manifest.made}${unsigned ? ' — UNSIGNED blank apps (--allow-unsigned): no release' : ''}` : 'NOT REPRODUCED')
  return ok
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
  try {
    if (args.command === 'inputs') inputsCommand(args)
    else if (!compareCommand(args)) process.exit(1)
  } catch (e) {
    console.error(`viewer_pack_reproduce: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
