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

# 08 ears ── 耳（必須 / 6〜10枚）

- 置き場所: `src/assets/players/face/`
- 名前: `ear_001.png` 〜
- 重なりの順: 6（顔より**下**。顔の輪郭が耳の付け根を隠す）

## 基準

高さ y=512 / 左 x=250 / 右 x=774。**左右2つを1枚に描きます。**

## プロンプト

```
A pair of ears only, seen from the front, floating with no head between them.
Left ear centered at x=250, right ear at x=774, both at y=512.
Simple inner fold lines. Everything else fully transparent.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

`small close set` / `large protruding` / `long lobed` / `attached lobe` /
`pointed upper rim` / `round` / `flat against head` / `slightly uneven`

### 追加ネガティブ

```
head, face, hair, earrings, piercings, one ear
```
