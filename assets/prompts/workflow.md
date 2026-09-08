# WORKFLOW ── 生成から取り込みまで（PHASE 4.7）

段階を踏みます。**いきなり全部作らないでください**（§14）。

```
STEP A  見本の1枚（MASTER STYLE SHEET）
STEP B  各種類3枚
STEP C  組み合わせを見る（100人）
STEP D  各種類10枚以上
STEP E  300人を見る
STEP F  直す
STEP G  1000人を見る
STEP H  採用
```

---

## STEP 0 まず下見

```sh
npm run assets:dry-run
```

何を何枚作るのか、APIを何回叩くのか、何が足りないのかを表示します。
**画像は1枚も作りません。**

---

## STEP 1 プロバイダーを決める

```sh
cp .env.example .env
```

`.env` に書くのは2つだけです。

```
IMAGE_PROVIDER=openai      # openai / replicate / fal / local
IMAGE_API_KEY=...          # local のときは不要
```

`.env` は `.gitignore` に入っています。**git には絶対に入りません。**

APIを契約していないときは `IMAGE_PROVIDER=local` にして、
手元のツール（Web版のUIなど）で作った PNG を `assets/incoming/<素材ID>.png` へ置きます。
文面は `npm run assets:prompts` が `assets/prompts/generated-prompts.md` に書き出します。

---

## STEP 2 見本の1枚

```sh
npm run assets:generate -- --master
```

`assets/state/master-style-sheet.png` ができます。
以降のすべての素材は、この絵に合わせます。

見本画像を渡せるプロバイダー（replicate / fal）なら、
2枚目以降は自動でこの絵を参照します。
渡せないプロバイダーなら、Style Bible の文面が毎回添えられます。

---

## STEP 3 まず3枚ずつ

```sh
npm run assets:generate -- --type all --count 3
```

10枚を超える生成には `--confirm-large-batch` が要ります（§53）。
これは事故で費用が膨らむのを防ぐための歯止めです。

種類を絞ることもできます。

```sh
npm run assets:generate -- --type hair_style --count 10 --confirm-large-batch
npm run assets:generate -- --type eyes,nose,mouth --count 3
```

生成されたものは `assets/original/` に無加工で置かれます。
**ここはゲームに入りません**（§19）。

---

## STEP 4 後処理

```sh
npm run assets:process
```

1枚ずつ、次の順で直します。

```
背景除去 → アルファの掃除 → 中身の切り出し
→ 大きさをそろえる → 基準点へ置き直す
→ 共通キャンバス 1024x1280 へ配置
→ 髪色10色・肌色8段階へ振り分け
→ 派生サイズ（512 / 256 / 128）を書き出す
```

生成AIが人物をどこに描いてきても、ここで必ず同じ位置に収まります。
**プロンプトだけで位置をそろえようとしないでください**（§5）。

結果は `src/assets/players/` に置かれます。ここがゲームに入るものです。

---

## STEP 5 機械の検査

```sh
npm run assets:check
```

見るのはこれだけです。

- 大きさが 1024x1280 か
- 背景が透明か
- 画面の端で切れていないか
- 中身が小さすぎないか
- 想定の場所に描かれているか
- 半透明の縁が残っていないか
- 離れた点が残っていないか
- 彩度が高すぎないか
- 陰影がついているか
- 左右のつり合い（目・眉・耳・眼鏡）

80点以上で APPROVED、60〜79点で REVIEW、59点以下は REJECT です。

---

## STEP 6 人の目で見る

```sh
npm run assets:audit
```

機械では見つけられないものを、1枚ずつ確認します。

- 文字・数字・署名が入っていないか
- ロゴ・チームマーク・透かしが入っていないか
- 実在の選手・有名人に似ていないか
- 既存のゲーム・アニメのキャラクターに似ていないか
- 線の太さが他とそろっているか
- 陰影の段数が他とそろっているか

**ここを飛ばさないでください。** 権利の問題は機械では防げません。

---

## STEP 7 目録を作る

```sh
npm run assets:manifest
```

`src/assets/players/manifest.json` が書き換わります。**手で編集しないでください。**

---

## STEP 8 組み上げて見る

```sh
npm run assets:gallery -- 100
npm run assets:gallery -- 300
npm run assets:gallery -- 1000
```

同じ顔が並んでいないか、髪が頭に食い込んでいないか、
目と眉がぶつかっていないか、鼻と口がずれていないかを見ます。

---

## STEP 9 実ブラウザで見る

```sh
npm run build
npx vite preview --port 4173 &
npm run e2e:images
```

素材が0点なら「確認することがない」として正常終了します。

---

## STEP 10 作り直し

```sh
npm run assets:regenerate -- --failed      # 失敗したものだけ
npm run assets:regenerate -- --id hair_007 # 指定したものだけ
```

途中で止めても、成功した素材は残ります（§30）。

---

## 必須の種類

次の11種類が**すべてそろって初めて**画像で描かれます。

```
head / hair / eyebrows / eyes / nose / mouth / ears / jaw / body / neck / uniform
```

1つでも欠けていれば、PHASE 4.5 の SVG のままです。
途中の状態でコミットしても、ゲームは壊れません。
