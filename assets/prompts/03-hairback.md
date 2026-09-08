# 03 hairBack ── 髪（後面・任意 / 0〜20枚）

- 置き場所: `src/assets/players/hair/`
- 名前: `hairback_001.png` 〜
- 重なりの順: 8（顔の**すぐ上**、あごより下）

後頭部の広がりだけを描きます。短髪だけで作るなら**丸ごと省いても構いません**
（`required: false`）。長髪・結んだ髪を出すときに、`hair_0NN` と番号をそろえて作ります。

## プロンプト

```
Back-of-head hair mass only, seen from the front — the volume that peeks out
behind and beside the head. Transparent in the center where the face will be.
Symmetric, spanning x=232 to x=792, top at y=230.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 1枚ずつ変えるところ

`low ponytail` / `short bob volume` / `shoulder length straight` /
`shoulder length wavy` / `bun` / `thick nape hair` / `long straight`

### 追加ネガティブ

```
face, front hair, bangs, ears, neck, shoulders
```
