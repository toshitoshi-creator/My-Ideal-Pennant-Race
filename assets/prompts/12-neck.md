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

# 12 neck ── 首（必須 / 6〜8枚）

- 置き場所: `src/assets/players/body/`
- 名前: `neck_001.png` 〜
- 重なりの順: 5（ユニフォームの上、耳の下）

あごとユニフォームの襟のあいだを埋めます。ここが無いと顔が浮きます。

## 基準

x=512 / 上端 y=790（あご先の少し上）/ 下端 y=880（首の付け根の少し下）。

## プロンプト

```
A neck only — a short column of skin between a chin and a collar,
floating with no head and no body. Centered at x=512, spanning y=790 to y=880.
One soft shadow under the jaw. Everything else fully transparent.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

`slender` / `average` / `thick` / `very thick muscular` /
`long` / `short` / `with visible adam's apple` / `with tendon lines`

### 追加ネガティブ

```
head, chin, face, shoulders, collar, jersey, necklace
```
