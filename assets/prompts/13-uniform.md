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

# 13 uniform ── ユニフォーム（必須 / 1〜8枚）

- 置き場所: `src/assets/players/uniforms/`
- 名前: `uniform_001.png` 〜
- 重なりの順: 4（体格の上、首の下）

## いちばん大事な決めごと

**球団色で塗らない。** 生成りの白  だけで作ります。
球団色はゲーム側が細い線として重ねます。素材に焼き込むと移籍で色が直りません。

**実在球団のロゴ・マーク・意匠を入れない。** 背番号も入れません。

## 基準

首の付け根 x=512 / y=856 / 肩 x=236〜788。体格の輪郭に沿わせます。

## プロンプト

```
A plain baseball jersey only, front facing, worn on an invisible body —
transparent where the head, neck and hands would be.
Off-white fabric #f2efe6, plain placket with buttons, plain collar,
no logo, no team mark, no number, no lettering, no stripes of any color.
Neck opening centered at x=512 at y=856, shoulders x=236 to x=788,
continues to the bottom edge y=1280.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

1枚だけでも動きます。増やすなら**形の違い**だけにします。

`button front` / `pullover` / `v-neck` / `with plain undershirt sleeves` /
`practice shirt` / `warm-up jacket` / `sleeveless vest over undershirt` / `windbreaker`

### 追加ネガティブ

```
team logo, emblem, lettering, jersey number, name on back, pinstripes,
colored trim, sponsor patch, head, neck, hands, real team uniform
```
