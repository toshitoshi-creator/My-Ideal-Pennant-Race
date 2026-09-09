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

# 14 cap ── 帽子・ヘルメット・マスク（任意 / 1〜8枚）

- 置き場所: `src/assets/players/equipment/`
- 名前: **番号が決まっています**
  - `cap_001.png` … 帽子
  - `cap_002.png` … ヘルメット
  - `cap_003.png` … 捕手のマスク
- 重なりの順: 16（髪の上）

この3つの番号はゲーム側（`HEADWEAR_ASSET`）で固定です。順番を入れ替えると、
打者に帽子、投手にマスクが乗ります。

守備位置ごとに何をかぶるかはゲームが決めます。

| 守備位置 | かぶるもの |
| --- | --- |
| 投手・内野・外野 | 帽子 |
| 打者 | ヘルメット |
| 捕手 | マスク |

## 基準

中心 x=512 / つばの高さ y=306。頭のてっぺん y=210 を覆います。

## プロンプト（帽子）

```
A baseball cap only, front facing, worn on an invisible head —
transparent underneath. Off-white and ink two-tone, plain crown,
no logo, no lettering, no team mark. Brim front edge at y=306,
crown centered at x=512 covering a skull top at y=210.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

## プロンプト（ヘルメット）

```
A batting helmet only, front facing, worn on an invisible head. Plain shell,
one ear flap on the left side, no logo, no lettering, no number.
Brim front edge at y=306, centered at x=512, covering a skull top at y=210.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

## プロンプト（捕手のマスク）

```
A catcher's mask and helmet only, front facing, worn on an invisible head —
transparent behind the bars so the face reads through. Plain metal cage,
padded edges, no logo, no lettering. Centered at x=512, covering y=210 to y=820.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 追加ネガティブ

```
head, hair, face, team logo, lettering, number, sponsor, colored crown
```
