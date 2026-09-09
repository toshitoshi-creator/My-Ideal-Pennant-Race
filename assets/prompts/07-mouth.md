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

# 07 mouth ── 口（必須 / 10〜15枚）

- 置き場所: `src/assets/players/mouth/`
- 名前: `mouth_001.png` 〜
- 重なりの順: 13

## 基準

中心 x=512 / y=712。

ここは**平常の口**だけです。笑い・落胆・食いしばりは `expression` が重なります。

## プロンプト

```
A single closed mouth only, neutral relaxed expression, front facing,
floating with no face around it. Centered at x=512, y=712.
Simple lip shapes, no teeth. Everything else fully transparent.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

`thin lips` / `full lips` / `wide` / `narrow` / `slight natural upturn` /
`slight natural downturn` / `flat line` / `softly parted` /
`pronounced cupid's bow` / `flat upper lip` / `asymmetric` / `small`

### 追加ネガティブ

```
face, skin, nose, chin, teeth, tongue, beard, mustache, smiling broadly, shouting
```
