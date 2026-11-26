/**
 * Tests' own release keys and signing (never part of the app: no module of the
 * page imports this). A page is signed as scripts/viewer_pack_signing.mjs
 * signs it — the signature of its bytes with the signature meta's content
 * empty, put into that content — so the app's check (`releaseSignature.ts`)
 * can be driven with a key the test holds.
 */
import { signatureRange } from './releaseSignature'

const enc = new TextEncoder()
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)))

/** A key pair as the release uses: ECDSA P-256; the public half as SPKI base64. */
export async function releaseKeyPair(): Promise<{ privateKey: CryptoKey; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  return { privateKey: pair.privateKey, publicKey: b64(await crypto.subtle.exportKey('spki', pair.publicKey)) }
}

/** `html` signed: the signature of its bytes (the content empty) put into its signature meta. */
export async function signPage(html: string, privateKey: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = enc.encode(html)
  const range = signatureRange(bytes)
  if (range === null || range.end !== range.start) throw new Error('no empty signature meta')
  const signature = enc.encode(b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, bytes)))
  const out = new Uint8Array(bytes.byteLength + signature.byteLength)
  out.set(bytes.subarray(0, range.start), 0)
  out.set(signature, range.start)
  out.set(bytes.subarray(range.start), range.start + signature.byteLength)
  return out
}
