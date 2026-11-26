#!/usr/bin/env node
/**
 * viewer_pack_signing.mjs — the Protein Viewer Pack's release signature (owner
 * 2026-11-17: 署名を「してください」). The app's HELP 「最新版ダウンロード」 puts
 * the person's data only into a blank app that carries AgroDesign's signature
 * (frontend/standalone/structure-viewer/releaseSignature.ts); this makes the
 * key and signs the release files with it
 * (docs/runbooks/standalone-viewer-pack-distribution.md §1.7).
 *
 *   node scripts/viewer_pack_signing.mjs create [--key-file <path>]
 *       Makes the key pair once: the private key to <path> (mode 0600, never
 *       over an existing file), and prints the public key the app must carry
 *       (`PUBLIC_KEY=<SPKI base64>`).
 *   node scripts/viewer_pack_signing.mjs public [--key-file <path>]
 *       Prints the public key of the private key in <path>.
 *   node scripts/viewer_pack_signing.mjs sign --in <unsigned build> --out <new dir> [--key-file <path>]
 *       Signs a release built unsigned (viewer_pack_release.mjs --unsigned,
 *       in the clean container from the published source: PT-9911, runbook
 *       §9) outside that container, so the key never enters it: every file
 *       copied, each blank app (build.json `blank`) signed — one signature per
 *       edition, so release/ and latest/ stay the same bytes — and build.json
 *       rewritten as signed. Refuses a build that is signed already, and a key
 *       whose public half is not the build's `releasePublicKey` (the app's).
 *
 * The key is never made again here or anywhere else: `create` refuses an
 * existing file, and a new key would make every app already out refuse the
 * next release.
 *
 * Where the key is (resolveKeyFile, which viewer_pack_release.mjs uses too):
 * the file `--key-file` (the release build's `--signing-key`) names, else the
 * one $VIEWER_PACK_SIGNING_KEY names. There is no default place: a command
 * that needs the key and is given neither stops.
 *
 * What is signed (the app's releaseSignature.ts reads it the same way): the
 * HTML file's bytes with the content of its
 * `<meta name="agdb-viewer-pack-signature" content="">` empty — the first such
 * meta, before the first `<script`. ECDSA P-256, SHA-256, the signature as
 * r‖s (64 bytes, IEEE P1363: what WebCrypto verifies), base64 into that
 * content.
 *
 * The pure parts are exported for scripts/tests/test_viewer_pack_signing.sh
 * and for viewer_pack_release.mjs; the commands run only when this file is the
 * program.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** The environment variable that names the key file when no argument does. */
export const KEY_FILE_ENV = 'VIEWER_PACK_SIGNING_KEY'
export const SIGNATURE_META = 'agdb-viewer-pack-signature'
const MARK = Buffer.from(`<meta name="${SIGNATURE_META}" content="`, 'utf8')

/**
 * Where the signature's text stands in `buf` (`[start, end)`, inside the
 * content attribute), or null: the first mark before the first `<script`, as
 * the app reads it.
 */
export function signatureRange(buf) {
  const at = buf.indexOf(MARK)
  if (at === -1) return null
  const script = buf.indexOf(Buffer.from('<script', 'utf8'))
  if (script !== -1 && script < at) return null
  const start = at + MARK.length
  const end = buf.indexOf(0x22, start)
  return end === -1 || end - start > 200 ? null : { start, end }
}

/** The file as it is signed: the signature's own text left out. */
export function signedMessage(buf, range) {
  return Buffer.concat([buf.subarray(0, range.start), buf.subarray(range.end)])
}

/** The public key of `privateKeyPem` as the app carries it: SPKI DER, base64. */
export function publicKeyOf(privateKeyPem) {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'der' }).toString('base64')
}

/**
 * `buf` signed: its signature meta's content set to the base64 signature of
 * the file with that content empty. Throws when the file has no (empty)
 * signature meta before its first script, or the key is not ECDSA P-256.
 */
export function signHtml(buf, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('the signing key is not ECDSA P-256')
  const range = signatureRange(buf)
  if (range === null) throw new Error(`no <meta name="${SIGNATURE_META}"> before the first script`)
  if (range.end !== range.start) throw new Error('the file is signed already')
  const signature = sign('sha256', buf, { key, dsaEncoding: 'ieee-p1363' }).toString('base64')
  return Buffer.concat([buf.subarray(0, range.start), Buffer.from(signature, 'ascii'), buf.subarray(range.start)])
}

/** Is `buf` signed by the key whose public half is `publicKeyB64` (SPKI DER, base64)? As the app checks it. */
export function verifyHtml(buf, publicKeyB64) {
  const range = signatureRange(buf)
  if (range === null || range.end === range.start) return false
  const signature = Buffer.from(buf.subarray(range.start, range.end).toString('ascii'), 'base64')
  if (signature.length !== 64) return false
  const key = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' })
  return verify('sha256', signedMessage(buf, range), { key, dsaEncoding: 'ieee-p1363' }, signature)
}

/** A new key pair: the private key as PKCS#8 PEM, the public as the app carries it. */
export function newKeyPair() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  return { privateKeyPem: pem, publicKey: publicKeyOf(pem) }
}

/**
 * Where the signing key is, and what named it: `given` (an argument) first,
 * then `env[KEY_FILE_ENV]`. Returns `{ file, source }` — the file absolute,
 * source 'argument' | 'environment'. Throws when neither names a place (there
 * is no default); the file itself may still be missing (the callers say so in
 * their own words).
 */
export function resolveKeyFile({ given = null, env = process.env } = {}) {
  if (given) return { file: path.resolve(given), source: 'argument' }
  const fromEnv = env[KEY_FILE_ENV]
  if (fromEnv) return { file: path.resolve(fromEnv), source: 'environment' }
  throw new Error(`no release signing key named: pass its path as an argument or set ${KEY_FILE_ENV}`)
}

/** A resolved key as messages name it: the path given, and where it came from. */
export function describeKeyFile({ file, source }) {
  return source === 'environment' ? `${file} (from $${KEY_FILE_ENV})` : file
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex')

/**
 * An unsigned build signed: `files` (path -> bytes, as read from the build)
 * and its build.json `manifest` in, the signed files and manifest out. Each
 * blank app is signed once per distinct unsigned content, so the release
 * attachment and its latest/ copy stay byte-identical (the app compares the
 * two). Throws on a manifest that is signed already or has no releasePublicKey, on
 * a key whose public half is not that releasePublicKey, on a file the manifest does
 * not describe byte for byte, and on a signature that does not verify.
 */
export function signBuild(files, manifest, privateKeyPem) {
  if (manifest === null || typeof manifest !== 'object' || typeof manifest.files !== 'object') throw new Error('build.json: not a release build manifest')
  if (manifest.signed !== false) throw new Error('build.json says the build is signed already: sign an unsigned build (viewer_pack_release.mjs --unsigned)')
  if (typeof manifest.releasePublicKey !== 'string' || manifest.releasePublicKey === '') throw new Error('build.json names no releasePublicKey: build it with a viewer_pack_release.mjs that records one')
  if (publicKeyOf(privateKeyPem) !== manifest.releasePublicKey) throw new Error("the signing key is not the one the build's app carries (build.json releasePublicKey): the app would refuse these files")
  const names = Object.keys(manifest.files).sort()
  const given = [...files.keys()].sort()
  if (JSON.stringify(names) !== JSON.stringify(given)) throw new Error(`the build's files are not the ones build.json lists (${given.join(', ')} vs ${names.join(', ')})`)
  const signedBy = new Map() // unsigned sha256 -> signed bytes
  const outFiles = new Map()
  const outManifest = { ...manifest, signed: true, publicKey: manifest.releasePublicKey, files: {} }
  for (const rel of names) {
    const buf = files.get(rel)
    const entry = manifest.files[rel]
    if (sha256(buf) !== entry.sha256 || buf.byteLength !== entry.bytes) throw new Error(`${rel} is not the file build.json describes`)
    if (entry.blank !== true) {
      outFiles.set(rel, buf)
      outManifest.files[rel] = entry
      continue
    }
    if (entry.unsignedSha256 !== entry.sha256) throw new Error(`${rel}: build.json's unsigned digest is not the file's`)
    let signed = signedBy.get(entry.sha256)
    if (signed === undefined) {
      signed = signHtml(buf, privateKeyPem)
      if (!verifyHtml(signed, manifest.releasePublicKey)) throw new Error(`${rel} does not verify after signing`)
      signedBy.set(entry.sha256, signed)
    }
    outFiles.set(rel, signed)
    outManifest.files[rel] = { bytes: signed.byteLength, sha256: sha256(signed), blank: true, unsignedSha256: entry.unsignedSha256 }
  }
  return { files: outFiles, manifest: outManifest }
}

/** Every file under `dir`, `/`-separated and relative, build.json left out. */
function filesUnder(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name)
    if (name.isDirectory()) out.push(...filesUnder(full, base))
    else if (name.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'))
    else throw new Error(`${full}: neither a file nor a directory`)
  }
  return out.filter(f => f !== 'build.json')
}

function signDir(inDir, outDir, privateKeyPem) {
  if (existsSync(outDir) && readdirSync(outDir).length > 0) throw new Error(`--out ${outDir} is not empty`)
  const manifest = JSON.parse(readFileSync(path.join(inDir, 'build.json'), 'utf8'))
  const files = new Map(filesUnder(inDir).map(rel => [rel, readFileSync(path.join(inDir, rel))]))
  const signed = signBuild(files, manifest, privateKeyPem)
  for (const [rel, buf] of signed.files) {
    mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true })
    writeFileSync(path.join(outDir, rel), buf)
  }
  writeFileSync(path.join(outDir, 'build.json'), JSON.stringify(signed.manifest, null, 2) + '\n')
  return signed.manifest
}

export function parseArgs(argv) {
  const [command, ...rest] = argv
  if (!['create', 'public', 'sign'].includes(command)) throw new Error('usage: viewer_pack_signing.mjs create|public [--key-file <path>] | sign --in <unsigned build> --out <new dir> [--key-file <path>]')
  const out = { command, keyFile: null, in: null, out: null }
  const flags = new Map([['--key-file', 'keyFile'], ...(command === 'sign' ? [['--in', 'in'], ['--out', 'out']] : [])])
  for (let i = 0; i < rest.length; i++) {
    const key = flags.get(rest[i])
    if (key !== undefined && i + 1 < rest.length && rest[i + 1] !== '' && out[key] === null) out[key] = rest[++i]
    else throw new Error(`unknown argument: ${rest[i]}`)
  }
  if (command === 'sign' && (out.in === null || out.out === null)) throw new Error('sign needs --in <unsigned build> and --out <new dir>')
  return out
}

function main(argv) {
  const { command, keyFile: given, in: inDir, out: outDir } = parseArgs(argv)
  const where = resolveKeyFile({ given })
  const keyFile = where.file
  if (command === 'sign') {
    if (!existsSync(keyFile)) throw new Error(`no release signing key at ${describeKeyFile(where)}`)
    const manifest = signDir(path.resolve(inDir), path.resolve(outDir), readFileSync(keyFile, 'utf8'))
    for (const [rel, f] of Object.entries(manifest.files)) if (f.blank) console.log(`signed  ${rel}  sha256 ${f.sha256}  (unsigned ${f.unsignedSha256})`)
    console.log(`SIGNED ${path.resolve(outDir)} with ${describeKeyFile(where)}`)
    return
  }
  if (command === 'public') {
    console.log(`PUBLIC_KEY=${publicKeyOf(readFileSync(keyFile, 'utf8'))}`)
    return
  }
  if (existsSync(keyFile)) throw new Error(`${keyFile} exists already: the release key is made once (a new key would refuse every app already out). Print its public key with: node ${process.argv[1]} public`)
  const { privateKeyPem, publicKey } = newKeyPair()
  // wx: never over a file that appeared meanwhile.
  writeFileSync(keyFile, privateKeyPem, { flag: 'wx', mode: 0o600 })
  console.log(`KEY_FILE=${keyFile}`)
  console.log(`PUBLIC_KEY=${publicKey}`)
  console.log('Keep a copy of the key file somewhere safe and offline: without it no later release can be signed for the apps already out.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(`viewer_pack_signing: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
