# AgroDesign Protein Viewer Pack (HTMLapp)

ブラウザだけで動くタンパク質立体構造ビューアです。PyMOL（WebAssembly でブラウザ向けにビルドしたもの）と 3Dmol.js を HTML ファイル 1 個に収めています。インストールもアカウント登録も不要で、オフラインでも動きます。PC でもスマホでも使えます。

*English follows below.*

## サンプル

このリポジトリの [`index.html`](index.html)（日本語）と [`en/index.html`](en/index.html)（英語）は、サンプルの構造を埋め込んだフル版のアプリです。サンプルは PDB ID [25HN](https://www.rcsb.org/structure/25HN)「Cryo-EM structure of native Rubisco from Nitrosospira multiformis」（Nitrosospira multiformis 由来の天然 Rubisco のクライオ電子顕微鏡構造）です。ファイルのページの「Download raw file」ボタンでダウンロードしてダブルクリックすると、25HN が表示されます。構造ファイルだけのものは [`sample/25HN.cif`](sample/25HN.cif) にあり、アプリの「ファイル/PDBを開く…」で開けます。

## 使い方（ダウンロード方法）

- **最新版をダウンロード**: [Releases](https://github.com/AgroDesign-Studios/ProteinViewerPack/releases/latest) から次の 2 つのどちらかをダウンロードし、ダブルクリックして開きます。ダウンロードしたファイルに構造は入っていません。
  - フル版 `AgroDesign-ProteinViewerPack-v<バージョン>_full_<日付>.html`（約 21 MB）: 3Dmol.js と PyMOL
  - ライト版 `AgroDesign-ProteinViewerPack-v<バージョン>_light_<日付>.html`（約 1.2 MB）: 3Dmol.js のみ
- **構造を開く**: 上部の「ファイル/PDBを開く…」から、このコンピュータの構造ファイル（PDB・mmCIF・SDF/MOL・MOL2・XYZ、フル版では PyMOL セッション .pse も）を開くか、PDB ID（例: 25HN）を入れて PDB からダウンロードします。ファイルをページのどこかにドロップしても開けます。
- **回す・拡大する**: マウスでは、左ボタンのドラッグで回転、右ボタンで拡大・縮小、中ボタンで移動します。タッチ画面では、1 本指で回転、ピンチで拡大・縮小、2 本指で移動します。
- **2 つの描画エンジン**: 3Dmol.js は軽く、すぐに表示できます。PyMOL はメニューやコマンドライン、レイトレース画像など多くのことができますが重く、起動に時間がかかり、メモリを 0.5〜1.5 GB 使います。右上の切り替え（スマホでは下部バーの「エンジン」）で選びます。
- **スマホで使う**: 幅の狭い画面ではスマホ向けの表示になり、下部バーから操作します。上部の「スマホ表示」／「PC」ボタンで 2 つの表示を切り替えられます。
- **言語**: ファイルは日本語で開きます。上部の「English」／「日本語」ボタンで表示言語を切り替えられます。
- **HELP**: 上部の「HELP」に「このアプリについて」「使い方」「最新版ダウンロード」のタブがあります。

PyMOL には WebGL2 と OffscreenCanvas が必要です。これらに対応していないブラウザ（例: iOS 17 より前の iPhone・iPad の Safari）では、3Dmol.js だけで構造を表示します。

## できること

- 3Dmol.js での表示: スタイル（リボン・スティック・ボール＆スティック・ライン・表面）、配色、リガンドと水の表示、距離などの測定、説明用のペンとレーザーポインター、奥行き強調、断面、平行投影
- PyMOL（フル版）: メニューとコマンドライン、PyMOL セッション（.pse）、レイトレース画像
- 保存: スクリーンショット（PNG）、PyMOL のレイトレース画像、構造ファイル、選択範囲の分子ファイル、PyMOL セッション（.pse）、3Dmol.js セッション（VRML .wrl）
- 「HTMLappとして出力」: いま開いている構造を入れて（または空のまま）、このアプリ全体を HTML ファイル 1 つにコピーします。メールで送れば、相手はインストールなしで開けます。
- オフラインで動く: すべてこの 1 つのファイルの中で動き、開いたファイルはどこにも送信しません。インターネットに接続するのは、PDB から読み込むとき（files.rcsb.org）、「GitHub の最新版と比べる」を押したとき（api.github.com）、ファイルの外へのリンクを開いたときだけです。

## スクリーンショット

サンプルの 25HN を PC で表示したところ（左: 3Dmol.js、右: PyMOL）:

<img src="images/screenshot-pc-3dmol.png" alt="PC で 25HN を 3Dmol.js で表示" width="49%"> <img src="images/screenshot-pc-pymol.png" alt="PC で 25HN を PyMOL で表示" width="49%">

スマホで表示したところ（左: 3Dmol.js、右: PyMOL）:

<img src="images/screenshot-phone-3dmol.png" alt="スマホで 25HN を 3Dmol.js で表示" width="240"> <img src="images/screenshot-phone-pymol.png" alt="スマホで 25HN を PyMOL で表示" width="240">

## ライセンス

- このアプリ自体のプログラムは [MIT License](LICENSE) で公開しています。
- HTML ファイルに含まれるオープンソースソフトウェア（3Dmol.js とその同梱コード、PyMOL とその実行環境（Pyodide・CPython・NumPy など）、React・i18next など）は、それぞれのライセンスに従います。各ソフトウェアの名前・版・ライセンス全文は [`NOTICE`](NOTICE) と、アプリの「HELP」→「このアプリについて」に載っています。
- 本アプリは、Open-Source PyMOL のソースコードをオープンソースライセンスのもとで利用し、AgroDesign Studios が開発（変更・機能追加）したアプリです。PyMOL™ は Schrödinger, LLC の商標です。
- サンプルデータは RCSB Protein Data Bank の PDB エントリ 25HN です（<https://files.rcsb.org/download/25HN.cif>、DOI [10.2210/pdb25HN/pdb](https://doi.org/10.2210/pdb25HN/pdb)）。PDB のデータには著作権上の制限がありません（CC0 1.0）。

## 製作

- 製作会社: 株式会社アグロデザイン・スタジオ（AgroDesign Studios）
- 製作者: 西ヶ谷有輝（NISHIGAYA Yuki）

Copyright (c) 2026 AgroDesign Studios

---

# AgroDesign Protein Viewer Pack (HTMLapp) (English)

A protein structure viewer that runs entirely in your browser. PyMOL (built for the browser with WebAssembly) and 3Dmol.js are packed into a single HTML file: nothing to install, no account, and it works offline. It runs on PCs and on phones.

## Sample

[`index.html`](index.html) (Japanese) and [`en/index.html`](en/index.html) (English) in this repository are the full edition of the app with a sample structure embedded: PDB ID [25HN](https://www.rcsb.org/structure/25HN), "Cryo-EM structure of native Rubisco from Nitrosospira multiformis". Download one (the "Download raw file" button on its page) and double-click it, and 25HN is shown. The structure file alone is [`sample/25HN.cif`](sample/25HN.cif); open it with "Open file/PDB…" in the app.

## How to use (Download)

- **Download the latest version**: download one of the two files from [Releases](https://github.com/AgroDesign-Studios/ProteinViewerPack/releases/latest) and double-click it. The downloaded file contains no structure.
  - Full edition `AgroDesign-ProteinViewerPack-v<version>_full_<date>.html` (about 21 MB): 3Dmol.js and PyMOL
  - Light edition `AgroDesign-ProteinViewerPack-v<version>_light_<date>.html` (about 1.2 MB): 3Dmol.js only
- **Opening a structure**: "Open file/PDB…" at the top opens a structure file from your computer (PDB, mmCIF, SDF/MOL, MOL2, XYZ; in the full edition also a PyMOL session .pse), or downloads an entry from the PDB by its PDB ID (for example 25HN). You can also drop a file anywhere on the page.
- **Turning and zooming**: with a mouse, drag with the left button to turn, the right button to zoom and the middle button to move. On a touch screen, one finger turns, pinching zooms and two fingers move.
- **Two engines**: 3Dmol.js is light and starts at once. PyMOL can do much more (its menus and command line, ray-traced pictures), but it is heavy: it takes a while to start and uses 0.5-1.5 GB of memory. Switch with the control at the top right (on a phone, "Engine" in the bottom bar).
- **On a phone**: on a narrow screen the app switches to its phone layout, with the controls in the bottom bar. The "Phone view" / "PC" button at the top switches between the two layouts.
- **Language**: the file opens in Japanese; the "English" / "日本語" button at the top switches the language.
- **Help**: "Help" at the top has "About this app", "How to use" and "Latest version" tabs.

PyMOL needs WebGL2 and OffscreenCanvas. In a browser without them (for example Safari before iOS 17 on an iPhone or iPad), the app shows structures with 3Dmol.js only.

## Features

- Viewing with 3Dmol.js: styles (ribbon, stick, ball and stick, line, surface), colouring, ligands and water, measuring, a pen and a laser pointer for presenting, depth cueing, slicing and orthographic view
- PyMOL (full edition): its menus and command line, PyMOL sessions (.pse), ray-traced pictures
- Saving: screenshots (PNG), PyMOL ray-traced pictures, the structure file, molecule files of a selection, PyMOL sessions (.pse) and 3Dmol.js sessions (VRML .wrl)
- "Save as HTMLapp": makes a copy of this whole app as one HTML file, with the structure now open in it or empty, ready to send to someone by e-mail
- Works offline: everything runs inside the one file, and the files you open are sent nowhere. It connects to the internet only to load an entry from the PDB (files.rcsb.org), when you press "Compare with the latest on GitHub" (api.github.com), or when you open a link out of the file.

## Screenshots

The sample 25HN on a PC (left: 3Dmol.js, right: PyMOL):

<img src="images/screenshot-pc-3dmol-en.png" alt="25HN shown with 3Dmol.js on a PC" width="49%"> <img src="images/screenshot-pc-pymol-en.png" alt="25HN shown with PyMOL on a PC" width="49%">

On a phone (left: 3Dmol.js, right: PyMOL):

<img src="images/screenshot-phone-3dmol-en.png" alt="25HN shown with 3Dmol.js on a phone" width="240"> <img src="images/screenshot-phone-pymol-en.png" alt="25HN shown with PyMOL on a phone" width="240">

## License

- This app's own program is published under the [MIT License](LICENSE).
- The open-source software the HTML files carry (3Dmol.js and what it bundles, PyMOL and its runtime (Pyodide, CPython, NumPy and others), React, i18next and others) keeps its own licence. The name, version and full licence text of each is in [`NOTICE`](NOTICE), and in the app under "Help" → "About this app".
- This application was developed (modified and extended) by AgroDesign Studios using the Open-Source PyMOL source code under its open-source license. PyMOL™ is a trademark of Schrödinger, LLC.
- The sample data is PDB entry 25HN from the RCSB Protein Data Bank (<https://files.rcsb.org/download/25HN.cif>, DOI [10.2210/pdb25HN/pdb](https://doi.org/10.2210/pdb25HN/pdb)). PDB data are free of all copyright restrictions (CC0 1.0).

## Made by

- Company: AgroDesign Studios, Inc.
- Author: NISHIGAYA Yuki

Copyright (c) 2026 AgroDesign Studios

---

## 更新履歴

各バージョンの主な変更です。ダウンロードは [Releases](https://github.com/AgroDesign-Studios/ProteinViewerPack/releases) から。

### v1.0.0（2026-11-16）
- 最初の版です。

---

## Release notes

The main changes in each version. Downloads are on the [Releases](https://github.com/AgroDesign-Studios/ProteinViewerPack/releases) page.

### v1.0.0 (2026-11-16)
- First version.
