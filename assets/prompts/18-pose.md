# 18 pose ── 姿勢（任意 / 0〜12枚）

- 置き場所: `src/assets/players/poses/`
- 名前: **番号が決まっています**（`STANCE_POSE_ASSET`）
  - `pose_pitch_001.png` … 投手
  - `pose_catch_001.png` … 捕手
  - `pose_field_001.png` … 内野・外野
  - `pose_bat_001.png` … 打者
- 重なりの順: 2（いちばん下）

守備位置から姿勢が決まります。

| 守備位置 | 姿勢 |
| --- | --- |
| 投手 | 投球フォーム |
| 捕手 | 構え |
| 内野・外野 | 守備の構え |
| 打者 | 打席の構え |

## 基準

体の輪郭（`body`）の下に敷く**下半身と腕**です。
上端 y=856（首の付け根）より下だけを描きます。中心 x=512。

大きく見せるとき（`hero`）だけ使う想定なので、**丸ごと省いても構いません**。

## プロンプト（雛形）

```
The lower body and arms of a baseball player only, front facing,
headless and torso-less above y=856 — transparent there so a separate torso
can be layered on top. Centered at x=512, filling down to y=1280.
Plain off-white uniform, no logo, no lettering, no number.
Pose: <ここに下の語を入れる>.
flat vector illustration, baseball almanac portrait, uniform line weight 5px, ink outline #1b1a17, two-tone shading only, no gradient, light from upper left 45 degrees, front view orthographic, fully transparent background, single isolated part on 1024x1280 canvas
```

### 姿勢ごとの語

| ファイル名 | 入れる語 |
| --- | --- |
| `pose_standing_001` | `standing straight, arms relaxed at the sides` |
| `pose_pitch_001` | `pitching wind-up, front leg lifted, throwing arm cocked back` |
| `pose_catch_001` | `catcher's crouch, mitt held forward at chest height` |
| `pose_field_001` | `fielding ready stance, knees bent, hands low in front` |
| `pose_bat_001` | `batting stance, bat held up over the back shoulder` |
| `pose_run_001` | `mid-stride running, arms driving` |

### 追加ネガティブ

```
head, face, chest, shoulders, ground, base, field, dirt, motion lines, team logo
```
