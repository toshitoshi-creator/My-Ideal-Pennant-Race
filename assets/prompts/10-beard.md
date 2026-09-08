# 10 beard ── ひげ（任意 / 8〜12枚）

- 置き場所: `src/assets/players/beard/`
- 名前: `beard_001.png` 〜
- 重なりの順: 14（口の上、髪の下）

ひげは**素質**として選手ごとに固定され、年齢が上がると出やすくなります
（18〜22歳で8%、35歳以上で50%超）。若い選手に濃いひげは出ません。

## 基準

中心 x=512 / y=740。口 y=712 を包む位置。

## プロンプト

```
Facial hair only, floating with no face underneath — transparent where
the skin and lips would be. Centered at x=512, y=740, wrapping a mouth at y=712
and a chin at y=800. Solid dark shape, no individual strands.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

`light stubble` / `heavy stubble` / `thin mustache` / `thick mustache` /
`goatee` / `chin strap` / `short full beard` / `medium full beard` /
`mutton chops` / `soul patch` / `circle beard` / `long full beard`

### 追加ネガティブ

```
face, skin, lips, teeth, nose, head, hair on scalp
```
