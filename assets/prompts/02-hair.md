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

# 02 hair ── 髪（前面・必須 / 15〜20枚）

- 置き場所: `src/assets/players/hair/`
- 名前: `hair_001.png` 〜
- 重なりの順: 15（顔のいちばん上、帽子の下）

## 描くもの・描かないもの

| 描く | 描かない |
| --- | --- |
| 前髪・もみあげ・頭頂 | 額の肌（下の `head` が透ける） |
| 生え際の形 | 耳（`ear` が下にある） |
| 髪の量感（2階調） | 後頭部の広がり（`hairback` が別） |

## 基準

てっぺん y=200 / 左 x=232 / 右 x=792。頭より一回り大きく描いて包みます。

## プロンプト

```
Hair piece only, front facing, floating with no head underneath —
transparent where the scalp and forehead would be. Short athletic men's haircut.
Fits a skull whose top is at y=200 and whose width spans x=232 to x=792.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

`buzz cut` / `crew cut` / `short side part` / `center part` /
`swept back` / `spiky short` / `messy short` / `tight fade` /
`slicked back` / `shaggy medium` / `bowl cut` / `textured crop` /
`high and tight` / `curly short` / `wavy medium` / `long tied back` /
`receding hairline` / `thinning crown` / `bald with side hair` / `shaved head`

### 髪の色

**素材は黒髪1色で作ります。** 10段階の色分けが要る場合は、
色ごとに別番号を割り当ててください（形5種 × 色4段 = 20枚など）。
白髪は 40歳以上の選手にだけ出るので、末尾の番号に寄せると管理しやすくなります。

### 追加ネガティブ

```
face, skin, forehead, eyes, ears, head shape, neck, hat, cap, headband
```
