# AgroDesign Protein Viewer Pack — 改良点 / Code changes

[日本語](#日本語) · [English](#english)

## 日本語

"Includes PyMOL™" モードは Open-Source PyMOL 3.2.0a を動かします。pymol-open-source のコミット edcda80f から作り、ブラウザの中で動くよう Pyodide 314.0.7 向けに WebAssembly へコンパイルしたものです。AgroDesign Studios が手を加えたビルドで、Schrödinger, LLC の製品とは別のものです。オリジナル版との違いを下に挙げます。ソースへのパッチとビルドの手順のほか、アプリのワーカーがエンジンの周りに加えた起動時の設定や動作、アプリが持つメニューバーの写し、一緒に動く numpy の wheel と Python 標準ライブラリへの変更も含みます。オリジナル版のソースファイル冒頭にある著作権・ライセンスの表記と、ライセンスの文書はそのまま残しています。3Dmol.js は配布されたまま使っており、アプリがその周りに加えたものを最後に挙げます。

ライト版（"3Dmol.js" モードだけ）には Open-Source PyMOL は入っていません。下の「3Dmol.js」の節が、ライト版にも当てはまる部分です。

### Open-Source PyMOL の改良点

#### このビルドやアプリのメニューに入っていないもの

##### ラベルのフォントは DejaVu Sans の 4 種だけ — 見た目が違うことがある

ラベルのフォント 5〜8（Sans、Sans Oblique、Sans Bold、Sans Bold Oblique）だけを組み込み、Serif・Mono・Gentium（9〜18 番）は入れていません。`CText::getFont`（`layer1/Text.cpp`）は、5 番以上のほかの番号を、何も描かない代わりに Sans で描きます。この 10 書体で、7.9 MB の `_cmd` モジュールのうち 2.3 MB を占めていました。

**影響:** Serif・Mono・Gentium、またはセッションが持ち込んだ未知の番号を指定したラベルは DejaVu Sans で描かれます。9 番以上のレイトレースのラベルは、5 番と画素単位で同じであることを確かめています。

**パッチ:** `0012-text-sans-four-fonts-fallback.patch`

<details><summary>パッチを表示</summary>

````diff
--- a/layer1/Text.cpp
+++ b/layer1/Text.cpp
@@ -29,8 +29,12 @@
 
 #ifdef _PYMOL_FREETYPE
 #include "FontTTF.h"
+#ifndef __EMSCRIPTEN__
+/* The wasm build registers no Gentium face (TextInit), so it does not
+ * compile the header in. */
 #include "FontTTF2.h"
 #endif
+#endif
 
 #define FONT_NAME_MAX 255
 
@@ -71,9 +75,25 @@
 public:
   // TODO make const
   CFont* getFont(unsigned font_id) {
+#ifdef __EMSCRIPTEN__
+    if (font_id < m_fonts.size() && m_fonts[font_id]) {
+      return m_fonts[font_id].get();
+    }
+    /* The wasm build embeds only the four Sans faces (TextInit), so any
+     * other id >= 5 (Serif, Mono, Gentium, or an id no build has, e.g. one a
+     * session file brings) draws with Sans (font 5) instead of drawing
+     * nothing. Every caller (the GL and the ray label paths, distance and
+     * dihedral labels) comes through here; SettingCheckFontID is not on the
+     * ray path. The id is unsigned, so a negative id also lands on font 5;
+     * SettingCheckFontID already maps those to 5 on every label path. */
+    if (font_id >= 5 && m_fonts.size() > 5 && m_fonts[5]) {
+      return m_fonts[5].get();
+    }
+#else
     if (font_id < m_fonts.size()) {
       return m_fonts[font_id].get();
     }
+#endif
     return nullptr;
   }
 
@@ -461,6 +481,9 @@
   I->addFont(6, FontTypeNew(G, TTF_DejaVuSans_Oblique_dat, TTF_DejaVuSans_Oblique_len));
   I->addFont(7, FontTypeNew(G, TTF_DejaVuSans_Bold_dat, TTF_DejaVuSans_Bold_len));
   I->addFont(8, FontTypeNew(G, TTF_DejaVuSans_BoldOblique_dat, TTF_DejaVuSans_BoldOblique_len));
+#ifndef __EMSCRIPTEN__
+  /* The wasm build stops at the four Sans faces 5-8: ids 9-18 are not
+   * registered and getFont draws them with font 5. */
   I->addFont(9, FontTypeNew(G, TTF_DejaVuSerif_dat, TTF_DejaVuSerif_len));
   I->addFont(10, FontTypeNew(G, TTF_DejaVuSerif_Bold_dat, TTF_DejaVuSerif_Bold_len));
   I->addFont(11, FontTypeNew(G, TTF_DejaVuSansMono_dat, TTF_DejaVuSansMono_len));
@@ -473,6 +496,7 @@
   I->addFont(18, FontTypeNew(G, TTF_DejaVuSerif_BoldOblique_dat, TTF_DejaVuSerif_BoldOblique_len));
 #endif
 #endif
+#endif
 
   return true;
 }
````

</details>

##### 使わないライブラリは組み込まない — ここでは使えない

ビルドは `_PYMOL_NO_MSGPACKC` を定義し、`_PYMOL_VMD_PLUGINS` と `_PYMOL_OPENVR` を定義しません。`_cmd` は `ov/src`、`layer0`〜`layer5`、`layerGraphics`、`layerGraphics/gl` と、生成した `ShaderText.cpp` だけからコンパイルします。そのため `contrib/uiuc` の VMD molfile プラグインは入りません。これらの設定は、このアプリの最初のブラウザ版のビルドから変わっていません。それぞれを外した理由は、どの資料にも記録されていません。

**影響:** OpenVR のステレオは使えず、`.mmtf` ファイルは読み込めません。molfile プラグインがほかにどの形式を加えるかは試していません。

##### 読まれないデータファイル 61 個を除く — ここでは使えない

wheel には、ディスク上のシェーダー 44 個（組み込みのものを使います）、`data/startup/`（Qt のプラグイン）、側鎖の生成スクリプトと `sc_library.pkl`、`splash.png`、`hsv.ppm`、アイコン、`setting_help.csv` を入れていません（一覧: `pymol-wasm/s1_drop.json`）。

**影響:** 違いが出るのは、これらのパスを名指しするコマンドだけで、ファイルがないと表示されます。シェーダーは既定ではディスクから読みません（`shaders_from_disk 0`）。

##### 動かない Python モジュール 31 個を除く — ここでは使えない

除いたもの: `pymol/Qt`、`pymol/plugins`、`pymolhttpd`、`rpc`、`mpeg_encode`、`xwin`、`seqalign`、`cgobuilder`、ウィザードの `demo`・`stereodemo`・`cleanup`、`chempy` の `tinker`・`bmin`・`fast`・`mmtf`・`gamess1`。`cgobuilder` は Python 3.14 では import できません。ほかはどれも Qt、スレッド、ソケット、X のディスプレイ、外部プログラム、またはブラウザにないモジュールを必要とします。

**影響:** これらはもともとブラウザでは動きませんでした。ほとんどはエラーの文が変わるだけです。Python で打った `chempy.bmin.do` は、以前は終わらないループで worker を固まらせていましたが、モジュールが無いのですぐに失敗するようになります。`wizard` の名前の補完の候補は 25 個から 22 個になります。

##### TINKER のパラメーターを除く — ここでは使えない

wheel から `data/chempy/tinker` を除いています。その `chempy.prm` は TINKER の `amber.prm` の改変版です。TINKER の条件では作者の許可なしに再配布できず、オリジナル開発元にはその許可の記録がありません。`chempy.tinker` はどのみち外部の TINKER プログラムを必要とします。

**影響:** このフォルダーにたどり着くのは `check` コマンドと Python の関数 `cmd.minimize`・`cmd.fast_minimize` だけで、どれももともとブラウザでは動きませんでした。

##### メニューの 28 項目を表示しない — ここでは使えない

アプリのメニューバーは、616 項目のうち 28 項目を出しません。Sans 以外のラベルのフォント 10 種、Wizard > Demo（12）、Display > Stereo Mode > Quad-Buffered Stereo と OpenVR、Setting > Rendering > Antialias (Real Time)（3）、Setting > Volume > Pre-integrated Rendering です。フォントの項目は選んでもエラーにはなりませんが、そのフォントを組み込んでいないので、ラベルは Sans で描かれます。残りの 18 項目はここでは失敗します。デモのウィザードはスレッドを必要とし、wheel にも入っていません。WebGL にはクアッドバッファーがなく、OpenVR はビルドしておらず、最後の 2 つはオリジナル版でもそもそも対応していません。

**影響:** 除いたものは、メニューの About ダイアログに一覧があります。Qt のダイアログを開く項目、Get PDB、Web へのリンクも、アプリのメニューにはありません。

#### デスクトップ版と違う設定

##### `trilines` をオン — 画像はデスクトップ版と未比較

起動時、セッションを開いた後、`reinitialize` の後に `trilines` を 1 にします（既定は 0）。0 のままでは線と結合のない原子の十字が GL_LINES で描かれ、WebGL では何も表示されません。

**影響:** 線が表示され、`line_width` も効きます。1 本の線を 2 つの三角形で描きます（デスクトップ版が core プロファイルの OpenGL で線を描くときと同じ描き方です）。デスクトップ版の絵とは比べていません。自分で `set trilines, 0` とした値は、次にセッションが復元される（セッションを開いたとき、またはビューアが不具合から自動で立て直したとき）か `reinitialize` するまで保たれます。

##### `cgo_shader_ub_color` をオン — 見た目が違うことがある

起動時、セッションを開いた後、`reinitialize` の後に `cgo_shader_ub_color` を 1 にします（既定は 0）。CGO の頂点の色を 4 つの float ではなく 4 バイトで GPU に送るので、頂点のメモリが 21〜25 % 減ります。WebGL で `cgo_shader_ub_normal 1` にしたとき、カートゥーンと不透明な表面が消えることも防ぎます。

**影響:** 同じビルドで設定をオフにした絵と比べました（デスクトップ版とは比べていません）。表面・ドット・メッシュは、色の各チャンネルで最大 1/255 違います（実 GPU のメッシュ 1 枚だけは 2/255）。カートゥーンは同じでした。ただし、カートゥーンとスティックの絵 4 枚で、1 画素だけが 1/255 違いました（ソフトウェア描画）。

##### `defer_builds_mode` をグリッドに合わせる — 速さ・大きさだけ

`defer_builds_mode` は 1（画面に出ている状態だけを作る）にします。ただし Grid by State と By Object-State ではオリジナル版と同じく 0 です（`auto_defer_builds`（500）以上の状態を持つオブジェクトがあるときを除く）。保存した `.pse` には、この 1 をオリジナル版の既定の 0 として書きます。デスクトップ版が保存するはずの値です。そのようなオブジェクトがあるときは 1 を書きます。グリッド表示の外で自分で 1 にした値も 0 として保存されます（そのようなオブジェクトがあるときを除く）。デスクトップ版なら 1 が保存されます。116 モデルの NMR エントリーで表面を出すのに、0 では 24.5 秒、1 では 0.66 秒かかりました。

**影響:** 状態は最初に表示されたときに作られるので、ムービーの 1 周目は遅くなることがあります。グリッド表示では、すべての状態を描きます。

##### レイトレースは 1 スレッド — 画像はデスクトップ版と未比較

`max_threads` は 1 に固定です。ブラウザの実行環境には、使えるスレッドがありません。

**影響:** レイトレースは、ネイティブのマルチスレッドのビルドより 5〜13 倍遅くなります。画像への影響は測っていません。

##### 文字の倍率は四捨五入 — 見た目が違うことがある

`display_scale_factor` は、デバイスピクセル比を四捨五入した整数（最小 1）にします。デスクトップ版は切り捨てます。切り捨てでは、Windows の 125 % や 150 % の拡大表示で、文字が本来の 67〜80 % の大きさになっていました。

**影響:** 内部 GUI の文字やパネルが、同じ画面のデスクトップ版より大きく描かれることがあります。

##### 静かな起動、外部 GUI なし — ここでは使えない

エンジンは `pymol -q` で起動し、`external_gui 0`・`show_splash 0`・`no_quit 1` にします。内部 GUI（オブジェクトのパネル）の有無はページによります。ブラウザには Qt のウィンドウがなく、終了するとページのエンジンが止まってしまうためです。

**影響:** 起動時の表示や Qt・Tk のウィンドウは出ず、`quit` でセッションは終わりません。

#### ブラウザで動かすための変更

##### メモリの数値は 0 を返す — ここでは使えない

`layer0/MemoryUsage.cpp` の `memory_usage()` と `memory_available()` は、emscripten では 0 を返します。オリジナル版も、自身の `_WEBGL` ビルドではそうしています。パッチは、この既存の `_WEBGL` の分岐に `__EMSCRIPTEN__` を加えるだけです。

**影響:** この 2 つの関数から作る数値は 0 になります。

**パッチ:** `0001-memoryusage-emscripten.patch`

<details><summary>パッチを表示</summary>

````diff
diff --git a/layer0/MemoryUsage.cpp b/layer0/MemoryUsage.cpp
index 3d0f810e..651eedc3 100644
--- a/layer0/MemoryUsage.cpp
+++ b/layer0/MemoryUsage.cpp
@@ -30,7 +30,7 @@ namespace pymol
  */
 size_t memory_usage()
 {
-#ifdef _WEBGL
+#if defined(_WEBGL) || defined(__EMSCRIPTEN__)
   return 0;
 #elif defined(__linux__) || defined(__FreeBSD__)
   size_t vmRSS = 0;
@@ -64,7 +64,7 @@ size_t memory_usage()
  */
 size_t memory_available()
 {
-#ifdef _WEBGL
+#if defined(_WEBGL) || defined(__EMSCRIPTEN__)
   return 0;
 #elif defined(__linux__) || defined(__FreeBSD__)
   size_t memAvail = 0;
````

</details>

##### WebGL1 での球と円柱の深度 — 画像はデスクトップ版と未比較

WebGL 向けのビルドでは、`data/shaders/cylinder.fs` と `sphere.fs` が `gl_FragDepth` の代わりに `gl_FragDepthEXT` に書き込みます。GLSL ES 1.00（WebGL1）には、深度の出力が拡張の形しかないためです。

**影響:** インポスターの球と円柱が WebGL1 でコンパイルできます。画像はデスクトップ版と比べていません。

**パッチ:** `0002-shaders-webgl1-fragdepth-ext.patch`

<details><summary>パッチを表示</summary>

````diff
diff --git a/data/shaders/cylinder.fs b/data/shaders/cylinder.fs
index 4ada6fbc..4751067e 100644
--- a/data/shaders/cylinder.fs
+++ b/data/shaders/cylinder.fs
@@ -167,7 +167,11 @@ void main(void)
     if (depth <= 0.0)
       discard;
 
+#ifdef PYMOL_WEBGL_IOS
+    gl_FragDepthEXT = depth;
+#else
     gl_FragDepth = depth;
+#endif
 
   if (!isPicking && lighting_enabled){
     color = ApplyColorEffects(color, depth);
diff --git a/data/shaders/sphere.fs b/data/shaders/sphere.fs
index 4cbec8cf..89bc6bc6 100644
--- a/data/shaders/sphere.fs
+++ b/data/shaders/sphere.fs
@@ -71,7 +71,11 @@ void main(void)
     if (depth <= 0.0 || depth >= 1.0)
       discard;
 
+#ifdef PYMOL_WEBGL_IOS
+    gl_FragDepthEXT = depth;
+#else
     gl_FragDepth = depth;
+#endif
 
     if (!isPicking){
       if (lighting_enabled){
````

</details>

##### 前の GL エラーでバッファを失わない — 画像はデスクトップ版と未比較

`GLGenBuffer`（`layerGraphics/gl/GLVertexBuffer.cpp`）は、`glGenBuffers` の前に、たまっている `glGetError()` を読み捨てます（emscripten のみ）。無関係な前の GL エラーでバッファの確認が失敗し、表示が頂点バッファを黙って失い、描かれないことがあったためです。

**影響:** 表示が消えずに描かれます。画像はデスクトップ版と比べていません。

**パッチ:** `0003-glgenbuffer-clear-stale-errors.patch`

<details><summary>パッチを表示</summary>

````diff
diff --git a/layerGraphics/gl/GLVertexBuffer.cpp b/layerGraphics/gl/GLVertexBuffer.cpp
index 76305dd4..266183e1 100644
--- a/layerGraphics/gl/GLVertexBuffer.cpp
+++ b/layerGraphics/gl/GLVertexBuffer.cpp
@@ -8,6 +8,10 @@
 
 static bool GLGenBuffer(GLuint& id, GLuint bufferType, pymol::span<const std::byte> data)
 {
+#ifdef __EMSCRIPTEN__
+  // don't let an unrelated, earlier (sticky) GL error abort buffer creation
+  while (glGetError() != GL_NO_ERROR) {}
+#endif
   glGenBuffers(1, &id);
   if (!CheckGLErrorOK(nullptr, "GenericBuffer::genBuffer failed\n"))
     return false;
````

</details>

##### ラベルはラベル用シェーダーで描く — 画像はデスクトップ版と未比較

OpenGL ES 2 のビルドでは、`use_shaders` がオンなら、`RepLabel::render`（`layer2/RepLabel.cpp`）はジオメトリシェーダーを求めずにラベル用シェーダーを使います。WebGL にはジオメトリシェーダーがなく、ES2 の代わりの経路では文字が描かれないためです。

**影響:** ラベルが欠けずに描かれます。画像はデスクトップ版と比べていません。

**パッチ:** `0004-replabel-es2-use-label-shader.patch`

<details><summary>パッチを表示</summary>

````diff
diff --git a/layer2/RepLabel.cpp b/layer2/RepLabel.cpp
index 9740ab91..9f88db99 100644
--- a/layer2/RepLabel.cpp
+++ b/layer2/RepLabel.cpp
@@ -1737,8 +1737,13 @@ void RepLabel::render(RenderInfo* info)
     RepLabelPick(I, info);
     return;
   }
+#ifdef PURE_OPENGL_ES_2
+  // the label shader needs no geometry shader; the ES2 immediate path draws no text
+  auto use_shader = SettingGet<bool>(G, cSetting_use_shaders);
+#else
   auto use_shader = SettingGet<bool>(G, cSetting_use_shaders) &&
                     G->ShaderMgr->GeometryShadersPresent();
+#endif
 
   if (!use_shader) {
     RepLabelRenderImmediate(I, info);
````

</details>

##### シェーダーを GLSL ES 3.00 に書き換える — 画像はデスクトップ版と未比較

WebGL2 では、`glShaderSource1String`（`layer0/ShaderMgr.cpp`）が ES2 のシェーダーをコンパイルの前に書き換えます。`#version` と `#extension` の行を除き、`texture2D(`・`textureCube(` を `texture(` に、`attribute` を `in` に、`varying` を頂点シェーダーでは `out`、フラグメントシェーダーでは `in` にします。`gl_FragColor` は宣言した出力に、`gl_FragDepthEXT` は `gl_FragDepth` にし、`#version 300 es` を加えます。WebGL2 は GLSL ES 1.00 のシェーダーで `GL_EXT_frag_depth` 拡張を受け付けないためです。

**影響:** 変わるのはシェーダーのプログラムで、描き方の手順は変わりません。画像はデスクトップ版と比べていません。

**パッチ:** `0005-shadermgr-webgl2-glsl-es300.patch`

<details><summary>パッチを表示</summary>

````diff
diff --git a/layer0/ShaderMgr.cpp b/layer0/ShaderMgr.cpp
index 6ac9fc1f..b41ad2b7 100644
--- a/layer0/ShaderMgr.cpp
+++ b/layer0/ShaderMgr.cpp
@@ -89,8 +89,46 @@ Z* -------------------------------------------------------------------
   } \
 }
 
+#ifdef __EMSCRIPTEN__
+#include <regex>
+/**
+ * WebGL2 rejects GL_EXT_frag_depth in GLSL ES 1.00 shaders, so on a WebGL2
+ * context rewrite PyMOL's ES2 shaders to GLSL ES 3.00 (pymolweb spike).
+ */
+static std::string pymolweb_to_es300(GLuint shad, const std::string& src)
+{
+  static int is_es3 = -1;
+  if (is_es3 < 0) {
+    auto v = (const char*) glGetString(GL_VERSION);
+    is_es3 = v && std::strstr(v, "OpenGL ES 3") ? 1 : 0;
+  }
+  if (!is_es3)
+    return src;
+  GLint type = 0;
+  glGetShaderiv(shad, GL_SHADER_TYPE, &type);
+  bool frag = (type == GL_FRAGMENT_SHADER);
+  std::string s = std::regex_replace(src, std::regex(R"(^[ \t]*#(version|extension)[^\n]*)", std::regex::multiline), "");
+  s = std::regex_replace(s, std::regex(R"(^[ \t]*#define[ \t]+texture[ \t]+texture2D[^\n]*)", std::regex::multiline), "");
+  s = std::regex_replace(s, std::regex(R"(\btexture2D\s*\()"), "texture(");
+  s = std::regex_replace(s, std::regex(R"(\btextureCube\s*\()"), "texture(");
+  s = std::regex_replace(s, std::regex(R"(\bvarying\b)"), frag ? "in" : "out");
+  if (frag) {
+    s = std::regex_replace(s, std::regex(R"(\bgl_FragColor\b|\bgl_FragData\s*\[\s*0\s*\])"), "pymolweb_FragColor");
+    s = std::regex_replace(s, std::regex(R"(\bgl_FragDepthEXT\b)"), "gl_FragDepth");
+    return "#version 300 es\nprecision highp float;\nout vec4 pymolweb_FragColor;\n" + s;
+  }
+  s = std::regex_replace(s, std::regex(R"(\battribute\b)"), "in");
+  return "#version 300 es\n" + s;
+}
+#endif
+
 static void glShaderSource1String(GLuint shad, const std::string &strobj){
+#ifdef __EMSCRIPTEN__
+  std::string conv = pymolweb_to_es300(shad, strobj);
+  const GLchar *str = (const GLchar *)conv.c_str();
+#else
   const GLchar *str = (const GLchar *)strobj.c_str();
+#endif
   glShaderSource(shad, 1, (const GLchar **)&str, nullptr);
 }
 
````

</details>

##### OpenGL ES 2 の経路でビルド — 画像はデスクトップ版と未比較

`compile.sh` は `-DPURE_OPENGL_ES_2 -DGL_GLEXT_PROTOTYPES -D_PYMOL_NO_MAIN` と libpng・FreeType・numpy の対応を付けて `-O2` でコンパイルし、`link.sh` が `_cmd` を Pyodide のサイドモジュールとしてリンクします。WebGL は OpenGL ES をもとにしているので、デスクトップの OpenGL の経路は動きません。

**影響:** 描画は ES2 のコードを通ります。デスクトップ版との画素の比較はしていません。

##### 起動時にシェーダーを一度コンパイル — 結果は同じ（確認済み）

起動時、ワーカーは使い捨てのペプチド（`cmd.fab('AAAA', '_warm')`）を作り、カートゥーン・スティック・表面・球・線を出して 10 回描きます。最初の本番の描画の前にシェーダーを用意しておくためです。そのあとペプチドを削除してさらに 3 回描き、`auto_color_next` を 0 に戻します。この暖機は、2026-10-11 の試験でクリーンビルドの起動の約半数でカートゥーンが黒くなったため加えたものです。原因を示す記録はありません。後の試験では、Chrome のソフトウェア描画（WebGL2 と WebGL1）で暖機を外しても黒くなりませんでした。ただし、黒い画面が出た条件（Windows の Direct3D 11、WebGL1 への切り替え、実機）は試し直していません。

**影響:** オブジェクトは削除し色の順番も戻すので、最初の構造の炭素はデスクトップ版と同じ色（緑）になります。

#### ファイルを安全に読むための変更

##### セッションは許可リストで読む — ここでは使えない

`modules/chempy/pkl.py` は、`pickle.loads`・`pickle._loads`・`chempy.pkl.cPickle.loads` を `RestrictedUnpickler` に置き換えます。これは名前を挙げた 18 個のグローバル（`chempy.Atom`、`numpy._core.multiarray._reconstruct` など）だけを解決し、persistent ID と、解決したグローバルへの BUILD を拒み、無効にはできません。`.pse` ファイルは pickle で、pickle を読むとファイルが名指しする関数を何でも実行できるため、他人のセッションでコードが動くおそれがありました。

**影響:** `get_session` で保存したセッションはこれまでどおり開けます。18 個以外のオブジェクトを含むセッションや、普通のクラスのプロトコル 0/1 の pickle は拒みます。

**パッチ:** `0006-chempy-restricted-unpickler.patch`

<details><summary>パッチを表示</summary>

````diff
diff --git a/modules/chempy/pkl.py b/modules/chempy/pkl.py
index aed58aa..75e541a 100644
--- a/modules/chempy/pkl.py
+++ b/modules/chempy/pkl.py
@@ -49,6 +49,169 @@ if True:
     pickle._Pickler.dispatch[str] = save_str
     pickle._Pickler.dispatch[bytes] = save_str
 
+    # Restricted unpickler for session files.
+    #
+    # A session can come from another user, so session data is unpickled only
+    # by an unpickler whose find_class resolves RESTRICTED_GLOBALS and nothing
+    # else. It replaces cPickle.loads below and the stdlib pickle.loads and
+    # pickle._loads (the C++ session restore calls the stdlib one), and no
+    # setting, argument or message turns it off.
+    # cPickle.load (a file) is left alone on purpose: it reads the bundled,
+    # trusted fragments and mutagenesis data. Untrusted .pkl / model input is
+    # refused before it reaches cPickle.load by the viewer's own load checks,
+    # not by this patch.
+
+    import _compat_pickle
+    import copyreg
+    import io as _io
+    import sys as _sys
+
+    # (module, name) pairs a session needs: measured on real sessions, and on
+    # PyMOL 2.x-era names after the _compat_pickle mapping below.
+    RESTRICTED_GLOBALS = frozenset([
+        ('pymol', 'Session_Storage'),
+        ('_codecs', 'encode'),
+        ('chempy', 'Storage'),
+        ('chempy', 'Atom'),
+        ('chempy', 'Bond'),
+        ('chempy.models', 'Indexed'),
+        ('chempy.models', 'Connected'),
+        ('builtins', 'bytearray'),
+        ('builtins', 'bytes'),
+        ('builtins', 'complex'),
+        ('collections', 'OrderedDict'),
+        ('copyreg', '_reconstructor'),
+        ('numpy', 'dtype'),
+        ('numpy', 'ndarray'),
+        ('numpy.core.multiarray', '_reconstruct'),
+        ('numpy._core.multiarray', '_reconstruct'),
+        ('numpy._core.multiarray', 'scalar'),
+        ('numpy.core.multiarray', 'scalar'),
+    ])
+
+    # Names that are allowed to be RESOLVED (so a reconstructor can take them as
+    # an argument) but must never be the callable a pickle invokes directly:
+    # called directly, numpy.ndarray is not safe on session data. A legitimate
+    # array never calls ndarray directly: it calls
+    # numpy._core.multiarray._reconstruct(ndarray, shape, dtype) and then BUILD,
+    # so ndarray appears only as _reconstruct's first argument, never reduced.
+    # Matched by (module, qualname); the object here is always one find_class
+    # already resolved from RESTRICTED_GLOBALS, so these attributes are genuine.
+    _NEVER_CALLED_DIRECTLY = frozenset([
+        ('numpy', 'ndarray'),
+    ])
+
+    class RestrictedUnpickler(pickle._Unpickler):
+        '''
+        The Python-implementation unpickler (so the string decoding above
+        still applies), refusing every global outside RESTRICTED_GLOBALS.
+        '''
+
+        def __init__(self, *args, **kwargs):
+            super().__init__(*args, **kwargs)
+            self._globals_handed_out = []
+
+        def find_class(self, module, name):
+            _sys.audit('pickle.find_class', module, name)
+            # Map PyMOL 2.x-era names (__builtin__.bytearray,
+            # copy_reg._reconstructor) with _compat_pickle, THEN check the
+            # allow-list: checking the as-written name refuses legitimate old
+            # sessions, and a mapped name is held to the same list. (stdlib
+            # find_class maps only for proto < 3 and when fix_imports is set;
+            # this maps for every proto < 4, which is wider but still ends at
+            # the same 18-name check.)
+            if self.proto < 4:
+                if (module, name) in _compat_pickle.NAME_MAPPING:
+                    module, name = _compat_pickle.NAME_MAPPING[(module, name)]
+                elif module in _compat_pickle.IMPORT_MAPPING:
+                    module = _compat_pickle.IMPORT_MAPPING[module]
+            if (module, name) not in RESTRICTED_GLOBALS:
+                raise pickle.UnpicklingError(
+                    'PyMOL session refused: global %s.%s is not allowed'
+                    % (module, name))
+            # One plain attribute of an imported module, never the dotted
+            # walk pickle._Unpickler.find_class does from protocol 4 on.
+            __import__(module, level=0)
+            obj = getattr(_sys.modules[module], name)
+            self._globals_handed_out.append(obj)
+            return obj
+
+        def get_extension(self, code):
+            # Skips pickle's process-wide _extension_cache: an entry another
+            # unpickler cached would come back without passing find_class.
+            key = copyreg._inverted_registry.get(code)
+            if not key:
+                raise pickle.UnpicklingError(
+                    'PyMOL session refused: unregistered extension code %r'
+                    % (code,))
+            self.append(self.find_class(*key))
+
+        def persistent_load(self, pid):
+            raise pickle.UnpicklingError(
+                'PyMOL session refused: persistent IDs are not allowed')
+
+        def load_build(self):
+            # BUILD sets attributes on the object under the state. On a class
+            # or function find_class handed out, that would rewrite it for
+            # the whole process.
+            stack = self.stack
+            if len(stack) >= 2 and any(stack[-2] is obj
+                                       for obj in self._globals_handed_out):
+                raise pickle.UnpicklingError(
+                    'PyMOL session refused: BUILD on a global object')
+            pickle._Unpickler.load_build(self)
+
+        def _refuse_direct_call(self, func):
+            module = getattr(func, '__module__', None)
+            qualname = getattr(func, '__qualname__', None) \
+                or getattr(func, '__name__', None)
+            if (module, qualname) in _NEVER_CALLED_DIRECTLY:
+                raise pickle.UnpicklingError(
+                    'PyMOL session refused: %s.%s may only be an argument to a '
+                    'reconstructor, not called directly' % (module, qualname))
+
+        def load_reduce(self):
+            # Stack at entry: [..., func, argtuple].
+            self._refuse_direct_call(self.stack[-2])
+            pickle._Unpickler.load_reduce(self)
+
+        def load_newobj(self):
+            # Stack at entry: [..., cls, argtuple]. cls.__new__(cls, *args)
+            # reaches the same C constructor as a direct call.
+            self._refuse_direct_call(self.stack[-2])
+            pickle._Unpickler.load_newobj(self)
+
+        def load_newobj_ex(self):
+            # Stack at entry: [..., cls, argtuple, kwargdict].
+            self._refuse_direct_call(self.stack[-3])
+            pickle._Unpickler.load_newobj_ex(self)
+
+        def _instantiate(self, klass, args):
+            # INST / OBJ (protocol 0/1) both call klass(*args) through here.
+            self._refuse_direct_call(klass)
+            return pickle._Unpickler._instantiate(self, klass, args)
+
+        dispatch = dict(pickle._Unpickler.dispatch)
+        dispatch[pickle.BUILD[0]] = load_build
+        dispatch[pickle.REDUCE[0]] = load_reduce
+        dispatch[pickle.NEWOBJ[0]] = load_newobj
+        dispatch[pickle.NEWOBJ_EX[0]] = load_newobj_ex
+
+    def restricted_loads(s, /, *, fix_imports=True, encoding="ASCII",
+                         errors="strict", buffers=None):
+        '''
+        Drop-in for pickle.loads and pickle._loads that unpickles with
+        RestrictedUnpickler.
+        '''
+        if isinstance(s, str):
+            raise TypeError("Can't load pickle from unicode string")
+        return RestrictedUnpickler(_io.BytesIO(s), fix_imports=fix_imports,
+                                   buffers=buffers, encoding=encoding,
+                                   errors=errors).load()
+
+    pickle.loads = restricted_loads
+    pickle._loads = restricted_loads
+
     class cPickle:
         dumps = pickle.dumps
         dump = pickle.dump
@@ -57,7 +220,7 @@ if True:
         def loads(s):
             if not isinstance(s, bytes):
                 s = s.encode(errors='ignore')
-            return pickle._loads(s)
+            return restricted_loads(s)
 
         @classmethod
         def configure_legacy_dump(cls, py2=False):
````

</details>

##### PNG の読み込みに失敗したら画像を作らない — 見た目が違うことがある

`MyPNGRead`（`layer0/MyPNG.cpp`）は幅と高さを 0 で始め、読み込みが成功したときだけ画像を作り、データ URI の長さと各読み込みを残りのバイト数と照らし、バイト数が `size_t`・`int` に収まらない大きさは確保の前に拒みます。

**影響:** 正しい PNG はこれまでどおり読めます。壊れた背景画像のレイトレースは、背景なしで描きます。`load_png` に PNG でないファイル、途中で切れた PNG、短い・途中で切れた・base64 でないデータ URI を渡すとエラーになります。

**パッチ:** `0011-mypng-failed-read-builds-no-image.patch`

<details><summary>パッチを表示</summary>

````diff
--- a/layer0/MyPNG.cpp
+++ b/layer0/MyPNG.cpp
@@ -17,6 +17,9 @@
 #include"MemoryDebug.h"
 #include"pymol/memory.h"
 
+#include <climits>
+#include <cstdint>
+
 
 /* backwards compatibility */
 
@@ -76,7 +79,8 @@
   44,  45,  46,  47,  48,  49,  50,  51};
 
 static unsigned char *base64_decode(const char *data,
-				    size_t input_length=0) {
+				    size_t input_length=0,
+				    size_t *output_length=nullptr) {
   unsigned char *decoded_data = nullptr;
   unsigned int triple;
   unsigned int i = 0, j = 0, k;
@@ -103,6 +107,8 @@
       decoded_data[j++] = (triple >> (--k) * 8) & 0xFF;
   }
 
+  if (output_length)
+    *output_length = j;
   return decoded_data;
 
 ok_except1:
@@ -113,6 +119,7 @@
 typedef struct {
   unsigned char *c; // moving pointer
   unsigned char *h; // for freeing
+  size_t n;         // bytes left at c
 } uchar2p;
 
 #ifdef _PYMOL_LIBPNG
@@ -129,6 +136,10 @@
   if(!io_ptr)
     return;
 
+  if(byteCountToRead > io_ptr->n)
+    png_error(png_ptr, "PNG data ends early");
+  io_ptr->n -= byteCountToRead;
+
   while(byteCountToRead--) {
     *(outBytes++) = *(io_ptr->c++);
   }
@@ -375,8 +386,8 @@
   png_byte *pix_ptr = nullptr;
   png_uint_32 row_bytes = 0;
 
-  png_uint_32 width;
-  png_uint_32 height;
+  png_uint_32 width = 0;
+  png_uint_32 height = 0;
   int bit_depth;
   int color_type;
   int row, col;
@@ -384,16 +395,21 @@
   int i;
   int ok = true;
   double file_gamma;
-  uchar2p data = {NULL, nullptr};
+  uchar2p data = {NULL, nullptr, 0};
 
   if(!file_name)
     return nullptr;
 
   if(!strncmp(file_name, "data:image/png;base64,", 22)) {
     const char *base64str = file_name + 22;
-    data.h = data.c = base64_decode(base64str);
-    memcpy(buf, data.c, 8);
-    data.c += 8;
+    data.h = data.c = base64_decode(base64str, 0, &data.n);
+    if(!data.c || data.n < 8) {
+      ok = false;
+    } else {
+      memcpy(buf, data.c, 8);
+      data.c += 8;
+      data.n -= 8;
+    }
 
   } else {
     png_file = pymol_fopen(file_name, "rb");
@@ -469,7 +485,17 @@
 
     /* row_bytes is the width x number of channels x (bit-depth / 8) */
     row_bytes = png_get_rowbytes(png_ptr, info_ptr);
-    if((png_pixels = (png_byte *) malloc(row_bytes * height * sizeof(png_byte))) == nullptr) {
+    /* Refuse, before allocating, a size whose byte counts do not fit:
+     * row_bytes * height and the row pointers in size_t (32-bit on
+     * wasm32), and the Image below (width * height pixels of 4 bytes,
+     * counted in int). A check on arithmetic only, not a size cap: what
+     * fits is still tried. */
+    if((uint64_t) row_bytes * height > SIZE_MAX ||
+       (uint64_t) height * sizeof(png_bytep) > SIZE_MAX ||
+       (uint64_t) width * height > INT_MAX ||
+       (uint64_t) width * height * 4 > SIZE_MAX) {
+      ok = false;
+    } else if((png_pixels = (png_byte *) malloc((size_t) row_bytes * height)) == nullptr) {
       ok = false;
     }
   }
@@ -488,7 +514,7 @@
 
     /* set the individual row_pointers to point at the correct offsets */
     for(i = 0; i < ((signed) height); i++)
-      row_pointers[i] = png_pixels + i * row_bytes;
+      row_pointers[i] = png_pixels + (size_t) i * row_bytes;
 
     /* now we can go ahead and just read the whole image */
     png_read_image(png_ptr, row_pointers);
@@ -497,8 +523,8 @@
     png_read_end(png_ptr, info_ptr);
   }
 
-  img = std::make_unique<pymol::Image>(width, height);
   if(ok) {
+    img = std::make_unique<pymol::Image>(width, height);
     auto p = img->bits();
     for(row = 0; row < (signed) height; row++) {
       pix_ptr = row_pointers[(height - 1) - row];
````

</details>

##### pickle とスクリプトの形式を拒む — ここでは使えない

ワーカーは `cmd.load`・`load` コマンド・`cmd.load_raw` を包み、`pkl`・`model`・`brick`・`callback`・`cgo`・`cc1`・`cc2`・`py`・`pml`・`pym` の形式を、名前か番号で指定されたときに拒みます。`cmd.load` と `load` コマンドは、`.pkl`・`.pkla`・`.pickle`・`.model`・`.brick`・`.cc1`・`.cc2`・`.py`・`.pml`・`.pym` で終わるファイルも拒みます（`.gz`・`.bz2` が付いたものも）。`pymol.internal._load` を包んだ部分は、どこから呼ばれても `model`・`brick`・`callback`・`cgo` を拒みます。これらの形式の多くは制限のない pickle の読み込みに届くか、ファイルのコードを実行します。`cc1`・`cc2` は、このビューアーでは使わないので拒みます。

**影響:** これらのファイルは開けず、Python スクリプトや `.pml` のコマンドスクリプトをファイルから実行することもできません。

##### セッションはムービーとウィザードを除いて開く — ここでは使えない

`.pse` は制限付きの読み込みで読み（`session_compression 1` のファイルも同じ経路）、`cmd.set_session` の前に `movie` と `wizard` を取り除きます。保存されたウィザードは入れ子の pickle で、ムービーのコマンドは再生時に Python を実行できるためです。

**影響:** 構造・表示・色・視点・シーンは戻ります。セッションのムービーのプログラムと、開いていたウィザードは戻りません。

#### 速くする、または小さくする変更

##### 不透明な表面を毎回並べ替えない — 見た目が違うことがある

`layer2/RepSurface.cpp` の 2 か所で、空の頂点ごとの透明度の配列を「配列なし」として扱い、不透明な表面で透明の判定が働かないようにしました。`std::vector::clear()` はポインターを残すため、不透明な表面も毎フレーム三角形ごとに並べ替えて送り直していました。1AON の不透明な表面を回すとき、1 フレームあたりのワーカーの CPU 時間は約 12 ms から 0.6 ms になりました。

**影響:** `transparency_global_sort 1` では不透明な表面が表示されるようになります（以前は消えていました）。`pick_surface 1` では、パッチの境目のクリックで隣の原子が選ばれることがあります。既定の設定では、表面の縁の画素がいくつか変わることがあります（実 GPU では 1 画素で差は 20/255、ソフトウェア描画では 3〜9 画素で差は最大 78/255）。

**パッチ:** `0008-repsurface-empty-va-is-null.patch`

<details><summary>パッチを表示</summary>

````diff
--- a/layer2/RepSurface.cpp
+++ b/layer2/RepSurface.cpp
@@ -266,7 +266,7 @@
   float* v = I->V.data();
   float* vn = I->VN.data();
   float* vc = I->VC.data();
-  float* va = I->VA.data();
+  float* va = I->VA.empty() ? nullptr : I->VA.data();
   int* t = I->T.data();
   int* s = I->S.data();
   int c = I->N;
@@ -1577,7 +1577,7 @@
   float* v = I->V.data();
   float* vn = I->VN.data();
   float* vc = I->VC.data();
-  float* va = I->VA.data();
+  float* va = I->VA.empty() ? nullptr : I->VA.data();
   int* rc = I->RC.data();
   int* t = I->T.data();
   int* s = I->S.data();
````

</details>

##### FreeType は 4 つのモジュールだけ — 結果は同じ（確認済み）

`TypeInit`（`layer1/TypeFace.cpp`）は FreeType を `FT_New_Library` で作り、すべてのモジュールではなく autofit・truetype・sfnt・smooth だけを加えます。読むのは組み込みの TrueType フォントだけだからです。

**影響:** `_cmd` が 315 KB 小さくなります。レイトレースと WebGL のラベルは、前後で画素単位で同じであることを確かめています。

**パッチ:** `0007-typeface-truetype-modules-only.patch`

<details><summary>パッチを表示</summary>

````diff
--- a/layer1/TypeFace.cpp
+++ b/layer1/TypeFace.cpp
@@ -24,6 +24,28 @@
 
 #include <ft2build.h>
 #include FT_FREETYPE_H
+#include FT_MODULE_H
+#include <cstdlib>
+
+/* Only the four FreeType modules the built-in TrueType fonts use.
+ * FT_Init_FreeType registers every module in ftmodule.h (Type 1, CFF, CID,
+ * PFR, Type 42, WinFNT, PCF, BDF, psaux, psnames, pshinter, raster1, sdf,
+ * svg), which keeps all of them in the link. The driver / renderer classes
+ * start with an FT_Module_Class; FreeType's own ftinit.c takes their
+ * addresses as FT_Module_Class pointers in the same way. */
+extern "C" {
+extern const FT_Module_Class autofit_module_class;
+extern const FT_Module_Class tt_driver_class;
+extern const FT_Module_Class sfnt_module_class;
+extern const FT_Module_Class ft_smooth_renderer_class;
+}
+static void* TypeFTAlloc(FT_Memory, long size) { return malloc(size); }
+static void TypeFTFree(FT_Memory, void* block) { free(block); }
+static void* TypeFTRealloc(FT_Memory, long, long new_size, void* block)
+{
+  return realloc(block, new_size);
+}
+static FT_MemoryRec_ TypeFTMemory = {nullptr, TypeFTAlloc, TypeFTFree, TypeFTRealloc};
 
 struct _CType {
   FT_Library library;
@@ -130,7 +152,18 @@
 {
   CType *I;
   if((I = (G->Type = pymol::calloc<CType>(1)))) {
-    FT_Error error = FT_Init_FreeType(&I->library);
+    /* same order as ftmodule.h: autofit, truetype, sfnt, smooth */
+    FT_Error error = FT_New_Library(&TypeFTMemory, &I->library);
+    if(!error)
+      error = FT_Add_Module(I->library, &autofit_module_class);
+    if(!error)
+      error = FT_Add_Module(I->library, &tt_driver_class);
+    if(!error)
+      error = FT_Add_Module(I->library, &sfnt_module_class);
+    if(!error)
+      error = FT_Add_Module(I->library, &ft_smooth_renderer_class);
+    if(!error)
+      FT_Set_Default_Properties(I->library);
     return !error;
   }
   return 0;
@@ -139,7 +172,7 @@
 void TypeFree(PyMOLGlobals * G)
 {
   CType *I = G->Type;
-  FT_Done_FreeType(I->library);
+  FT_Done_Library(I->library);
   FreeP(G->Type);
 }
 
````

</details>

##### 近傍リストと表面の作り始めを速く — 結果は同じ（確認済み）

`MapSetupExpress`（`layer0/Map.cpp`）は、各セルの周りの点を先に数え、近傍リストを可変長配列で伸ばす代わりに一度で正確な大きさに確保し、中断時にはそれを空にします。`layer0/Triangle.cpp` では、表面の起点探しのループから不変の判定を外に出しました。pymolish-studio（コミット 3e4218d、3f91dbe）の考え方から書き直したもので、コードは取り込んでいません。

**影響:** 表面の作成が 15〜45 % 速くなります。マップを使う 513 の結果（結合、距離による選択、dss、h_add、面積、表面、マップ）を 4 つの構造で比べ、同じでした。書き直した関数も、無作為の 330,000 件をネイティブのビルドで元のコードと比べ、同じでした。

**出典:** <https://github.com/adrian-jasinski/pymolish-studio>

**パッチ:** `0009-map-express-two-pass-triangle-start.patch`

<details><summary>パッチを表示</summary>

````diff
--- a/layer0/Map.cpp
+++ b/layer0/Map.cpp
@@ -453,78 +453,104 @@
 }
 
 int MapSetupExpress(MapType* I)
-{ /* setup a list of neighbors for each square */
+{
+  /* For every cell, EList gets the points of the 27 cells around it (the cell
+   * itself included): the cells in d, e, f order (f fastest), the points of
+   * one cell in Head/Link order, then -1. EHead holds where that list starts;
+   * 0 means no point is near the cell (EList[0] is never a start).
+   *
+   * Three passes: count the points of every cell that is read, give each cell
+   * its start from the counts of its 27 cells, then allocate EList once at its
+   * final size and write the lists into it. */
   PyMOLGlobals* G = I->G;
-  int n = 0;
-  int c, d, e, f, i, cm1, cp2, D1D2 = I->D1D2, D2 = I->Dim[2];
-  int mx2 = I->iMax[2];
-  int* link = I->Link.data();
-  int st, flag;
-  int *i_ptr3, *i_ptr4, *i_ptr5;
-  int mx0 = I->iMax[0], mx1 = I->iMax[1], a, am1, ap2, *i_ptr1, b, bm1, bp2,
-      *i_ptr2;
-  int ok = true;
+  const int D1D2 = I->D1D2, D2 = I->Dim[2];
+  const int* head = I->Head.data();
+  const int* link = I->Link.data();
 
   PRINTFD(G, FB_Map)
   " MapSetupExpress-Debug: entered.\n" ENDFD;
 
   auto mapSize = I->Dim[0] * I->Dim[1] * I->Dim[2];
   I->EHead.assign(mapSize, 0);
-  std::vector<int> e_list;
-  e_list.reserve(1000);
+  int* ehead = I->EHead.data();
 
-  e_list.push_back(0);
-  n = 1;
-  for (a = (I->iMin[0] - 1); ok && a <= mx0; a++) {
-    am1 = a - 1;
-    ap2 = a + 2;
-    i_ptr1 = I->Head.data() + am1 * D1D2;
-    for (b = (I->iMin[1] - 1); ok && b <= mx1; b++) {
-      bm1 = b - 1;
-      bp2 = b + 2;
-      i_ptr2 = i_ptr1 + bm1 * D2;
-      for (c = (I->iMin[2] - 1); ok && c <= mx2; c++) {
-        st = n;
-        cm1 = c - 1;
-        cp2 = c + 2;
-        flag = false;
-        i_ptr5 = (i_ptr4 = (i_ptr3 = i_ptr2 + cm1));
-
-        for (d = am1; ok && d < ap2; d++) {
-          for (e = bm1; ok && e < bp2; e++) {
-            for (f = cm1; ok && f < cp2; f++) {
-              /*i=*MapFirst(I,d,e,f); */
-              if ((i = *(i_ptr5++)) >= 0) {
-                flag = true;
-                do {
-                  e_list.push_back(i);
-                  n++;
-                  /*i=MapNext(I,i); */
-                } while (ok && (i = link[i]) >= 0);
-              }
-              ok &= !G->Interrupt;
+  /* cells that get a list; the cells read reach one further on every side */
+  const int a0 = I->iMin[0] - 1, a1 = I->iMax[0];
+  const int b0 = I->iMin[1] - 1, b1 = I->iMax[1];
+  const int c0 = I->iMin[2] - 1, c1 = I->iMax[2];
+  const bool any_cell = (a0 <= a1) && (b0 <= b1) && (c0 <= c1);
+
+  int n = 1; /* size of EList: slot 0 plus every list and its -1 */
+
+  std::vector<int> count;
+  if (any_cell) {
+    /* pass 1: number of points in each cell that is read */
+    count.assign(mapSize, 0);
+    for (int d = a0 - 1; d <= a1 + 1; d++) {
+      for (int e = b0 - 1; e <= b1 + 1; e++) {
+        for (int f = c0 - 1; f <= c1 + 1; f++) {
+          const int cell = d * D1D2 + e * D2 + f;
+          int k = 0;
+          for (int i = head[cell]; i >= 0; i = link[i])
+            k++;
+          count[cell] = k;
+        }
+      }
+    }
+
+    /* pass 2: a cell with points around it gets the next free start */
+    for (int a = a0; a <= a1; a++) {
+      for (int b = b0; b <= b1; b++) {
+        for (int c = c0; c <= c1; c++) {
+          int total = 0;
+          for (int d = a - 1; d <= a + 1; d++) {
+            for (int e = b - 1; e <= b + 1; e++) {
+              const int* row = count.data() + d * D1D2 + e * D2 + c;
+              total += row[-1] + row[0] + row[1];
             }
-            if (ok)
-              i_ptr5 = (i_ptr4 += D2);
           }
-          if (ok)
-            i_ptr5 = (i_ptr4 = (i_ptr3 += D1D2));
+          if (total) {
+            ehead[a * D1D2 + b * D2 + c] = n;
+            n += total + 1;
+          }
         }
-        if (ok) {
-          if (flag) {
-            *(MapEStart(I, a, b, c)) = st;
-            e_list.push_back(-1);
-            n++;
-          } else {
-            *(MapEStart(I, a, b, c)) = 0;
+      }
+    }
+  }
+
+  /* pass 3: allocate once, then write each list at its start */
+  std::vector<int> e_list(n, 0);
+  if (any_cell) {
+    for (int a = a0; a <= a1; a++) {
+      for (int b = b0; b <= b1; b++) {
+        for (int c = c0; c <= c1; c++) {
+          const int start = ehead[a * D1D2 + b * D2 + c];
+          if (!start)
+            continue;
+          int* p = e_list.data() + start;
+          for (int d = a - 1; d <= a + 1; d++) {
+            for (int e = b - 1; e <= b + 1; e++) {
+              for (int f = c - 1; f <= c + 1; f++) {
+                for (int i = head[d * D1D2 + e * D2 + f]; i >= 0; i = link[i])
+                  *(p++) = i;
+              }
+            }
           }
+          *p = -1;
         }
       }
     }
   }
+
+  /* The flag is looked at only when there were cells to visit, as before.
+   * When it is set, nothing is kept: EList stays as it was and EHead goes back
+   * to all 0, so a caller that ignores the return value (MapEIter among them)
+   * finds no neighbours instead of starts into a list that was never stored. */
+  int ok = !(any_cell && G->Interrupt);
   if (ok) {
     I->EList = std::move(e_list);
-    I->EList.shrink_to_fit();
+  } else {
+    I->EHead.assign(mapSize, 0);
   }
   PRINTFD(G, FB_Map)
   " MapSetupExpress-Debug: leaving...n=%d\n", n ENDFD;
--- a/layer0/Triangle.cpp
+++ b/layer0/Triangle.cpp
@@ -1642,7 +1642,10 @@
       minDist2 = I->maxEdgeLenSq;
 
       for(a = 0; a < n; a++) {
-        if(!I->edgeStatus[a]) {
+        /* Only a vertex whose vertActive is -1 can start a triangle here.
+           Nothing in this loop body writes vertActive, so the test is made
+           once per vertex instead of once per neighbour. */
+        if(!I->edgeStatus[a] && I->vertActive[a] == -1) {
           v0 = v + a * 3;
           n0 = vn + 3 * a;
 
@@ -1655,16 +1658,15 @@
               if(j != a) {
                 float dif2 = diffsq3f(v + 3 * j, v0);
                 if(dif2 < minDist2)
-                  if(I->vertActive[a] == -1)
-                    if(TriangleEdgeStatus(I, a, j) >= 0) {      /* can we put a triangle here? */
-                      n1 = vn + 3 * j;
-                      if(dot_product3f(n0, n1) > 0.5) { /* start with vertices pointing the same way */
-                        minDist2 = dif2;
-                        i1 = a;
-                        i2 = j;
-                        first_vert_used = first_vert;
-                      }
+                  if(TriangleEdgeStatus(I, a, j) >= 0) {      /* can we put a triangle here? */
+                    n1 = vn + 3 * j;
+                    if(dot_product3f(n0, n1) > 0.5) { /* start with vertices pointing the same way */
+                      minDist2 = dif2;
+                      i1 = a;
+                      i2 = j;
+                      first_vert_used = first_vert;
                     }
+                  }
               }
               j = map->EList[i++];
             }
````

</details>

##### シェーダーの書き換えに `std::regex` を使わない — 結果は同じ（確認済み）

パッチ 0005 の GLSL ES 3.00 への書き換えを、`std::regex` ではなく、新しい `layer0/ShaderEs300.h` の素朴な文字列の走査で、同じ手順を同じ順に行います。`<regex>` は `_cmd` を大きくし、起動時のシェーダーのコンパイルごとに時間がかかっていました。

**影響:** 出力は regex 版とバイト単位で同じです。ビルドのたびに、出荷と同じ em++ で、130,895 個の文字列について両者を比べています。比べる文字列は、すべてのシェーダーとその前処理の変数のすべての組み合わせ（照明は起動時の値）、照明の各変種（ファイルごとに 32 の組み合わせで）、そして敵対的な入力です。このほか、すべての組み合わせを照明のすべての変種と掛け合わせた 519,695 個の文字列も、ホストの g++ で一度だけ比べ、差はありませんでした。

**パッチ:** `0013-shadermgr-es300-without-regex.patch`

<details><summary>パッチを表示</summary>

````diff
--- a/layer0/ShaderMgr.cpp
+++ b/layer0/ShaderMgr.cpp
@@ -90,10 +90,12 @@
 }
 
 #ifdef __EMSCRIPTEN__
-#include <regex>
+#include "ShaderEs300.h"
 /**
  * WebGL2 rejects GL_EXT_frag_depth in GLSL ES 1.00 shaders, so on a WebGL2
  * context rewrite PyMOL's ES2 shaders to GLSL ES 3.00 (pymolweb spike).
+ * The rewrite itself is ShaderEs300.h: plain string scans whose output is
+ * byte-identical to the regular-expression passes they replaced.
  */
 static std::string pymolweb_to_es300(GLuint shad, const std::string& src)
 {
@@ -106,19 +108,7 @@
     return src;
   GLint type = 0;
   glGetShaderiv(shad, GL_SHADER_TYPE, &type);
-  bool frag = (type == GL_FRAGMENT_SHADER);
-  std::string s = std::regex_replace(src, std::regex(R"(^[ \t]*#(version|extension)[^\n]*)", std::regex::multiline), "");
-  s = std::regex_replace(s, std::regex(R"(^[ \t]*#define[ \t]+texture[ \t]+texture2D[^\n]*)", std::regex::multiline), "");
-  s = std::regex_replace(s, std::regex(R"(\btexture2D\s*\()"), "texture(");
-  s = std::regex_replace(s, std::regex(R"(\btextureCube\s*\()"), "texture(");
-  s = std::regex_replace(s, std::regex(R"(\bvarying\b)"), frag ? "in" : "out");
-  if (frag) {
-    s = std::regex_replace(s, std::regex(R"(\bgl_FragColor\b|\bgl_FragData\s*\[\s*0\s*\])"), "pymolweb_FragColor");
-    s = std::regex_replace(s, std::regex(R"(\bgl_FragDepthEXT\b)"), "gl_FragDepth");
-    return "#version 300 es\nprecision highp float;\nout vec4 pymolweb_FragColor;\n" + s;
-  }
-  s = std::regex_replace(s, std::regex(R"(\battribute\b)"), "in");
-  return "#version 300 es\n" + s;
+  return pymolweb_es300_rewrite(src, type == GL_FRAGMENT_SHADER);
 }
 #endif
 
--- /dev/null
+++ b/layer0/ShaderEs300.h
@@ -0,0 +1,270 @@
+#pragma once
+
+/*
+ * GLSL ES 1.00 -> GLSL ES 3.00 source rewrite for a WebGL2 context, as plain
+ * string scans (no regular-expression library).
+ *
+ * pymolweb_es300_rewrite() returns, for every input, the bytes that patch
+ * 0005's regular-expression version returned (tests/es300_rewrite_test.cpp in
+ * the pymol-wasm build keeps that version and compares the two). It runs the
+ * same passes in the same order, each over the previous pass's output:
+ *
+ *   1. ^[ \t]*#(version|extension)[^\n]*           (multiline) -> ""
+ *   2. ^[ \t]*#define[ \t]+texture[ \t]+texture2D[^\n]*  (multiline) -> ""
+ *   3. \btexture2D\s*\(                                -> "texture("
+ *   4. \btextureCube\s*\(                              -> "texture("
+ *   5. \bvarying\b                                     -> "in" (fragment) / "out"
+ *   fragment shaders:
+ *   6. \bgl_FragColor\b|\bgl_FragData\s*\[\s*0\s*\]   -> "pymolweb_FragColor"
+ *   7. \bgl_FragDepthEXT\b                             -> "gl_FragDepth"
+ *   8. prologue "#version 300 es\nprecision highp float;\nout vec4 pymolweb_FragColor;\n"
+ *   other shaders:
+ *   9. \battribute\b                                   -> "in"
+ *  10. prologue "#version 300 es\n"
+ *
+ * Equivalences relied on (regex_replace with the ECMAScript grammar and the
+ * default flags, as implemented by the toolchain's libc++, global locale "C"):
+ *  - A pass matches against its own input, leftmost first, without overlap: the
+ *    search resumes where the previous match ended, and the anchors below look
+ *    at the input bytes on both sides of a position, matched or not.
+ *  - No pattern can match an empty string, so regex_iterator's empty-match
+ *    step never applies.
+ *  - Multiline '^' holds at offset 0 and right after '\n' or '\r' (libc++
+ *    __is_eol).
+ *  - '\b' holds where exactly one of the two neighbouring bytes is a word byte
+ *    [A-Za-z0-9_]; a position outside the input counts as a non-word byte.
+ *    Bytes >= 0x80 are not word bytes in the "C" locale.
+ *  - '\s' is one of ' ' '\t' '\n' '\v' '\f' '\r' (isspace in the "C" locale).
+ *  - '[^\n]*' is greedy and stops only at '\n' (or the end); it takes '\r' and
+ *    any other byte.
+ *  - At a given offset each pattern has at most one match: every '[ \t]*',
+ *    '[ \t]+' and '\s*' is followed by a literal byte outside its class, and the
+ *    two alternatives of pass 6 differ at their eighth byte ('C' / 'D'). So
+ *    neither the order of alternatives nor backtracking can choose a different
+ *    match, and "match at offset i" is a fixed test on the bytes from i on.
+ *  - The replacement texts contain no '$', so the default format copies them
+ *    verbatim.
+ * Every pass is one left-to-right scan; the test at an offset reads ahead only
+ * over its own keyword and the blank / space run or line rest that follows it
+ * (a run no other keyword's test can reach), so the rewrite is linear in the
+ * input length.
+ */
+
+#include <cstddef>
+#include <string>
+
+namespace pymolweb_es300
+{
+
+// Bits for rewrite_masked(): each one drops one rule (test positive controls).
+enum : unsigned {
+  kSkipVersionExtension = 1u << 0,
+  kSkipDefineTexture = 1u << 1,
+  kSkipTexture2D = 1u << 2,
+  kSkipTextureCube = 1u << 3,
+  kSkipVarying = 1u << 4,
+  kSkipFragColor = 1u << 5,  // first alternative of pass 6
+  kSkipFragData0 = 1u << 6,  // second alternative of pass 6
+  kSkipFragDepthEXT = 1u << 7,
+  kSkipFragPrologue = 1u << 8,
+  kSkipAttribute = 1u << 9,
+  kSkipVertexPrologue = 1u << 10,
+  kRuleCount = 11
+};
+
+inline bool is_word(char c)
+{
+  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
+         (c >= '0' && c <= '9') || c == '_';
+}
+
+inline bool is_space(char c)
+{
+  return c == ' ' || c == '\t' || c == '\n' || c == '\v' || c == '\f' ||
+         c == '\r';
+}
+
+inline bool is_blank(char c) { return c == ' ' || c == '\t'; }
+
+// '\b' at offset i (0 <= i <= s.size())
+inline bool word_boundary(const std::string& s, std::size_t i)
+{
+  bool before = i > 0 && is_word(s[i - 1]);
+  bool after = i < s.size() && is_word(s[i]);
+  return before != after;
+}
+
+// multiline '^' at offset i
+inline bool line_start(const std::string& s, std::size_t i)
+{
+  return i == 0 || s[i - 1] == '\n' || s[i - 1] == '\r';
+}
+
+// s[i, i + n) == lit
+inline bool has(const std::string& s, std::size_t i, const char* lit, std::size_t n)
+{
+  if (i > s.size() || s.size() - i < n)
+    return false;
+  return s.compare(i, n, lit, n) == 0;
+}
+
+inline std::size_t skip_blanks(const std::string& s, std::size_t i)
+{
+  while (i < s.size() && is_blank(s[i]))
+    ++i;
+  return i;
+}
+
+inline std::size_t skip_spaces(const std::string& s, std::size_t i)
+{
+  while (i < s.size() && is_space(s[i]))
+    ++i;
+  return i;
+}
+
+// '[^\n]*' from offset i: the offset of the next '\n', or the end
+inline std::size_t line_rest_end(const std::string& s, std::size_t i)
+{
+  std::size_t e = s.find('\n', i);
+  return e == std::string::npos ? s.size() : e;
+}
+
+// Passes 1 and 2: the end of a matching line directive at offset i, or 0
+// (a match always ends after its '#', so 0 cannot be a match end).
+inline std::size_t match_version_extension(const std::string& s, std::size_t i)
+{
+  if (!line_start(s, i))
+    return 0;
+  std::size_t j = skip_blanks(s, i);
+  if (!has(s, j, "#", 1))
+    return 0;
+  ++j;
+  if (has(s, j, "version", 7))
+    return line_rest_end(s, j + 7);
+  if (has(s, j, "extension", 9))
+    return line_rest_end(s, j + 9);
+  return 0;
+}
+
+inline std::size_t match_define_texture(const std::string& s, std::size_t i)
+{
+  if (!line_start(s, i))
+    return 0;
+  std::size_t j = skip_blanks(s, i);
+  if (!has(s, j, "#define", 7))
+    return 0;
+  std::size_t k = skip_blanks(s, j + 7);
+  if (k == j + 7 || !has(s, k, "texture", 7))
+    return 0;
+  j = k + 7;
+  k = skip_blanks(s, j);
+  if (k == j || !has(s, k, "texture2D", 9))
+    return 0;
+  return line_rest_end(s, k + 9);
+}
+
+// '\b<word>\s*\(' at offset i: the match end, or 0
+inline std::size_t match_call(const std::string& s, std::size_t i, const char* word, std::size_t n)
+{
+  if (!word_boundary(s, i) || !has(s, i, word, n))
+    return 0;
+  std::size_t j = skip_spaces(s, i + n);
+  return has(s, j, "(", 1) ? j + 1 : 0;
+}
+
+// '\b<word>\b' at offset i: the match end, or 0
+inline std::size_t match_word(const std::string& s, std::size_t i, const char* word, std::size_t n)
+{
+  if (!word_boundary(s, i) || !has(s, i, word, n) || !word_boundary(s, i + n))
+    return 0;
+  return i + n;
+}
+
+// '\bgl_FragData\s*\[\s*0\s*\]' at offset i: the match end, or 0
+inline std::size_t match_frag_data0(const std::string& s, std::size_t i)
+{
+  if (!word_boundary(s, i) || !has(s, i, "gl_FragData", 11))
+    return 0;
+  std::size_t j = skip_spaces(s, i + 11);
+  if (!has(s, j, "[", 1))
+    return 0;
+  j = skip_spaces(s, j + 1);
+  if (!has(s, j, "0", 1))
+    return 0;
+  j = skip_spaces(s, j + 1);
+  return has(s, j, "]", 1) ? j + 1 : 0;
+}
+
+// One regex_replace: every leftmost non-overlapping match of `match` -> repl.
+template <typename Match>
+std::string replace_all(const std::string& s, Match match, const char* repl)
+{
+  std::string out;
+  out.reserve(s.size() + 64);
+  std::size_t i = 0;
+  while (i < s.size()) {
+    std::size_t e = match(s, i);
+    if (e) {
+      out += repl;
+      i = e;
+    } else {
+      out += s[i];
+      ++i;
+    }
+  }
+  return out;
+}
+
+inline std::string rewrite_masked(const std::string& src, bool frag, unsigned skip)
+{
+  std::string s = src;
+  if (!(skip & kSkipVersionExtension))
+    s = replace_all(s, match_version_extension, "");
+  if (!(skip & kSkipDefineTexture))
+    s = replace_all(s, match_define_texture, "");
+  if (!(skip & kSkipTexture2D))
+    s = replace_all(s, [](const std::string& t, std::size_t i) {
+      return match_call(t, i, "texture2D", 9);
+    }, "texture(");
+  if (!(skip & kSkipTextureCube))
+    s = replace_all(s, [](const std::string& t, std::size_t i) {
+      return match_call(t, i, "textureCube", 11);
+    }, "texture(");
+  if (!(skip & kSkipVarying))
+    s = replace_all(s, [](const std::string& t, std::size_t i) {
+      return match_word(t, i, "varying", 7);
+    }, frag ? "in" : "out");
+  if (frag) {
+    if ((skip & (kSkipFragColor | kSkipFragData0)) != (kSkipFragColor | kSkipFragData0))
+      s = replace_all(s, [skip](const std::string& t, std::size_t i) {
+        std::size_t e = (skip & kSkipFragColor) ? 0 : match_word(t, i, "gl_FragColor", 12);
+        if (!e && !(skip & kSkipFragData0))
+          e = match_frag_data0(t, i);
+        return e;
+      }, "pymolweb_FragColor");
+    if (!(skip & kSkipFragDepthEXT))
+      s = replace_all(s, [](const std::string& t, std::size_t i) {
+        return match_word(t, i, "gl_FragDepthEXT", 15);
+      }, "gl_FragDepth");
+    if (skip & kSkipFragPrologue)
+      return s;
+    return "#version 300 es\nprecision highp float;\nout vec4 pymolweb_FragColor;\n" + s;
+  }
+  if (!(skip & kSkipAttribute))
+    s = replace_all(s, [](const std::string& t, std::size_t i) {
+      return match_word(t, i, "attribute", 9);
+    }, "in");
+  if (skip & kSkipVertexPrologue)
+    return s;
+  return "#version 300 es\n" + s;
+}
+
+} // namespace pymolweb_es300
+
+/**
+ * GLSL ES 1.00 source -> GLSL ES 3.00 source; `frag` for a fragment shader.
+ */
+inline std::string pymolweb_es300_rewrite(const std::string& src, bool frag)
+{
+  return pymolweb_es300::rewrite_masked(src, frag, 0);
+}
````

</details>

##### 同梱データは C の unpickler で読む — 結果は同じ（確認済み）

`PKL.fromFile`（`chempy/pkl.py`）は、実際のパスが `$PYMOL_DATA` の中にあるファイル（同梱のフラグメントと側鎖ライブラリ）を Python の C 版 `pickle.load` で読みます。それ以外のファイルはこれまでどおりで、セッションは引き続き制限付きの読み込み（パッチ 0006）だけを通ります。純 Python の読み込みでは、変異導入のウィザードを開くのが遅かったためです。

**影響:** 同梱の 133 個の pickle はどちらの経路でも同じオブジェクトになり、変異導入のウィザード・フラグメント・`fab` の結果も同じです（ビルドのたびに確認）。

**パッチ:** `0014-chempy-pkl-bundled-c-unpickler.patch`

<details><summary>パッチを表示</summary>

````diff
--- a/modules/chempy/pkl.py
+++ b/modules/chempy/pkl.py
@@ -232,11 +232,42 @@
                 cls.dump = pickle.dump
 
 
+# Bundled data through the C unpickler.
+#
+# PKL.fromFile reads a file under $PYMOL_DATA (the fragments and mutagenesis
+# side-chain libraries the wheel ships) with the stdlib C unpickler, which is
+# much faster than the pure-Python cPickle.load, and every other file with
+# cPickle.load exactly as before. Both are unrestricted file loaders, so no
+# trust boundary moves: session data still goes only through restricted_loads
+# above. The two differ on a protocol < 3 STRING whose bytes are not printable
+# ASCII (C: str or UnicodeDecodeError, _decode_string: bytes); the shipped
+# data is protocol 4 and the build compares both paths on it. A file counts
+# as under $PYMOL_DATA by its real path.
+
+import os as _os
+
+
+def _bundled_file(fname):
+    '''
+    True if fname resolves (symlinks and ".." included) to a path inside the
+    resolved $PYMOL_DATA. False if $PYMOL_DATA is unset or empty, and for a
+    URL (Storage.my_open fetches those).
+    '''
+    data = _os.environ.get('PYMOL_DATA')
+    if not data or '://' in fname:
+        return False
+    data = _os.path.realpath(data)
+    return _os.path.commonpath([data, _os.path.realpath(fname)]) == data
+
+
 class PKL(Storage):
 
     def fromFile(self,fname,**params):
         fp = self.my_open(fname,'rb')
-        result = cPickle.load(fp)
+        if _bundled_file(fname):
+            result = pickle.load(fp)
+        else:
+            result = cPickle.load(fp)
         fp.close()
         return result
 
````

</details>

##### シンボルを隠し、リンクで指定する公開は 1 つだけ — 速さ・大きさだけ

すべてのソースを `-fvisibility=hidden -fvisibility-inlines-hidden` でコンパイルし、`_cmd` を `-sSIDE_MODULE=2 -sEXPORTED_FUNCTIONS=_PyInit__cmd` でリンクします。リンクで公開を指定するのは `PyInit__cmd` だけです。以前は 5,972 の公開名と 615 の自己参照で、モジュールが大きく、読み込みも遅くなっていました。この実行環境の `_cmd` が公開する名前は 303 個（関数 9 個、残りはデータのアドレス）で、自分しか持たない関数を読み込むことはありません。これはビルドのたびに確かめています。

**影響:** `_cmd` が 800 KB 小さくなります。計算時間の合計は変わりませんが、例外が 1 つあります。調査では、読み込み直後の最初のレイトレースだけが 3 回の測定すべてで 4〜8 %（35〜60 ms）長くかかりました。原因は分かっていません。2 回目のレイトレースは同じ時間でした。

##### 同梱データを損失なく詰め直す — 結果は同じ（確認済み）

同梱のフラグメントと側鎖の pickle 133 個をプロトコル 4 で書き直し、`data/pymol/cmyk.png` を gAMA と tEXt のチャンクを残したまま圧縮し直しました。合わせて約 160 KB 小さくなります。

**影響:** pickle は同じオブジェクトになり、`cmyk.png` の画素も同じです。`space cmyk` の後の色の表はビット単位で同じです（ビルドのたびに確認）。

##### 起動時の Python はコンパイル済みで同梱 — ここでは使えない

起動時に読み込む wheel のモジュール 68 個には、`.py` の横に `__pycache__/*.pyc` を付けています。起動時に使う標準ライブラリのモジュール 167 個は `.pyc` だけで同梱します（`chempy/pkl.py` はソースのみ）。Python のソースのコンパイルが、ワーカーの起動時間の約半分を占めていたためです。

**影響:** 起動が約 1.3 秒短くなります。起動時に使う標準ライブラリのモジュール 167 個の中の行は、トレースバックにソースの文が出ず、それらの関数では `inspect.getsource` が失敗します。ほかの標準ライブラリのモジュールはソースを残しています。

##### numpy の wheel からビルド用ファイルを除く — 結果は同じ（確認済み）

Pyodide の numpy 2.4.6 の wheel から、実行時に読まれない 206 個を除きました。型スタブ、C のヘッダーとソース、静的ライブラリ、Cython のファイル、ビルド設定、PyInstaller のフック、doc モジュール、pytest の conftest です。実行時のモジュールとライセンスのファイルは、すべてバイト単位でそのまま残しています。

**影響:** 詰めた wheel に残したモジュールは、どれも元の wheel と同じく import できます（ビルドのたびに確認）。外した 4 つのモジュール（`numpy._pyinstaller`、そのフック、`numpy.conftest`、`numpy.doc.ufuncs`）は import できなくなります。wheel は 2.96 MB から 2.57 MB になります。

##### numpy は最初に使うときに展開 — 速さ・大きさだけ

ワーカーは起動時のパッケージの一覧から numpy を外し、何かが初めて import したときに展開します。メニュー・画面・ウィザードは numpy を使わないのに、毎回の起動で展開していたためです。

**影響:** 起動が約 0.15 秒短くなります。numpy を使う最初のコマンド（`cmd.get_coords` など）が、その時間を一度だけ払います。

#### オリジナル版の修正の取り込み

##### オリジナル版 #522 の UTF-8 のバッファ修正 — 結果は同じ（確認済み）

オリジナル版のコミット bebf5f0644 の C++ の部分（5 ファイル: `os_python.h`、`PConv.cpp`、`PConv.h`、`Property.cpp`、`PopUp.cpp`）です。文字列のバッファをコードポイントの数ではなく UTF-8 のバイト数で確保するので、ASCII 以外の文字（日本語のウィザードやシーンのメッセージなど）であふれなくなります。適用後、この 5 ファイルはオリジナル版の master とバイト単位で同じです。

**影響:** ASCII 以外の文字で落ちたり止まらなくなったりする不具合を直します。固定しているコミットが bebf5f0644 を含むようになったら外します。

**出典:** <https://github.com/schrodinger/pymol-open-source/pull/522>

**パッチ:** `0010-utf8-byte-lengths-upstream-522.patch`

<details><summary>パッチを表示</summary>

````diff
Port of upstream pymol-open-source commit bebf5f0644ff93cceda045d8676cca9e8d088c0d
(PR #522, fixes issue #517): size string buffers by UTF-8 byte length instead of
PyUnicode_GetLength (code points). Only the C++ part (5 files) is taken, verbatim;
the upstream test files under testing/ are left out. After this patch the 5 files
are byte-identical to upstream master's.

diff --git a/layer0/os_python.h b/layer0/os_python.h
index af372db883..c2631ddecd 100644
--- a/layer0/os_python.h
+++ b/layer0/os_python.h
@@ -44,8 +44,6 @@ typedef int PyObject;
 # define PyNumber_Int           PyNumber_Long
 
 # define PyString_Check                 PyUnicode_Check
-# define PyString_Size                  PyUnicode_GetLength
-# define PyString_GET_SIZE              PyUnicode_GetLength
 # define PyString_FromString            PyUnicode_FromString
 # define PyString_FromStringAndSize     PyUnicode_FromStringAndSize
 # define PyString_InternFromString      PyUnicode_InternFromString
diff --git a/layer1/PConv.cpp b/layer1/PConv.cpp
index ed259f8379..4d00f2deb7 100644
--- a/layer1/PConv.cpp
+++ b/layer1/PConv.cpp
@@ -122,10 +122,10 @@ int PConvPyListToStrVLAList(PyObject * obj, char **vla, int *n_str)
     for(i = 0; i < n_st; i++) {
       t = PyList_GetItem(obj, i);
       if(PyString_Check(t)) {
-        l = PyString_Size(t);
+        auto strval = PyString_AsSomeString(t);
+        l = strval.length();
         nn_ch = n_ch + l + 1;
         VLACheck(*vla, char, nn_ch);
-        auto strval = PyString_AsSomeString(t);
         UtilNCopy((*vla) + n_ch, strval.c_str(), l + 1);
         n_ch = nn_ch;
       } else {
@@ -1159,7 +1159,8 @@ int PConvPyListToStringVLA(PyObject * obj, char **vla_ptr)
       for(a = 0; a < l; a++) {
         i = PyList_GetItem(obj, a);
         if(PyString_Check(i)) {
-          ll += PyString_Size(i) + 1;
+          // UTF-8 byte length, not code points (PyUnicode_GetLength)
+          ll += PyString_AsSomeString(i).length() + 1;
         }
       }
       vla = VLAlloc(char, ll);
diff --git a/layer1/PConv.h b/layer1/PConv.h
index e3055d62ab..4a556c83b8 100644
--- a/layer1/PConv.h
+++ b/layer1/PConv.h
@@ -85,7 +85,6 @@ Z* -------------------------------------------------------------------
 #define CPythonVal_New_Float(VAL)                       PyFloat_FromDouble(VAL)
 
 #define CPythonVal_PyFloat_AsDouble(PYOBJECT)            PyFloat_AsDouble(PYOBJECT)
-#define CPythonVal_PyString_Length(PYOBJECT)             PyString_Size(PYOBJECT)
 #define CPythonVal_PConvPyStrToStr                       PConvPyStrToStr
 #define CPythonVal_PConvPyBoolToInt                      PConvPyBoolToInt
 #define CPythonVal_PConvPyFloatToFloat                   PConvPyFloatToFloat
diff --git a/layer1/Property.cpp b/layer1/Property.cpp
index dc91d818ef..024bd0b670 100644
--- a/layer1/Property.cpp
+++ b/layer1/Property.cpp
@@ -726,7 +726,7 @@ int PropertyFromPyList(PyMOLGlobals* G, PyObject* list)
           if (!prop_id)
             prop_id = PropertyGetNewUniqueID(G);
           pVal = CPythonVal_PyList_GetItem(G, val, 0);
-          prop_name_len = CPythonVal_PyString_Length(pVal) + 1;
+          prop_name_len = PyString_AsSomeString(pVal).length() + 1;
           prop_name = pymol::malloc<char>(prop_name_len);
           CPythonVal_PConvPyStrToStr(pVal, prop_name, prop_name_len);
           CPythonVal_Free(pVal);
@@ -752,7 +752,7 @@ int PropertyFromPyList(PyMOLGlobals* G, PyObject* list)
           } break;
           case PropertyType::String: {
             char* prop_value;
-            int prop_value_len = CPythonVal_PyString_Length(propval) + 1;
+            int prop_value_len = PyString_AsSomeString(propval).length() + 1;
             prop_value = pymol::malloc<char>(prop_value_len);
             CPythonVal_PConvPyStrToStr(propval, prop_value, prop_value_len);
             PropertySet(G, prop_id, prop_name, prop_value);
diff --git a/layer4/PopUp.cpp b/layer4/PopUp.cpp
index 0792cdab89..51676a3576 100644
--- a/layer4/PopUp.cpp
+++ b/layer4/PopUp.cpp
@@ -186,9 +186,9 @@ Block *PopUpNew(PyMOLGlobals * G, int x, int y, int last_x, int last_y,
       continue;
     }
     elem = PyList_GetItem(item, 1);
-    l = PyString_Size(elem);
     str = PyString_AsString(elem);
-    cl = l;
+    l = strlen(str);             /* buffer size in UTF-8 bytes */
+    cl = PyUnicode_GetLength(elem); /* display width in code points */
     c = str;
     while(*c) {
       if(TextStartsWithColorCode(c)) {  /* discount the markup */
@@ -214,7 +214,7 @@ Block *PopUpNew(PyMOLGlobals * G, int x, int y, int last_x, int last_y,
     if (PyList_Size(item) > 2) {
       PyObject* command = PyList_GetItem(item, 2);
       if(PyString_Check(command)) {
-	l = PyString_Size(command);
+	l = strlen(PyString_AsString(command));
 	if(l > mx)
 	  mx = l;
       }
````

</details>

### "3Dmol.js" モード: 3Dmol.js 2.5.5

3Dmol.js 2.5.5（BSD 3-Clause）は改変せずに入れています。`build/3Dmol-min.js` をバイト単位でそのまま写し、そのまま動かします。アプリは各ビューアの周りに次のものを加えています。名前を挙げた非公開の関数を除き、3Dmol.js の公開の関数を通しています。

- **2 本指で構造を移動** `twoFingerPan.ts` は 3Dmol.js より先にビューアの要素で指の動きを受けます。広げるより動かす量が大きい 2 本指の操作は 3Dmol.js に渡さず、公開の `translateScene` で表示を動かします。移動量は 3Dmol.js 自身の 3 本指の移動と同じく、非公開の `renderer` から読むビューア格子の比で合わせます（ビューアが 1 つなら 1）。HELP とスマホの「表示ツール」のスイッチで、3Dmol.js 本来の操作（2 本指で拡大縮小、3 本指で移動）に戻せます。
- **平行投影を透視投影と同じ大きさに** `orthoFraming.ts` は、ビューアのインスタンスごと（プロトタイプではなく）に非公開の `setSlabAndFog` を包みます。3Dmol.js は平行投影の範囲を画面の幅から決めます。その直後に、包んだ関数が透視投影と同じく縦の視野角から範囲を決め直します。そのために非公開の `rotationGroup` を読み、非公開の `camera` を読み書きします。これで投影を切り替えても、回転の中心での構造の大きさは変わりません。
- **奥行き強調・断面・平行投影** このアプリの奥行きの操作は、公開の `enableFog` で霧を、`setSlab` で断面を、`setProjection` で投影法を設定します。断面の手前カットと厚みは、分子を囲む箱の対角線をもとにした奥行きの幅に対する割合です。この対角線は `fitSlab({})` と `getSlab()` で読み取ります。分子を回しても幅は変わりません。断面がオンで表面を表示しているときは、`sectionCap.ts` が公開の `addCustom` で加える図形で切り口を塗ることができます。操作がオフのときに書き込む値は 3Dmol.js 自身の値です。霧は 0.4 から 1.0、断面は `zoomTo()` が残す範囲、投影法は透視投影です。これらの設定は見た目の保存には入りません。
- **表面の切り口を塞ぐ** 断面を作ると分子表面に穴が開き、表面の内側の壁が見えます。この穴は `sectionCap.ts` で塞げます。使うのは 3Dmol.js の公開 API だけです。表面のメッシュを `getSurface` で読み戻し、手前のクリッピング面で切ります。切り口をつないで輪郭にし（UCSF ChimeraX の表面の capper と同じ考え方で、このアプリのために書いたコードです。ChimeraX のコードを移したものではありません）、`earcut` で埋めて `addCustom` で描きます。視点を回したり拡大したりしたときや、切る位置を動かしたときに作り直します。使えるのは、このアプリの表示で表面を出し、断面をオンにしているときだけです。きれいに閉じられない切り口は開いたままにします。
- **このアプリ独自のツールバーと表示** ツールバーはこのアプリのものです。スタイル、配色、タンパク質・リガンド・水の表示、表面の設定は `applySceneStyles` を通して 3Dmol.js のスタイルを設定します。回転と背景は 3Dmol.js の `spin` と `setBackgroundColor` を呼びます。スタイル、配色、表示の切り替え、表面のどれかを最初に変えると、ファイルを開いたときの表示はこのアプリの表示に替わります。このアプリの表示では、クリックした残基を黄色で示します。「初期表示」で、開いたときの表示と視点に戻せます。
- **見た目の保存と再現** `mol3dLook.ts` はスタイル、原子ごとの色（数値）、表面、背景、視点を記録します。`exportedLook3d.ts` がスタイル・表面・背景を再現し、視点は表示枠が戻します。"Includes PyMOL™" モードで保存した見た目は 3Dmol.js のスタイルに直して描きます。記録には非公開の `surfaces` の表（各表面のスタイル・原子・不透明度）と非公開の `bgColor` を読みます。ラベル、計測、ペンの線、奥行き強調と断面の設定、ほかのモデルや図形は記録しません。原子の数が構造と合わない見た目は使いません。
- **VRML の書き出しで表示を崩さない** `vrmlExport.ts` は `exportVRML()` の前に非公開の `modelGroup`、各表面の `lastGL`、各図形の `renderedShapeObj` を控え、書き出しの後に（失敗したときも）戻すので、画面の表示が崩れません。
- **WebGL のコンテキストを失ったときの復旧** 共有の WebGL コンテキストが失われても 3Dmol.js には知らされません。そのため `viewerRecovery.ts` は、ページが見えている間、2 秒ごとに `getRenderer().isLost()` で確かめます。失われていれば `resize()` と `render()` を呼び、ビューアは同じ場面・同じ視点のまま新しいコンテキストを得ます。置き換えたり閉じたりしたビューアは片付けます。中身を消し、非公開の resize と intersection のオブザーバーを外し、canvas を取り除きます。
- **縦長の画面では幅に合わせる** 3Dmol.js は高さだけに合わせて構造を収めるので、ビューアが縦長のときは `zoomTo()` の後に幅と高さの比だけ縮小します。
- **3Dmol.js が読む前に構造の文字列の危ない名前を書き換える** `safeModelText.ts` が変えるのは 3Dmol.js が読む写しだけです。保存・書き出し、または "Includes PyMOL™" モードに渡すファイルそのものは変えません。ファイル内の文字列が、ページ上のすべてのスクリプトが共有するオブジェクトに届き、ページを止めることがあります。そのため、JavaScript のオブジェクトが受け継ぐ名前（`__proto__`、`constructor`、`toString` など）は、大文字小文字を問わず、最後の 1 文字を `0` にします。無作為に選んだ PDB の mmCIF 30,000 件には、このような名前は 1 つもありませんでした。SDF と MOL では、`3DMOL_STYLE` という名前のデータ項目の名前を変えます。そのため 3Dmol.js はこの項目からスタイルを取りません。行の追加や削除はなく、どの行も長さは変わりません。
- **MOL2 の原子にヘテロの印（`hetflag`）を付ける** 3Dmol.js 2.5.5 の MOL2 の読み込みは `hetflag` を設定しません。アプリの表示は `hetflag: false` の原子をポリマーとして、`hetflag: true` の原子をリガンドとして描くため、このままでは MOL2 ファイルは何も表示されません。`markHetero`（`localFile.ts`）は、この値がない MOL2 の原子に値を設定します。残基名がタンパク質と核酸の残基のリストにあれば false（`THR1` のような末尾の番号は無視します）、それ以外は true です。PDB と mmCIF の読み込みは、この値を ATOM か HETATM かのレコードから決めます。MOL2 の読み込みは残基名を残さないため、現在は MOL2 の原子はすべてリガンドとして（スティックで）描かれ、カートゥーンは出ません。
- **表示の上の層に描くペン** 「ペン」は 3Dmol.js の描画の上に重ねた層に手書きの線を描きます。3D の場面には入らないので、線は構造と一緒には回りません。視点が動くと、線の位置がずれたことを知らせます。保存する PNG は、3Dmol.js の `pngURI()` の画像に線を重ねたものです。線がずれているときは注記が入ります。

## English

"Includes PyMOL™" mode runs Open-Source PyMOL 3.2.0a, built from pymol-open-source commit edcda80f and compiled to WebAssembly for Pyodide 314.0.7 so that it runs inside the browser. It is a modified build made by AgroDesign Studios and distinct from the products of Schrödinger, LLC. The list below shows how it differs from upstream. Besides source patches and build steps, it covers start-up settings and behaviour that the app's worker adds around the engine, the app's copy of the menu bar, and changes to the numpy wheel and the Python standard library that it runs with. The copyright and licence notices at the top of upstream's source files, and its licence texts, are kept unchanged. 3Dmol.js is used as published; what the app adds around it is listed at the end.

The light edition ("3Dmol.js" mode only) carries no Open-Source PyMOL: the 3Dmol.js section below is the part that applies to it.

### Changes to Open-Source PyMOL

#### Left out of this build or the app's menu

##### Only the four DejaVu Sans label fonts — The picture can differ

Label fonts 5–8 (Sans, Sans Oblique, Sans Bold, Sans Bold Oblique) are compiled in; Serif, Mono and Gentium (ids 9–18) are not. `CText::getFont` (`layer1/Text.cpp`) draws any other font id of 5 or more in Sans instead of drawing nothing. The ten other faces were 2.3 MB of the 7.9 MB `_cmd` module.

**Effect:** Labels set to Serif, Mono or Gentium, or to an unknown id from a session, are drawn in DejaVu Sans; ray-traced labels with ids 9 and up were checked to be pixel-identical to id 5.

**Patch:** `0012-text-sans-four-fonts-fallback.patch`

<details><summary>Show the patch</summary>

````diff
--- a/layer1/Text.cpp
+++ b/layer1/Text.cpp
@@ -29,8 +29,12 @@
 
 #ifdef _PYMOL_FREETYPE
 #include "FontTTF.h"
+#ifndef __EMSCRIPTEN__
+/* The wasm build registers no Gentium face (TextInit), so it does not
+ * compile the header in. */
 #include "FontTTF2.h"
 #endif
+#endif
 
 #define FONT_NAME_MAX 255
 
@@ -71,9 +75,25 @@
 public:
   // TODO make const
   CFont* getFont(unsigned font_id) {
+#ifdef __EMSCRIPTEN__
+    if (font_id < m_fonts.size() && m_fonts[font_id]) {
+      return m_fonts[font_id].get();
+    }
+    /* The wasm build embeds only the four Sans faces (TextInit), so any
+     * other id >= 5 (Serif, Mono, Gentium, or an id no build has, e.g. one a
+     * session file brings) draws with Sans (font 5) instead of drawing
+     * nothing. Every caller (the GL and the ray label paths, distance and
+     * dihedral labels) comes through here; SettingCheckFontID is not on the
+     * ray path. The id is unsigned, so a negative id also lands on font 5;
+     * SettingCheckFontID already maps those to 5 on every label path. */
+    if (font_id >= 5 && m_fonts.size() > 5 && m_fonts[5]) {
+      return m_fonts[5].get();
+    }
+#else
     if (font_id < m_fonts.size()) {
       return m_fonts[font_id].get();
     }
+#endif
     return nullptr;
   }
 
@@ -461,6 +481,9 @@
   I->addFont(6, FontTypeNew(G, TTF_DejaVuSans_Oblique_dat, TTF_DejaVuSans_Oblique_len));
   I->addFont(7, FontTypeNew(G, TTF_DejaVuSans_Bold_dat, TTF_DejaVuSans_Bold_len));
   I->addFont(8, FontTypeNew(G, TTF_DejaVuSans_BoldOblique_dat, TTF_DejaVuSans_BoldOblique_len));
+#ifndef __EMSCRIPTEN__
+  /* The wasm build stops at the four Sans faces 5-8: ids 9-18 are not
+   * registered and getFont draws them with font 5. */
   I->addFont(9, FontTypeNew(G, TTF_DejaVuSerif_dat, TTF_DejaVuSerif_len));
   I->addFont(10, FontTypeNew(G, TTF_DejaVuSerif_Bold_dat, TTF_DejaVuSerif_Bold_len));
   I->addFont(11, FontTypeNew(G, TTF_DejaVuSansMono_dat, TTF_DejaVuSansMono_len));
@@ -473,6 +496,7 @@
   I->addFont(18, FontTypeNew(G, TTF_DejaVuSerif_BoldOblique_dat, TTF_DejaVuSerif_BoldOblique_len));
 #endif
 #endif
+#endif
 
   return true;
 }
````

</details>

##### Optional libraries not compiled in — Not available here

The build defines `_PYMOL_NO_MSGPACKC` and leaves out `_PYMOL_VMD_PLUGINS` and `_PYMOL_OPENVR`. `_cmd` is compiled only from `ov/src`, `layer0`–`layer5`, `layerGraphics`, `layerGraphics/gl` and the generated `ShaderText.cpp`, so the VMD molfile plugins under `contrib/uiuc` are not built. These settings are unchanged from the app's first in-browser build. No source records why each one was left out.

**Effect:** OpenVR stereo is unavailable and `.mmtf` files do not load; which other file formats the molfile plugins would add was not tested.

##### 61 data files nothing reads are left out — Not available here

The wheel ships without the 44 on-disk shader files (the compiled-in copies are used), `data/startup/` (Qt plugins), the side-chain generator scripts and `sc_library.pkl`, `splash.png`, `hsv.ppm`, an icon and `setting_help.csv` (list: `pymol-wasm/s1_drop.json`).

**Effect:** Only a command that names one of these paths differs: it now says the file does not exist. Shaders are not read from disk by default (`shaders_from_disk 0`).

##### 31 Python modules that cannot run are left out — Not available here

Left out: `pymol/Qt`, `pymol/plugins`, `pymolhttpd`, `rpc`, `mpeg_encode`, `xwin`, `seqalign`, `cgobuilder`, the `demo`, `stereodemo` and `cleanup` wizards, and `chempy`'s `tinker`, `bmin`, `fast`, `mmtf` and `gamess1`. `cgobuilder` fails to import under Python 3.14. Each of the others needs Qt, threads, sockets, an X display, an external program or a module the browser does not have.

**Effect:** These features did not work in the browser before either. Most now only fail with a different error message. `chempy.bmin.do`, typed as Python, used to hang the worker in an endless loop; now it fails at once because the module is missing. Name completion after `wizard` offers 22 wizards instead of 25.

##### TINKER parameter folder left out — Not available here

`data/chempy/tinker` is removed from the wheel. Its `chempy.prm` is a modified TINKER `amber.prm`; TINKER's terms forbid passing copies on without the author's permission, and upstream records no such permission. `chempy.tinker` needs the external TINKER program anyway.

**Effect:** Only the `check` command and the Python functions `cmd.minimize` and `cmd.fast_minimize` lead to this folder. None of them worked in the browser before.

##### 28 menu entries hidden — Not available here

The app's copy of the menu bar leaves out 28 of its 616 entries: the ten non-Sans label fonts, Wizard > Demo (12), Display > Stereo Mode > Quad-Buffered Stereo and OpenVR, Setting > Rendering > Antialias (Real Time) (3) and Setting > Volume > Pre-integrated Rendering. A font entry would give no error, but the font is not built in, so its labels would be drawn in Sans. The other 18 entries fail here: the demo wizard needs threads and is not in the wheel, WebGL has no quad buffer, OpenVR is not built, and the last two are not supported upstream at all.

**Effect:** The About dialog of the menu lists what is left out. Menu entries that open Qt dialogs, Get PDB and web links are not in the app's menu either.

#### Settings that differ from desktop builds

##### `trilines` on — Picture not compared with a desktop build

`trilines` is set to 1 at start-up, after a session is opened and after `reinitialize` (default 0). With 0, lines and non-bonded crosses are drawn as GL_LINES, which WebGL draws as nothing.

**Effect:** Lines appear and `line_width` works. Each line is drawn as two triangles, the way desktop builds draw lines under a core OpenGL profile. The picture was not compared with a desktop build. Your own `set trilines, 0` stands until a session is restored (when you open one, or when the viewer rebuilds itself after a failure) or `reinitialize` is run.

##### `cgo_shader_ub_color` on — The picture can differ

`cgo_shader_ub_color` is set to 1 at start-up, after a session is opened and after `reinitialize` (default 0), so CGO vertex colours go to the GPU as 4 bytes instead of 4 floats: 21–25 % less vertex memory. It also stops `cgo_shader_ub_normal 1` from blanking cartoons and opaque surfaces on WebGL.

**Effect:** Compared with the same build with the setting off (not with a desktop build): surfaces, dots and mesh differ by at most 1/255 per colour channel (2/255 in one mesh picture on a real GPU). Cartoons matched, except that four cartoon-and-sticks pictures had one pixel off by 1/255 (software rendering).

##### `defer_builds_mode` follows the grid — Speed or size only

`defer_builds_mode` is 1 (build only the state on screen) except in Grid by State and By Object-State, where it is 0 as upstream, unless an object with `auto_defer_builds` (500) states or more is loaded. A saved `.pse` stores this 1 as upstream's default 0, the value a desktop build would have saved; while such an object is loaded it stores 1. A 1 you set yourself outside those grid views is also saved as 0 (unless such an object is loaded), where a desktop build would save 1. Showing a surface on a 116-model NMR entry took 24.5 s with 0 and 0.66 s with 1.

**Effect:** A state is built when it is first shown, so the first pass through a movie can be slower; grid views still draw every state.

##### One ray-tracing thread — Picture not compared with a desktop build

`max_threads` is fixed at 1: the browser runtime has no threads to use.

**Effect:** Ray tracing is 5–13 times slower than a native multi-threaded build; an effect on the picture was not measured.

##### Text scale rounded to the nearest whole number — The picture can differ

`display_scale_factor` is set from the device pixel ratio rounded to the nearest whole number (at least 1), where desktop builds round down. Rounding down left text at 67–80 % of its size on Windows at 125 % or 150 % scaling.

**Effect:** The internal GUI's text and panels can be drawn larger than in a desktop build on the same screen.

##### Quiet start, no external GUI — Not available here

The engine starts as `pymol -q` with `external_gui 0`, `show_splash 0` and `no_quit 1`; the internal GUI (object panel) is on or off depending on the page. There is no Qt window in a browser, and quitting would stop the page's engine.

**Effect:** No splash text and no Qt or Tk windows, and `quit` does not end the session.

#### Changes to run in a browser

##### Memory figures return 0 — Not available here

In `layer0/MemoryUsage.cpp`, `memory_usage()` and `memory_available()` return 0 under emscripten, as upstream already does for its own `_WEBGL` build. The patch adds `__EMSCRIPTEN__` to that existing `_WEBGL` branch.

**Effect:** Any figure built from these two functions reads 0.

**Patch:** `0001-memoryusage-emscripten.patch`

<details><summary>Show the patch</summary>

````diff
diff --git a/layer0/MemoryUsage.cpp b/layer0/MemoryUsage.cpp
index 3d0f810e..651eedc3 100644
--- a/layer0/MemoryUsage.cpp
+++ b/layer0/MemoryUsage.cpp
@@ -30,7 +30,7 @@ namespace pymol
  */
 size_t memory_usage()
 {
-#ifdef _WEBGL
+#if defined(_WEBGL) || defined(__EMSCRIPTEN__)
   return 0;
 #elif defined(__linux__) || defined(__FreeBSD__)
   size_t vmRSS = 0;
@@ -64,7 +64,7 @@ size_t memory_usage()
  */
 size_t memory_available()
 {
-#ifdef _WEBGL
+#if defined(_WEBGL) || defined(__EMSCRIPTEN__)
   return 0;
 #elif defined(__linux__) || defined(__FreeBSD__)
   size_t memAvail = 0;
````

</details>

##### Sphere and cylinder depth on WebGL1 — Picture not compared with a desktop build

`data/shaders/cylinder.fs` and `sphere.fs` write `gl_FragDepthEXT` instead of `gl_FragDepth` in the WebGL build: GLSL ES 1.00 (WebGL1) has only the extension form of the depth output.

**Effect:** The impostor spheres and cylinders compile on WebGL1; the picture was not compared with a desktop build.

**Patch:** `0002-shaders-webgl1-fragdepth-ext.patch`

<details><summary>Show the patch</summary>

````diff
diff --git a/data/shaders/cylinder.fs b/data/shaders/cylinder.fs
index 4ada6fbc..4751067e 100644
--- a/data/shaders/cylinder.fs
+++ b/data/shaders/cylinder.fs
@@ -167,7 +167,11 @@ void main(void)
     if (depth <= 0.0)
       discard;
 
+#ifdef PYMOL_WEBGL_IOS
+    gl_FragDepthEXT = depth;
+#else
     gl_FragDepth = depth;
+#endif
 
   if (!isPicking && lighting_enabled){
     color = ApplyColorEffects(color, depth);
diff --git a/data/shaders/sphere.fs b/data/shaders/sphere.fs
index 4cbec8cf..89bc6bc6 100644
--- a/data/shaders/sphere.fs
+++ b/data/shaders/sphere.fs
@@ -71,7 +71,11 @@ void main(void)
     if (depth <= 0.0 || depth >= 1.0)
       discard;
 
+#ifdef PYMOL_WEBGL_IOS
+    gl_FragDepthEXT = depth;
+#else
     gl_FragDepth = depth;
+#endif
 
     if (!isPicking){
       if (lighting_enabled){
````

</details>

##### Old GL errors no longer drop buffers — Picture not compared with a desktop build

`GLGenBuffer` (`layerGraphics/gl/GLVertexBuffer.cpp`) drains pending `glGetError()` values before `glGenBuffers` (emscripten only). An unrelated earlier GL error made the buffer check fail, so a representation silently lost its vertex buffer and was not drawn.

**Effect:** Representations are drawn instead of disappearing; the picture was not compared with a desktop build.

**Patch:** `0003-glgenbuffer-clear-stale-errors.patch`

<details><summary>Show the patch</summary>

````diff
diff --git a/layerGraphics/gl/GLVertexBuffer.cpp b/layerGraphics/gl/GLVertexBuffer.cpp
index 76305dd4..266183e1 100644
--- a/layerGraphics/gl/GLVertexBuffer.cpp
+++ b/layerGraphics/gl/GLVertexBuffer.cpp
@@ -8,6 +8,10 @@
 
 static bool GLGenBuffer(GLuint& id, GLuint bufferType, pymol::span<const std::byte> data)
 {
+#ifdef __EMSCRIPTEN__
+  // don't let an unrelated, earlier (sticky) GL error abort buffer creation
+  while (glGetError() != GL_NO_ERROR) {}
+#endif
   glGenBuffers(1, &id);
   if (!CheckGLErrorOK(nullptr, "GenericBuffer::genBuffer failed\n"))
     return false;
````

</details>

##### Labels use the label shader — Picture not compared with a desktop build

`RepLabel::render` (`layer2/RepLabel.cpp`) uses the label shader whenever `use_shaders` is on in an OpenGL ES 2 build, without requiring geometry shaders. WebGL has no geometry shaders, and the ES2 fallback draws no text.

**Effect:** Labels are drawn instead of missing; the picture was not compared with a desktop build.

**Patch:** `0004-replabel-es2-use-label-shader.patch`

<details><summary>Show the patch</summary>

````diff
diff --git a/layer2/RepLabel.cpp b/layer2/RepLabel.cpp
index 9740ab91..9f88db99 100644
--- a/layer2/RepLabel.cpp
+++ b/layer2/RepLabel.cpp
@@ -1737,8 +1737,13 @@ void RepLabel::render(RenderInfo* info)
     RepLabelPick(I, info);
     return;
   }
+#ifdef PURE_OPENGL_ES_2
+  // the label shader needs no geometry shader; the ES2 immediate path draws no text
+  auto use_shader = SettingGet<bool>(G, cSetting_use_shaders);
+#else
   auto use_shader = SettingGet<bool>(G, cSetting_use_shaders) &&
                     G->ShaderMgr->GeometryShadersPresent();
+#endif
 
   if (!use_shader) {
     RepLabelRenderImmediate(I, info);
````

</details>

##### Shaders rewritten to GLSL ES 3.00 — Picture not compared with a desktop build

On a WebGL2 context, `glShaderSource1String` (`layer0/ShaderMgr.cpp`) rewrites each ES2 shader before compiling: `#version` and `#extension` lines go, `texture2D(` / `textureCube(` become `texture(`, `attribute` becomes `in`, `varying` becomes `out` in a vertex shader and `in` in a fragment shader, `gl_FragColor` becomes a declared output, `gl_FragDepthEXT` becomes `gl_FragDepth`, and `#version 300 es` is added. WebGL2 refuses the `GL_EXT_frag_depth` extension in GLSL ES 1.00 shaders.

**Effect:** The shader programs change, the drawing logic does not; the picture was not compared with a desktop build.

**Patch:** `0005-shadermgr-webgl2-glsl-es300.patch`

<details><summary>Show the patch</summary>

````diff
diff --git a/layer0/ShaderMgr.cpp b/layer0/ShaderMgr.cpp
index 6ac9fc1f..b41ad2b7 100644
--- a/layer0/ShaderMgr.cpp
+++ b/layer0/ShaderMgr.cpp
@@ -89,8 +89,46 @@ Z* -------------------------------------------------------------------
   } \
 }
 
+#ifdef __EMSCRIPTEN__
+#include <regex>
+/**
+ * WebGL2 rejects GL_EXT_frag_depth in GLSL ES 1.00 shaders, so on a WebGL2
+ * context rewrite PyMOL's ES2 shaders to GLSL ES 3.00 (pymolweb spike).
+ */
+static std::string pymolweb_to_es300(GLuint shad, const std::string& src)
+{
+  static int is_es3 = -1;
+  if (is_es3 < 0) {
+    auto v = (const char*) glGetString(GL_VERSION);
+    is_es3 = v && std::strstr(v, "OpenGL ES 3") ? 1 : 0;
+  }
+  if (!is_es3)
+    return src;
+  GLint type = 0;
+  glGetShaderiv(shad, GL_SHADER_TYPE, &type);
+  bool frag = (type == GL_FRAGMENT_SHADER);
+  std::string s = std::regex_replace(src, std::regex(R"(^[ \t]*#(version|extension)[^\n]*)", std::regex::multiline), "");
+  s = std::regex_replace(s, std::regex(R"(^[ \t]*#define[ \t]+texture[ \t]+texture2D[^\n]*)", std::regex::multiline), "");
+  s = std::regex_replace(s, std::regex(R"(\btexture2D\s*\()"), "texture(");
+  s = std::regex_replace(s, std::regex(R"(\btextureCube\s*\()"), "texture(");
+  s = std::regex_replace(s, std::regex(R"(\bvarying\b)"), frag ? "in" : "out");
+  if (frag) {
+    s = std::regex_replace(s, std::regex(R"(\bgl_FragColor\b|\bgl_FragData\s*\[\s*0\s*\])"), "pymolweb_FragColor");
+    s = std::regex_replace(s, std::regex(R"(\bgl_FragDepthEXT\b)"), "gl_FragDepth");
+    return "#version 300 es\nprecision highp float;\nout vec4 pymolweb_FragColor;\n" + s;
+  }
+  s = std::regex_replace(s, std::regex(R"(\battribute\b)"), "in");
+  return "#version 300 es\n" + s;
+}
+#endif
+
 static void glShaderSource1String(GLuint shad, const std::string &strobj){
+#ifdef __EMSCRIPTEN__
+  std::string conv = pymolweb_to_es300(shad, strobj);
+  const GLchar *str = (const GLchar *)conv.c_str();
+#else
   const GLchar *str = (const GLchar *)strobj.c_str();
+#endif
   glShaderSource(shad, 1, (const GLchar **)&str, nullptr);
 }
 
````

</details>

##### Built for the OpenGL ES 2 path — Picture not compared with a desktop build

`compile.sh` compiles with `-DPURE_OPENGL_ES_2 -DGL_GLEXT_PROTOTYPES -D_PYMOL_NO_MAIN` plus libpng, FreeType and numpy support, at `-O2`, and `link.sh` links `_cmd` as a Pyodide side module. WebGL is based on OpenGL ES, so the desktop OpenGL path cannot run.

**Effect:** Drawing uses the ES2 code path; a pixel comparison against a desktop build was not made.

##### Shaders compiled once at start-up — Results unchanged (checked)

At start-up the worker builds a throw-away peptide (`cmd.fab('AAAA', '_warm')`), shows cartoon, sticks, surface, spheres and lines, and draws it 10 times. This gets the shaders ready before the first real picture. It then deletes the peptide, draws 3 more times and resets `auto_color_next` to 0. The warm-up was added after a 2026-10-11 test in which cartoon came out black in about half the starts of a clean build. No source names the cause. A later test in Chrome's software renderer (WebGL2 and WebGL1) without the warm-up showed no black picture. The conditions where the black picture was seen (Windows with Direct3D 11, fallback to WebGL1, a real machine) were not tested again.

**Effect:** The object is deleted and the colour cycle reset, so the first structure gets the same carbon colour (green) as on the desktop.

#### Safer reading of files

##### Sessions read through an allow-list — Not available here

`modules/chempy/pkl.py` replaces `pickle.loads`, `pickle._loads` and `chempy.pkl.cPickle.loads` with a `RestrictedUnpickler` that resolves only 18 named globals (e.g. `chempy.Atom`, `numpy._core.multiarray._reconstruct`), refuses persistent IDs and BUILD on a resolved global, and cannot be turned off. A `.pse` file is a pickle, and unpickling can run any function the file names, so a session from someone else could otherwise run code.

**Effect:** Sessions saved by `get_session` open as before; a session holding objects outside the 18 names, or a protocol 0/1 pickle of a plain class, is refused.

**Patch:** `0006-chempy-restricted-unpickler.patch`

<details><summary>Show the patch</summary>

````diff
diff --git a/modules/chempy/pkl.py b/modules/chempy/pkl.py
index aed58aa..75e541a 100644
--- a/modules/chempy/pkl.py
+++ b/modules/chempy/pkl.py
@@ -49,6 +49,169 @@ if True:
     pickle._Pickler.dispatch[str] = save_str
     pickle._Pickler.dispatch[bytes] = save_str
 
+    # Restricted unpickler for session files.
+    #
+    # A session can come from another user, so session data is unpickled only
+    # by an unpickler whose find_class resolves RESTRICTED_GLOBALS and nothing
+    # else. It replaces cPickle.loads below and the stdlib pickle.loads and
+    # pickle._loads (the C++ session restore calls the stdlib one), and no
+    # setting, argument or message turns it off.
+    # cPickle.load (a file) is left alone on purpose: it reads the bundled,
+    # trusted fragments and mutagenesis data. Untrusted .pkl / model input is
+    # refused before it reaches cPickle.load by the viewer's own load checks,
+    # not by this patch.
+
+    import _compat_pickle
+    import copyreg
+    import io as _io
+    import sys as _sys
+
+    # (module, name) pairs a session needs: measured on real sessions, and on
+    # PyMOL 2.x-era names after the _compat_pickle mapping below.
+    RESTRICTED_GLOBALS = frozenset([
+        ('pymol', 'Session_Storage'),
+        ('_codecs', 'encode'),
+        ('chempy', 'Storage'),
+        ('chempy', 'Atom'),
+        ('chempy', 'Bond'),
+        ('chempy.models', 'Indexed'),
+        ('chempy.models', 'Connected'),
+        ('builtins', 'bytearray'),
+        ('builtins', 'bytes'),
+        ('builtins', 'complex'),
+        ('collections', 'OrderedDict'),
+        ('copyreg', '_reconstructor'),
+        ('numpy', 'dtype'),
+        ('numpy', 'ndarray'),
+        ('numpy.core.multiarray', '_reconstruct'),
+        ('numpy._core.multiarray', '_reconstruct'),
+        ('numpy._core.multiarray', 'scalar'),
+        ('numpy.core.multiarray', 'scalar'),
+    ])
+
+    # Names that are allowed to be RESOLVED (so a reconstructor can take them as
+    # an argument) but must never be the callable a pickle invokes directly:
+    # called directly, numpy.ndarray is not safe on session data. A legitimate
+    # array never calls ndarray directly: it calls
+    # numpy._core.multiarray._reconstruct(ndarray, shape, dtype) and then BUILD,
+    # so ndarray appears only as _reconstruct's first argument, never reduced.
+    # Matched by (module, qualname); the object here is always one find_class
+    # already resolved from RESTRICTED_GLOBALS, so these attributes are genuine.
+    _NEVER_CALLED_DIRECTLY = frozenset([
+        ('numpy', 'ndarray'),
+    ])
+
+    class RestrictedUnpickler(pickle._Unpickler):
+        '''
+        The Python-implementation unpickler (so the string decoding above
+        still applies), refusing every global outside RESTRICTED_GLOBALS.
+        '''
+
+        def __init__(self, *args, **kwargs):
+            super().__init__(*args, **kwargs)
+            self._globals_handed_out = []
+
+        def find_class(self, module, name):
+            _sys.audit('pickle.find_class', module, name)
+            # Map PyMOL 2.x-era names (__builtin__.bytearray,
+            # copy_reg._reconstructor) with _compat_pickle, THEN check the
+            # allow-list: checking the as-written name refuses legitimate old
+            # sessions, and a mapped name is held to the same list. (stdlib
+            # find_class maps only for proto < 3 and when fix_imports is set;
+            # this maps for every proto < 4, which is wider but still ends at
+            # the same 18-name check.)
+            if self.proto < 4:
+                if (module, name) in _compat_pickle.NAME_MAPPING:
+                    module, name = _compat_pickle.NAME_MAPPING[(module, name)]
+                elif module in _compat_pickle.IMPORT_MAPPING:
+                    module = _compat_pickle.IMPORT_MAPPING[module]
+            if (module, name) not in RESTRICTED_GLOBALS:
+                raise pickle.UnpicklingError(
+                    'PyMOL session refused: global %s.%s is not allowed'
+                    % (module, name))
+            # One plain attribute of an imported module, never the dotted
+            # walk pickle._Unpickler.find_class does from protocol 4 on.
+            __import__(module, level=0)
+            obj = getattr(_sys.modules[module], name)
+            self._globals_handed_out.append(obj)
+            return obj
+
+        def get_extension(self, code):
+            # Skips pickle's process-wide _extension_cache: an entry another
+            # unpickler cached would come back without passing find_class.
+            key = copyreg._inverted_registry.get(code)
+            if not key:
+                raise pickle.UnpicklingError(
+                    'PyMOL session refused: unregistered extension code %r'
+                    % (code,))
+            self.append(self.find_class(*key))
+
+        def persistent_load(self, pid):
+            raise pickle.UnpicklingError(
+                'PyMOL session refused: persistent IDs are not allowed')
+
+        def load_build(self):
+            # BUILD sets attributes on the object under the state. On a class
+            # or function find_class handed out, that would rewrite it for
+            # the whole process.
+            stack = self.stack
+            if len(stack) >= 2 and any(stack[-2] is obj
+                                       for obj in self._globals_handed_out):
+                raise pickle.UnpicklingError(
+                    'PyMOL session refused: BUILD on a global object')
+            pickle._Unpickler.load_build(self)
+
+        def _refuse_direct_call(self, func):
+            module = getattr(func, '__module__', None)
+            qualname = getattr(func, '__qualname__', None) \
+                or getattr(func, '__name__', None)
+            if (module, qualname) in _NEVER_CALLED_DIRECTLY:
+                raise pickle.UnpicklingError(
+                    'PyMOL session refused: %s.%s may only be an argument to a '
+                    'reconstructor, not called directly' % (module, qualname))
+
+        def load_reduce(self):
+            # Stack at entry: [..., func, argtuple].
+            self._refuse_direct_call(self.stack[-2])
+            pickle._Unpickler.load_reduce(self)
+
+        def load_newobj(self):
+            # Stack at entry: [..., cls, argtuple]. cls.__new__(cls, *args)
+            # reaches the same C constructor as a direct call.
+            self._refuse_direct_call(self.stack[-2])
+            pickle._Unpickler.load_newobj(self)
+
+        def load_newobj_ex(self):
+            # Stack at entry: [..., cls, argtuple, kwargdict].
+            self._refuse_direct_call(self.stack[-3])
+            pickle._Unpickler.load_newobj_ex(self)
+
+        def _instantiate(self, klass, args):
+            # INST / OBJ (protocol 0/1) both call klass(*args) through here.
+            self._refuse_direct_call(klass)
+            return pickle._Unpickler._instantiate(self, klass, args)
+
+        dispatch = dict(pickle._Unpickler.dispatch)
+        dispatch[pickle.BUILD[0]] = load_build
+        dispatch[pickle.REDUCE[0]] = load_reduce
+        dispatch[pickle.NEWOBJ[0]] = load_newobj
+        dispatch[pickle.NEWOBJ_EX[0]] = load_newobj_ex
+
+    def restricted_loads(s, /, *, fix_imports=True, encoding="ASCII",
+                         errors="strict", buffers=None):
+        '''
+        Drop-in for pickle.loads and pickle._loads that unpickles with
+        RestrictedUnpickler.
+        '''
+        if isinstance(s, str):
+            raise TypeError("Can't load pickle from unicode string")
+        return RestrictedUnpickler(_io.BytesIO(s), fix_imports=fix_imports,
+                                   buffers=buffers, encoding=encoding,
+                                   errors=errors).load()
+
+    pickle.loads = restricted_loads
+    pickle._loads = restricted_loads
+
     class cPickle:
         dumps = pickle.dumps
         dump = pickle.dump
@@ -57,7 +220,7 @@ if True:
         def loads(s):
             if not isinstance(s, bytes):
                 s = s.encode(errors='ignore')
-            return pickle._loads(s)
+            return restricted_loads(s)
 
         @classmethod
         def configure_legacy_dump(cls, py2=False):
````

</details>

##### A failed PNG read builds no image — The picture can differ

`MyPNGRead` (`layer0/MyPNG.cpp`) starts width and height at 0, builds the image only when the read succeeded, checks a data URI's length and every read against the bytes left, and refuses a size whose byte count does not fit `size_t` / `int` before allocating.

**Effect:** Valid PNGs read as before. A ray trace with a broken background image draws without it. In `load_png`, a file that is not a PNG, a cut-off PNG, or a data URI that is short, cut off or not valid base64 raises an error.

**Patch:** `0011-mypng-failed-read-builds-no-image.patch`

<details><summary>Show the patch</summary>

````diff
--- a/layer0/MyPNG.cpp
+++ b/layer0/MyPNG.cpp
@@ -17,6 +17,9 @@
 #include"MemoryDebug.h"
 #include"pymol/memory.h"
 
+#include <climits>
+#include <cstdint>
+
 
 /* backwards compatibility */
 
@@ -76,7 +79,8 @@
   44,  45,  46,  47,  48,  49,  50,  51};
 
 static unsigned char *base64_decode(const char *data,
-				    size_t input_length=0) {
+				    size_t input_length=0,
+				    size_t *output_length=nullptr) {
   unsigned char *decoded_data = nullptr;
   unsigned int triple;
   unsigned int i = 0, j = 0, k;
@@ -103,6 +107,8 @@
       decoded_data[j++] = (triple >> (--k) * 8) & 0xFF;
   }
 
+  if (output_length)
+    *output_length = j;
   return decoded_data;
 
 ok_except1:
@@ -113,6 +119,7 @@
 typedef struct {
   unsigned char *c; // moving pointer
   unsigned char *h; // for freeing
+  size_t n;         // bytes left at c
 } uchar2p;
 
 #ifdef _PYMOL_LIBPNG
@@ -129,6 +136,10 @@
   if(!io_ptr)
     return;
 
+  if(byteCountToRead > io_ptr->n)
+    png_error(png_ptr, "PNG data ends early");
+  io_ptr->n -= byteCountToRead;
+
   while(byteCountToRead--) {
     *(outBytes++) = *(io_ptr->c++);
   }
@@ -375,8 +386,8 @@
   png_byte *pix_ptr = nullptr;
   png_uint_32 row_bytes = 0;
 
-  png_uint_32 width;
-  png_uint_32 height;
+  png_uint_32 width = 0;
+  png_uint_32 height = 0;
   int bit_depth;
   int color_type;
   int row, col;
@@ -384,16 +395,21 @@
   int i;
   int ok = true;
   double file_gamma;
-  uchar2p data = {NULL, nullptr};
+  uchar2p data = {NULL, nullptr, 0};
 
   if(!file_name)
     return nullptr;
 
   if(!strncmp(file_name, "data:image/png;base64,", 22)) {
     const char *base64str = file_name + 22;
-    data.h = data.c = base64_decode(base64str);
-    memcpy(buf, data.c, 8);
-    data.c += 8;
+    data.h = data.c = base64_decode(base64str, 0, &data.n);
+    if(!data.c || data.n < 8) {
+      ok = false;
+    } else {
+      memcpy(buf, data.c, 8);
+      data.c += 8;
+      data.n -= 8;
+    }
 
   } else {
     png_file = pymol_fopen(file_name, "rb");
@@ -469,7 +485,17 @@
 
     /* row_bytes is the width x number of channels x (bit-depth / 8) */
     row_bytes = png_get_rowbytes(png_ptr, info_ptr);
-    if((png_pixels = (png_byte *) malloc(row_bytes * height * sizeof(png_byte))) == nullptr) {
+    /* Refuse, before allocating, a size whose byte counts do not fit:
+     * row_bytes * height and the row pointers in size_t (32-bit on
+     * wasm32), and the Image below (width * height pixels of 4 bytes,
+     * counted in int). A check on arithmetic only, not a size cap: what
+     * fits is still tried. */
+    if((uint64_t) row_bytes * height > SIZE_MAX ||
+       (uint64_t) height * sizeof(png_bytep) > SIZE_MAX ||
+       (uint64_t) width * height > INT_MAX ||
+       (uint64_t) width * height * 4 > SIZE_MAX) {
+      ok = false;
+    } else if((png_pixels = (png_byte *) malloc((size_t) row_bytes * height)) == nullptr) {
       ok = false;
     }
   }
@@ -488,7 +514,7 @@
 
     /* set the individual row_pointers to point at the correct offsets */
     for(i = 0; i < ((signed) height); i++)
-      row_pointers[i] = png_pixels + i * row_bytes;
+      row_pointers[i] = png_pixels + (size_t) i * row_bytes;
 
     /* now we can go ahead and just read the whole image */
     png_read_image(png_ptr, row_pointers);
@@ -497,8 +523,8 @@
     png_read_end(png_ptr, info_ptr);
   }
 
-  img = std::make_unique<pymol::Image>(width, height);
   if(ok) {
+    img = std::make_unique<pymol::Image>(width, height);
     auto p = img->bits();
     for(row = 0; row < (signed) height; row++) {
       pix_ptr = row_pointers[(height - 1) - row];
````

</details>

##### Pickle and script formats refused — Not available here

The worker wraps `cmd.load`, the `load` command and `cmd.load_raw` to refuse the formats `pkl`, `model`, `brick`, `callback`, `cgo`, `cc1`, `cc2`, `py`, `pml` and `pym`, given by name or number. `cmd.load` and the `load` command also refuse files ending in `.pkl`, `.pkla`, `.pickle`, `.model`, `.brick`, `.cc1`, `.cc2`, `.py`, `.pml` or `.pym`, also under `.gz` / `.bz2`. A wrapper on `pymol.internal._load` refuses `model`, `brick`, `callback` and `cgo`, however it is reached. Most of these formats reach the unrestricted pickle loader or run code from the file. `cc1` and `cc2` are refused because the viewer never needs them.

**Effect:** Such files cannot be opened, and Python scripts or `.pml` command scripts cannot be run from a file.

##### Sessions open without movie and wizard — Not available here

A `.pse` is read through the restricted unpickler (a `session_compression 1` file through the same path), and its `movie` and `wizard` entries are removed before `cmd.set_session`: a stored wizard is a nested pickle, and a movie command can run Python on playback.

**Effect:** Structures, representations, colours, views and scenes are restored; a session's movie program and active wizard are not.

#### Faster or smaller

##### Opaque surfaces are not re-sorted — The picture can differ

In `layer2/RepSurface.cpp` (two places) an empty per-vertex alpha array is treated as no array, so the transparency test no longer fires for an opaque surface. `std::vector::clear()` keeps its pointer, so every opaque surface was sorted triangle by triangle and re-uploaded on every frame. Rotating the opaque surface of 1AON, the worker's CPU time per frame went from about 12 ms to 0.6 ms.

**Effect:** With `transparency_global_sort 1` opaque surfaces now appear (they vanished before); with `pick_surface 1` a click on a patch border can pick the neighbouring atom; with default settings a few pixels at surface edges can change: 1 pixel (by 20/255) on a real GPU, 3–9 pixels (by up to 78/255) in a software renderer.

**Patch:** `0008-repsurface-empty-va-is-null.patch`

<details><summary>Show the patch</summary>

````diff
--- a/layer2/RepSurface.cpp
+++ b/layer2/RepSurface.cpp
@@ -266,7 +266,7 @@
   float* v = I->V.data();
   float* vn = I->VN.data();
   float* vc = I->VC.data();
-  float* va = I->VA.data();
+  float* va = I->VA.empty() ? nullptr : I->VA.data();
   int* t = I->T.data();
   int* s = I->S.data();
   int c = I->N;
@@ -1577,7 +1577,7 @@
   float* v = I->V.data();
   float* vn = I->VN.data();
   float* vc = I->VC.data();
-  float* va = I->VA.data();
+  float* va = I->VA.empty() ? nullptr : I->VA.data();
   int* rc = I->RC.data();
   int* t = I->T.data();
   int* s = I->S.data();
````

</details>

##### FreeType loads four modules only — Results unchanged (checked)

`TypeInit` (`layer1/TypeFace.cpp`) builds the FreeType library with `FT_New_Library` and adds only autofit, truetype, sfnt and smooth, instead of every module: only embedded TrueType fonts are ever read.

**Effect:** `_cmd` is 315 KB smaller; ray-traced and WebGL labels were checked to be pixel-identical before and after.

**Patch:** `0007-typeface-truetype-modules-only.patch`

<details><summary>Show the patch</summary>

````diff
--- a/layer1/TypeFace.cpp
+++ b/layer1/TypeFace.cpp
@@ -24,6 +24,28 @@
 
 #include <ft2build.h>
 #include FT_FREETYPE_H
+#include FT_MODULE_H
+#include <cstdlib>
+
+/* Only the four FreeType modules the built-in TrueType fonts use.
+ * FT_Init_FreeType registers every module in ftmodule.h (Type 1, CFF, CID,
+ * PFR, Type 42, WinFNT, PCF, BDF, psaux, psnames, pshinter, raster1, sdf,
+ * svg), which keeps all of them in the link. The driver / renderer classes
+ * start with an FT_Module_Class; FreeType's own ftinit.c takes their
+ * addresses as FT_Module_Class pointers in the same way. */
+extern "C" {
+extern const FT_Module_Class autofit_module_class;
+extern const FT_Module_Class tt_driver_class;
+extern const FT_Module_Class sfnt_module_class;
+extern const FT_Module_Class ft_smooth_renderer_class;
+}
+static void* TypeFTAlloc(FT_Memory, long size) { return malloc(size); }
+static void TypeFTFree(FT_Memory, void* block) { free(block); }
+static void* TypeFTRealloc(FT_Memory, long, long new_size, void* block)
+{
+  return realloc(block, new_size);
+}
+static FT_MemoryRec_ TypeFTMemory = {nullptr, TypeFTAlloc, TypeFTFree, TypeFTRealloc};
 
 struct _CType {
   FT_Library library;
@@ -130,7 +152,18 @@
 {
   CType *I;
   if((I = (G->Type = pymol::calloc<CType>(1)))) {
-    FT_Error error = FT_Init_FreeType(&I->library);
+    /* same order as ftmodule.h: autofit, truetype, sfnt, smooth */
+    FT_Error error = FT_New_Library(&TypeFTMemory, &I->library);
+    if(!error)
+      error = FT_Add_Module(I->library, &autofit_module_class);
+    if(!error)
+      error = FT_Add_Module(I->library, &tt_driver_class);
+    if(!error)
+      error = FT_Add_Module(I->library, &sfnt_module_class);
+    if(!error)
+      error = FT_Add_Module(I->library, &ft_smooth_renderer_class);
+    if(!error)
+      FT_Set_Default_Properties(I->library);
     return !error;
   }
   return 0;
@@ -139,7 +172,7 @@
 void TypeFree(PyMOLGlobals * G)
 {
   CType *I = G->Type;
-  FT_Done_FreeType(I->library);
+  FT_Done_Library(I->library);
   FreeP(G->Type);
 }
 
````

</details>

##### Faster neighbour lists and surface start — Results unchanged (checked)

`MapSetupExpress` (`layer0/Map.cpp`) counts the points around each cell first and allocates the neighbour list once at its exact size instead of growing a vector, and clears it on an interrupt; in `layer0/Triangle.cpp` a loop-invariant test moves out of the surface start search. Rewritten from the idea in pymolish-studio (commits 3e4218d, 3f91dbe); no code was taken.

**Effect:** Surface building is 15–45 % faster; 513 results that use the map (bonds, distance selections, dss, h_add, areas, surfaces, maps) on four structures were identical, and so were 330,000 random cases of the rewritten function run natively against the original code.

**Source:** <https://github.com/adrian-jasinski/pymolish-studio>

**Patch:** `0009-map-express-two-pass-triangle-start.patch`

<details><summary>Show the patch</summary>

````diff
--- a/layer0/Map.cpp
+++ b/layer0/Map.cpp
@@ -453,78 +453,104 @@
 }
 
 int MapSetupExpress(MapType* I)
-{ /* setup a list of neighbors for each square */
+{
+  /* For every cell, EList gets the points of the 27 cells around it (the cell
+   * itself included): the cells in d, e, f order (f fastest), the points of
+   * one cell in Head/Link order, then -1. EHead holds where that list starts;
+   * 0 means no point is near the cell (EList[0] is never a start).
+   *
+   * Three passes: count the points of every cell that is read, give each cell
+   * its start from the counts of its 27 cells, then allocate EList once at its
+   * final size and write the lists into it. */
   PyMOLGlobals* G = I->G;
-  int n = 0;
-  int c, d, e, f, i, cm1, cp2, D1D2 = I->D1D2, D2 = I->Dim[2];
-  int mx2 = I->iMax[2];
-  int* link = I->Link.data();
-  int st, flag;
-  int *i_ptr3, *i_ptr4, *i_ptr5;
-  int mx0 = I->iMax[0], mx1 = I->iMax[1], a, am1, ap2, *i_ptr1, b, bm1, bp2,
-      *i_ptr2;
-  int ok = true;
+  const int D1D2 = I->D1D2, D2 = I->Dim[2];
+  const int* head = I->Head.data();
+  const int* link = I->Link.data();
 
   PRINTFD(G, FB_Map)
   " MapSetupExpress-Debug: entered.\n" ENDFD;
 
   auto mapSize = I->Dim[0] * I->Dim[1] * I->Dim[2];
   I->EHead.assign(mapSize, 0);
-  std::vector<int> e_list;
-  e_list.reserve(1000);
+  int* ehead = I->EHead.data();
 
-  e_list.push_back(0);
-  n = 1;
-  for (a = (I->iMin[0] - 1); ok && a <= mx0; a++) {
-    am1 = a - 1;
-    ap2 = a + 2;
-    i_ptr1 = I->Head.data() + am1 * D1D2;
-    for (b = (I->iMin[1] - 1); ok && b <= mx1; b++) {
-      bm1 = b - 1;
-      bp2 = b + 2;
-      i_ptr2 = i_ptr1 + bm1 * D2;
-      for (c = (I->iMin[2] - 1); ok && c <= mx2; c++) {
-        st = n;
-        cm1 = c - 1;
-        cp2 = c + 2;
-        flag = false;
-        i_ptr5 = (i_ptr4 = (i_ptr3 = i_ptr2 + cm1));
-
-        for (d = am1; ok && d < ap2; d++) {
-          for (e = bm1; ok && e < bp2; e++) {
-            for (f = cm1; ok && f < cp2; f++) {
-              /*i=*MapFirst(I,d,e,f); */
-              if ((i = *(i_ptr5++)) >= 0) {
-                flag = true;
-                do {
-                  e_list.push_back(i);
-                  n++;
-                  /*i=MapNext(I,i); */
-                } while (ok && (i = link[i]) >= 0);
-              }
-              ok &= !G->Interrupt;
+  /* cells that get a list; the cells read reach one further on every side */
+  const int a0 = I->iMin[0] - 1, a1 = I->iMax[0];
+  const int b0 = I->iMin[1] - 1, b1 = I->iMax[1];
+  const int c0 = I->iMin[2] - 1, c1 = I->iMax[2];
+  const bool any_cell = (a0 <= a1) && (b0 <= b1) && (c0 <= c1);
+
+  int n = 1; /* size of EList: slot 0 plus every list and its -1 */
+
+  std::vector<int> count;
+  if (any_cell) {
+    /* pass 1: number of points in each cell that is read */
+    count.assign(mapSize, 0);
+    for (int d = a0 - 1; d <= a1 + 1; d++) {
+      for (int e = b0 - 1; e <= b1 + 1; e++) {
+        for (int f = c0 - 1; f <= c1 + 1; f++) {
+          const int cell = d * D1D2 + e * D2 + f;
+          int k = 0;
+          for (int i = head[cell]; i >= 0; i = link[i])
+            k++;
+          count[cell] = k;
+        }
+      }
+    }
+
+    /* pass 2: a cell with points around it gets the next free start */
+    for (int a = a0; a <= a1; a++) {
+      for (int b = b0; b <= b1; b++) {
+        for (int c = c0; c <= c1; c++) {
+          int total = 0;
+          for (int d = a - 1; d <= a + 1; d++) {
+            for (int e = b - 1; e <= b + 1; e++) {
+              const int* row = count.data() + d * D1D2 + e * D2 + c;
+              total += row[-1] + row[0] + row[1];
             }
-            if (ok)
-              i_ptr5 = (i_ptr4 += D2);
           }
-          if (ok)
-            i_ptr5 = (i_ptr4 = (i_ptr3 += D1D2));
+          if (total) {
+            ehead[a * D1D2 + b * D2 + c] = n;
+            n += total + 1;
+          }
         }
-        if (ok) {
-          if (flag) {
-            *(MapEStart(I, a, b, c)) = st;
-            e_list.push_back(-1);
-            n++;
-          } else {
-            *(MapEStart(I, a, b, c)) = 0;
+      }
+    }
+  }
+
+  /* pass 3: allocate once, then write each list at its start */
+  std::vector<int> e_list(n, 0);
+  if (any_cell) {
+    for (int a = a0; a <= a1; a++) {
+      for (int b = b0; b <= b1; b++) {
+        for (int c = c0; c <= c1; c++) {
+          const int start = ehead[a * D1D2 + b * D2 + c];
+          if (!start)
+            continue;
+          int* p = e_list.data() + start;
+          for (int d = a - 1; d <= a + 1; d++) {
+            for (int e = b - 1; e <= b + 1; e++) {
+              for (int f = c - 1; f <= c + 1; f++) {
+                for (int i = head[d * D1D2 + e * D2 + f]; i >= 0; i = link[i])
+                  *(p++) = i;
+              }
+            }
           }
+          *p = -1;
         }
       }
     }
   }
+
+  /* The flag is looked at only when there were cells to visit, as before.
+   * When it is set, nothing is kept: EList stays as it was and EHead goes back
+   * to all 0, so a caller that ignores the return value (MapEIter among them)
+   * finds no neighbours instead of starts into a list that was never stored. */
+  int ok = !(any_cell && G->Interrupt);
   if (ok) {
     I->EList = std::move(e_list);
-    I->EList.shrink_to_fit();
+  } else {
+    I->EHead.assign(mapSize, 0);
   }
   PRINTFD(G, FB_Map)
   " MapSetupExpress-Debug: leaving...n=%d\n", n ENDFD;
--- a/layer0/Triangle.cpp
+++ b/layer0/Triangle.cpp
@@ -1642,7 +1642,10 @@
       minDist2 = I->maxEdgeLenSq;
 
       for(a = 0; a < n; a++) {
-        if(!I->edgeStatus[a]) {
+        /* Only a vertex whose vertActive is -1 can start a triangle here.
+           Nothing in this loop body writes vertActive, so the test is made
+           once per vertex instead of once per neighbour. */
+        if(!I->edgeStatus[a] && I->vertActive[a] == -1) {
           v0 = v + a * 3;
           n0 = vn + 3 * a;
 
@@ -1655,16 +1658,15 @@
               if(j != a) {
                 float dif2 = diffsq3f(v + 3 * j, v0);
                 if(dif2 < minDist2)
-                  if(I->vertActive[a] == -1)
-                    if(TriangleEdgeStatus(I, a, j) >= 0) {      /* can we put a triangle here? */
-                      n1 = vn + 3 * j;
-                      if(dot_product3f(n0, n1) > 0.5) { /* start with vertices pointing the same way */
-                        minDist2 = dif2;
-                        i1 = a;
-                        i2 = j;
-                        first_vert_used = first_vert;
-                      }
+                  if(TriangleEdgeStatus(I, a, j) >= 0) {      /* can we put a triangle here? */
+                    n1 = vn + 3 * j;
+                    if(dot_product3f(n0, n1) > 0.5) { /* start with vertices pointing the same way */
+                      minDist2 = dif2;
+                      i1 = a;
+                      i2 = j;
+                      first_vert_used = first_vert;
                     }
+                  }
               }
               j = map->EList[i++];
             }
````

</details>

##### Shader rewrite without `std::regex` — Results unchanged (checked)

Patch 0005's GLSL ES 3.00 rewrite is done with plain string scans in a new `layer0/ShaderEs300.h` instead of `std::regex`, with the same passes in the same order: `<regex>` added size to `_cmd` and time to every shader compile at start-up.

**Effect:** The output is byte-identical to the regex version. Every build compares the two on 130,895 strings, using em++, the shipped toolchain. The strings are every shader with every combination of its preprocessor variables (lighting at its start-up value), each lighting variant on a sample of 32 combinations per file, and adversarial inputs. A one-off run with g++ on the host also compared 519,695 strings, with every combination crossed with every lighting variant: no differences.

**Patch:** `0013-shadermgr-es300-without-regex.patch`

<details><summary>Show the patch</summary>

````diff
--- a/layer0/ShaderMgr.cpp
+++ b/layer0/ShaderMgr.cpp
@@ -90,10 +90,12 @@
 }
 
 #ifdef __EMSCRIPTEN__
-#include <regex>
+#include "ShaderEs300.h"
 /**
  * WebGL2 rejects GL_EXT_frag_depth in GLSL ES 1.00 shaders, so on a WebGL2
  * context rewrite PyMOL's ES2 shaders to GLSL ES 3.00 (pymolweb spike).
+ * The rewrite itself is ShaderEs300.h: plain string scans whose output is
+ * byte-identical to the regular-expression passes they replaced.
  */
 static std::string pymolweb_to_es300(GLuint shad, const std::string& src)
 {
@@ -106,19 +108,7 @@
     return src;
   GLint type = 0;
   glGetShaderiv(shad, GL_SHADER_TYPE, &type);
-  bool frag = (type == GL_FRAGMENT_SHADER);
-  std::string s = std::regex_replace(src, std::regex(R"(^[ \t]*#(version|extension)[^\n]*)", std::regex::multiline), "");
-  s = std::regex_replace(s, std::regex(R"(^[ \t]*#define[ \t]+texture[ \t]+texture2D[^\n]*)", std::regex::multiline), "");
-  s = std::regex_replace(s, std::regex(R"(\btexture2D\s*\()"), "texture(");
-  s = std::regex_replace(s, std::regex(R"(\btextureCube\s*\()"), "texture(");
-  s = std::regex_replace(s, std::regex(R"(\bvarying\b)"), frag ? "in" : "out");
-  if (frag) {
-    s = std::regex_replace(s, std::regex(R"(\bgl_FragColor\b|\bgl_FragData\s*\[\s*0\s*\])"), "pymolweb_FragColor");
-    s = std::regex_replace(s, std::regex(R"(\bgl_FragDepthEXT\b)"), "gl_FragDepth");
-    return "#version 300 es\nprecision highp float;\nout vec4 pymolweb_FragColor;\n" + s;
-  }
-  s = std::regex_replace(s, std::regex(R"(\battribute\b)"), "in");
-  return "#version 300 es\n" + s;
+  return pymolweb_es300_rewrite(src, type == GL_FRAGMENT_SHADER);
 }
 #endif
 
--- /dev/null
+++ b/layer0/ShaderEs300.h
@@ -0,0 +1,270 @@
+#pragma once
+
+/*
+ * GLSL ES 1.00 -> GLSL ES 3.00 source rewrite for a WebGL2 context, as plain
+ * string scans (no regular-expression library).
+ *
+ * pymolweb_es300_rewrite() returns, for every input, the bytes that patch
+ * 0005's regular-expression version returned (tests/es300_rewrite_test.cpp in
+ * the pymol-wasm build keeps that version and compares the two). It runs the
+ * same passes in the same order, each over the previous pass's output:
+ *
+ *   1. ^[ \t]*#(version|extension)[^\n]*           (multiline) -> ""
+ *   2. ^[ \t]*#define[ \t]+texture[ \t]+texture2D[^\n]*  (multiline) -> ""
+ *   3. \btexture2D\s*\(                                -> "texture("
+ *   4. \btextureCube\s*\(                              -> "texture("
+ *   5. \bvarying\b                                     -> "in" (fragment) / "out"
+ *   fragment shaders:
+ *   6. \bgl_FragColor\b|\bgl_FragData\s*\[\s*0\s*\]   -> "pymolweb_FragColor"
+ *   7. \bgl_FragDepthEXT\b                             -> "gl_FragDepth"
+ *   8. prologue "#version 300 es\nprecision highp float;\nout vec4 pymolweb_FragColor;\n"
+ *   other shaders:
+ *   9. \battribute\b                                   -> "in"
+ *  10. prologue "#version 300 es\n"
+ *
+ * Equivalences relied on (regex_replace with the ECMAScript grammar and the
+ * default flags, as implemented by the toolchain's libc++, global locale "C"):
+ *  - A pass matches against its own input, leftmost first, without overlap: the
+ *    search resumes where the previous match ended, and the anchors below look
+ *    at the input bytes on both sides of a position, matched or not.
+ *  - No pattern can match an empty string, so regex_iterator's empty-match
+ *    step never applies.
+ *  - Multiline '^' holds at offset 0 and right after '\n' or '\r' (libc++
+ *    __is_eol).
+ *  - '\b' holds where exactly one of the two neighbouring bytes is a word byte
+ *    [A-Za-z0-9_]; a position outside the input counts as a non-word byte.
+ *    Bytes >= 0x80 are not word bytes in the "C" locale.
+ *  - '\s' is one of ' ' '\t' '\n' '\v' '\f' '\r' (isspace in the "C" locale).
+ *  - '[^\n]*' is greedy and stops only at '\n' (or the end); it takes '\r' and
+ *    any other byte.
+ *  - At a given offset each pattern has at most one match: every '[ \t]*',
+ *    '[ \t]+' and '\s*' is followed by a literal byte outside its class, and the
+ *    two alternatives of pass 6 differ at their eighth byte ('C' / 'D'). So
+ *    neither the order of alternatives nor backtracking can choose a different
+ *    match, and "match at offset i" is a fixed test on the bytes from i on.
+ *  - The replacement texts contain no '$', so the default format copies them
+ *    verbatim.
+ * Every pass is one left-to-right scan; the test at an offset reads ahead only
+ * over its own keyword and the blank / space run or line rest that follows it
+ * (a run no other keyword's test can reach), so the rewrite is linear in the
+ * input length.
+ */
+
+#include <cstddef>
+#include <string>
+
+namespace pymolweb_es300
+{
+
+// Bits for rewrite_masked(): each one drops one rule (test positive controls).
+enum : unsigned {
+  kSkipVersionExtension = 1u << 0,
+  kSkipDefineTexture = 1u << 1,
+  kSkipTexture2D = 1u << 2,
+  kSkipTextureCube = 1u << 3,
+  kSkipVarying = 1u << 4,
+  kSkipFragColor = 1u << 5,  // first alternative of pass 6
+  kSkipFragData0 = 1u << 6,  // second alternative of pass 6
+  kSkipFragDepthEXT = 1u << 7,
+  kSkipFragPrologue = 1u << 8,
+  kSkipAttribute = 1u << 9,
+  kSkipVertexPrologue = 1u << 10,
+  kRuleCount = 11
+};
+
+inline bool is_word(char c)
+{
+  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
+         (c >= '0' && c <= '9') || c == '_';
+}
+
+inline bool is_space(char c)
+{
+  return c == ' ' || c == '\t' || c == '\n' || c == '\v' || c == '\f' ||
+         c == '\r';
+}
+
+inline bool is_blank(char c) { return c == ' ' || c == '\t'; }
+
+// '\b' at offset i (0 <= i <= s.size())
+inline bool word_boundary(const std::string& s, std::size_t i)
+{
+  bool before = i > 0 && is_word(s[i - 1]);
+  bool after = i < s.size() && is_word(s[i]);
+  return before != after;
+}
+
+// multiline '^' at offset i
+inline bool line_start(const std::string& s, std::size_t i)
+{
+  return i == 0 || s[i - 1] == '\n' || s[i - 1] == '\r';
+}
+
+// s[i, i + n) == lit
+inline bool has(const std::string& s, std::size_t i, const char* lit, std::size_t n)
+{
+  if (i > s.size() || s.size() - i < n)
+    return false;
+  return s.compare(i, n, lit, n) == 0;
+}
+
+inline std::size_t skip_blanks(const std::string& s, std::size_t i)
+{
+  while (i < s.size() && is_blank(s[i]))
+    ++i;
+  return i;
+}
+
+inline std::size_t skip_spaces(const std::string& s, std::size_t i)
+{
+  while (i < s.size() && is_space(s[i]))
+    ++i;
+  return i;
+}
+
+// '[^\n]*' from offset i: the offset of the next '\n', or the end
+inline std::size_t line_rest_end(const std::string& s, std::size_t i)
+{
+  std::size_t e = s.find('\n', i);
+  return e == std::string::npos ? s.size() : e;
+}
+
+// Passes 1 and 2: the end of a matching line directive at offset i, or 0
+// (a match always ends after its '#', so 0 cannot be a match end).
+inline std::size_t match_version_extension(const std::string& s, std::size_t i)
+{
+  if (!line_start(s, i))
+    return 0;
+  std::size_t j = skip_blanks(s, i);
+  if (!has(s, j, "#", 1))
+    return 0;
+  ++j;
+  if (has(s, j, "version", 7))
+    return line_rest_end(s, j + 7);
+  if (has(s, j, "extension", 9))
+    return line_rest_end(s, j + 9);
+  return 0;
+}
+
+inline std::size_t match_define_texture(const std::string& s, std::size_t i)
+{
+  if (!line_start(s, i))
+    return 0;
+  std::size_t j = skip_blanks(s, i);
+  if (!has(s, j, "#define", 7))
+    return 0;
+  std::size_t k = skip_blanks(s, j + 7);
+  if (k == j + 7 || !has(s, k, "texture", 7))
+    return 0;
+  j = k + 7;
+  k = skip_blanks(s, j);
+  if (k == j || !has(s, k, "texture2D", 9))
+    return 0;
+  return line_rest_end(s, k + 9);
+}
+
+// '\b<word>\s*\(' at offset i: the match end, or 0
+inline std::size_t match_call(const std::string& s, std::size_t i, const char* word, std::size_t n)
+{
+  if (!word_boundary(s, i) || !has(s, i, word, n))
+    return 0;
+  std::size_t j = skip_spaces(s, i + n);
+  return has(s, j, "(", 1) ? j + 1 : 0;
+}
+
+// '\b<word>\b' at offset i: the match end, or 0
+inline std::size_t match_word(const std::string& s, std::size_t i, const char* word, std::size_t n)
+{
+  if (!word_boundary(s, i) || !has(s, i, word, n) || !word_boundary(s, i + n))
+    return 0;
+  return i + n;
+}
+
+// '\bgl_FragData\s*\[\s*0\s*\]' at offset i: the match end, or 0
+inline std::size_t match_frag_data0(const std::string& s, std::size_t i)
+{
+  if (!word_boundary(s, i) || !has(s, i, "gl_FragData", 11))
+    return 0;
+  std::size_t j = skip_spaces(s, i + 11);
+  if (!has(s, j, "[", 1))
+    return 0;
+  j = skip_spaces(s, j + 1);
+  if (!has(s, j, "0", 1))
+    return 0;
+  j = skip_spaces(s, j + 1);
+  return has(s, j, "]", 1) ? j + 1 : 0;
+}
+
+// One regex_replace: every leftmost non-overlapping match of `match` -> repl.
+template <typename Match>
+std::string replace_all(const std::string& s, Match match, const char* repl)
+{
+  std::string out;
+  out.reserve(s.size() + 64);
+  std::size_t i = 0;
+  while (i < s.size()) {
+    std::size_t e = match(s, i);
+    if (e) {
+      out += repl;
+      i = e;
+    } else {
+      out += s[i];
+      ++i;
+    }
+  }
+  return out;
+}
+
+inline std::string rewrite_masked(const std::string& src, bool frag, unsigned skip)
+{
+  std::string s = src;
+  if (!(skip & kSkipVersionExtension))
+    s = replace_all(s, match_version_extension, "");
+  if (!(skip & kSkipDefineTexture))
+    s = replace_all(s, match_define_texture, "");
+  if (!(skip & kSkipTexture2D))
+    s = replace_all(s, [](const std::string& t, std::size_t i) {
+      return match_call(t, i, "texture2D", 9);
+    }, "texture(");
+  if (!(skip & kSkipTextureCube))
+    s = replace_all(s, [](const std::string& t, std::size_t i) {
+      return match_call(t, i, "textureCube", 11);
+    }, "texture(");
+  if (!(skip & kSkipVarying))
+    s = replace_all(s, [](const std::string& t, std::size_t i) {
+      return match_word(t, i, "varying", 7);
+    }, frag ? "in" : "out");
+  if (frag) {
+    if ((skip & (kSkipFragColor | kSkipFragData0)) != (kSkipFragColor | kSkipFragData0))
+      s = replace_all(s, [skip](const std::string& t, std::size_t i) {
+        std::size_t e = (skip & kSkipFragColor) ? 0 : match_word(t, i, "gl_FragColor", 12);
+        if (!e && !(skip & kSkipFragData0))
+          e = match_frag_data0(t, i);
+        return e;
+      }, "pymolweb_FragColor");
+    if (!(skip & kSkipFragDepthEXT))
+      s = replace_all(s, [](const std::string& t, std::size_t i) {
+        return match_word(t, i, "gl_FragDepthEXT", 15);
+      }, "gl_FragDepth");
+    if (skip & kSkipFragPrologue)
+      return s;
+    return "#version 300 es\nprecision highp float;\nout vec4 pymolweb_FragColor;\n" + s;
+  }
+  if (!(skip & kSkipAttribute))
+    s = replace_all(s, [](const std::string& t, std::size_t i) {
+      return match_word(t, i, "attribute", 9);
+    }, "in");
+  if (skip & kSkipVertexPrologue)
+    return s;
+  return "#version 300 es\n" + s;
+}
+
+} // namespace pymolweb_es300
+
+/**
+ * GLSL ES 1.00 source -> GLSL ES 3.00 source; `frag` for a fragment shader.
+ */
+inline std::string pymolweb_es300_rewrite(const std::string& src, bool frag)
+{
+  return pymolweb_es300::rewrite_masked(src, frag, 0);
+}
````

</details>

##### Bundled data read with the C unpickler — Results unchanged (checked)

`PKL.fromFile` (`chempy/pkl.py`) reads a file whose real path lies inside `$PYMOL_DATA` (the bundled fragments and side-chain libraries) with Python's C `pickle.load`; every other file is read as before, and sessions still go only through the restricted unpickler (patch 0006). The pure-Python loader made opening the mutagenesis wizard slow.

**Effect:** All 133 bundled pickles load to identical objects on both paths, and the mutagenesis wizard, fragments and `fab` give identical results (checked every build).

**Patch:** `0014-chempy-pkl-bundled-c-unpickler.patch`

<details><summary>Show the patch</summary>

````diff
--- a/modules/chempy/pkl.py
+++ b/modules/chempy/pkl.py
@@ -232,11 +232,42 @@
                 cls.dump = pickle.dump
 
 
+# Bundled data through the C unpickler.
+#
+# PKL.fromFile reads a file under $PYMOL_DATA (the fragments and mutagenesis
+# side-chain libraries the wheel ships) with the stdlib C unpickler, which is
+# much faster than the pure-Python cPickle.load, and every other file with
+# cPickle.load exactly as before. Both are unrestricted file loaders, so no
+# trust boundary moves: session data still goes only through restricted_loads
+# above. The two differ on a protocol < 3 STRING whose bytes are not printable
+# ASCII (C: str or UnicodeDecodeError, _decode_string: bytes); the shipped
+# data is protocol 4 and the build compares both paths on it. A file counts
+# as under $PYMOL_DATA by its real path.
+
+import os as _os
+
+
+def _bundled_file(fname):
+    '''
+    True if fname resolves (symlinks and ".." included) to a path inside the
+    resolved $PYMOL_DATA. False if $PYMOL_DATA is unset or empty, and for a
+    URL (Storage.my_open fetches those).
+    '''
+    data = _os.environ.get('PYMOL_DATA')
+    if not data or '://' in fname:
+        return False
+    data = _os.path.realpath(data)
+    return _os.path.commonpath([data, _os.path.realpath(fname)]) == data
+
+
 class PKL(Storage):
 
     def fromFile(self,fname,**params):
         fp = self.my_open(fname,'rb')
-        result = cPickle.load(fp)
+        if _bundled_file(fname):
+            result = pickle.load(fp)
+        else:
+            result = cPickle.load(fp)
         fp.close()
         return result
 
````

</details>

##### Hidden symbols, one requested export — Speed or size only

Every source file is compiled with `-fvisibility=hidden -fvisibility-inlines-hidden`, and `_cmd` is linked with `-sSIDE_MODULE=2 -sEXPORTED_FUNCTIONS=_PyInit__cmd`, so `PyInit__cmd` is the only export the link asks for. Before, 5,972 exported names and 615 self-imports made the module larger and slower to load. The `_cmd` in this runtime exports 303 names (9 functions; the rest are data addresses) and imports no function that only it provides; every build checks that.

**Effect:** `_cmd` is 800 KB smaller. Total compute time is unchanged, with one exception. In the study, the first ray trace after loading took 4–8 % (35–60 ms) longer in all three rounds. The cause was not found. The second ray trace took the same time.

##### Bundled data re-encoded without loss — Results unchanged (checked)

The 133 bundled fragment and side-chain pickles are rewritten with pickle protocol 4, and `data/pymol/cmyk.png` is re-compressed, its gAMA and tEXt chunks kept: about 160 KB less.

**Effect:** The pickles load to identical objects and `cmyk.png` has identical pixels; after `space cmyk` the colour table is bit-identical (checked every build).

##### Start-up Python shipped precompiled — Not available here

The 68 wheel modules imported at start-up carry `__pycache__/*.pyc` beside their `.py`, and the 167 standard-library start-up modules are shipped as `.pyc` only (`chempy/pkl.py` stays source only): compiling Python source took about half of the worker's start-up time.

**Effect:** Start-up is about 1.3 s shorter; a traceback line inside one of the 167 standard-library start-up modules shows no source text, and `inspect.getsource` fails on their functions. Other standard-library modules keep their source.

##### numpy wheel without build files — Results unchanged (checked)

Pyodide's numpy 2.4.6 wheel ships without 206 members no run reads: type stubs, C headers and sources, static libraries, Cython files, build configuration, the PyInstaller hook, the doc module and pytest's conftest. Every runtime module and licence file is kept byte for byte.

**Effect:** Every module the trimmed wheel keeps imports exactly as from the original (checked every build); the four dropped modules (`numpy._pyinstaller`, its hook, `numpy.conftest` and `numpy.doc.ufuncs`) no longer import. The wheel is 2.57 MB instead of 2.96 MB.

##### numpy unpacked on first use — Speed or size only

The worker removes numpy from the start-up package list and unpacks it the first time anything imports it: menus, the screen and wizards never use numpy, but it was unpacked at every start.

**Effect:** Start-up is about 0.15 s shorter; the first command that needs numpy (e.g. `cmd.get_coords`) pays that time once.

#### Fixes taken from upstream

##### UTF-8 buffer fix from upstream #522 — Results unchanged (checked)

The C++ part of upstream commit bebf5f0644 (5 files: `os_python.h`, `PConv.cpp`, `PConv.h`, `Property.cpp`, `PopUp.cpp`): string buffers are sized by UTF-8 bytes, not by code points, so non-ASCII text (e.g. a Japanese wizard or scene message) no longer overflows them. After the patch these files are byte-identical to upstream master.

**Effect:** Fixes a crash or endless loop on non-ASCII text; to be dropped once the pinned commit includes bebf5f0644.

**Source:** <https://github.com/schrodinger/pymol-open-source/pull/522>

**Patch:** `0010-utf8-byte-lengths-upstream-522.patch`

<details><summary>Show the patch</summary>

````diff
Port of upstream pymol-open-source commit bebf5f0644ff93cceda045d8676cca9e8d088c0d
(PR #522, fixes issue #517): size string buffers by UTF-8 byte length instead of
PyUnicode_GetLength (code points). Only the C++ part (5 files) is taken, verbatim;
the upstream test files under testing/ are left out. After this patch the 5 files
are byte-identical to upstream master's.

diff --git a/layer0/os_python.h b/layer0/os_python.h
index af372db883..c2631ddecd 100644
--- a/layer0/os_python.h
+++ b/layer0/os_python.h
@@ -44,8 +44,6 @@ typedef int PyObject;
 # define PyNumber_Int           PyNumber_Long
 
 # define PyString_Check                 PyUnicode_Check
-# define PyString_Size                  PyUnicode_GetLength
-# define PyString_GET_SIZE              PyUnicode_GetLength
 # define PyString_FromString            PyUnicode_FromString
 # define PyString_FromStringAndSize     PyUnicode_FromStringAndSize
 # define PyString_InternFromString      PyUnicode_InternFromString
diff --git a/layer1/PConv.cpp b/layer1/PConv.cpp
index ed259f8379..4d00f2deb7 100644
--- a/layer1/PConv.cpp
+++ b/layer1/PConv.cpp
@@ -122,10 +122,10 @@ int PConvPyListToStrVLAList(PyObject * obj, char **vla, int *n_str)
     for(i = 0; i < n_st; i++) {
       t = PyList_GetItem(obj, i);
       if(PyString_Check(t)) {
-        l = PyString_Size(t);
+        auto strval = PyString_AsSomeString(t);
+        l = strval.length();
         nn_ch = n_ch + l + 1;
         VLACheck(*vla, char, nn_ch);
-        auto strval = PyString_AsSomeString(t);
         UtilNCopy((*vla) + n_ch, strval.c_str(), l + 1);
         n_ch = nn_ch;
       } else {
@@ -1159,7 +1159,8 @@ int PConvPyListToStringVLA(PyObject * obj, char **vla_ptr)
       for(a = 0; a < l; a++) {
         i = PyList_GetItem(obj, a);
         if(PyString_Check(i)) {
-          ll += PyString_Size(i) + 1;
+          // UTF-8 byte length, not code points (PyUnicode_GetLength)
+          ll += PyString_AsSomeString(i).length() + 1;
         }
       }
       vla = VLAlloc(char, ll);
diff --git a/layer1/PConv.h b/layer1/PConv.h
index e3055d62ab..4a556c83b8 100644
--- a/layer1/PConv.h
+++ b/layer1/PConv.h
@@ -85,7 +85,6 @@ Z* -------------------------------------------------------------------
 #define CPythonVal_New_Float(VAL)                       PyFloat_FromDouble(VAL)
 
 #define CPythonVal_PyFloat_AsDouble(PYOBJECT)            PyFloat_AsDouble(PYOBJECT)
-#define CPythonVal_PyString_Length(PYOBJECT)             PyString_Size(PYOBJECT)
 #define CPythonVal_PConvPyStrToStr                       PConvPyStrToStr
 #define CPythonVal_PConvPyBoolToInt                      PConvPyBoolToInt
 #define CPythonVal_PConvPyFloatToFloat                   PConvPyFloatToFloat
diff --git a/layer1/Property.cpp b/layer1/Property.cpp
index dc91d818ef..024bd0b670 100644
--- a/layer1/Property.cpp
+++ b/layer1/Property.cpp
@@ -726,7 +726,7 @@ int PropertyFromPyList(PyMOLGlobals* G, PyObject* list)
           if (!prop_id)
             prop_id = PropertyGetNewUniqueID(G);
           pVal = CPythonVal_PyList_GetItem(G, val, 0);
-          prop_name_len = CPythonVal_PyString_Length(pVal) + 1;
+          prop_name_len = PyString_AsSomeString(pVal).length() + 1;
           prop_name = pymol::malloc<char>(prop_name_len);
           CPythonVal_PConvPyStrToStr(pVal, prop_name, prop_name_len);
           CPythonVal_Free(pVal);
@@ -752,7 +752,7 @@ int PropertyFromPyList(PyMOLGlobals* G, PyObject* list)
           } break;
           case PropertyType::String: {
             char* prop_value;
-            int prop_value_len = CPythonVal_PyString_Length(propval) + 1;
+            int prop_value_len = PyString_AsSomeString(propval).length() + 1;
             prop_value = pymol::malloc<char>(prop_value_len);
             CPythonVal_PConvPyStrToStr(propval, prop_value, prop_value_len);
             PropertySet(G, prop_id, prop_name, prop_value);
diff --git a/layer4/PopUp.cpp b/layer4/PopUp.cpp
index 0792cdab89..51676a3576 100644
--- a/layer4/PopUp.cpp
+++ b/layer4/PopUp.cpp
@@ -186,9 +186,9 @@ Block *PopUpNew(PyMOLGlobals * G, int x, int y, int last_x, int last_y,
       continue;
     }
     elem = PyList_GetItem(item, 1);
-    l = PyString_Size(elem);
     str = PyString_AsString(elem);
-    cl = l;
+    l = strlen(str);             /* buffer size in UTF-8 bytes */
+    cl = PyUnicode_GetLength(elem); /* display width in code points */
     c = str;
     while(*c) {
       if(TextStartsWithColorCode(c)) {  /* discount the markup */
@@ -214,7 +214,7 @@ Block *PopUpNew(PyMOLGlobals * G, int x, int y, int last_x, int last_y,
     if (PyList_Size(item) > 2) {
       PyObject* command = PyList_GetItem(item, 2);
       if(PyString_Check(command)) {
-	l = PyString_Size(command);
+	l = strlen(PyString_AsString(command));
 	if(l > mx)
 	  mx = l;
       }
````

</details>

### "3Dmol.js" mode: 3Dmol.js 2.5.5

3Dmol.js 2.5.5 (BSD 3-Clause) is embedded unmodified: its `build/3Dmol-min.js` is copied byte for byte and runs as it is. The app adds the following around each viewer, through 3Dmol.js's public functions except where a private one is named:

- **Two fingers move the structure** `twoFingerPan.ts` listens on the viewer's element before 3Dmol.js does. A two-finger gesture that moves more than it spreads is held back from 3Dmol.js. Instead, the app moves the view with the public `translateScene`, scaled as 3Dmol.js scales its own three-finger move: by the viewer-grid ratio read from the private `renderer` (1 for a single viewer). A switch in HELP and in the phone's "View tools" sheet turns 3Dmol.js's own touch controls back on: two fingers zoom, three fingers move.
- **Orthographic view sized like perspective** `orthoFraming.ts` wraps the private `setSlabAndFog` of each viewer instance (not the prototype). 3Dmol.js sizes the orthographic view from the canvas width. Right after it does, the wrapper sizes the view again from the vertical field of view, as in perspective. To do this it reads the private `rotationGroup` and reads and sets the private `camera`. Switching projection then keeps the structure's size at the rotation centre.
- **Depth cue, cross-section and orthographic view** The app's depth controls set fog with the public `enableFog`, a slice with `setSlab` and the projection with `setProjection`. The slice's front cut and thickness are fractions of a depth window based on the diagonal of the molecule's bounding box, which is read with `fitSlab({})` and `getSlab()`; the window does not change as the molecule turns. With the slice on and a surface shown, `sectionCap.ts` can fill the cut face with a shape added through the public `addCustom`. With the controls off, the values written are 3Dmol.js's own: fog from 0.4 to 1.0, the slab `zoomTo()` leaves, and perspective. These settings are not saved with the look.
- **Filled cut face of the surface** A cross-section leaves a hole in the molecular surface. Through it you see the surface's inside wall. `sectionCap.ts` can fill the hole, using only public 3Dmol.js calls. It reads the surface mesh back with `getSurface` and cuts it at the near clipping plane. It joins the cut into outlines, following the approach of UCSF ChimeraX's surface capper (written for this app, not translated from ChimeraX's code), fills them with `earcut` and draws the result with `addCustom`. The cap is rebuilt when the view turns or zooms, or when the cut moves. It is offered only while the app's own scene draws a surface and a cross-section is on. A cut it cannot close cleanly is left open.
- **The app's own toolbar and scene** The toolbar is the app's own. Its styles, colour schemes, protein, ligand and water switches and surface controls set 3Dmol.js styles through `applySceneStyles`. Spin and background call 3Dmol.js's `spin` and `setBackgroundColor`. The first change to a style, colour scheme, switch or surface replaces the display the file opened with by the app's display. In the app's display, a clicked residue is shown in yellow. "Initial view" brings back the opening display and view.
- **Saving and restoring the look** `mol3dLook.ts` records the styles, each atom's colour as a number, the surfaces, the background and the view. `exportedLook3d.ts` applies the styles, surfaces and background again, and the pane restores the view. A look saved in "Includes PyMOL™" mode is drawn in 3Dmol.js styles instead. Recording reads the private `surfaces` table (each surface's style, atoms and opacity) and the private `bgColor`. Labels, measurements, pen lines, the depth cue and cross-section settings, and other models or shapes are not recorded. A look whose atom count does not match the structure is not used.
- **VRML export keeps the live scene** `vrmlExport.ts` notes the private `modelGroup`, each surface's `lastGL` and each shape's `renderedShapeObj` before `exportVRML()` and puts them back afterwards, also when the export fails, so the scene on screen is not disturbed.
- **Recovery from a lost WebGL context** 3Dmol.js is not told when its shared WebGL context is lost. So `viewerRecovery.ts` checks `getRenderer().isLost()` every 2 s while the page is shown. If the context is lost, it calls `resize()` and `render()`, which give the viewer a new context with the same scene and view. A viewer that is replaced or closed is retired: it is cleared, its private resize and intersection observers are disconnected, and its canvas is removed.
- **Fit to width on tall screens** After `zoomTo()`, the view is zoomed out by the width-to-height ratio when the viewer is taller than wide, since 3Dmol.js fits the structure to the height only.
- **Risky names in structure text renamed before 3Dmol.js reads it** `safeModelText.ts` changes only the copy of a file that 3Dmol.js reads. The file that is stored, exported or given to "Includes PyMOL™" mode is not changed. Some text in a file can reach objects that all of the page's scripts share, and that can stop the page. So each name a JavaScript object inherits (such as `__proto__`, `constructor` and `toString`), in any letter case, has its last character changed to `0`. None of 30,000 randomly sampled PDB mmCIF entries holds such a name. In SDF and MOL text, a data item named `3DMOL_STYLE` is renamed, so 3Dmol.js does not take styles from it. No line is added or removed, and no line changes length.
- **MOL2 atoms marked as hetero (`hetflag`)** 3Dmol.js 2.5.5's MOL2 reader sets no `hetflag`, and the app's scene draws `hetflag: false` atoms as polymer and `hetflag: true` atoms as ligands, so a MOL2 file would show nothing. `markHetero` (`localFile.ts`) sets the flag on each MOL2 atom that has none: false when the residue name is on its list of protein and nucleic-acid residues (a trailing number such as `THR1` is ignored), true otherwise. The PDB and mmCIF readers take the flag from the ATOM or HETATM record instead. The MOL2 reader keeps no residue names, so today every MOL2 atom is drawn as a ligand (sticks), with no cartoon.
- **Pen lines on a layer over the view** The pen draws freehand lines on a layer over the 3Dmol.js canvas, not in the 3D scene, so the lines do not turn with the structure. When the view moves, the app says the lines no longer line up. The saved PNG is 3Dmol.js's `pngURI()` with the lines drawn on top, plus a note when they are out of place.

---

PyMOL is a trademark of Schrodinger, LLC. "Includes PyMOL™" mode runs a modified build of Open-Source PyMOL made by AgroDesign Studios, distinct from the products of Schrödinger, LLC.
