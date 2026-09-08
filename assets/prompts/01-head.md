# 01 head ── 顔の輪郭（必須 / 10〜15枚）

- 置き場所: `src/assets/players/base/`
- 名前: `head_001.png` 〜
- 重なりの順: 7（耳の上、髪の下）

## 描くもの・描かないもの

| 描く | 描かない |
| --- | --- |
| 額からあご先までの肌の面 | 目・眉・鼻・口（別の種類） |
| 頬の陰影（2階調） | 髪・生え際（`hair` が乗る） |
| 首の付け根の手前まで | 耳（`ear` が別にある） |

## 基準

てっぺん y=210 / あご先 y=800 / 横幅 x=244〜780 / 中心 x=512。

## プロンプト

```
Bare human head shape, front facing, no facial features at all —
blank skin surface from forehead to chin, no eyes, no eyebrows, no nose,
no mouth, no ears, no hair. Adult male athlete, age 25.
Face width 536px, top of skull at y=210, chin at y=800, centered at x=512.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

顔の形を10〜15通り。1枚につき1語だけ差し替えます。

`oval` / `round` / `square jawed` / `long narrow` / `heart shaped` /
`diamond` / `broad cheekboned` / `soft rounded square` / `angular` /
`tapered` / `wide flat` / `slightly asymmetric oval`

### 肌の色

**素材は肌色1色ぶんだけ作ります。** 8段階はゲーム側が持ちますが、
現状の実装は素材をそのまま出すので、肌の段階を素材で持ちたい場合は
`head_001`〜`head_015` を形 × 肌の色で割り当ててください
（例: 形5種 × 肌3段階 = 15枚）。

### 追加ネガティブ

```
eyes, eyebrows, nose, mouth, ears, hair, facial hair, glasses, hat, neck, shoulders
```
