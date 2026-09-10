# パーツの足しかた（PHASE 4.8-A §25）

このフェーズで固定したのは **絵ではなく規格** です。
規格が決まっているので、パーツを足すときに描画側を直す必要はありません。

足す手順は、どの種類でも同じ4行です。

1. `parts/` の該当ファイルに1つ足す
2. `registry.ts` の表に載る（配列に足すだけで自動で載る）
3. `characterProfile.ts` の `DEFAULT_PART_COUNTS` の数を1つ増やす
4. `npm test` を通す（数の一致を検査しています）

描画順（`CHARACTER_LAYERS`）も、座標系も、アンカーも触りません。

---

## 守ること

### 1. 座標を直に書かない

パーツが書いてよいのは **アンカーからの相対** だけです。

```tsx
// ✅ よい：頭が申告した位置から組み立てる
const half = context.anchors.rightTemple.x - context.guides.centerX + 3;

// ❌ わるい：自分で数値を決める
const half = 65;
```

固定値を1つ書いた瞬間に、細い頭では浮き、広い頭では食い込みます。
実際、髪の幅と帽子の幅を固定値にしていたときに両方とも起きました。

### 2. z-index を持たない

順番を知っているのは `CHARACTER_LAYERS` だけです（§6）。
パーツが自分の順番を主張しはじめると、足すたびに順番が壊れます。

### 3. 色を決め打ちしない

色は `context.palette` から取ります。
肌の色も髪の色も球団色も、設計図の番号から配られます。

### 4. 乱数と時刻を見ない

`Math.random` も `Date.now` も使いません。
同じ設計図からは、いつ描いても同じ絵が出ます。
これは検査で機械的に確かめています（`phase48a.test.ts` の D/E）。

### 5. 頭だけが基準線を動かす

`guideAdjustment` と `anchorsFor` を持ってよいのは頭だけです。
頭が「自分の幅はこれ」「あごはここ」と申告し、
耳・髪・帽子はそれを見ます。この一方通行が崩れるとズレが戻ってきます。

---

## 種類ごとの注意

| 種類 | 見るアンカー | 注意 |
|---|---|---|
| head | guides のみ | `anchorsFor` で temple と耳を必ず申告する |
| ear | leftEar / rightEar | 頭より下の層なので、縁から **外へ** ふくらませる |
| hairFront / hairBack | temple / capBase | 帽子をかぶったときは生え際を capBase の下へ |
| cap | headTop / capBase / temple | 幅は temple から。つばは eyeLine より上で止める |
| eye / eyebrow / nose / mouth | それぞれの専用アンカー | 左右は1つのテンプレートから作る（反転ミス防止） |
| body / neck | shoulderLine / neckTop | 首から下の線は頭の形で動かない。ここは固定でよい |

---

## 足したあとに見ること

`npx tsx scripts/character-gallery.tsx` で `character-gallery.html` が出ます。
見るのは3つです。

- パーツ一覧の行 … 足したものが他と混ざって見えるか
- 基準線の確認の行 … 線とアンカーの上に乗っているか
- 100人の格子 … **同じパーツなのに人によって位置が変わっていないか**

3つめがいちばん大事です。
位置が人によって変わるなら、そのパーツはどこかに固定値を書いています。
