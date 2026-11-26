# AgroDesign Protein Viewer Pack (HTMLapp)

<p>
<img src="images/badges/android.svg" alt="Android: phone · tablet" height="28">
<img src="images/badges/ios.svg" alt="iOS / iPadOS: iPhone · iPad" height="28">
<img src="images/badges/windows.svg" alt="Windows" height="28">
<img src="images/badges/macos.svg" alt="macOS" height="28">
<img src="images/badges/linux.svg" alt="Linux" height="28">
</p>

*English follows below.*

**タンパク質構造データと複数のビューワーが１ファイルになった**ブラウザアプリです。Includes 3Dmol.js. Includes PyMOL™.

- **HTML ファイル 1 つで動く** — ウェブブラウザ上で動く、インストールもアカウントも不要なアプリ。
- **オフラインで動く** — ブラウザアプリですが、ネットにつながなくても動作します。
- **スマホでも PC でも** — 同じファイルが Windows・macOS・Linux・iPhone / iPad（iOS / iPadOS）・Android™ のブラウザで動きます。
- **メールでアプリと構造を１ファイルで送れる** — 構造を入れたままアプリを保存してメールに添付すれば、受け取った人はすぐに構造を見られます。

<p align="center"><a href="https://agrodesign-studios.github.io/ProteinViewerPack/"><img src="images/badges/live-sample.svg" alt="稼働サンプル（そのままダウンロード可能）" height="44"></a></p>

<p align="center">
<img src="images/screenshot-phone-3dmol-framed.png" alt="スマホで 25HN を &quot;3Dmol.js&quot; モードで表示" width="260">
<img src="images/screenshot-phone-pymol-framed.png" alt="スマホで 25HN をフル版の &quot;Includes PyMOL™&quot; モードで表示" width="260">
</p>
<p align="center"><sub>スマホで見たサンプル 25HN。左: "3Dmol.js" モード、右: フル版の "Includes PyMOL™" モード</sub></p>

<p align="center">
<img src="images/screenshot-pc-monitor.png" alt="PC の画面で 25HN を表示。斜めの線の左は &quot;3Dmol.js&quot; モード、右は &quot;Includes PyMOL™&quot; モード" width="524">
</p>
<p align="center"><sub>PC でも。左: "3Dmol.js" モード、右: "Includes PyMOL™" モード。ワンタッチで切り替えられます。</sub></p>



## 稼働サンプル

<p align="center"><a href="https://agrodesign-studios.github.io/ProteinViewerPack/"><img src="images/badges/live-sample.svg" alt="稼働サンプル（そのままダウンロード可能）" height="44"></a></p>

- **ブラウザで開く（稼働サンプル）**: <https://agrodesign-studios.github.io/ProteinViewerPack/>
- **そのままダウンロード**: 開いたアプリは「エクスポート…」→「HTMLappとして出力（このアプリをコピー）」で、構造を入れたまま 1 ファイルで保存できます。

開くと、PDB エントリ [25HN](https://www.rcsb.org/structure/25HN)（Nitrosospira multiformis の Rubisco のクライオ電子顕微鏡構造）を入れたフル版が "3Dmol.js" モードで表示されます。右上のスイッチ（スマホでは下部バーの「モード」）で "Includes PyMOL™" モードに切り替えられます。スマホでもそのまま試せます。最初に約 21 MB を読み込みます。ほかの構造は「ファイル/PDBを開く…」（スマホでは下部バーの「開く」）で開けます。

## ダウンロード

[Releases](https://github.com/AgroDesign-Studios/ProteinViewerPack/releases/latest) からどちらか 1 つをダウンロードし、ダブルクリックで開きます。

| ファイル | 大きさ | 中身 |
|---|---|---|
| `AgroDesign-ProteinViewerPack-v<版>_full_<日付>.html`（フル版） | 約 19 MB | "3Dmol.js" モードと "Includes PyMOL™" モード: "Includes PyMOL™" モードはメニュー・コマンドライン・レイトレース画像・.pse セッション |
| `AgroDesign-ProteinViewerPack-v<版>_light_<日付>.html`（ライト版） | 約 1.2 MB | "3Dmol.js" モードのみ |

ダウンロードしたファイルは空です。「ファイル/PDBを開く…」で構造ファイル（PDB・mmCIF・SDF/MOL・MOL2・XYZ、フル版は .pse も）を開くか、PDB ID を入れるか、ファイルをページにドロップします。

**サンプル**: [`index.html`](index.html)（日本語）と [`en/index.html`](en/index.html)（英語）は、PDB エントリ [25HN](https://www.rcsb.org/structure/25HN) を入れたフル版です。「Download raw file」でダウンロードしてダブルクリックすると開きます。構造ファイルだけなら [`sample/25HN.cif`](sample/25HN.cif)。

## メールで構造を送る

1. 構造を開く
2. 「エクスポート…」→「HTMLappとして出力（このアプリをコピー）」で、「版」（「ライト版」か、フル版にあたる「通常版」）を選んで保存
3. 保存した .html をメールに添付

メールの添付は 20〜25 MB 程度までのことが多く、フル版（約 19 MB＋構造）は届かないことがあります。メールにはライト版（約 1.2 MB＋構造）を使うか、フル版はファイル共有サービスで渡してください。
※注意：iPhone/iPadの場合は、iOSの仕様によりHTMLファイルをそのまま開くことができません。iOSアプリでは、Microsoft EdgeのみHTMLファイルを直接開けることを確認しております。（添付ファイルをクリック→右上(･･･）→共有→EDGEを選択→EDGEで開く）


## 使い方

- **回す・拡大・移動**: マウスは左ドラッグ・右ドラッグ・中ドラッグ。タッチは下の「スマホでの操作」。
- **モードの切り替え（フル版）**: 右上の切り替え（スマホは下部バーの「モード」）で "3Dmol.js" モードと "Includes PyMOL™" モードを切り替えます。"Includes PyMOL™" モードは起動に時間がかかり、メモリを 0.5〜1.5 GB 使います。
- **スマホ表示**: 幅の狭い画面では 1 画面に収まる表示になり、下部バーで操作します。上部の「スマホ表示」／「PC」で切り替えられます。
- **言語**: 日本語で開きます。上部の「English」／「日本語」で切り替えます。
- **HELP**: 「使い方」「最新版ダウンロード」「ライセンス表記」「改良点」。

## できること

- "3Dmol.js" モード: リボン・スティック・ボール＆スティック・ライン・表面、配色、測定、ペンとレーザーポインター、奥行き強調、断面、平行投影
- フル版の "Includes PyMOL™" モード: メニューとコマンドライン、.pse セッション、レイトレース画像
- 保存: スクリーンショット（PNG。画面の 1〜4 倍の解像度を選べます）、レイトレース画像、構造ファイル、選択範囲の分子ファイル、.pse、VRML（.wrl）、HTMLapp
- 読み込んだファイルは、お使いの端末外には送信されません。ネットにつなぐのは、PDB から読むとき（files.rcsb.org）、HELP の「最新版ダウンロード」で「①GitHubの最新版を確認」を押したとき（api.github.com）とその後の「②今のデータを引き継いだ最新版を別途保存」（raw.githubusercontent.com）、外へのリンクを開いたときだけです。

## スマホでの操作

<p align="center">
<img src="images/gesture-pinch.webp" alt="2 本指で広げると拡大し、つまむと縮小する（&quot;3Dmol.js&quot; モード）" width="172">
<img src="images/gesture-pan.webp" alt="2 本指でなぞると構造が横に動く" width="172">
<img src="images/gesture-rotate.webp" alt="1 本指でなぞると構造が回る（&quot;3Dmol.js&quot; モード）" width="172">
</p>
<p align="center"><sub>左: ピンチで拡大・縮小。中: 2 本指でなぞって移動。右: 1 本指で回転。灰色の丸は指の位置です。</sub></p>

- **1 本指でなぞる**: 回転
- **2 本指で広げる・つまむ（ピンチ）**: 拡大・縮小
- **2 本指でなぞる**: 上下左右に移動（"3Dmol.js" モードと "Includes PyMOL™" モードで同じ）
- **3Dmol.js オリジナルの操作**: "3Dmol.js" モードは、3Dmol.js 本来の操作（2 本指は拡大・縮小だけ、3 本指で移動）にも切り替えられます。下部バーの「表示」か HELP の「使い方」の「3Dmol.js オリジナルの操作を使う」で、選んだ操作はこのブラウザが覚えます。
- **下部バーの「表示」**: 拡大・縮小のボタン（"Includes PyMOL™" モードでは全体を表示するボタンも）
- **下部バーの「モード」**: "3Dmol.js" モードと "Includes PyMOL™" モードの切り替え

## PC での表示（スイッチで切替）

<img src="images/screenshot-pc-3dmol.png" alt="PC で 25HN を &quot;3Dmol.js&quot; モードで表示" width="49%"> <img src="images/screenshot-pc-pymol.png" alt="PC で 25HN をフル版の &quot;Includes PyMOL™&quot; モードで表示" width="49%">

右上のスイッチで "3Dmol.js" モード（左）と "Includes PyMOL™" モード（右）を切り替えます。

## 動作環境

| ブラウザ | "3Dmol.js" モード（両方の版） | "Includes PyMOL™" モード（フル版） |
|---|---|---|
| Chrome・Edge（Windows・macOS・Linux・Android） | 111 以降 | 111 以降 |
| Firefox（Windows・macOS・Linux・Android） | 121 以降 | 121 以降 |
| Safari（macOS） | 16.4 以降 | 17 以降 |
| iPhone・iPad のブラウザ（Safari・Edge・Chrome など。どれも WebKit） | iOS / iPadOS 16.4 以降 | iOS / iPadOS 17 以降 |

- **実機で確認済み**: Windows の Chrome、iPhone の Edge
- **自動検証のみ**: Linux の Chrome（headless・ソフトウェア描画で両方のビューアを確認）
- **要件上は動くはず（未確認）**: Android（Chrome・Firefox など）、macOS（Safari・Chrome など）、Windows の Edge・Firefox、iPhone の Safari、iPad
- "Includes PyMOL™" モードが使えないブラウザやメモリの少ないスマホでは "3Dmol.js" モードで表示します。WebGL がないブラウザでは、鎖とリガンドの一覧を文字で表示します。

## 改良点

フル版の "Includes PyMOL™" モードは、Open-Source PyMOL 3.2.0a（pymol-open-source のコミット edcda80f）を AgroDesign Studios が変更し、Pyodide 314.0.7 向けに WebAssembly でビルドしたものです。オリジナル版との違いは次のとおりです。

- **入っていないもの**: TrueType のラベル用フォント 14 種のうち、Serif・Mono・Gentium の 10 種（9〜18 番。これらを指定したラベルは DejaVu Sans で描きます。Sans の 4 種は残しています）。Qt・プラグイン・HTTP/RPC サーバー・外部プログラム連携・デモのウィザードなど、ブラウザで動かない部分。メニューの 28 項目
- **起動時の設定の違い**: `trilines`・`cgo_shader_ub_color` をオン、`defer_builds_mode` は表示中の状態だけを作る（グリッドではオリジナル版どおり）、レイトレースは 1 スレッド
- **ブラウザで動かすための変更**: WebGL1/WebGL2 向けのシェーダーの書き換えなど（パッチ 0001〜0005）
- **ファイルを安全に読むための変更**: `.pse` セッションは許可リストで読み、pickle やスクリプトの形式は開きません。ムービーとウィザードはセッションから戻しません
- **起動を速く、ダウンロードを小さく**: 不透明な表面の毎フレームの並べ替えをやめ、近傍リストの作り方を速くしたほか、Python のコンパイル済みファイルの同梱、numpy の遅延展開など。多くは結果を変えません。ビルドのたびに確かめているもの（タブに書いています）と、設計のときに手で確かめたものがあります。不透明な表面の変更では、表面の縁の数画素が変わることがあり、`transparency_global_sort 1` と `pick_surface 1` での動きも変わります。また、コンパイル済みの Python では、標準ライブラリの中のトレースバックの行にソースの文が出ません
- **オリジナル版の修正の取り込み**: UTF-8 のバッファ修正（オリジナル版 #522）

14 個のパッチの全文と、各変更の結果への影響（同じ・見た目が違うことがある・使えない など）は [CODE-CHANGES.md](CODE-CHANGES.md) にあります（アプリの HELP の「改良点」から、その版の文書を開けます）。3Dmol.js 2.5.5 は改変せずに使っています。アプリがその周りに加えたもの（2 本指の移動など）も同じ文書に挙げています。

## 引用

このアプリを使った研究を発表するときは、使ったビューアを、それぞれの作者・会社が求める形で引用してください（引用文は英語の原文のまま）。

- 3Dmol.js（"3Dmol.js" モード。フル版・ライト版とも）— 3Dmol.js の作者が求める論文:
  Nicholas Rego and David Koes, "3Dmol.js: molecular visualization with WebGL", *Bioinformatics* 31(8):1322–1324 (2015), [doi:10.1093/bioinformatics/btu829](https://doi.org/10.1093/bioinformatics/btu829)
- フル版の "Includes PyMOL™" モード：Built using PyMOL™. Schrödinger, LLC が求める形で、使った版を入れて:
  The PyMOL Molecular Graphics System, Version 3.2, Schrödinger, LLC.

## ライセンス・帰属・商標

- このアプリ自体は [MIT License](LICENSE)。同梱のオープンソースソフトウェアはそれぞれのライセンスに従い、名前・版・全文は [`NOTICE`](NOTICE) とアプリの「HELP」→「ライセンス表記」にあります。
- アプリのソースコードは [`source/`](source/) にあります。ライセンスと、それが覆う範囲は [`source/LICENSE`](source/LICENSE) に書いています。
- Includes PyMOL™.（PyMOL™ を含みます。）フル版の "Includes PyMOL™" モードは、AgroDesign Studios が Open-Source PyMOL のソースコードをそのライセンスのもとで変更・機能追加し、WebAssembly でブラウザ向けにビルドしたものです。Schrödinger, LLC が配布する PyMOL 製品とは別のものです。
- Includes 3Dmol.js（BSD 3-Clause License）。論文の引用は上の「引用」の節にあります。
- フル版の PyMOL の実行環境は [FreeType](https://freetype.org) を使っています。このソフトウェアの一部は FreeType Team の成果にもとづいています（原文: "This software is based in part on the work of the FreeType Team." FreeType License の全文は [`NOTICE`](NOTICE) にあります）。
- サンプルは RCSB PDB のエントリ 25HN（[DOI 10.2210/pdb25HN/pdb](https://doi.org/10.2210/pdb25HN/pdb)）。PDB のデータは CC0 1.0 です。
- バッジとスマホ・モニターの絵（[`images/`](images)）:
  - Android のロボットは Google の作品を複製・改変したもので、CC BY 3.0 の条件に従って使用しています（原文: "The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the [Creative Commons](https://creativecommons.org/licenses/by/3.0/) 3.0 Attribution License."）。
  - Linux のペンギン（Tux）は Larry Ewing（lewing@isc.tamu.edu）が The GIMP で描いたもので、[Simple Icons](https://simpleicons.org/) の図形（CC0 1.0）を使っています。
  - iOS / iPadOS のバッジの電話の絵と、スクリーンショットを囲むスマホとモニターの絵は、このリポジトリで描いたもので、特定の製品を表すものではありません。ほかの OS とブラウザは名前だけで示しています。
  - 「スマホでの操作」のアニメーションは、このアプリの実際の画面を録画し、指の位置の丸を描き足したものです。
- 商標: Android と Chrome は Google LLC の商標です。iPhone、iPad、iPadOS、macOS、Safari は、米国およびその他の国や地域で登録された Apple Inc. の商標です。IOS は Cisco の米国およびその他の国における商標または登録商標で、ライセンスに基づき使用されています。Microsoft、Microsoft Edge、Windows は Microsoft グループ各社の商標です。Linux® は Linus Torvalds の米国およびその他の国における登録商標です。Firefox は Mozilla Foundation の米国およびその他の国における商標です。このアプリはこれらの会社・団体（Mozilla を含む）と公式な関係はなく、名前は動作する環境を示すためだけに使っています。
- 製作: 株式会社アグロデザイン・スタジオ（AgroDesign Studios）、西ヶ谷有輝（NISHIGAYA Yuki）。Copyright (c) 2026 AgroDesign Studios
- PyMOL は Schrödinger, LLC の商標です（原文はこの README の末尾）。

## 製作

- 株式会社アグロデザイン・スタジオ（AgroDesign Studios）: <https://www.agrodesign.co.jp>
- タンパク質構造解析サービス AgroBox®: <https://www.agrobox.jp/>

---

# AgroDesign Protein Viewer Pack (HTMLapp) (English)

<p>
<img src="images/badges/android.svg" alt="Android: phone · tablet" height="28">
<img src="images/badges/ios.svg" alt="iOS / iPadOS: iPhone · iPad" height="28">
<img src="images/badges/windows.svg" alt="Windows" height="28">
<img src="images/badges/macos.svg" alt="macOS" height="28">
<img src="images/badges/linux.svg" alt="Linux" height="28">
</p>

A browser app that puts **protein structure data and several viewers in one file**. Includes 3Dmol.js. Includes PyMOL™.

- **Runs from one HTML file** — an app that runs in your web browser, with no installation and no account.
- **Works offline** — it is a browser app, yet it works with no network connection.
- **On phones and PCs** — the same file runs in the browser on Windows, macOS, Linux, iPhone / iPad (iOS / iPadOS) and Android™.
- **Send the app and the structure by e-mail, as one file** — save the app with your structure inside and attach it, and the recipient sees the structure at once.

<p align="center"><a href="https://agrodesign-studios.github.io/ProteinViewerPack/en/"><img src="images/badges/live-sample-en.svg" alt="Live sample (ready to download)" height="44"></a></p>

<p align="center">
<img src="images/screenshot-phone-3dmol-en-framed.png" alt="25HN shown in &quot;3Dmol.js&quot; mode on a phone" width="260">
<img src="images/screenshot-phone-pymol-en-framed.png" alt="25HN shown in the full edition's &quot;Includes PyMOL™&quot; mode on a phone" width="260">
</p>
<p align="center"><sub>The sample 25HN on a phone. Left: "3Dmol.js" mode. Right: the full edition's "Includes PyMOL™" mode.</sub></p>

<p align="center">
<img src="images/screenshot-pc-monitor-en.png" alt="25HN on a PC screen: &quot;3Dmol.js&quot; mode left of the slanted line, &quot;Includes PyMOL™&quot; mode right of it" width="524">
</p>
<p align="center"><sub>On a PC too. Left: "3Dmol.js" mode. Right: "Includes PyMOL™" mode. One click switches between them.</sub></p>

## Live sample

<p align="center"><a href="https://agrodesign-studios.github.io/ProteinViewerPack/en/"><img src="images/badges/live-sample-en.svg" alt="Live sample (ready to download)" height="44"></a></p>

- **Open in the browser (live sample)**: <https://agrodesign-studios.github.io/ProteinViewerPack/en/>
- **Download it as it is**: "Export…" > "Save as HTMLapp (a copy of this app)" saves the app you opened, with its structure, as one file.

It opens the full edition with PDB entry [25HN](https://www.rcsb.org/structure/25HN) (a cryo-EM structure of Rubisco from Nitrosospira multiformis) in "3Dmol.js" mode. The switch at the top right (on a phone, "Mode" in the bottom bar) changes to "Includes PyMOL™" mode. It works on a phone as well. The page loads about 21 MB the first time. Open other structures with "Open file/PDB…" (on a phone, "Open" in the bottom bar).

## Download

From [Releases](https://github.com/AgroDesign-Studios/ProteinViewerPack/releases/latest), download one file and double-click it.

| File | Size | Contents |
|---|---|---|
| `AgroDesign-ProteinViewerPack-v<version>_full_<date>.html` (full edition) | about 19 MB | "3Dmol.js" mode and "Includes PyMOL™" mode: "Includes PyMOL™" mode has menus, a command line, ray-traced images and .pse sessions |
| `AgroDesign-ProteinViewerPack-v<version>_light_<date>.html` (light edition) | about 1.2 MB | "3Dmol.js" mode only |

The downloaded files are empty. Open a structure file with "Open file/PDB…" (PDB, mmCIF, SDF/MOL, MOL2, XYZ; .pse in the full edition), enter a PDB ID, or drop a file on the page.

**Sample**: [`index.html`](index.html) (Japanese) and [`en/index.html`](en/index.html) (English) are the full edition with PDB entry [25HN](https://www.rcsb.org/structure/25HN) inside. Download one ("Download raw file") and double-click it. The structure file alone: [`sample/25HN.cif`](sample/25HN.cif).

## Sending a structure by e-mail

1. Open the structure
2. "Export…" → "Save as HTMLapp (a copy of this app)", choose the edition and save
3. Attach the saved .html to an e-mail

Mail services often cap attachments at about 20-25 MB, so the full edition (about 19 MB plus the structure) may not get through. Send the light edition (about 1.2 MB plus the structure), or share the full edition through a file-sharing service.
Note: on iPhone / iPad, iOS does not open an HTML file as it is. Of the iOS apps, we have confirmed that only Microsoft Edge opens one directly (tap the attachment → (…) at the top right → Share → choose Edge → open in Edge).

## How to use

- **Turn, zoom, move**: mouse left, right and middle drag; on a touch screen see "On a phone" below.
- **Switch mode (full edition)**: the control at the top right (on a phone, "Mode" in the bottom bar) switches between "3Dmol.js" mode and "Includes PyMOL™" mode. "Includes PyMOL™" mode takes a while to start and uses 0.5-1.5 GB of memory.
- **Phone layout**: a narrow screen gets a one-screen layout with a bottom bar. "Phone view" / "PC" at the top switches.
- **Language**: opens in Japanese; "English" / "日本語" at the top switches.
- **Help**: "How to use", "Latest version", "Licences", "Code changes".

## Features

- "3Dmol.js" mode: ribbon, stick, ball and stick, line, surface; colouring; measuring; pen and laser pointer; depth cueing, slicing, orthographic view
- The full edition's "Includes PyMOL™" mode: menus and command line, .pse sessions, ray-traced images
- Save: screenshots (PNG, at 1-4 times the screen's resolution), ray-traced images, structure files, molecule files of a selection, .pse, VRML (.wrl), HTMLapp
- Files you open are never sent outside your device. The app goes online only to load from the PDB (files.rcsb.org), when you press "① Check the latest version on GitHub" in Help > "Latest version" (api.github.com) and then "② Save the latest version with the current data as a separate file" (raw.githubusercontent.com), or when you follow a link out of the file.

## On a phone

<p align="center">
<img src="images/gesture-pinch-en.webp" alt="Two fingers spread to zoom in and pinch to zoom out (&quot;3Dmol.js&quot; mode)" width="172">
<img src="images/gesture-pan-en.webp" alt="Two fingers dragged move the structure sideways" width="172">
<img src="images/gesture-rotate-en.webp" alt="One finger dragged turns the structure (&quot;3Dmol.js&quot; mode)" width="172">
</p>
<p align="center"><sub>Left: pinch to zoom. Middle: drag with two fingers to move. Right: drag with one finger to turn. The grey circles show where the fingers are.</sub></p>

- **Drag with one finger**: turn
- **Spread or pinch two fingers**: zoom in or out
- **Drag with two fingers**: move up, down and sideways (the same in "3Dmol.js" mode and "Includes PyMOL™" mode)
- **The original 3Dmol.js controls**: "3Dmol.js" mode can use 3Dmol.js's own controls instead (two fingers only zoom, three fingers move): "Use the original 3Dmol.js controls" under "View" in the bottom bar or in Help > "How to use". This browser remembers the choice.
- **"View" in the bottom bar**: buttons to zoom in and out (and, in "Includes PyMOL™" mode, to show everything)
- **"Mode" in the bottom bar**: switch between "3Dmol.js" mode and "Includes PyMOL™" mode

## On a PC (one switch changes the viewer)

<img src="images/screenshot-pc-3dmol-en.png" alt="25HN shown in &quot;3Dmol.js&quot; mode on a PC" width="49%"> <img src="images/screenshot-pc-pymol-en.png" alt="25HN shown in the full edition's &quot;Includes PyMOL™&quot; mode on a PC" width="49%">

The switch at the top right changes between "3Dmol.js" mode (left) and "Includes PyMOL™" mode (right).

## Supported environments

| Browser | "3Dmol.js" mode (both editions) | "Includes PyMOL™" mode (full edition) |
|---|---|---|
| Chrome, Edge (Windows, macOS, Linux, Android) | 111 or later | 111 or later |
| Firefox (Windows, macOS, Linux, Android) | 121 or later | 121 or later |
| Safari (macOS) | 16.4 or later | 17 or later |
| Browsers on an iPhone or iPad (Safari, Edge, Chrome and others, all WebKit) | iOS / iPadOS 16.4 or later | iOS / iPadOS 17 or later |

- **Tried on real devices**: Chrome on Windows, Edge on an iPhone
- **Automated check only**: Chrome on Linux (headless, software rendering, both viewers)
- **Should work from the requirements (not yet tried)**: Android (Chrome, Firefox and others), macOS (Safari, Chrome and others), Edge and Firefox on Windows, Safari on an iPhone, an iPad
- Where "Includes PyMOL™" mode cannot run (an older browser, a phone short of memory), "3Dmol.js" mode shows the structure. Without WebGL, the app lists the chains and ligands in words.

## Code changes

The full edition's "Includes PyMOL™" mode is Open-Source PyMOL 3.2.0a (pymol-open-source commit edcda80f), modified by AgroDesign Studios and compiled to WebAssembly for Pyodide 314.0.7. It differs from upstream as follows.

- **Left out**: ten of the 14 TrueType label fonts, Serif, Mono and Gentium (ids 9–18; labels set to them are drawn in DejaVu Sans, and the four Sans faces stay); Qt, plugins, the HTTP/RPC servers, external-program bindings, the demo wizards and the other parts that cannot run in a browser; 28 menu entries
- **Start-up settings that differ**: `trilines` and `cgo_shader_ub_color` on, `defer_builds_mode` builds only the state on screen (as upstream in grid views), one ray-tracing thread
- **Changes to run in a browser**: shaders rewritten for WebGL1/WebGL2 and related fixes (patches 0001-0005)
- **Safer reading of files**: `.pse` sessions are read through an allow-list, pickle and script formats are refused, and a session's movie and wizard are not restored
- **Faster start-up, smaller download**: opaque surfaces are no longer re-sorted every frame, faster neighbour lists, precompiled Python, numpy unpacked on first use, among others. Most leave results unchanged; some are checked at every build (the tab marks them), others were checked by hand during the design work. The opaque-surface change can alter a few pixels at surface edges and changes how `transparency_global_sort 1` and `pick_surface 1` behave; with precompiled Python a traceback line inside the standard library shows no source text
- **Fixes taken from upstream**: the UTF-8 buffer fix (upstream #522)

[CODE-CHANGES.md](CODE-CHANGES.md#english) has all 14 patches in full and each change's effect on results (unchanged, the picture can differ, not available, ...); the app's Help > "Code changes" opens the document of its own version. 3Dmol.js 2.5.5 is used unmodified; the same document lists what the app adds around it (two-finger move and others).

## Citation

If you publish work that used this app, please cite the viewer you used, in the form its makers ask for (the citations are given word for word).

- 3Dmol.js ("3Dmol.js" mode, in both editions): the paper the 3Dmol.js authors ask users to cite:
  Nicholas Rego and David Koes, "3Dmol.js: molecular visualization with WebGL", *Bioinformatics* 31(8):1322-1324 (2015), [doi:10.1093/bioinformatics/btu829](https://doi.org/10.1093/bioinformatics/btu829)
- The full edition's "Includes PyMOL™" mode: Built using PyMOL™. In the form Schrödinger, LLC asks for, with the version used:
  The PyMOL Molecular Graphics System, Version 3.2, Schrödinger, LLC.

## License, attribution and trademarks

- This app is under the [MIT License](LICENSE). The open-source software it carries keeps its own licence; names, versions and full texts are in [`NOTICE`](NOTICE) and in the app under "Help" → "Licences".
- The app's source code is in [`source/`](source/); its licence and what that licence covers are in [`source/LICENSE`](source/LICENSE).
- Includes PyMOL™. The full edition's "Includes PyMOL™" mode is built from Open-Source PyMOL source code, which AgroDesign Studios modified and extended under its license and compiled for the browser with WebAssembly. It is distinct from the PyMOL products distributed by Schrödinger, LLC.
- Includes 3Dmol.js (BSD 3-Clause License). Its paper is under "Citation" above.
- The full edition's PyMOL runtime uses FreeType: this software is based in part on the work of the FreeType Team ([FreeType](https://freetype.org); the FreeType License's full text is in [`NOTICE`](NOTICE)).
- The sample is PDB entry 25HN from the RCSB PDB ([DOI 10.2210/pdb25HN/pdb](https://doi.org/10.2210/pdb25HN/pdb)). PDB data are CC0 1.0.
- Badges, phone and monitor pictures ([`images/`](images)):
  - The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the [Creative Commons](https://creativecommons.org/licenses/by/3.0/) 3.0 Attribution License.
  - Tux, the Linux penguin, was drawn by Larry Ewing (lewing@isc.tamu.edu) with The GIMP; the shape used is from [Simple Icons](https://simpleicons.org/) (CC0 1.0).
  - The phone outline on the iOS / iPadOS badge and the phone and the monitor around the screenshots were drawn for this repository and depict no particular product. The other systems and the browsers are shown by name only.
  - The animations under "On a phone" are recordings of this app's own screen, with circles drawn where the fingers are.
- Trademarks: Android and Chrome are trademarks of Google LLC. iPhone, iPad, iPadOS, macOS and Safari are trademarks of Apple Inc., registered in the U.S. and other countries and regions. IOS is a trademark or registered trademark of Cisco in the U.S. and other countries and is used under license. Microsoft, Microsoft Edge and Windows are trademarks of the Microsoft group of companies. Linux® is the registered trademark of Linus Torvalds in the U.S. and other countries. Firefox is a trademark of the Mozilla Foundation in the U.S. and other countries. This app is not officially associated with any of these companies or organisations, Mozilla included; the names are used only to say where the app runs.
- Made by AgroDesign Studios (NISHIGAYA Yuki). Copyright (c) 2026 AgroDesign Studios
- The PyMOL trademark notice is at the end of this README.

## Made by

- AgroDesign Studios: <https://www.agrodesign.co.jp>
- AgroBox®, a protein structure analysis service: <https://www.agrobox.jp/>

---

## 更新履歴

各バージョンの主な変更です。ダウンロードは [Releases](https://github.com/AgroDesign-Studios/ProteinViewerPack/releases) から。

### v1.0.7（2026-11-26）
- アプリのソースコードを、このリポジトリの [`source/`](source/) で公開しました。アプリを組み立てるファイルとそのテスト、PyMOL の実行環境のビルド、リリースのスクリプトです。ビルドのしかた、テストの実行、リリースと同じファイルができることの確かめ方は [`source/README.md`](source/README.md) にあります。
- HELP の「最新版ダウンロード」: GitHub のリポジトリの下の一文を「最新版アプリとソースコードは、GitHub で公開しています。」にしました。
- 「HTMLappとして出力（このアプリをコピー）」: 保存を押すと、ファイル名の欄に実際に保存する名前（使えない文字を除いたもの）が出るようにしました。コピーを作っているあいだは、欄とその既定に戻すボタンを押せなくしました。

### v1.0.6（2026-11-22）
- "Includes PyMOL™" モード: 右上の「配列」タグ（下の「Seq」でも同じ）で、配列を画面の上に 1 行で出せるようにしました。文字にマウスを重ねる（スマホでは押す）と、その文字が光り、PyMOL の画面でその残基が一時的に黄色の太い棒で目立ち、左上に「どの構造の、どの鎖の、何番の、何という残基か」が出ます。
- "Includes PyMOL™" モード: 3Dmol.js モードと同じ「描画」（ペン・消しゴム・色・レーザー・十字）を使えるようにしました。パソコンはメニュー行の「描画」、スマホは表示ツールの「表示・操作」にあります。
- 「スクリーンショット（PNG）」: 描画した線があるときは「描画した線を含める」で、線を画像に入れるかどうかを選べるようにしました（両方のモード）。
- "Includes PyMOL™" モード: 下の ▼ ボタンにマウスを重ねると、「左右に揺らす」と「回転」、速さ（1 倍・2 倍・4 倍）を選べるようにしました。使わない F ボタンをなくし、S ボタンを「Seq」にしました。
- "Includes PyMOL™" モード: マウスモードの表をスマホでは出さず、パソコンでは畳んでおき、上のタグを押すと開くようにしました。
- "Includes PyMOL™" モード: オブジェクト一覧のつまみにマウスを重ねると、左右に引いて大きさを変えられることを吹き出しで示すようにしました。一覧を大きくしたあと小さく戻すと「スペースがない」と出て戻らないことがある不具合（特にスマホ）を直しました。
- "Includes PyMOL™" モード: サンプル構造の名前を「Structure」から「Structure_25HN」にしました。
- スマホ: 日本語/英語の切り替えの国旗を丸いアイコンにして、横の幅を節約しました。
- README に「稼働サンプル（そのままダウンロード可能）」のボタンを付けました。

### v1.0.5（2026-11-20）
- スクリーンショットの解像度を選べるようにしました（画面と同じ〜画面の 4 倍）。「画像出力」→「スクリーンショット（PNG）…」で選び、「画像作成」で作ります。"Includes PyMOL™" モードでは、右側のオブジェクト一覧を画像から外したいときは、一覧を畳んでから「画像作成」を押してください（画面に案内が出ます）。
- "Includes PyMOL™" モード（パソコン）: オブジェクト一覧の下のボタン（ムービーの操作とマウスモードの欄）にも、マウスを重ねると枠と説明が出るようにしました。この画面では働かないボタンは、点線の枠と理由を出します。
- "Includes PyMOL™" モード: 開いたオブジェクト一覧のつまみを左に引くと、一覧の文字と A S H L C のボタンが大きくなります（右に引くと小さく。設定の「表示の倍率」と同じ値です）。
- "Includes PyMOL™" モード: 「オリジナル表示」を選べるようにしました。v1.0.0 と同じオブジェクト一覧（パソコンではマウス操作の表も）に戻せます。パソコンは Setting →「すべての設定…」、スマホは表示ツールの「オブジェクト」の先頭にあります。
- 「ファイル/PDBを開く…」: "Includes PyMOL™" モードでファイルの開き方を選ぶ欄を先頭に移し、目立つようにしました。説明を「読み込んだファイルは、お使いの端末外には送信されません。」にしました。
- HELP の「最新版ダウンロード」: 「①GitHubの最新版を確認」⇓「②今のデータを引き継いだ最新版を別途保存」の順に並べ、①で確かめるまで②はグレーにしました。
- HELP の「改良点」: 内容を GitHub の文書 [CODE-CHANGES.md](CODE-CHANGES.md) に移し、タブからはその版の文書を開くようにしました。アプリが小さくなりました。

### v1.0.4（2026-11-19）
- スマホの "Includes PyMOL™" モード: PyMOL のオブジェクト一覧の代わりに、分子の右上の「オブジェクト」から、アプリの一覧を開くようにしました。表示のスイッチと、名前を押すと表示の種類・色・ラベル・視点・削除が使えます。測定中は、距離・角度・二面角と「最後を消す」「終了」のカードが出ます。
- パソコンの "3Dmol.js" モード: 分子の上のメニューを 1 段にしました。スタイル・表示・表面・奥行き・描画は分子の上に重なって開くので、分子の画面は小さくなりません。
- パソコンの "Includes PyMOL™" モード: マウス欄のボタンの表をなくし、メニュー行の右端の「🖱 マウス操作」で、マウスの操作を言葉で一覧できるようにしました。

### v1.0.3（2026-11-19）
- 初めて開いたときに、モードの切り替えとエクスポート（アプリのダウンロード）の場所を吹き出しで案内するようにしました。画面のどこかを押すと消えます。
- PDB から開いた構造は、構造名の前に PDB ID を出し、押すと RCSB PDB のページを開くようにしました。
- "Includes PyMOL™" モードの「創薬表示」のあとに出る説明に「詳しく」と「×」を付け、閉じられるようにしました。
- "Includes PyMOL™" モードのオブジェクト一覧: パソコンでは、マウスが重なったボタンに枠を付け、そのボタンの働きを出すようにしました。スマホでは、一覧を 2 本指で広げる（または表示ツールの「大きく」）と、一覧のボタンが大きくなります。
- スマホ表示の言語の切り替えを国旗だけにしました。英語表示の社名を「AgroDesign Studios」にしました。

### v1.0.2（2026-11-19）
- HELP の「使い方」の先頭にも、「最新版ダウンロード」「ライセンス表記」と同じく、アプリ名・使用中の版・製作会社・GitHub を出すようにしました。
- HELP に、製作会社のサイトと、タンパク質構造解析サービス AgroBox® へのリンクを足しました。
- エクスポートの「HTMLappとして出力」が、マウスを重ねると濃い色になるようにしました。

### v1.0.1（2026-11-19）
- アプリを本番用の設定で組み直しました。使い方と見た目は同じで、ファイルが小さくなりました（ライト版は約 1.4 MB → 約 1.2 MB）。
- v1.0.0 をお使いの方は、HELP の「最新版ダウンロード」から、今のデータを引き継いだ v1.0.1 を準備できます。

### v1.0.0（2026-11-19）
- 最初の版です。

---

## Release notes

The main changes in each version. Downloads are on the [Releases](https://github.com/AgroDesign-Studios/ProteinViewerPack/releases) page.

### v1.0.7 (2026-11-26)
- The app's source code is published in [`source/`](source/) of this repository: the files the app is built from, with their tests, the build of the PyMOL runtime and the release scripts. [`source/README.md`](source/README.md) says how to build it, run the tests and check that it makes the same files as a release.
- Help > "Latest version": the note under the GitHub repository says that the latest version of the app and its source code are published on GitHub.
- "Save as HTMLapp (a copy of this app)": pressing save shows, in the file-name field, the name the file is saved under (without the characters a file name cannot hold); while the copy is made, the field and its default button cannot be used.

### v1.0.6 (2026-11-22)
- "Includes PyMOL™" mode: the "Sequence" tag at the top right (or "Seq" below) shows the sequence in one row over the view. A residue under the mouse (tapped on a phone) is lit, stands out in PyMOL's view for the moment as thick yellow sticks, and a box at the top left says which structure, chain, number and residue it is.
- "Includes PyMOL™" mode: the same "Draw" as "3Dmol.js" mode (pen, eraser, colours, laser, crosshair): "Draw" in the menu row on a computer, "View & tools" in the view tools on a phone.
- "Screenshot (PNG)": with lines drawn, "Include the lines drawn" chooses whether they go into the picture (both modes).
- "Includes PyMOL™" mode: with the mouse on the ▼ button below, choose "Rock side to side" or "Rotate" and a speed (1×, 2×, 4×). The unused F button is gone, and the S button reads "Seq".
- "Includes PyMOL™" mode: the mouse-mode table is gone on a phone; on a computer it is folded away, and the tab above it opens it.
- "Includes PyMOL™" mode: a bubble on the object panel's tab says it pulls left and right to resize the panel. Fixed: after making the panel larger, making it smaller again could say there was no room and stay large (on phones especially).
- "Includes PyMOL™" mode: the sample structure is named "Structure_25HN" instead of "Structure".
- Phone: the Japanese/English switch is a round flag, which takes less width.
- The README has a "Live sample (ready to download)" button.

### v1.0.5 (2026-11-20)
- Screenshots at a chosen resolution (the screen's to 4 times it): "Save image" > "Screenshot (PNG)…", then "Create image". In "Includes PyMOL™" mode, fold the object panel on the right before "Create image" to leave it out of the picture (the form says so).
- "Includes PyMOL™" mode (computer): the buttons under the object panel (the movie controls and the mouse-mode box) also get a frame and a description under the mouse; a button that does nothing in this app is dashed, with the reason.
- "Includes PyMOL™" mode: pull the open object panel's tab to the left to make its text and A S H L C buttons larger (to the right, smaller; the same value as the settings' display scale).
- "Includes PyMOL™" mode: "Original display" brings back the object list of v1.0.0 (with the mouse grid on a computer): Setting > "All settings…" on a computer, the head of "Objects" in the view tools on a phone.
- "Open file/PDB…": the choice of how "Includes PyMOL™" mode opens a file comes first and stands out; the note reads "Files you open are never sent outside your device."
- Help > "Latest version": "① Check the latest version on GitHub" ⇓ "② Save the latest version with the current data as a separate file", ② greyed until ① has checked.
- Help > "Code changes": the list moved to the document [CODE-CHANGES.md](CODE-CHANGES.md#english) on GitHub; the tab opens the one of its version. The app is smaller.

### v1.0.4 (2026-11-19)
- Phone, "Includes PyMOL™" mode: instead of PyMOL's object list, "Objects" at the top right of the view opens the app's own list: a switch per object, and, by its name, representations, colour, labels, view and delete. While measuring, a card offers distances, angles and dihedrals, "Delete last" and "Done".
- Computer, "3Dmol.js" mode: the menu above the view is one row; Style, Show, Surface, Depth and Draw open over the view, so the view keeps its size.
- Computer, "Includes PyMOL™" mode: the mouse box's grid of buttons is gone; "🖱 Mouse controls" at the right of the menu row lists the mouse actions in words.

### v1.0.3 (2026-11-19)
- On first opening, speech bubbles show where the mode switch and Export (downloading the app) are; a press anywhere closes them.
- A structure opened from the PDB shows its PDB ID before its name, linked to its RCSB PDB page.
- In "Includes PyMOL™" mode, the note shown after a Drug discovery preset has "Show all" and a close button.
- "Includes PyMOL™" mode's object list: on a computer, the button under the mouse is outlined and its function shown; on a phone, spreading two fingers on the list (or View tools > Larger) makes its buttons larger.
- On a phone the language switch is the flag alone. The company name in English is "AgroDesign Studios".

### v1.0.2 (2026-11-19)
- HELP's "How to use" now opens with the app's name, version in use, company and GitHub, as "Latest version" and "Licences" do.
- HELP links to the company website and to AgroBox®, a protein structure analysis service.
- In the export dialog, "Save as HTMLapp (a copy of this app)" now darkens under the pointer.

### v1.0.1 (2026-11-19)
- The app is now built with production settings. It works and looks the same, but the files are smaller (the light edition goes from about 1.4 MB to about 1.2 MB).
- If you use v1.0.0, HELP > "Latest version" can prepare v1.0.1 with your current data carried over.

### v1.0.0 (2026-11-19)
- First version.

---

PyMOL is a trademark of Schrodinger, LLC.
