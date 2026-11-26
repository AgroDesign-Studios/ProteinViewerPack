#!/usr/bin/env node
/**
 * viewer_pack_release.mjs — builds the files of a Protein Viewer Pack
 * (HTMLapp) release for its GitHub repository, AgroDesign-Studios/
 * ProteinViewerPack (docs/runbooks/standalone-viewer-pack-distribution.md).
 *
 *   node scripts/viewer_pack_release.mjs --sample <file.cif> --out <empty dir> [--logo <file.png>]
 *
 * From this checkout's frontend/ (its own node_modules, its own commit):
 *
 *   index.html          the full edition with the sample structure, Japanese
 *   en/index.html       the same, English
 *   release/AgroDesign-ProteinViewerPack-v<ver>_full_<yyyyMMdd>.html   the blank full edition
 *   release/AgroDesign-ProteinViewerPack-v<ver>_light_<yyyyMMdd>.html  the blank light edition
 *   latest/AgroDesign-ProteinViewerPack_{full,light}.html  the same two, byte for byte, under the
 *                       fixed names the app downloads from the release's tag (latestFetch.ts
 *                       LATEST_FILE): a release attachment cannot be read by a page (no CORS)
 *   LICENSE             the app's MIT licence, as the app shows it
 *   NOTICE              every bundled package and runtime licence, as the app shows them
 *   build.json          version, commit, date and each file's bytes and SHA-256
 *
 * Nothing here is a second copy of the page format: the template is
 * vite.structure-viewer.config.ts's own build, the blocks are made by
 * vite-plugins/protein-viewer-pages.ts (the code that makes the blank app),
 * the names by viewerPackFileStem. Only the sample page's config and
 * structure blocks are written here, in the shape selfCopy.ts gives a
 * structure loaded from the PDB (structureId 0, the PDB ID as the code).
 *
 * The blank files open in Japanese; the header's language button switches
 * them (the app keeps one file per edition).
 *
 * `--logo` (owner 2026-11-16: 「入れる（ファイルサイズは、適したものに）」):
 * the company logo, a small PNG or JPEG, written as every page's `logo`
 * block, which the app draws in its header and before PyMOL's 創薬表示 menu
 * (blocks.ts readLogo, the same cap). Without it the files carry none.
 *
 * The release's blank apps (`release/` and `latest/`) are signed with the
 * release key (owner 2026-11-17; viewer_pack_signing.mjs, runbook §1.7):
 * `--signing-key <pem>` (else $VIEWER_PACK_SIGNING_KEY; there is no default place: readSigningKey), whose public half must be the one the app carries (releaseSignature.ts
 * RELEASE_PUBLIC_KEY) or the build stops. `--unsigned` builds them unsigned,
 * for a local test only: the app's 「最新版」 refuses an unsigned file.
 *
 * What a build stamps into its files, so that the same inputs give the same
 * bytes (PT-9911; the reproducibility check is scripts/viewer_pack_reproduce.mjs):
 * the time it was made (`--made <ISO-8601 UTC instant>`, default now: the
 * pages' `exportedAt` and the date in the release file names), the time zone
 * (`TZ`: the sample pages' `timeZone` and that date), the short commit
 * (`AGDB_GIT_SHA`, else this checkout's HEAD), the sample and the logo.
 * build.json records each of them, the Node version (its zlib gzips the page
 * blocks) and, for a blank app, the SHA-256 of its unsigned bytes — what the
 * signature covers.
 *
 * The pure parts are exported for tests; the build runs only when this file is the program.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describeKeyFile, publicKeyOf, resolveKeyFile, signHtml, verifyHtml } from './viewer_pack_signing.mjs'

/** GitHub refuses a file over 100 MiB and warns over 50 MiB. */
export const GITHUB_FILE_LIMIT = 100 * 1024 * 1024
export const GITHUB_FILE_WARN = 50 * 1024 * 1024

const USAGE = 'usage: viewer_pack_release.mjs --sample <file.cif> --out <empty dir> [--code <PDB ID>] [--logo <file.png|jpg>] [--made <ISO-8601 UTC instant>] [--signing-key <file.pem> | --unsigned]'

const FLAGS = new Map([
  ['--sample', 'sample'],
  ['--out', 'out'],
  ['--code', 'code'],
  ['--logo', 'logo'],
  ['--made', 'made'],
  ['--signing-key', 'signingKey'],
])

/** An instant as `--made` takes one: UTC, to the second or millisecond, as `Date.toISOString` writes it. */
const MADE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

/**
 * `--made`'s instant as a Date: only the form toISOString writes (a `Z`,
 * no offset), and a real calendar time (2026-02-30 is refused, not rolled
 * over). A build made at that instant stamps it exactly.
 */
export function parseMade(text) {
  const d = MADE.test(text) ? new Date(text) : null
  if (d === null || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 19) !== text.slice(0, 19)) {
    throw new Error(`--made: not an ISO-8601 UTC instant (2026-11-21T03:00:00Z): ${text}`)
  }
  return d
}

/** The most a logo may be: the app's own cap (blocks.ts LOGO_MAX_BYTES), past which it shows none. */
export const LOGO_MAX_BYTES = 512 * 1024

/** The logo's type by its first bytes, as the app reads it (blocks.ts LOGO_MAGIC); null for anything else. */
export function logoType(buf) {
  const starts = head => head.every((b, i) => buf[i] === b)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  return null
}

/** Throws unless `buf` is a logo the app will draw: a PNG or JPEG, not empty, at most LOGO_MAX_BYTES. */
export function checkLogo(buf, name = 'logo') {
  if (buf.byteLength === 0) throw new Error(`--logo ${name}: empty`)
  if (buf.byteLength > LOGO_MAX_BYTES) throw new Error(`--logo ${name}: ${buf.byteLength} bytes, over the app's ${LOGO_MAX_BYTES}`)
  if (logoType(buf) === null) throw new Error(`--logo ${name}: not a PNG or JPEG`)
}

/** A PDB ID as this script accepts one: 4 to 12 letters and digits (the extended IDs are 12). */
const PDB_ID = /^[A-Za-z0-9]{4,12}$/

/**
 * `--sample`, `--out`, `--code` (default: the cif's _entry.id), `--logo` and
 * `--signing-key`, each once and non-empty, and `--unsigned` (no value, not
 * with `--signing-key`); throws with USAGE on anything else.
 */
export function parseArgs(argv) {
  const out = { sample: null, out: null, code: null, logo: null, made: null, signingKey: null, unsigned: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--unsigned') {
      if (out.unsigned) throw new Error(USAGE)
      out.unsigned = true
      continue
    }
    const key = FLAGS.get(argv[i])
    const value = argv[i + 1]
    if (key === undefined || value === undefined || value === '' || value.startsWith('--') || out[key] !== null) throw new Error(USAGE)
    out[key] = value
    i++
  }
  if (out.sample === null || out.out === null || (out.unsigned && out.signingKey !== null)) throw new Error(USAGE)
  if (out.code !== null && !PDB_ID.test(out.code)) throw new Error(`--code: not a PDB ID: ${out.code}`)
  if (out.made !== null) parseMade(out.made)
  return out
}

/**
 * The release key the build signs with: null for `--unsigned` (nothing is
 * looked up), else `{ pem, named }` read from the file resolveKeyFile names
 * (`--signing-key`, else $VIEWER_PACK_SIGNING_KEY). Throws when neither names
 * a file, or when that file is missing.
 * `resolve` is the lookup (a test passes its own).
 */
export function readSigningKey(args, resolve = given => resolveKeyFile({ given })) {
  if (args.unsigned) return null
  const where = resolve(args.signingKey)
  const named = describeKeyFile(where)
  if (!existsSync(where.file)) throw new Error(`no release signing key at ${named}: make it once (node scripts/viewer_pack_signing.mjs create), pass --signing-key, or build a local test with --unsigned`)
  return { pem: readFileSync(where.file, 'utf8'), named }
}

/**
 * The sample's PDB ID: `--code` if given, else the cif's `_entry.id`. A
 * `--code` that names another entry than the file's is refused (it would
 * label the embedded structure as something it is not), and so is an
 * `_entry.id` that is no PDB ID. Upper case, as RCSB writes them.
 */
export function sampleCode(argCode, entryId) {
  if (argCode !== null && entryId !== null && argCode.toUpperCase() !== entryId.toUpperCase()) {
    throw new Error(`--code ${argCode}: the file's _entry.id is ${entryId}`)
  }
  const code = argCode ?? entryId
  if (code === null || !PDB_ID.test(code)) throw new Error(`no PDB ID: --code not given and _entry.id is ${entryId === null ? 'missing' : `not one: ${entryId}`}`)
  return code.toUpperCase()
}

/**
 * An mmCIF item's value: `_item value`, quoted or not, or a value or a `;`
 * text field on the next line. For files shaped as RCSB writes them: an item
 * inside a `loop_` table, or one with no value, reads as null, and so do the
 * CIF markers `?` (unknown) and `.` (not applicable).
 */
export function cifItem(text, item) {
  const lines = text.split(/\r?\n/)
  const value = raw => {
    const q = /^(['"])(.*)\1$/.exec(raw)
    if (q) return q[2]
    return raw === '' || raw === '?' || raw === '.' ? null : raw
  }
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\S+)(?:\s+(.*))?$/.exec(lines[i])
    if (m === null || m[1] !== item) continue
    const rest = (m[2] ?? '').trim()
    if (rest !== '') return value(rest)
    const next = lines[i + 1] ?? ''
    if (next.startsWith(';')) {
      const body = [next.slice(1)]
      let j = i + 2
      for (; j < lines.length && !lines[j].startsWith(';'); j++) body.push(lines[j])
      if (j >= lines.length) return null // an unterminated text field
      return body.join(' ').replace(/\s+/g, ' ').trim() || null
    }
    const t = next.trim()
    // A loop_ header (the next line is another item's name) or no value at all.
    if (t.startsWith('_') || /^(loop_|data_)/.test(t)) return null
    return value(t)
  }
  return null
}

/**
 * The sample page's config block: a structure loaded from the PDB, as the
 * app's own copy writes one (selfCopy.ts makeAppCopy: structureId 0, the PDB
 * ID as the code, no exporter), starting on 3Dmol.js.
 */
export function sampleConfig({ edition, lang, code, title, made, timeZone, runtime }) {
  return {
    v: 1,
    edition,
    structureId: 0,
    title,
    code,
    exporterName: null,
    lang,
    initialEngine: '3dmol',
    bColumn: 'bfactor',
    exportedAt: made.toISOString(),
    timeZone,
    pymolView: null,
    skipped: [],
    runtime,
  }
}

/** One page block, as protein-viewer-pages.ts makes it (gzip, base64, the raw length). */
export function pageBlock(blockElement, name, bytes) {
  return blockElement(name, gzipSync(bytes).toString('base64'), bytes.byteLength)
}

/** A block's decoded bytes, read back out of a page as blocks.ts does. */
export function readBlock(html, name) {
  const m = new RegExp(`<script type="application/x-agdb-b64" id="agdb-${name}" data-gz="1" data-len="(\\d+)">([^<]*)</script>`).exec(html)
  if (m === null) throw new Error(`no ${name} block`)
  const raw = gunzipSync(Buffer.from(m[2], 'base64'))
  if (raw.byteLength !== Number(m[1])) throw new Error(`${name} block: ${raw.byteLength} bytes, says ${m[1]}`)
  return raw
}

const RULE = '='.repeat(78)

/**
 * NOTICE: what the app's 「ライセンス表記」 lists after its own licence,
 * in the same order — the open-source packages the page bundles, then
 * 3Dmol.js and what it bundles, then PyMOL (with its trademark notice) and
 * its runtime — each with its full text.
 */
export function noticeText({ appTitle, version, sha, pymolNotice, bundled, licences }) {
  const head = [
    `${appTitle} ver ${version}${sha ? ` (${sha})` : ''}`,
    'Copyright (c) 2026 AgroDesign Studios',
    '',
    "This app's own program is licensed under the MIT License (see LICENSE).",
    'The software the HTML files carry keeps its own licence; each is listed',
    'below with its full text, as the app shows it in Help > Licences.',
    'The light edition carries the first two groups only (no PyMOL).',
  ]
  const section = (title, entries) => [
    '',
    RULE,
    title,
    RULE,
    ...entries.flatMap(e => ['', `--- ${e.title} ---`, '', ...e.texts.map(t => t.replace(/\s+$/, '')).flatMap((t, i) => (i === 0 ? [t] : ['', t]))]),
  ]
  const pkg = bundled.map(p => ({
    title: `${p.name} ${p.version}${p.license ? ` (${p.license})` : ''}`,
    texts: [...(p.text ? [p.text] : []), ...p.notices],
  }))
  const group = g => licences.filter(l => l.group === g).map(l => ({ title: l.title, texts: [l.text] }))
  const pymol = group('pymol')
  return [
    ...head,
    ...section('Open-source packages this app uses', pkg),
    ...section('3Dmol.js and the code it bundles', group('3dmol')),
    ...(pymol.length > 0 ? section('PyMOL, the code inside it and its runtime', [{ title: 'Trademark notice', texts: [pymolNotice] }, ...pymol]) : []),
    '',
  ].join('\n')
}

/** A size GitHub takes, or why not; warnings for a file it accepts with a warning. */
/**
 * The template carries the app's version mark (`<meta name="agdb-viewer-pack">`,
 * vite.structure-viewer.config.ts), and it is `version`: the app that moves its
 * data into a newer release's file reads it there (latestShell.ts).
 */
export function versionMarked(html, version) {
  const m = /<meta name="agdb-viewer-pack" content="([^"]*)" data-config="[0-9 ]+"\s*\/?>/.exec(html)
  return m !== null && m[1] === version
}

export function sizeCheck(name, bytes) {
  if (bytes > GITHUB_FILE_LIMIT) return { ok: false, note: `${name}: ${bytes} bytes, over GitHub's 100 MiB file limit` }
  if (bytes > GITHUB_FILE_WARN) return { ok: true, note: `${name}: ${bytes} bytes, over GitHub's 50 MiB warning size` }
  return { ok: true, note: null }
}

/** What React's development build leaves in a page; its production build has none of them. */
export const DEV_BUILD_MARKS = Object.freeze(['jsxDEV', 'react-dom.development', 'react.development', 'react-jsx-dev-runtime.development'])

/**
 * What a development build left in the template (PT-9858): React's
 * development bundle and the development JSX runtime, whose `jsxDEV` calls
 * pass each element's source file as an absolute path of the checkout it was
 * built in. A release carries none of them: returns the ones found (the
 * marks, then `the build path <root>` for each of `roots` the page holds).
 */
export function devBuildMarks(html, roots) {
  const found = DEV_BUILD_MARKS.filter(mark => html.includes(mark))
  for (const root of roots) if (root && html.includes(root)) found.push(`the build path ${root}`)
  return found
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex')

/**
 * build.json's head: what the files were made from and with. `releasePublicKey`
 * is the public key the app carries (releaseSignature.ts), recorded signed
 * or not: viewer_pack_signing.mjs `sign` signs an unsigned build only with
 * the private half of that key, and the reproducibility check verifies with
 * it. `publicKey` stays what it was (the key the files are signed with, or
 * null). The name says "Public" because the value is the public half of the
 * key pair, never a secret (PT-11286).
 */
export function buildManifest({ app, version, sha, made, timeZone, node, releasePublicKey, signed, sample, logo }) {
  return {
    app,
    version,
    sha,
    made: made.toISOString(),
    timeZone,
    node,
    releasePublicKey,
    signed,
    publicKey: signed ? releasePublicKey : null,
    sample,
    logo,
    files: {},
  }
}

/**
 * One file's entry in build.json: its bytes and SHA-256 and, for a blank app
 * (`unsigned` given), `blank: true` and the SHA-256 of the bytes its
 * signature covers (the file itself when it is unsigned).
 */
export function fileEntry(buf, unsigned = null) {
  const entry = { bytes: buf.byteLength, sha256: sha256(buf) }
  return unsigned === null ? entry : { ...entry, blank: true, unsignedSha256: sha256(unsigned) }
}

async function build(args) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const fe = path.resolve(here, '..', 'frontend')
  const out = path.resolve(args.out)
  if (existsSync(out) && readdirSync(out).length > 0) throw new Error(`--out ${out} is not empty`)
  const cif = readFileSync(args.sample)
  const cifText = cif.toString('utf8')
  const code = sampleCode(args.code, cifItem(cifText, '_entry.id'))
  const title = cifItem(cifText, '_struct.title')
  if (!title) throw new Error(`${args.sample}: no _struct.title`)
  const logo = args.logo === null ? null : readFileSync(args.logo)
  if (logo !== null) checkLogo(logo, args.logo)
  const key = readSigningKey(args)
  const signingKey = key === null ? null : key.pem

  const vite = await import(pathToFileURL(createRequire(path.join(fe, 'package.json')).resolve('vite')).href)
  const load = async file => (await vite.runnerImport(path.join(fe, file), { root: fe, configFile: false, logLevel: 'error' })).module
  const pages = await load('vite-plugins/protein-viewer-pages.ts')
  const fmt = await load('src/pages/structure-html-export/standaloneFormat.ts')
  const names = await load('src/pages/structure-html-export/viewerPackFileName.ts')
  const app = await load('standalone/structure-viewer/appLicence.ts')
  const latest = await load('standalone/structure-viewer/latestFetch.ts')
  const releasePublicKey = (await load('standalone/structure-viewer/releaseSignature.ts')).RELEASE_PUBLIC_KEY
  if (signingKey !== null && publicKeyOf(signingKey) !== releasePublicKey) {
    throw new Error(`the signing key (${key.named}) is not the one the app carries (releaseSignature.ts RELEASE_PUBLIC_KEY): the app would refuse these files`)
  }
  const licences = await load('vite-plugins/gantt-licenses.ts')
  const shaMod = await load('standalone/structure-viewer/buildSha.ts')
  const sha = shaMod.buildSha(process.env, shaMod.gitShortHead(fe))
  const pymolNotice = JSON.parse(readFileSync(path.join(fe, 'src/i18n/locales/en/pymolNotice.json'), 'utf8')).notice

  // 1. The template: the structure viewer's own build, into a scratch dir;
  //    the bundled packages caught from the same chunks gantt-licenses reads.
  const tmpl = path.join(out, '.template')
  let bundled = null
  const catchPackages = {
    name: 'viewer-pack-release-packages',
    enforce: 'pre',
    generateBundle(_o, bundle) {
      const ids = new Set()
      for (const c of Object.values(bundle)) if (c.type === 'chunk') for (const id of Object.keys(c.modules)) ids.add(id)
      bundled = licences.collectPackages(ids)
    },
  }
  const cwd = process.cwd()
  // `vite.runnerImport` above set NODE_ENV=development where it was unset,
  // and `vite.build` keeps a NODE_ENV that is set. NODE_ENV=production here
  // makes the template bundle React's production build, so no development
  // build and no jsxDEV build path of this checkout end up in it (PT-9858):
  // a release is React's production build, and no output may hold the build
  // checkout's path.
  const nodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  process.chdir(fe) // the config's root is relative to the working directory
  try {
    await vite.build({ configFile: path.join(fe, 'vite.structure-viewer.config.ts'), mode: 'production', logLevel: 'warn', plugins: [catchPackages], build: { outDir: tmpl, emptyOutDir: true } })
  } finally {
    process.chdir(cwd)
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv
  }
  if (bundled === null) throw new Error('the build reported no chunks')
  const template = readFileSync(path.join(tmpl, 'index.html'), 'utf8')
  rmSync(tmpl, { recursive: true, force: true })
  const checkout = path.dirname(fe)
  const devMarks = devBuildMarks(template, [checkout])
  if (devMarks.length > 0) throw new Error(`the template is a development build (${devMarks.join('; ')}): a release is React's production build (PT-9858)`)
  const at = template.indexOf(fmt.PAYLOAD_MARKER)
  if (at < 0 || template.indexOf(fmt.PAYLOAD_MARKER, at + 1) >= 0) throw new Error('the template has no single payload slot')
  if (!versionMarked(template, app.APP_VERSION)) throw new Error(`the template does not carry the app version mark of ${app.APP_VERSION}`)

  // 2. The pages.
  const made = args.made === null ? new Date() : parseMade(args.made)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null
  const files = new Map()
  const logoBlock = logo === null ? [] : [pageBlock(fmt.blockElement, 'logo', logo)]
  const blocks = {
    full: [...(await pages.editionBlocks('full', { root: fe })), ...logoBlock],
    light: [...(await pages.editionBlocks('light', { root: fe })), ...logoBlock],
  }
  for (const [rel, lang] of [['index.html', 'ja'], ['en/index.html', 'en']]) {
    const config = sampleConfig({ edition: 'full', lang, code, title, made, timeZone, runtime: fmt.standaloneRuntime('full') })
    const parts = [
      template.slice(0, at),
      pageBlock(fmt.blockElement, 'config', Buffer.from(JSON.stringify(config), 'utf8')),
      pageBlock(fmt.blockElement, 'structure', cif),
      ...blocks.full,
      template.slice(at + fmt.PAYLOAD_MARKER.length),
    ]
    files.set(rel, Buffer.from(parts.join(''), 'utf8'))
  }
  const unsignedOf = new Map() // a blank app's path -> the bytes its signature covers
  for (const edition of ['full', 'light']) {
    const parts = await pages.blankPageParts(template, edition, 'ja', blocks[edition], made)
    const unsignedBlank = Buffer.from(parts.join(''), 'utf8')
    const blank = signingKey === null ? unsignedBlank : signHtml(unsignedBlank, signingKey)
    if (signingKey !== null && !verifyHtml(blank, releasePublicKey)) throw new Error(`the ${edition} blank app does not verify after signing`)
    files.set(`release/${names.viewerPackFileStem('', edition, made)}.html`, blank)
    // The same bytes where the app downloads them (the release's digest is checked against them).
    files.set(latest.LATEST_FILE[edition], blank)
    unsignedOf.set(`release/${names.viewerPackFileStem('', edition, made)}.html`, unsignedBlank)
    unsignedOf.set(latest.LATEST_FILE[edition], unsignedBlank)
  }
  files.set('LICENSE', Buffer.from(app.APP_LICENCE_TEXT, 'utf8'))
  const carried = JSON.parse(readBlock(files.get('index.html').toString('utf8'), 'licenses').toString('utf8'))
  files.set('NOTICE', Buffer.from(noticeText({ appTitle: app.APP_LICENCE_TITLE, version: app.APP_VERSION, sha, pymolNotice, bundled, licences: carried }), 'utf8'))

  // 3. Write, with the sizes GitHub takes.
  const notes = []
  const manifest = buildManifest({
    app: app.APP_LICENCE_TITLE,
    version: app.APP_VERSION,
    sha,
    made,
    timeZone,
    node: process.version,
    releasePublicKey,
    signed: signingKey !== null,
    sample: { code, title, sha256: sha256(cif) },
    logo: logo === null ? null : { bytes: logo.byteLength, sha256: sha256(logo) },
  })
  for (const [rel, buf] of files) {
    const check = sizeCheck(rel, buf.byteLength)
    if (!check.ok) throw new Error(check.note)
    // Only the path here: the blocks are base64, where a short mark like jsxDEV can occur by chance.
    if (buf.includes(checkout)) throw new Error(`${rel} holds the build path ${checkout} (PT-9858)`)
    if (check.note) notes.push(check.note)
    mkdirSync(path.dirname(path.join(out, rel)), { recursive: true })
    writeFileSync(path.join(out, rel), buf)
    manifest.files[rel] = fileEntry(buf, unsignedOf.get(rel) ?? null)
  }
  writeFileSync(path.join(out, 'build.json'), JSON.stringify(manifest, null, 2) + '\n')
  for (const [rel, f] of Object.entries(manifest.files)) console.log(`${String(f.bytes).padStart(10)}  ${rel}`)
  for (const n of notes) console.log(`WARN ${n}`)
  console.log(`version ${app.APP_VERSION}${sha ? ` (${sha})` : ' (no commit known)'}`)
  console.log(signingKey === null ? 'UNSIGNED (--unsigned): a local test only; the app refuses these blank apps as the latest version' : `signed with ${key.named}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
  build(args).catch(e => {
    console.error(`viewer_pack_release: ${e instanceof Error ? e.stack : String(e)}`)
    process.exit(1)
  })
}
