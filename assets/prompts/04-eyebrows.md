> **⚠️ この文面は PHASE 4.6 のものです（絵柄が変わりました）**
>
> PHASE 4.7-A で絵柄を「日本のデフォルメ野球ゲーム風」へ変えました。
> ここに書いてある「flat vector illustration / ink outline #1b1a17 /
> two-tone shading」は**もう使いません**。
>
> いま実際に使う文面は、次のどちらかで出してください。
>
> ```
> npm run assets:prompts        部品ごとの文面（scripts/assets/prompts.ts）
> npm run assets:style-test -- --dry-run   キャラクター本体の文面
> ```
>
> 絵柄の正本は `assets/prompts/style-bible.md` の §15・§16 です。

# 04 eyebrows ── 眉（必須 / 10〜15枚）

- 置き場所: `src/assets/players/eyebrows/`
- 名前: `brow_001.png` 〜
- 重なりの順: 10

## 基準

高さ y=428 / 左 x=404 / 右 x=620。**左右2本を1枚に描きます。**

## プロンプト

```
A pair of eyebrows only, nothing else. Left brow centered at x=404,
right brow centered at x=620, both at y=428. Solid dark shape,
no individual hair strands. Everything else fully transparent.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

`straight thick` / `straight thin` / `softly arched` / `sharply angled` /
`downturned` / `upturned` / `short bushy` / `long tapered` /
`slightly asymmetric` / `furrowed inward` / `raised` / `flat and low`

### 追加ネガティブ

```
eyes, eyelids, forehead, skin, face, hair, single eyebrow
```
