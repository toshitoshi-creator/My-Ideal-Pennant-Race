/**
 * PHASE 4.8-A 顔の造作（§14〜§17）と耳。
 *
 * 目6・眉5・鼻4・口6・耳1。
 *
 * すべて **アンカーを起点に描く**（§5）。
 * 座標を直に書かないので、頭の形が変われば造作もまとめて追従する。
 * 左右は同じテンプレートから作る（§14）ので、左右反転ミスが起きない。
 */
import type { ReactNode } from 'react';
import type { CharacterExpression, CharacterPart, CharacterRenderContext } from '../types';
import { STROKE } from '../coordinates';

/* ================================================================
 * 目（§14）6種類
 * ============================================================== */

interface EyeShape {
  /** 目の横半径 */
  rx: number;
  /** 目の縦半径 */
  ry: number;
  /** 目尻の上がり下がり（正で吊り目、負で垂れ目） */
  tilt: number;
  /** 瞳の大きさ */
  pupil: number;
  /** まぶたで上をどれだけ隠すか */
  lid: number;
}

/**
 * 片目を描く。左右で同じ関数を使い、向きだけ変える。
 * こうしておけば「左右反転ミス」が構造的に起きない（§26）。
 */
function eye(
  context: CharacterRenderContext,
  side: 'left' | 'right',
  shape: EyeShape,
): ReactNode {
  const anchor = side === 'left' ? context.anchors.leftEye : context.anchors.rightEye;
  const dir = side === 'left' ? -1 : 1;
  const { palette, expression } = context;

  // 表情でまぶたの開き方だけを変える。目そのものは変えない（§21）
  const open =
    expression === 'surprised' ? 1.25 : expression === 'grin' || expression === 'smile' ? 0.82 : 1;
  const ry = shape.ry * open;
  const lid = expression === 'surprised' ? 0 : shape.lid;

  return (
    <g key={side} transform={`rotate(${shape.tilt * dir} ${anchor.x} ${anchor.y})`}>
      <ellipse
        cx={anchor.x}
        cy={anchor.y}
        rx={shape.rx}
        ry={ry}
        fill={palette.eyeWhite}
        stroke={palette.outline}
        strokeWidth={STROKE.secondary}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={anchor.x} cy={anchor.y + 0.5} r={shape.pupil} fill={palette.eye} />
      <circle
        cx={anchor.x + dir * shape.pupil * 0.35}
        cy={anchor.y - shape.pupil * 0.4}
        r={shape.pupil * 0.3}
        fill={palette.eyeHighlight}
      />
      {lid > 0 ? (
        <path
          d={`M ${anchor.x - shape.rx} ${anchor.y - ry + lid} A ${shape.rx} ${ry} 0 0 1 ${anchor.x + shape.rx} ${anchor.y - ry + lid}`}
          fill="none"
          stroke={palette.outline}
          strokeWidth={STROKE.detail}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </g>
  );
}

function makeEye(id: string, label: string, shape: EyeShape): CharacterPart {
  return {
    id,
    category: 'eye',
    label,
    render: (context) => (
      <g>
        {eye(context, 'left', shape)}
        {eye(context, 'right', shape)}
      </g>
    ),
  };
}

/** 目6種類（§14）。大きくしすぎない */
export const EYE_PARTS: CharacterPart[] = [
  makeEye('eye_01', '丸目', { rx: 9, ry: 8.5, tilt: 0, pupil: 4.6, lid: 1.5 }),
  makeEye('eye_02', '横長', { rx: 11, ry: 6.5, tilt: 0, pupil: 4.2, lid: 1.2 }),
  makeEye('eye_03', 'タレ目', { rx: 9.5, ry: 7.5, tilt: -9, pupil: 4.4, lid: 1.8 }),
  makeEye('eye_04', 'つり目', { rx: 9.5, ry: 7, tilt: 9, pupil: 4.2, lid: 1.6 }),
  makeEye('eye_05', '小さめ', { rx: 7.5, ry: 6, tilt: 0, pupil: 3.6, lid: 1.2 }),
  makeEye('eye_06', '大きめ', { rx: 10.5, ry: 9.5, tilt: 0, pupil: 5.2, lid: 1.4 }),
];

/* ================================================================
 * 眉（§15）5種類
 * ============================================================== */

interface BrowShape {
  width: number;
  thickness: number;
  /** 内側の端の上下（正で八の字、負で怒り眉） */
  angle: number;
  /** 眉の反り */
  arch: number;
}

/** 表情ごとの眉の傾き。眉の形そのものは変えない（§15） */
const BROW_TILT: Record<CharacterExpression, number> = {
  neutral: 0,
  smile: -1,
  grin: -2,
  open: 1,
  serious: 3,
  surprised: -4,
};

function brow(
  context: CharacterRenderContext,
  side: 'left' | 'right',
  shape: BrowShape,
): ReactNode {
  const anchor = side === 'left' ? context.anchors.leftEyebrow : context.anchors.rightEyebrow;
  const dir = side === 'left' ? -1 : 1;
  const tilt = BROW_TILT[context.expression];
  const half = shape.width / 2;

  // 内側（鼻寄り）と外側（こめかみ寄り）
  const innerX = anchor.x + dir * -half;
  const outerX = anchor.x + dir * half;
  const innerY = anchor.y + shape.angle + tilt;
  const outerY = anchor.y - shape.angle * 0.4;

  return (
    <path
      key={side}
      d={`M ${innerX} ${innerY} Q ${anchor.x} ${anchor.y - shape.arch} ${outerX} ${outerY}`}
      fill="none"
      stroke={context.palette.brow}
      strokeWidth={shape.thickness}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

function makeBrow(id: string, label: string, shape: BrowShape): CharacterPart {
  return {
    id,
    category: 'eyebrow',
    label,
    render: (context) => (
      <g>
        {brow(context, 'left', shape)}
        {brow(context, 'right', shape)}
      </g>
    ),
  };
}

export const EYEBROW_PARTS: CharacterPart[] = [
  makeBrow('brow_01', '標準', { width: 22, thickness: 3.4, angle: 1, arch: 3 }),
  makeBrow('brow_02', '太い', { width: 24, thickness: 5, angle: 1, arch: 2 }),
  makeBrow('brow_03', '細い', { width: 21, thickness: 2.2, angle: 1, arch: 3.5 }),
  makeBrow('brow_04', 'まっすぐ', { width: 23, thickness: 3.6, angle: 0, arch: 0.5 }),
  makeBrow('brow_05', '傾き', { width: 22, thickness: 3.6, angle: -2.5, arch: 2 }),
];

/* ================================================================
 * 鼻（§16）4種類
 * ============================================================== */

function makeNose(id: string, label: string, draw: (c: CharacterRenderContext) => ReactNode): CharacterPart {
  return { id, category: 'nose', label, render: draw };
}

/** 鼻4種類。写実にしない。点・短い線・三角・柔らかい曲線だけ（§16） */
export const NOSE_PARTS: CharacterPart[] = [
  makeNose('nose_01', '点', (c) => (
    <circle cx={c.anchors.nose.x} cy={c.anchors.nose.y} r={2.6} fill={c.palette.skinShadow} />
  )),
  makeNose('nose_02', '短い線', (c) => (
    <path
      d={`M ${c.anchors.nose.x - 1} ${c.anchors.nose.y - 5} L ${c.anchors.nose.x + 1.5} ${c.anchors.nose.y + 3}`}
      fill="none"
      stroke={c.palette.skinShadow}
      strokeWidth={STROKE.detail}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  )),
  makeNose('nose_03', '三角', (c) => (
    <path
      d={`M ${c.anchors.nose.x} ${c.anchors.nose.y - 6} L ${c.anchors.nose.x + 4.5} ${c.anchors.nose.y + 3} L ${c.anchors.nose.x - 4.5} ${c.anchors.nose.y + 3} Z`}
      fill={c.palette.skinShadow}
      stroke="none"
    />
  )),
  makeNose('nose_04', '柔らかい曲線', (c) => (
    <path
      d={`M ${c.anchors.nose.x - 4} ${c.anchors.nose.y + 1} Q ${c.anchors.nose.x} ${c.anchors.nose.y + 5} ${c.anchors.nose.x + 4} ${c.anchors.nose.y + 1}`}
      fill="none"
      stroke={c.palette.skinShadow}
      strokeWidth={STROKE.detail}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  )),
];

/* ================================================================
 * 口（§17）6種類
 * ============================================================== */

/**
 * 口は表情でいちばん変わる部分。
 * ただし「その選手の口の形」は変えず、開き方と口角だけを変える。
 */
function mouthPath(
  context: CharacterRenderContext,
  shape: { width: number; curve: number; open: number },
): ReactNode {
  const anchor = context.anchors.mouth;
  const half = shape.width / 2;
  const { palette, expression } = context;

  // 表情ごとの上乗せ。形ではなく開き方と口角を動かす
  const lift = expression === 'smile' ? 2 : expression === 'grin' ? 4 : expression === 'serious' ? -1.5 : 0;
  const open =
    expression === 'open' || expression === 'surprised'
      ? Math.max(shape.open, 6)
      : expression === 'grin'
        ? Math.max(shape.open, 4)
        : shape.open;
  const curve = shape.curve + lift;

  if (open <= 0.5) {
    // 閉じた口は1本の線
    return (
      <path
        d={`M ${anchor.x - half} ${anchor.y} Q ${anchor.x} ${anchor.y + curve} ${anchor.x + half} ${anchor.y}`}
        fill="none"
        stroke={palette.outline}
        strokeWidth={STROKE.secondary}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    );
  }

  return (
    <path
      d={[
        `M ${anchor.x - half} ${anchor.y}`,
        `Q ${anchor.x} ${anchor.y + curve} ${anchor.x + half} ${anchor.y}`,
        `Q ${anchor.x} ${anchor.y + curve + open} ${anchor.x - half} ${anchor.y}`,
        'Z',
      ].join(' ')}
      fill={palette.mouthInner}
      stroke={palette.outline}
      strokeWidth={STROKE.secondary}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}

function makeMouth(
  id: string,
  label: string,
  shape: { width: number; curve: number; open: number },
): CharacterPart {
  return { id, category: 'mouth', label, render: (context) => mouthPath(context, shape) };
}

export const MOUTH_PARTS: CharacterPart[] = [
  makeMouth('mouth_01', '標準', { width: 20, curve: 2, open: 0 }),
  makeMouth('mouth_02', '微笑', { width: 22, curve: 5, open: 0 }),
  makeMouth('mouth_03', '笑い', { width: 24, curve: 6, open: 5 }),
  makeMouth('mouth_04', '開き', { width: 18, curve: 3, open: 8 }),
  makeMouth('mouth_05', '真顔', { width: 19, curve: 0, open: 0 }),
  makeMouth('mouth_06', '驚き', { width: 14, curve: 2, open: 9 }),
];

/* ================================================================
 * 耳
 * ============================================================== */

/**
 * 耳。
 *
 * 耳は頭より **下** の層に描かれる（§6）。頭の縁の内側に置くと消える。
 * だからアンカー（頭が申告した縁）から **外へ** ふくらませる。
 * 幅を固定値にすると、細い頭では離れて浮き、広い頭では埋まる。
 */
function ear(context: CharacterRenderContext, side: 'left' | 'right'): ReactNode {
  const anchor = side === 'left' ? context.anchors.leftEar : context.anchors.rightEar;
  const dir = side === 'left' ? -1 : 1;
  // 縁から外へ出る分だけが見える。中心は縁より外に置く
  const cx = anchor.x + dir * 5;
  const cy = anchor.y;
  return (
    <g key={side}>
      <ellipse
        cx={cx}
        cy={cy}
        rx={7}
        ry={10}
        fill={context.palette.skin}
        stroke={context.palette.outline}
        strokeWidth={STROKE.secondary}
        vectorEffect="non-scaling-stroke"
      />
      {/* 耳のくぼみ。外へ出ている側にだけ入れる */}
      <path
        d={`M ${cx + dir * 2.5} ${cy - 4} Q ${cx - dir * 1} ${cy} ${cx + dir * 2} ${cy + 4}`}
        fill="none"
        stroke={context.palette.skinShadow}
        strokeWidth={STROKE.detail}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

export const EAR_PARTS: CharacterPart[] = [
  {
    id: 'ear_01',
    category: 'ear',
    label: '標準',
    render: (context) => (
      <g>
        {ear(context, 'left')}
        {ear(context, 'right')}
      </g>
    ),
  },
];
