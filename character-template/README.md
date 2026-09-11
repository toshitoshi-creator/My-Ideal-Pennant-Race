# CHARACTER CREATION TEMPLATE（PHASE 4.8-B）

**あなたが描いたSVGを、ゲームのキャラクターにするための制作環境です。**

ここには絵は入っていません。枠と目印と道具だけです。
絵はあなたが描きます。

---

## 全体の流れ

```
1. 下書きを作る        npm run character:template
       ↓
2. 描く               character-template/templates/ の1枚を開いて、枠の中に描く
       ↓
3. 置く               src/ui/character/custom/<種類>/ に保存
       ↓
4. 確かめる           npm run character:check
       ↓
5. 見る               npm run character:workshop
       ↓
6. 直す → 3 へ戻る    npm run character:workshop -- --watch なら保存するたび自動
       ↓
7. できあがり         そのままゲームに入っています（登録の作業はありません）
```

---

## 1. 下書きを作る

```bash
npm run character:template
```

`character-template/templates/` に14種類のSVGが出ます。

中身は**基準線と目印だけ**です。

* 赤い線 … その種類で特に大事な基準線
* 灰色の点線 … ほかの基準線
* 青い点 … アンカー（位置の基準点）
* 灰色の破線の楕円 … 頭の**枠**（輪郭の見本ではありません。位置合わせ用です）

下書きはコードから作っています。基準線を変えたらもう一度動かせば揃います。

---

## 2. 描く

テンプレートを Illustrator / Inkscape / Figma / VS Code などで開いて、

```xml
<g data-part="cap_01" data-category="cap" data-label="なまえ">

    <!-- ここに描く -->

</g>
```

この `<g>` の**中**に描きます。外に描いたものは取り込まれません。

守ることは3つだけです。

1. **viewBox を変えない**（`0 0 256 320`）
2. **色を直に書かない**（`fill="token:skin"` のように名前で書く）
3. **位置をずらさない**（基準線の上に描けば、追従は自動）

使える色の名前と、頭だけが持つ指定は [NAMING.md](./NAMING.md) にあります。

### 描画ソフトを使うときの注意

書き出しのときに、ソフトが余計なものを入れることがあります。

* `<image>` … 画像を貼ってしまっています。パスに変換してください
* `<style>` / `class=` … ほかのパーツに影響するので使えません。属性で書いてください
* `<use>` … 参照先がずれるので使えません。実体に展開してください
* `transform="matrix(...)"` … 使えますが、ずれの原因になりやすいので避けてください

検査（`npm run character:check`）が全部指摘します。読めば直せます。

---

## 3. 置く

```
src/ui/character/custom/<種類>/<名前>.svg
```

**フォルダ名が種類**です。`data-category` と揃えてください。

置くだけで入ります。コードを書き足す必要はありません。

---

## 4. 確かめる

```bash
npm run character:check                    # 全部
npm run character:check -- --file 下書き.svg # 置く前に1枚だけ
```

見るのは「ゲームに入れて壊れないか」だけです。
**絵の good / bad は判定しません。** そこはあなたが決めることです。

| 印 | 意味 |
|---|---|
| ○ | 問題なし |
| △ | 入りますが、気になる点があります |
| × | このままでは入りません |

---

## 5. 見る（Character Workshop）

```bash
npm run character:workshop              # 1回だけ
npm run character:workshop -- --watch   # 保存するたび作り直す
```

`character-workshop.html` をブラウザで開いてください。
`--watch` を付けていれば、**開いたまま描き続けられます**（2秒ごとに自動で更新）。

Workshop は1つのパーツにつき3つ並べます。

| 並び | 何を見るか |
|---|---|
| 組み合わせを変える | **いちばん大事。** どの頭に載せても位置が合っているか |
| 実際の大きさ | 一覧の44pxまで小さくして潰れないか |
| ほかのパーツと組む | 24人ぶん。ほかの髪や帽子と喧嘩しないか |

PHASE 4.8-A では、1つめの並びを見て耳・髪・帽子のズレを3つとも見つけました。
**絵を1枚で見て良くても、組み合わせると壊れます。** 必ず並べて見てください。

---

## 6. ゲームに入ったあと

置いた時点で入っています。`npm run dev` で選手を見れば出ます。

### 番号のこと

パーツは「はじめから入っているもの → あなたのもの」の順に並びます。
後ろに足す形なので、**足しても既存の選手の顔は変わりません**。

ただし、その種類のパーツ数が増えるので、
新しく作った選手には新しいパーツが配られるようになります。

### 消したら

消したパーツを使っていた選手は、別のパーツに置き換わります。
**名前（`data-part`）は変えないでください。** 変えると別人になります。

---

## 持ち出しと取り込み（export / import）

### 持ち出す

パーツはただのSVGファイルです。`src/ui/character/custom/` をコピーすれば、
そのまま別の環境へ持っていけます。特別な書き出しは要りません。

```bash
# 例: 作ったパーツだけをまとめる
cp -r src/ui/character/custom ~/my-character-parts
```

### 取り込む

逆に、フォルダごと戻せば入ります。

```bash
cp -r ~/my-character-parts/* src/ui/character/custom/
npm run character:check
```

**取り込む前に必ず検査してください。** 検査は次のものを弾きます。

* `<script>` / イベント属性（`onclick` など）
* `<image>` / 外部URL / `url(...)` / `@import`
* `<style>` / `<use>` / `<foreignObject>`
* viewBox が違うもの
* 色が直に書かれているもの

人からもらったSVGをそのまま入れないでください。
**必ず `npm run character:check` を通してから**にしてください。

### 書き方の見本

`character-template/examples/head_99_placeholder.svg` にあります。

**絵の見本ではありません。** わざと「ただの丸」にしてあります。
ファイルの書き方（viewBox・`data-part`・色の名前・`data-half-width`）だけを見てください。

道具の動きを試したいときは、これを置いてみてください。

```bash
cp character-template/examples/head_99_placeholder.svg src/ui/character/custom/head/
npm run character:check
npm run character:workshop
rm src/ui/character/custom/head/head_99_placeholder.svg   # 試したら消す
```

---

## よくある詰まりかた

| 症状 | 原因 | 直しかた |
|---|---|---|
| Workshop に出ない | フォルダ名と `data-category` が違う | 揃える |
| 「中身が空です」 | `<g data-part>` の外に描いている | 中に移す |
| 髪が浮く / 帽子が食い込む | `data-half-width` が実際の輪郭と違う | 描いた輪郭を測り直す |
| 小さくすると消える | 線が細すぎる | `stroke-width` を 1.5 以上に |
| 色が変わらない | 色を直に書いている | `token:` の名前に置き換える |
| 位置が少しずれる | 自分でずらして描いている | テンプレートの基準線の上に描き直す |

---

## この環境が作らないもの

* **キャラクターの絵**（あなたが描くものです）
* 画像生成AIの呼び出し（このプロジェクトはゲーム実行時にAIを呼びません）
* 外部への通信（描いたSVGはビルド時に同梱されます）
