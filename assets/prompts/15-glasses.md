# 15 glasses ── 眼鏡（任意 / 0〜10枚）

- 置き場所: `src/assets/players/equipment/`
- 名前: `glasses_001.png` 〜
- 重なりの順: 17（帽子の上）

眼鏡がつくのは全選手の**約9%**です。0枚でも構いません。

## 基準

目 y=496 / 左 x=408 / 右 x=616 を覆う位置。

## プロンプト

```
A pair of eyeglasses only, front facing, floating with no face behind them —
fully transparent lenses, only the frame is drawn. Lens centers at
x=408 and x=616, both at y=496. Thin ink frame, temples going straight back.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

`thin metal round` / `thin metal rectangular` / `thick black rectangular` /
`half rim` / `rimless` / `sports goggles with strap` / `square frames` / `oval frames`

### 追加ネガティブ

```
face, eyes, nose, skin, tinted lenses, reflections, sunglasses glare, head
```
