# WORKFLOW ── 生成から取り込みまで

## STEP 1 前提を読む

`style-bible.md` → `negative-prompt.md` → `canvas.md` の順に読みます。

## STEP 2 生成する

種類ごとのファイル（`01-head.md` など）からプロンプトをそのままコピーします。
同じ種類の中で見分けがつくよう、**1枚ずつ違う指定**で作ります。
プロンプトの末尾にはネガティブを必ず付けます。

## STEP 3 背景を透明にする

生成直後はほぼ必ず背景が付いています。落とします。

```sh
# ImageMagick の例（白背景を透明に）
magick in.png -fuzz 8% -transparent white out.png
```

`npm run assets:validate` はアルファの無い素材を落とします。

## STEP 4 キャンバスに合わせる

```sh
# 1024x1024 で作ったものを 1024x1280 の所定位置へ
magick in.png -background none -gravity north -extent 1024x1280 out.png
```

顔の位置がずれていたら、`-page +x+y` で寄せてから `-flatten` します。

## STEP 5 名前を付けて置く

```
src/assets/players/<dir>/<prefix>_<3桁>.png
例) src/assets/players/base/head_001.png
    src/assets/players/eyes/eye_007.png
    src/assets/players/expressions/expression_happy_002.png
```

`<dir>` と `<prefix>` は `config/visual-assets.json` の `categories` が決めます。
番号は 001 から**飛ばさず連番**。飛ぶと、その番号を引いた選手が SVG に落ちます。

## STEP 6 WebP と縮小版を書き出す

```sh
npm run assets:optimize        # 変換コマンドを表示する
```

出てきた `cwebp` の行をそのまま実行します。
`@small` `@medium` `@large` は必須ではありませんが、
一覧画面で 1024px を読むと重いので、少なくとも `@small` は用意します。

## STEP 7 目録を作る

```sh
npm run assets:manifest
```

`src/assets/players/manifest.json` が書き換わります。**手で編集しない。**

## STEP 8 検査する

```sh
npm run assets:validate
```

PASS になるまで取り込みません。落ちる主な理由：

| 表示 | 直しかた |
| --- | --- |
| 背景が透明ではない | STEP 3 をやり直す |
| 大きさが違う | STEP 4 をやり直す |
| 名前が規則に合わない | STEP 5 の規則で付け直す |
| 同じ絵が2枚ある | どちらかを消して番号を詰める |
| 目録と実物が違う | STEP 7 をやり直す |

## STEP 9 目で見る

```sh
npm run assets:audit    # 1枚ずつの目視チェック表（文字・ロゴ・実在人物）
npm run gallery         # 組み上げた選手を大量に並べる
```

ここで「別人に見える」「線の太さが合わない」を拾います。

## STEP 10 取り込む

必要な種類（`head` `hair` `eyebrows` `eyes` `nose` `mouth` `ears` `jaw` `body` `neck` `uniform`）が
**すべてそろって初めて**画像で描かれます。1つでも欠けていれば SVG のままです。
途中の状態でコミットしても、ゲームは壊れません。
