# NEGATIVE PROMPT ── 必ず外すもの

**すべての生成に、この1行をそのまま付けます。** 種類ごとの追加は各ファイルにあります。

```
background, backdrop, white background, gradient background, scenery, floor, ground,
drop shadow, cast shadow, ambient occlusion, text, letters, numbers, watermark,
signature, logo, emblem, brand mark, team logo, frame, border, canvas edge, vignette,
photorealistic, photograph, 3d render, cgi, ray tracing, glossy highlights,
oil painting texture, brush strokes, paper texture, noise, grain, jpeg artifacts,
multiple people, second person, duplicate face, extra limbs, extra fingers,
cropped, cut off, out of frame, tilted, side view, three quarter view, looking away,
blurry, low resolution, sketch lines, construction lines, color fringing,
real athlete, celebrity likeness, existing video game character, anime franchise character,
child, toddler, infant, sexualized, gore, blood, injury detail
```

## なぜ外すのか

| 外すもの | 理由 |
| --- | --- |
| 背景・床・影 | 重ねたときに前のパーツを隠す |
| 文字・ロゴ・透かし | 権利の問題。検査でも落ちる |
| 写実・3D・光沢 | 他のパーツと絵柄が合わない |
| 複数人物 | 1素材＝1パーツが原則 |
| 斜め・横向き | 基準点に合わない |
| 実在人物・既存キャラ | §53 で明確に禁止されている |

## 検査との対応

`npm run assets:validate` は、背景が不透明な素材と、
キャンバスの大きさが違う素材を機械的に落とします。
文字やロゴは機械では見つけられないので、`npm run assets:audit` の
目視チェック表で1枚ずつ確認します。
