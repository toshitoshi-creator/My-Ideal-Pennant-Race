# 選手ビジュアル素材の作りかた（PHASE 4.7）

このフォルダは **画像を作る人のための資料** です。
ゲーム本体はここのファイルを一切読みません。ビルドにも含まれません。

素材は外部の画像生成AIで作りますが、
**ゲームがAIを呼ぶことは絶対にありません**。
できあがった画像だけを `src/assets/players/` へ置き、ビルド時に同梱します。
APIキーも `.env` もゲームには要りません。外部サービスが止まってもゲームは動きます。

## 読む順番

| ファイル | 中身 |
| --- | --- |
| `style-bible.md` | **絵柄の正本。最初に読む** |
| `canvas.md` | 共通キャンバスと基準点 |
| `negative-prompt.md` | すべての生成で必ず外すもの |
| `workflow.md` | 生成 → 後処理 → 検査 → 取り込み の手順 |
| `transparency.md` | **透明背景の作りかた（fal-ai/flux/dev むけ）** |
| `01-head.md` … `18-pose.md` | 種類ごとの手書きの解説 |
| `generated-prompts.md` | `npm run assets:prompts` が書き出す、そのまま貼れる文面 |

## 早わかり

```sh
npm run assets:generate -- --dry-run          # 何を何枚作るのか。APIを1回も呼ばない
cp .env.example .env                          # プロバイダーと鍵を設定
npm run assets:generate -- --master           # 見本の1枚（STYLE SHEET）
npm run assets:generate -- --type head_shape,hair_style,eyes --count 1   # まず3枚だけ
npm run assets:remove-background              # 単色の下地を抜いて透明PNGにする
npm run assets:normalize                      # 1024x1280 へ正規化・色の振り分け
npm run assets:compare                        # 元 → 除去後 → 正規化後 を見比べる
npm run assets:validate                       # 透明PNGとして検査（14項目）
npm run assets:manifest                       # 目録を作る
npm run assets:audit                          # 人の目で見る（文字・ロゴ・実在人物）
npm run assets:gallery -- 300                 # 300人を組み上げて確認
npm run build:single                          # 単一HTMLに同梱
```

`assets:remove-background` → `normalize` → `validate` → `manifest` は
`npm run assets:build` でまとめて実行できます。

**3枚で品質を確かめてから量産してください。**

APIを契約していないときは `IMAGE_PROVIDER=local` にして、
手元のツールで作った PNG を `assets/incoming/` へ置けば、
後処理から先はまったく同じ流れで使えます。

## いまの状態

素材は **0点** です。ゲームは PHASE 4.5 の SVG で選手を描いています。
これは異常ではなく、素材がそろうまでの正常な状態です。
