# poses

PHASE 4.6 の選手ビジュアル素材を置く場所です。

* 形式：透過 WebP（マスターは `assets/masters/poses/` に PNG で残す）
* キャンバス：`config/visual-assets.json` の `canvas` と `anchors` に合わせる
* 命名：`config/visual-assets.json` の `naming.pattern` に従う

素材を置いたら：

```
npm run assets:manifest   # manifest.json を作り直す
npm run assets:validate   # 仕様に合っているか調べる
npm run assets:audit      # 目視確認の一覧を出す
```

素材が1枚も無くてもゲームは動きます（PHASE 4.5 の SVG で描かれます）。
