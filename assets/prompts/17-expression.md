# 17 expression ── 表情の上書き（任意 / 0〜15枚）

- 置き場所: `src/assets/players/expressions/`
- 名前: `expression_<表情>_001.png` 〜
- 重なりの順: 19（いちばん上）

ファイル名は `expression_<表情ID>_001.png` で固定です（`expressionAsset`）。
`neutral` だけは素材を使いません。

## ゲームが使う表情

表情は**すでにゲームが決めた状態**（怪我・調子・スランプ・疲労・新人）から選ばれます。
能力や成績から作り出すことはありません。

| ID | 出る場面 | 素材 |
| --- | --- | --- |
| `neutral` | 平常 | **不要**（下の目と口がそのまま出る） |
| `focused` | 調子が良い・新人・ドラフトの指名 | 要 |
| `confident` | 調子が最高・MVP | 要 |
| `tired` | 疲労78以上・調子が悪い | 要 |
| `disappointed` | スランプ・調子が最悪 | 要 |
| `injured` | 怪我 | 要 |
| `happy` | 優勝・受賞 | 要 |
| `angry` | 闘志（演出で使う） | 任意 |
| `surprised` | 驚き（演出で使う） | 任意 |
| `celebrating` | 歓喜（演出で使う） | 任意 |

`neutral` は素材を作りません。上の「要」6つを1枚ずつ用意すれば十分です。

## 基準

目 y=496（左 x=408 / 右 x=616）・眉 y=428・口 y=712 を覆う位置。
**下の目と口を隠す**ので、覆う部分は不透明に描きます。

## プロンプト（雛形）

```
An expression overlay only — a pair of eyes at x=408 and x=616 (y=496),
a pair of eyebrows at x=404 and x=620 (y=428), and a mouth at x=512 (y=712).
Nothing else: no face, no skin, no nose, no head.
Emotion: <ここに下の語を入れる>.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 表情ごとの語

| ファイル名 | 入れる語 |
| --- | --- |
| `expression_focused_001` | `narrowed determined eyes, level brows, firmly closed mouth` |
| `expression_confident_001` | `steady bright eyes, slightly raised brows, small confident smile` |
| `expression_tired_001` | `heavy half closed eyes, slack brows, slightly open weary mouth` |
| `expression_disappointed_001` | `downcast eyes, inner brows raised, flat downturned mouth` |
| `expression_injured_001` | `tightly shut eyes, deeply furrowed brows, clenched grimacing mouth` |
| `expression_happy_001` | `crescent smiling eyes, raised brows, open joyful smile` |
| `expression_angry_001` | `hard glaring eyes, low drawn brows, tight set mouth` |
| `expression_surprised_001` | `wide open eyes, high raised brows, small open mouth` |
| `expression_celebrating_001` | `eyes shut in joy, high brows, wide open shouting mouth` |

### 追加ネガティブ

```
face, skin, head, nose, ears, hair, tears, blood, exaggerated cartoon emotion
```
