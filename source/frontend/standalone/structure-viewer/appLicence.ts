/**
 * This app's own licence (owner 2026-11-15: the file is to be published on
 * GitHub under the MIT License). It covers the app's own program; the
 * software the file carries — 3Dmol.js and what it bundles, PyMOL and its
 * runtime, the open-source packages of the page — keeps its own licence, each
 * listed after this one in the licence dialog. The copyright line names the
 * publisher the owner's notice signs with; its year is the first
 * publication's.
 */
export const APP_LICENCE_TITLE = 'AgroDesign Protein Viewer Pack (HTMLapp)'

/**
 * The app's own version (owner 2026-11-16: 「1.0.0 ＋ git の短い番号」): this
 * app's, not AgDB's — AgDB's package.json version is not it. The short
 * commit the file was built from follows it in brackets.
 *
 * Held at 1.0.0 until the public release (owner 2026-11-16: 「公開を承認
 * するまでは改良したとしても、1.0.0としておいてください」), which came on
 * 2026-11-19 (「GitHubページを公開してください。」). Since then every
 * release raises it: 1.0.1 is React's production build (PT-9858); 1.0.2 the app's facts
 * in HELP 「使い方」 and the maker's links (owner 2026-11-19); 1.0.3 the
 * dismissible preset note, the PDB ID link, the phone's flag-only language
 * switch and the first-run guide (owner 2026-11-19); 1.0.4 the phone's own
 * PyMOL object list and the computer's one-row 3Dmol.js toolbar and mouse
 * controls card (owner 2026-11-19); 1.0.5 the open dialog's wording and mode
 * box, HELP's ①→② latest steps, the PyMOL panel's lower-button marks, pull
 * to zoom and 「オリジナル表示」, the screenshot's resolution, and 「改良点」 as
 * a link to its GitHub document (owner 2026-11-20). `appVersion.test.ts`
 * pins the value, so a raise is a deliberate edit of both. The
 * latest-version check compares it with GitHub's latest release tag
 * (`latestRelease.ts`).
 */
export const APP_VERSION = '1.0.7'

/**
 * The app's public repository (owner 2026-11-16: created; public since
 * 2026-11-19).
 * The one place to write its URL: 「このアプリについて」's GitHub row, the
 * releases link and the latest-version check's API address
 * (`latestReleaseApiUrl`) all come from it; '' would draw none of them.
 */
export const APP_GITHUB_URL: string = 'https://github.com/AgroDesign-Studios/ProteinViewerPack'

/**
 * The maker's website and its protein structure analysis service (owner
 * 2026-11-19: 制作会社website / タンパク質構造解析サービスAgroBox®, 「リンク付きで
 * 適切な場所に掲示」): `AppAbout`'s rows in every HELP tab that has them, each
 * URL shown as it is, as the GitHub row is. The service's name is a mark,
 * written once here and never translated.
 */
export const COMPANY_SITE_URL = 'https://www.agrodesign.co.jp'
export const AGROBOX_URL = 'https://www.agrobox.jp/'
export const AGROBOX_NAME = 'AgroBox®'

/** A short commit id, or nothing: anything else is dropped rather than shown. */
const SHORT_SHA = /^[0-9a-f]{7,12}$/

/**
 * The commit the file was built from, as vite.structure-viewer.config.ts
 * wrote it into the build (`define`), or '' where it wrote none — a build
 * with no git and no AGDB_GIT_SHA, or a test, which runs no such build.
 */
export const APP_BUILD_SHA: string = typeof __SAV_BUILD_SHA__ === 'string' && SHORT_SHA.test(__SAV_BUILD_SHA__) ? __SAV_BUILD_SHA__ : ''

/** 「ver 1.0.0 (abc1234)」, or 「ver 1.0.0」 with no commit known. */
export function appVersionText(sha: string = APP_BUILD_SHA): string {
  return SHORT_SHA.test(sha) ? `ver ${APP_VERSION} (${sha})` : `ver ${APP_VERSION}`
}

export const APP_LICENCE_NAME = 'MIT License'

export const APP_LICENCE_TEXT = `MIT License

Copyright (c) 2026 AgroDesign Studios

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`
