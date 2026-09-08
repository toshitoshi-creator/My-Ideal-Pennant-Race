# 16 equipment ── 用具（任意 / 0〜24枚）

- 置き場所: `src/assets/players/equipment/`
- 名前: **番号が決まっています**（`STANCE_GEAR_ASSET`）
  - `gear_glove_001.png` … 投手・内野・外野
  - `gear_mitt_001.png` … 捕手
  - `gear_bat_001.png` … 打者
- 重なりの順: 18（いちばん上に近い）

この3つは必ずこの名前で置きます。他の用具（ボール・プロテクター）は
いま画面には出ませんが、資料として作っておいて構いません。

守備位置ごとに何を持つかはゲームが決めます（`STANCE_EQUIPMENT`）。

| 守備位置 | 持つもの |
| --- | --- |
| 投手 | グラブ・ボール |
| 捕手 | ミット・プロテクター・レガース |
| 内野 | グラブ |
| 外野 | 外野用グラブ |
| 打者 | バット・バッティンググラブ |

## 基準

中心 x=512 / y=980。体の前に来ます。

## プロンプト（グラブ）

```
A baseball glove only, front facing, held by an invisible hand —
transparent where the hand and arm would be. Centered at x=512, y=980.
Plain leather, no logo, no lettering, no brand mark.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

`pitcher's closed-web glove` / `infielder's small glove` /
`outfielder's deep glove` / `first baseman's mitt` / `catcher's mitt`

## プロンプト（バット）

```
A baseball bat only, held vertically in front of the body by an invisible hand.
Centered at x=512, barrel top at y=760, knob at y=1180.
Plain wood, no logo, no lettering, no brand mark.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

## プロンプト（捕手の防具）

```
A catcher's chest protector only, front facing, worn on an invisible body.
Centered at x=512, spanning y=880 to y=1280. Plain padded panels,
no logo, no lettering, no team color.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

## プロンプト（ボール）

```
A single baseball only, front facing, floating. Centered at x=512, y=980,
diameter 120px. White leather with two simple seam curves.
No logo, no lettering, no brand mark.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 追加ネガティブ

```
hand, fingers, arm, player, body, team logo, brand mark, lettering, sponsor
```
