/**
 * The release signature (owner 2026-11-17): only a blank app AgroDesign signed
 * is taken as the latest version — checked with the public key the app
 * carries, over the file's bytes with the signature's own text left out, as
 * scripts/viewer_pack_signing.mjs signs it.
 */
import { describe, expect, it } from 'vitest'

import { checkReleaseSignature, RELEASE_PUBLIC_KEY, signatureRange, SIGNATURE_META } from './releaseSignature'
import { releaseKeyPair, signPage } from './releaseSigning.testkit'

const enc = new TextEncoder()

const PAGE = `<!DOCTYPE html><html><head><meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'" /><meta name="${SIGNATURE_META}" content="" /></head><body><script>const mark = '<meta name="${SIGNATURE_META}" content="'</script></body></html>`

describe('checkReleaseSignature', () => {
  it('takes a page signed with the release key, and only with it', async () => {
    const release = await releaseKeyPair()
    const other = await releaseKeyPair()
    const signed = await signPage(PAGE, release.privateKey)
    expect(await checkReleaseSignature(signed, release.publicKey)).toBeNull()
    expect(await checkReleaseSignature(signed, other.publicKey)).toBe('bad')
  })

  it('refuses a page changed after signing, even by one byte, the signature itself included', async () => {
    const release = await releaseKeyPair()
    const signed = await signPage(PAGE, release.privateKey)
    const late = signed.slice()
    late[late.length - 20] ^= 1
    expect(await checkReleaseSignature(late, release.publicKey)).toBe('bad')
    const range = signatureRange(signed)!
    const sig = signed.slice()
    sig[range.start + 3] = sig[range.start + 3] === 0x41 ? 0x42 : 0x41
    expect(await checkReleaseSignature(sig, release.publicKey)).toBe('bad')
  })

  it('says unsigned for a page with no signature, an empty one, or one after a script; bad for one that is not 64 bytes', async () => {
    const release = await releaseKeyPair()
    expect(await checkReleaseSignature(enc.encode('<html><head></head></html>'), release.publicKey)).toBe('unsigned')
    expect(await checkReleaseSignature(enc.encode(PAGE), release.publicKey)).toBe('unsigned')
    const late = `<html><head><script></script><meta name="${SIGNATURE_META}" content="${'A'.repeat(88)}" /></head></html>`
    expect(await checkReleaseSignature(enc.encode(late), release.publicKey)).toBe('unsigned')
    const short = PAGE.replace(`content="" />`, `content="QUJD" />`)
    expect(await checkReleaseSignature(enc.encode(short), release.publicKey)).toBe('bad')
    const junk = PAGE.replace(`content="" />`, `content="not base64!" />`)
    expect(await checkReleaseSignature(enc.encode(junk), release.publicKey)).toBe('bad')
  })

  it('refuses everything when it carries no key, or the browser has no WebCrypto', async () => {
    const release = await releaseKeyPair()
    const signed = await signPage(PAGE, release.privateKey)
    expect(await checkReleaseSignature(signed, '')).toBe('no-crypto')
    const subtle = globalThis.crypto.subtle
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true })
    try {
      expect(await checkReleaseSignature(signed, release.publicKey)).toBe('no-crypto')
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: subtle, configurable: true })
    }
  })

  it('carries AgroDesign’s release key: an ECDSA P-256 public key', async () => {
    const key = await crypto.subtle.importKey('spki', Uint8Array.from(atob(RELEASE_PUBLIC_KEY), c => c.charCodeAt(0)), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
    expect(key.algorithm).toMatchObject({ name: 'ECDSA', namedCurve: 'P-256' })
    expect(key.type).toBe('public')
  })
})
