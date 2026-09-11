# パーツの名前と色の名前（PHASE 4.8-B §5）

## 1. ファイルの置き場所

```
src/ui/character/custom/<種類>/<名前>.svg
```

**フォルダ名が種類です。** ファイルの中の `data-category` と必ず揃えてください。
揃っていないと、検査で止まります（間違いに気づかないまま進むほうが困るためです）。

## 2. 種類の名前

| フォルダ | 何を描くか | 描く順番 |
|---|---|---|
| `head` | 顔の輪郭だけ | 体の上・顔の造作の下 |
| `body` | 肩から下 | いちばん下のほう |
| `neck` | あごから肩まで | 体より下 |
| `uniform` | 前立て・ベルトなど | 体のすぐ上 |
| `hairBack` | 後ろ髪 | いちばん下 |
| `hairFront` | 前髪 | 顔の造作の上 |
| `ear` | 耳 | **頭より下**（縁から外へ出た分だけ見える） |
| `eye` | 目 | 頭の上 |
| `eyebrow` | 眉 | 目の上 |
| `nose` | 鼻 | 眉の上 |
| `mouth` | 口 | 鼻の上 |
| `beard` | ひげ | 頭の上・目の下 |
| `cap` | 帽子 | 前髪の上 |
| `accessory` | めがねなど | いちばん上 |

## 3. パーツの名前

```
<種類>_<2桁以上の数字>
```

例: `head_06` / `cap_12` / `hairFront_07`

* 小文字で始める
* はじめから入っているものと番号がぶつかっても構いません（後ろに足されます）
* 名前は**変えないでください**。変えると、その顔の選手が別人になります

## 4. 色の名前

色は**直に書けません**。名前で書きます。

```xml
<path d="..." fill="token:skin" stroke="token:outline" stroke-width="3"/>
```

肌の色は選手ごとに違うので、`#e8b48c` と書いてしまうと全員同じ肌になります。

### 使える名前

| 名前 | 何の色か |
|---|---|
| `token:skin` | 肌 |
| `token:skinShadow` | 肌の陰 |
| `token:skinLight` | 肌の明るいところ |
| `token:hair` | 髪 |
| `token:hairShadow` | 髪の陰（後ろ髪・眉にも使う） |
| `token:eye` | 瞳 |
| `token:eyeWhite` | 白目 |
| `token:eyeHighlight` | 瞳の光 |
| `token:brow` | 眉 |
| `token:mouth` | 口 |
| `token:mouthInner` | 口の中 |
| `token:outline` | 輪郭線（全員共通） |
| `token:uniform` | ユニフォーム |
| `token:uniformSecondary` | ユニフォームの差し色（球団色） |
| `token:uniformShadow` | ユニフォームの陰 |
| `token:cap` | 帽子（球団色） |
| `token:capSecondary` | 帽子のヘッドバンド |
| `token:capShadow` | 帽子のつば |

`fill="none"` はそのまま使えます。

## 5. 頭だけが持てる指定

頭は「自分がどんな形か」を申告します。髪・耳・帽子がこれを見て位置を決めます。

```xml
<g data-part="head_06" data-category="head" data-label="四角顔"
   data-half-width="62" data-face-scale-y="1" data-chin-shift="0">
```

| 指定 | 意味 | 目安 |
|---|---|---|
| `data-half-width` | **輪郭のいちばん外側**の、中心からの距離 | 40〜75（必須） |
| `data-face-scale-y` | 顔を縦に伸ばす量。1でそのまま | 0.9〜1.2 |
| `data-chin-shift` | あごだけを下げる量（px） | -6〜8 |

`data-half-width` を間違えると、髪が浮いたり帽子が食い込んだりします。
**描いた輪郭のいちばん広いところを測って入れてください。**

## 6. 位置について

**ずらす計算はしなくて構いません。**

テンプレートの基準線の上に描けば、それで合います。
頭の形が変わったときの追従（縦のずれ・横の伸び縮み）は、
取り込むときに自動で計算されます。

逆に、自分でずらして描くと二重にずれます。**テンプレートのまま描いてください。**
