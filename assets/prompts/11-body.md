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

# 11 body ── 体格（必須 / 8〜12枚）

- 置き場所: `src/assets/players/body/`
- 名前: `body_001.png` 〜
- 重なりの順: 3（いちばん下。姿勢の上）

## 基準

首の付け根 x=512 / y=856 / 肩 x=236〜788。下端はキャンバスの底 y=1280 まで。

## 描くもの・描かないもの

| 描く | 描かない |
| --- | --- |
| 肩から胸・腕の付け根 | 首（`neck` が別） |
| 体格の輪郭 | ユニフォーム（`uniform` が上に乗る） |
| 素の肩の丸み | 手・指・用具 |

## プロンプト

```
Bare shoulders and upper torso of an adult male athlete, front facing,
headless and neckless — flat cut at the neck base. Neck base at x=512, y=856,
shoulders spanning x=236 to x=788, body continues to the bottom edge y=1280.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

`slim` / `lean athletic` / `average` / `broad shouldered` / `muscular` /
`heavy set` / `stocky` / `tall and narrow` / `thick chested` / `wiry`

### 追加ネガティブ

```
head, neck, face, jersey, shirt, uniform, hands, arms below elbow, legs
```
