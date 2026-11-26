/**
 * The release signature (owner 2026-11-17: 署名を「してください」): every blank
 * app the Protein Viewer Pack publishes is signed by AgroDesign's own key, and
 * HELP's 「最新版ダウンロード」 puts the person's data only into a file whose
 * signature this app checks with the public key it carries
 * (`RELEASE_PUBLIC_KEY`). A checksum (SHA-256) alone shows a file is the one
 * listed beside it — whoever can change the file can change that list too; a
 * signature can only be made with the private key, which never leaves the
 * release builder's machine (`scripts/viewer_pack_signing.mjs` says where the
 * build looks for it; docs/runbooks/standalone-viewer-pack-distribution.md §1.7).
 *
 * The signature sits in the file itself, so a downloaded file and one chosen on
 * this computer are checked the same way: `<meta name="agdb-viewer-pack-signature"
 * content="<base64>">` in the head, before any script. What is signed is the
 * file's bytes with that content left empty — the file as the build wrote it
 * before signing (`scripts/viewer_pack_signing.mjs` `signHtml`, the one other
 * place this definition lives; this module's tests hold it to that). ECDSA P-256 with SHA-256, the signature as r‖s (64
 * bytes, what WebCrypto reads), base64.
 *
 * A copy the app makes of itself carries no signature (`selfCopy.ts` leaves the
 * meta out), so only the files AgroDesign published pass.
 */

/** The meta that carries the signature, as the build writes it (name first, content second). */
export const SIGNATURE_META = 'agdb-viewer-pack-signature'

/**
 * AgroDesign's release-signing public key: ECDSA P-256, SubjectPublicKeyInfo,
 * base64. Made once by the owner (`viewer_pack_signing.mjs create`,
 * 2026-11-17); the private key is the build host's only.
 */
export const RELEASE_PUBLIC_KEY =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEfnpNAr2hVsTzRX5uxO48b/SLbksThP3KgwJ4Raw9tSDiS/6RHNVi+GZ2qU3aRCvQBwhdrON2uTe8KNhFwF0i4Q=='

/** Why a file is not taken as AgroDesign's: no signature, one that does not match, or no way to check it here. */
export type SignatureFailure = 'unsigned' | 'bad' | 'no-crypto'

const enc = new TextEncoder()
const MARK = enc.encode(`<meta name="${SIGNATURE_META}" content="`)
const SCRIPT = enc.encode('<script')
const QUOTE = 0x22

/** The first place `needle` stands in `hay` at or after `from`, or -1. */
function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0]
  for (let i = hay.indexOf(first, from); i !== -1 && i <= hay.length - needle.length; i = hay.indexOf(first, i + 1)) {
    let j = 1
    while (j < needle.length && hay[i + j] === needle[j]) j++
    if (j === needle.length) return i
  }
  return -1
}

/**
 * Where the signature's text stands in `bytes` — `[start, end)` inside the
 * content attribute — or null when the file has no signature meta before its
 * first script. The first mark only: the app's own code, later in the file,
 * may spell the same words.
 */
export function signatureRange(bytes: Uint8Array): { start: number; end: number } | null {
  const at = indexOf(bytes, MARK)
  if (at === -1) return null
  const script = indexOf(bytes, SCRIPT)
  if (script !== -1 && script < at) return null
  const start = at + MARK.length
  const end = bytes.indexOf(QUOTE, start)
  return end === -1 || end - start > 200 ? null : { start, end }
}

function base64Bytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null
  try {
    const bin = atob(text)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/**
 * Is `bytes` a file AgroDesign signed with the key whose public half is
 * `publicKey` (SPKI, base64)? null when it is; else why not. Never throws.
 */
export async function checkReleaseSignature(bytes: Uint8Array, publicKey: string = RELEASE_PUBLIC_KEY): Promise<SignatureFailure | null> {
  const range = signatureRange(bytes)
  if (range === null || range.end === range.start) return 'unsigned'
  const signature = base64Bytes(new TextDecoder().decode(bytes.subarray(range.start, range.end)))
  if (signature === null || signature.byteLength !== 64) return 'bad'
  const spki = base64Bytes(publicKey)
  const subtle = globalThis.crypto?.subtle
  if (spki === null || subtle === undefined) return 'no-crypto'
  let key: CryptoKey
  try {
    key = await subtle.importKey('spki', spki as Uint8Array<ArrayBuffer>, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  } catch {
    return 'no-crypto'
  }
  // The file as it was signed: the signature's own text left out.
  const message = new Uint8Array(bytes.byteLength - (range.end - range.start))
  message.set(bytes.subarray(0, range.start), 0)
  message.set(bytes.subarray(range.end), range.start)
  try {
    const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature as Uint8Array<ArrayBuffer>, message)
    return ok ? null : 'bad'
  } catch {
    return 'bad'
  }
}
