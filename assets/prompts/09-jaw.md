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

# 09 jaw ── あご・輪郭の陰影（必須 / 6〜10枚）

- 置き場所: `src/assets/players/face/`
- 名前: `jaw_001.png` 〜
- 重なりの順: 9（顔の上、眉より下）

顔の骨格の差を出す薄い陰影です。**輪郭線は描きません**（`head` が持っています）。

## 基準

あご先 y=800 / 中心 x=512。

## プロンプト

```
Jawline shading overlay only — a soft two-tone shadow that defines the
jaw and chin of a face, with no outline and no skin fill.
Chin tip at y=800, centered at x=512. Mostly transparent,
opacity of the shadow around 25 percent. Everything else fully transparent.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

`square heavy jaw` / `narrow tapered jaw` / `rounded soft jaw` /
`cleft chin` / `pointed chin` / `wide chin` / `double chin` / `slack jowls`

### 追加ネガティブ

```
outline, face, skin fill, mouth, beard, neck, full head
```
