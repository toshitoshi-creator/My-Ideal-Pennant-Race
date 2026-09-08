# 05 eyes ── 目（必須 / 12〜16枚）

- 置き場所: `src/assets/players/eyes/`
- 名前: `eye_001.png` 〜
- 重なりの順: 11

## 基準

高さ y=496 / 左 x=408 / 右 x=616。**左右2つを1枚に描きます。**

## 描くもの・描かないもの

| 描く | 描かない |
| --- | --- |
| まぶた・目の輪郭・黒目 | 眉（`brow` が別） |
| ごく短いまつ毛 | 眼鏡（`glasses` が別） |
| 一点だけの光 | 涙・充血・隈 |

表情の差し替えは `expression` が上に重なります。ここは**平常の目**だけ作ります。

## プロンプト

```
A pair of eyes only, front facing, calm neutral gaze looking straight ahead.
Left eye centered at x=408, right eye at x=616, both at y=496.
Dark iris, single small highlight. Everything else fully transparent.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

`almond` / `round` / `narrow` / `hooded` / `downturned outer corner` /
`upturned outer corner` / `wide set` / `close set` / `deep set` /
`single eyelid` / `double eyelid` / `heavy lidded` / `large` / `small` /
`slightly uneven` / `sharp`

### 追加ネガティブ

```
eyebrows, glasses, nose, face, skin, one eye, closed eyes, tears, makeup
```
