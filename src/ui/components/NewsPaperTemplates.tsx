/**
 * ニュースの誌面（もらったテンプレート画像に、実際の文字を重ねる版）。
 *
 * テンプレート画像（src/assets/ui/paper/page*.webp）は、ユーザーが用意した
 * 「枠」で、写真・文字はすべてプレースホルダー。ここでは、その枠の上に
 * 実際のデータだけを重ねる。文字数が変わっても崩れないよう、SVGの
 * viewBox 座標系（画像と同じ大きさ）に文字を置き、画像ごと拡大縮小させる
 * （キャラクターSVGや球場SVGと同じ、既存のやり方）。
 *
 * 各要素の座標は、実際の画像を1%刻みの方眼で読み取り、
 * さらに表の罫線はピクセル単位の明暗の切り替わりを検出して決めた
 * （目分量ではない）。プレースホルダーの文字は、重ねる前に白い矩形で
 * いったん消してから実際の文字を書く（透けて二重に見えないように）。
 *
 * 守ること：
 *  - テンプレートの色・線・見出し飾り（TOPICS・選手特集…等の帯、
 *    ロゴ、表の罫線、「試合結果」「注目ポイント」等の固定ラベル）は
 *    そのまま。ここでは文字だけを足す
 *  - 実在しない項目（出身地・監督名・ファン数など）は書かない
 */
import type { ReactNode } from 'react';

import page3Bg from '../../assets/ui/paper/page3.webp';
import page4Bg from '../../assets/ui/paper/page4.webp';
import page5Bg from '../../assets/ui/paper/page5.webp';
import page6Bg from '../../assets/ui/paper/page6.webp';
import page7Bg from '../../assets/ui/paper/page7.webp';
import page8Bg from '../../assets/ui/paper/page8.webp';
import page9Bg from '../../assets/ui/paper/page9.webp';
import page10Bg from '../../assets/ui/paper/page10.webp';

/** 元画像を切り出したときの実ピクセルサイズ（viewBox に使う） */
const SIZE = {
  page3: { w: 381, h: 497, bg: page3Bg },
  page4: { w: 380, h: 497, bg: page4Bg },
  page5: { w: 379, h: 497, bg: page5Bg },
  page6: { w: 377, h: 497, bg: page6Bg },
  page7: { w: 381, h: 509, bg: page7Bg },
  page8: { w: 380, h: 509, bg: page8Bg },
  page9: { w: 380, h: 509, bg: page9Bg },
  page10: { w: 379, h: 509, bg: page10Bg },
} as const;

export type TemplateName = keyof typeof SIZE;

const INK = '#1c2430';
const INK_DIM = '#4a5568';
const WHITE = '#ffffff';

/**
 * 日本語の文章を、決まった文字数で機械的に折り返す。
 * 単語の区切りが無い言語なので、単純に文字数で切るだけ。
 * 収まらない分は「…」で切る（無いことにせず、切れたと分かる形にする）。
 */
export function wrapJa(text: string, charsPerLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  let rest = text.replace(/\s+/g, ' ').trim();
  while (rest.length > 0 && lines.length < maxLines) {
    if (lines.length === maxLines - 1 && rest.length > charsPerLine) {
      lines.push(rest.slice(0, Math.max(1, charsPerLine - 1)) + '…');
      rest = '';
      break;
    }
    lines.push(rest.slice(0, charsPerLine));
    rest = rest.slice(charsPerLine);
  }
  return lines;
}

/**
 * 指定した幅・フォントサイズ（どちらも%指定）に収まる、おおよその文字数。
 * 日本語（全角）の実際の字送りは、フォントサイズの約75%程度になることが
 * 多いため、その係数で概算する（テンプレート画像の実測値と一致するよう調整済み）。
 * これを使うことで、ボックスごとに手で文字数を決め打ちして食い違う、
 * という間違いを防ぐ。
 */
function fitChars(wTotal: number, hTotal: number, widthPct: number, sizePct: number): number {
  const availPx = (widthPct / 100) * wTotal;
  const fontPx = (sizePct / 100) * hTotal;
  return Math.max(1, Math.floor(availPx / (fontPx * 0.92)));
}

/**
 * プレースホルダーの文字を隠す下地（% 座標）。
 * 既定は白（白地の上の文字を消す）。色帯の中の文字を消すときは
 * fillOverride にその帯の色を渡す（白で塗ると帯に白い穴が空いて見えるため）。
 */
function Cover({
  x,
  y,
  w,
  h,
  wTotal,
  hTotal,
  fillOverride,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  wTotal: number;
  hTotal: number;
  fillOverride?: string;
}) {
  return (
    <rect
      x={(x / 100) * wTotal}
      y={(y / 100) * hTotal}
      width={(w / 100) * wTotal}
      height={(h / 100) * hTotal}
      fill={fillOverride ?? WHITE}
    />
  );
}

/** 複数行テキスト。1行ずつ tspan で置く（座標は % 指定） */
function Text({
  x,
  y,
  wTotal,
  hTotal,
  size,
  weight = 400,
  fill = INK_DIM,
  anchor = 'start',
  lines,
  lineHeight,
}: {
  x: number;
  y: number;
  wTotal: number;
  hTotal: number;
  size: number;
  weight?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  lines: string[];
  lineHeight: number;
}) {
  const px = (x / 100) * wTotal;
  const py = (y / 100) * hTotal;
  const fs = (size / 100) * hTotal;
  const lh = (lineHeight / 100) * hTotal;
  return (
    <text x={px} y={py} fontSize={fs} fontWeight={weight} fill={fill} textAnchor={anchor}>
      {lines.map((line, i) => (
        <tspan key={i} x={px} dy={i === 0 ? 0 : lh}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/** マストヘッドの日付。画像に焼き込まれている架空の日付を、白で塗って実際の日付に差し替える */
function DateStamp({ w, h, date }: { w: number; h: number; date: string }) {
  return (
    <g>
      <rect x={w * 0.6} y={0} width={w * 0.4} height={h * 0.035} fill={WHITE} />
      <text x={w * 0.98} y={h * 0.024} fontSize={h * 0.021} fill={INK_DIM} textAnchor="end">
        {date}
      </text>
    </g>
  );
}

/**
 * 1ページの土台。テンプレート画像を viewBox いっぱいに敷き、
 * 子要素（文字の overlay）をその上に置く。画像ごと拡大縮小されるので、
 * 画面幅が変わっても文字と枠がずれない。
 */
function TemplateFrame({
  name,
  date,
  children,
  htmlLayer,
}: {
  name: TemplateName;
  date: string;
  children?: ReactNode;
  /** 写真の代わりに置く、通常のHTML要素（選手の肖像など）。%位置で重ねる */
  htmlLayer?: ReactNode;
}) {
  const { w, h, bg } = SIZE[name];
  return (
    <div className="paper-page" style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <image href={bg} x={0} y={0} width={w} height={h} />
        <DateStamp w={w} h={h} date={date} />
        {children}
      </svg>
      {htmlLayer}
    </div>
  );
}

/** 写真の枠に procedural な絵（選手肖像・球団マーク等）を重ねる位置指定つきラッパー（% 座標） */
function PhotoSlot({
  top,
  left,
  width,
  height,
  children,
}: {
  top: string;
  left: string;
  width: string;
  height: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top,
        left,
        width,
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        /* テンプレートに焼き込まれた「写真が入ります」の文字が、
           肖像やロゴの隙間から透けて見えないよう、枠全体を不透明な
           下地色で覆ってから絵を中央に置く */
        background: '#dde2e8',
      }}
    >
      {children}
    </div>
  );
}

/**
 * 見出し・サブ見出し（3面〜6面・8面〜10面、共通の位置）。
 * テンプレート自体が見出しを1行だけで見せる作りなので、収まらない分は
 * 「…」で切る（無理に2行へ潰して読みにくくしない）。
 */
function HeadlineBlock({
  w,
  h,
  headline,
  subhead,
}: {
  w: number;
  h: number;
  headline: string;
  subhead: string;
}) {
  return (
    <>
      <Cover x={2} y={14.5} w={96} h={11} wTotal={w} hTotal={h} />
      <Text
        x={3}
        y={23}
        wTotal={w}
        hTotal={h}
        size={7}
        weight={800}
        fill={INK}
        lineHeight={0}
        lines={wrapJa(headline, fitChars(w, h, 96, 7), 1)}
      />
      <Cover x={2} y={25.5} w={96} h={4.5} wTotal={w} hTotal={h} />
      <Text
        x={3}
        y={29}
        wTotal={w}
        hTotal={h}
        size={3.3}
        lineHeight={0}
        lines={wrapJa(subhead, fitChars(w, h, 96, 3.3), 1)}
      />
    </>
  );
}

/* ================================================================
 * 3面 TOPICS（試合の話題）
 * ============================================================== */

export function Page3Topics({
  date,
  headline,
  subhead,
  lead,
  results,
  highlights,
  photo,
}: {
  date: string;
  headline: string;
  subhead: string;
  /** 本文（リード文欄に入れる） */
  lead: string;
  /** 「試合結果」欄。無ければ空配列（最大3件） */
  results: Array<{ opponent: string; score: string }>;
  /** 「注目ポイント」欄。無ければ空配列 */
  highlights: string[];
  photo?: ReactNode;
}) {
  const { w, h } = SIZE.page3;
  return (
    <TemplateFrame
      name="page3"
      date={date}
      htmlLayer={
        photo && (
          <PhotoSlot top="30%" left="5%" width="50%" height="29%">
            {photo}
          </PhotoSlot>
        )
      }
    >
      <HeadlineBlock w={w} h={h} headline={headline} subhead={subhead} />
      <Cover x={55} y={30} w={41} h={33} wTotal={w} hTotal={h} />
      <Text x={57} y={34} wTotal={w} hTotal={h} size={3.2} lineHeight={4.3} lines={wrapJa(lead, fitChars(w, h, 41, 3.2), 7)} />
      {/*
        テンプレートの「勝敗」欄は、右側の「注目ポイント」欄と同じ場所に
        重なって置かれている（元画像の時点で領域が重複している）ため、
        3列目は使わず、対戦相手とスコア（勝敗の記号つき）の2列だけを
        左半分（〜54%）に収める。
      */}
      {results.slice(0, 3).map((r, i) => {
        const y = 72 + i * 5.3;
        return (
          <g key={i}>
            <Cover x={9} y={y - 2.8} w={28} h={5} wTotal={w} hTotal={h} />
            <text x={(w * 9) / 100} y={(h * y) / 100} fontSize={h * 0.023} fill={INK}>
              {wrapJa(r.opponent, fitChars(w, h, 28, 2.3), 1)[0]}
            </text>
            <Cover x={37} y={y - 2.8} w={18} h={5} wTotal={w} hTotal={h} />
            <text x={(w * 46) / 100} y={(h * y) / 100} fontSize={h * 0.024} fill={INK} textAnchor="middle">
              {r.score}
            </text>
          </g>
        );
      })}
      {highlights.length > 0 && (
        <>
          <Cover x={55} y={70} w={43} h={17} wTotal={w} hTotal={h} />
          <Text
            x={57}
            y={74}
            wTotal={w}
            hTotal={h}
            size={2.9}
            lineHeight={5}
            lines={highlights.slice(0, 3).map((t) => `・${wrapJa(t, fitChars(w, h, 41, 2.9) - 1, 1)[0]}`)}
          />
        </>
      )}
    </TemplateFrame>
  );
}

/* ================================================================
 * 4面 / 5面 選手特集（打者 / 投手）・6面 チーム情報
 * ============================================================== */

interface DataRowsPageProps {
  date: string;
  headline: string;
  subhead: string;
  body: string;
  rows: Array<{ label?: string; value: string }>;
  highlight: string | null;
  photo?: ReactNode;
}

function DataRowsPage({
  name,
  headline,
  subhead,
  body,
  rows,
  highlight,
  labelCoverNeeded,
}: Omit<DataRowsPageProps, 'date' | 'photo'> & { name: 'page4' | 'page5' | 'page6'; labelCoverNeeded: boolean }) {
  const { w, h } = SIZE[name];
  const rowStart = name === 'page5' ? 69.4 : 69;
  const rowStep = name === 'page5' ? 4.9 : 4.8;
  const valueX = name === 'page5' ? 34 : labelCoverNeeded ? 29 : 29;
  return (
    <>
      <HeadlineBlock w={w} h={h} headline={headline} subhead={subhead} />
      <Cover x={55} y={30} w={41} h={33} wTotal={w} hTotal={h} />
      <Text x={57} y={39} wTotal={w} hTotal={h} size={3.3} lineHeight={5.3} lines={wrapJa(body, fitChars(w, h, 41, 3.3), 5)} />
      {rows.slice(0, 5).map((r, i) => {
        const y = rowStart + i * rowStep;
        return (
          <g key={i}>
            {labelCoverNeeded && r.label && (
              <>
                <Cover x={7} y={y - 3} w={20} h={4.3} wTotal={w} hTotal={h} />
                <text x={(w * 9) / 100} y={(h * y) / 100} fontSize={h * 0.026} fill={INK_DIM}>
                  {r.label}
                </text>
              </>
            )}
            <Cover x={27} y={y - 3} w={65} h={4.3} wTotal={w} hTotal={h} />
            <text x={(w * valueX) / 100} y={(h * y) / 100} fontSize={h * 0.028} fill={INK}>
              {wrapJa(r.value, fitChars(w, h, 62, 2.8), 1)[0]}
            </text>
          </g>
        );
      })}
      {highlight && (
        <>
          <Cover x={66} y={63} w={32} h={12} wTotal={w} hTotal={h} />
          <Text x={83} y={66.5} wTotal={w} hTotal={h} size={2.7} anchor="middle" lineHeight={4} lines={wrapJa(highlight, fitChars(w, h, 30, 2.7), 2)} />
        </>
      )}
    </>
  );
}

export function Page4Batter({ date, photo, ...rest }: DataRowsPageProps) {
  return (
    <TemplateFrame
      name="page4"
      date={date}
      htmlLayer={
        photo && (
          <PhotoSlot top="30%" left="5%" width="50%" height="30%">
            {photo}
          </PhotoSlot>
        )
      }
    >
      <DataRowsPage name="page4" labelCoverNeeded={false} {...rest} />
    </TemplateFrame>
  );
}

export function Page5Pitcher({ date, photo, ...rest }: DataRowsPageProps) {
  return (
    <TemplateFrame
      name="page5"
      date={date}
      htmlLayer={
        photo && (
          <PhotoSlot top="30%" left="5%" width="50%" height="30%">
            {photo}
          </PhotoSlot>
        )
      }
    >
      <DataRowsPage name="page5" labelCoverNeeded={false} {...rest} />
    </TemplateFrame>
  );
}

export function Page6Team(props: DataRowsPageProps) {
  return (
    <TemplateFrame
      name="page6"
      date={props.date}
      htmlLayer={
        props.photo && (
          <PhotoSlot top="30%" left="5%" width="50%" height="30%">
            {props.photo}
          </PhotoSlot>
        )
      }
    >
      {/*
        テンプレートの行ラベル（監督・球場・過去成績・本拠地・ファン数）は
        このゲームに存在しない項目なので、白で塗って実在する項目名に差し替える。
      */}
      <DataRowsPage name="page6" labelCoverNeeded {...props} />
    </TemplateFrame>
  );
}

/* ================================================================
 * 7面 順位・成績
 * ============================================================== */

export interface StandingsRowFacts {
  rank: number;
  teamShort: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winPct: string;
  gamesBehind: string;
}

export interface BattingLeaderFacts {
  rank: number;
  name: string;
  average: string;
  homeRuns: number;
  rbi: number;
}

export function Page7Standings({
  date,
  headline,
  subhead,
  standings,
  leaders,
  catchphrase,
}: {
  date: string;
  headline: string;
  subhead: string;
  standings: StandingsRowFacts[];
  leaders: BattingLeaderFacts[];
  catchphrase: string;
}) {
  const { w, h } = SIZE.page7;
  const colX = { team: 23.7, games: 36.5, wins: 45.5, losses: 54.6, draws: 63.5, pct: 74.9, gb: 87 };
  const leaderX = { name: 21, avg: 52, hr: 69.5, rbi: 86.7 };
  return (
    <TemplateFrame name="page7" date={date}>
      <Cover x={2} y={14.5} w={96} h={11} wTotal={w} hTotal={h} />
      <Text x={3} y={23} wTotal={w} hTotal={h} size={7} weight={800} fill={INK} lineHeight={0} lines={wrapJa(headline, fitChars(w, h, 96, 7), 1)} />
      <Cover x={2} y={25.5} w={96} h={4.5} wTotal={w} hTotal={h} />
      <Text x={3} y={29} wTotal={w} hTotal={h} size={3.3} lineHeight={0} lines={wrapJa(subhead, fitChars(w, h, 96, 3.3), 1)} />
      {standings.slice(0, 6).map((row, i) => {
        const y = 39.5 + i * 3.65;
        return (
          <g key={row.rank}>
            <Cover x={16} y={y - 2.6} w={78} h={3.6} wTotal={w} hTotal={h} />
            <text x={(w * colX.team) / 100} y={(h * y) / 100} fontSize={h * 0.023} fill={INK}>{wrapJa(row.teamShort, fitChars(w, h, 12, 2.3), 1)[0]}</text>
            <text x={(w * colX.games) / 100} y={(h * y) / 100} fontSize={h * 0.023} textAnchor="middle" fill={INK}>{row.games}</text>
            <text x={(w * colX.wins) / 100} y={(h * y) / 100} fontSize={h * 0.023} textAnchor="middle" fill={INK}>{row.wins}</text>
            <text x={(w * colX.losses) / 100} y={(h * y) / 100} fontSize={h * 0.023} textAnchor="middle" fill={INK}>{row.losses}</text>
            <text x={(w * colX.draws) / 100} y={(h * y) / 100} fontSize={h * 0.023} textAnchor="middle" fill={INK}>{row.draws}</text>
            <text x={(w * colX.pct) / 100} y={(h * y) / 100} fontSize={h * 0.023} textAnchor="middle" fill={INK}>{row.winPct}</text>
            <text x={(w * colX.gb) / 100} y={(h * y) / 100} fontSize={h * 0.023} textAnchor="middle" fill={INK}>{row.gamesBehind}</text>
          </g>
        );
      })}
      {leaders.slice(0, 5).map((row, i) => {
        const y = 69.35 + i * 2.95;
        return (
          <g key={row.rank}>
            <Cover x={16} y={y - 2.1} w={78} h={2.9} wTotal={w} hTotal={h} />
            <text x={(w * leaderX.name) / 100} y={(h * y) / 100} fontSize={h * 0.021} fill={INK}>{wrapJa(row.name, fitChars(w, h, 26, 2.1), 1)[0]}</text>
            <text x={(w * leaderX.avg) / 100} y={(h * y) / 100} fontSize={h * 0.021} textAnchor="middle" fill={INK}>{row.average}</text>
            <text x={(w * leaderX.hr) / 100} y={(h * y) / 100} fontSize={h * 0.021} textAnchor="middle" fill={INK}>{row.homeRuns}</text>
            <text x={(w * leaderX.rbi) / 100} y={(h * y) / 100} fontSize={h * 0.021} textAnchor="middle" fill={INK}>{row.rbi}</text>
          </g>
        );
      })}
      {/* テンプレート左端の「B」ロゴには重ねない（帯の色だけ塗り直す） */}
      <Cover x={18} y={85} w={76} h={11} wTotal={w} hTotal={h} fillOverride="#1c3a6e" />
      <Text x={20} y={89} wTotal={w} hTotal={h} size={3} fill="#ffffff" lineHeight={4} lines={wrapJa(catchphrase, fitChars(w, h, 74, 3), 2)} />
    </TemplateFrame>
  );
}

/* ================================================================
 * 8面 ファーム情報
 * ============================================================== */

export interface FarmRowFacts {
  rank: number;
  name: string;
  line: string;
}

export function Page8Farm({
  date,
  headline,
  subhead,
  body,
  rows,
  catchphrase,
  photo,
}: {
  date: string;
  headline: string;
  subhead: string;
  body: string;
  rows: FarmRowFacts[];
  catchphrase: string;
  photo?: ReactNode;
}) {
  const { w, h } = SIZE.page8;
  return (
    <TemplateFrame
      name="page8"
      date={date}
      htmlLayer={
        photo && (
          <PhotoSlot top="30%" left="5%" width="50%" height="30%">
            {photo}
          </PhotoSlot>
        )
      }
    >
      <HeadlineBlock w={w} h={h} headline={headline} subhead={subhead} />
      <Cover x={55} y={30} w={41} h={33} wTotal={w} hTotal={h} />
      <Text x={57} y={39} wTotal={w} hTotal={h} size={3.1} lineHeight={4} lines={wrapJa(body, fitChars(w, h, 41, 3.1), 5)} />
      {rows.slice(0, 5).map((r, i) => {
        const y = 65.75 + i * 3.35;
        return (
          <g key={r.rank}>
            <Cover x={16} y={y - 2.3} w={76} h={3.3} wTotal={w} hTotal={h} />
            <text x={(w * 18) / 100} y={(h * y) / 100} fontSize={h * 0.023} fill={INK}>{wrapJa(r.name, fitChars(w, h, 28, 2.3), 1)[0]}</text>
            <text x={(w * 52) / 100} y={(h * y) / 100} fontSize={h * 0.023} fill={INK}>{wrapJa(r.line, fitChars(w, h, 38, 2.3), 1)[0]}</text>
          </g>
        );
      })}
      {/* テンプレート右端の「B」ロゴには重ねない */}
      <Cover x={2} y={82.2} w={73} h={13.8} wTotal={w} hTotal={h} fillOverride="#4a2d82" />
      <Text x={10} y={87} wTotal={w} hTotal={h} size={3.1} fill="#ffffff" lineHeight={4.1} lines={wrapJa(catchphrase, fitChars(w, h, 63, 3.1), 2)} />
    </TemplateFrame>
  );
}

/* ================================================================
 * 9面 コラム
 * ============================================================== */

export function Page9Column({
  date,
  headline,
  subhead,
  body,
  authorLabel,
  quote,
  photo,
  scene,
}: {
  date: string;
  headline: string;
  subhead: string;
  body: string;
  authorLabel: string;
  quote: string;
  photo?: ReactNode;
  scene?: ReactNode;
}) {
  const { w, h } = SIZE.page9;
  return (
    <TemplateFrame
      name="page9"
      date={date}
      htmlLayer={
        <>
          {photo && (
            <PhotoSlot top="32%" left="5%" width="30%" height="24%">
              {photo}
            </PhotoSlot>
          )}
          {scene && (
            <PhotoSlot top="70%" left="52%" width="44%" height="20%">
              {scene}
            </PhotoSlot>
          )}
        </>
      }
    >
      <Cover x={2} y={14.5} w={96} h={11} wTotal={w} hTotal={h} />
      <Text x={3} y={23} wTotal={w} hTotal={h} size={7} weight={800} fill={INK} lineHeight={0} lines={wrapJa(headline, fitChars(w, h, 96, 7), 1)} />
      <Cover x={2} y={25.5} w={96} h={4.5} wTotal={w} hTotal={h} />
      <Text x={3} y={29} wTotal={w} hTotal={h} size={3.3} lineHeight={0} lines={wrapJa(subhead, fitChars(w, h, 96, 3.3), 1)} />
      <Cover x={36} y={31} w={60} h={39} wTotal={w} hTotal={h} />
      <Text x={37} y={35} wTotal={w} hTotal={h} size={2.8} lineHeight={4.4} lines={wrapJa(body, fitChars(w, h, 59, 2.8), 8)} />
      {/* テンプレートの本文は写真の下まで全幅で流れ込む作りだが、
          ここでは右列だけに文字を置くため、左下に残るプレースホルダーの
          「記事の本文が入ります」を別途消す */}
      <Cover x={3} y={57} w={33} h={14} wTotal={w} hTotal={h} />
      <Cover x={5} y={50} w={32} h={4.5} wTotal={w} hTotal={h} />
      <text x={(w * 5) / 100} y={(h * 53) / 100} fontSize={h * 0.024} fill={INK_DIM}>
        {wrapJa(authorLabel, fitChars(w, h, 32, 2.4), 1)[0]}
      </text>
      <Cover x={8} y={74} w={42} h={15} wTotal={w} hTotal={h} />
      <Text x={11} y={79} wTotal={w} hTotal={h} size={3} weight={700} fill={INK} lineHeight={4.6} lines={wrapJa(quote, fitChars(w, h, 38, 3), 3)} />
    </TemplateFrame>
  );
}

/* ================================================================
 * 10面 特集
 * ============================================================== */

export function Page10Feature({
  date,
  headline,
  subhead,
  body,
  catchphrase,
  scene,
}: {
  date: string;
  headline: string;
  subhead: string;
  body: string;
  catchphrase: string;
  scene?: ReactNode;
}) {
  const { w, h } = SIZE.page10;
  return (
    <TemplateFrame
      name="page10"
      date={date}
      htmlLayer={
        scene && (
          <PhotoSlot top="30%" left="5%" width="90%" height="28%">
            {scene}
          </PhotoSlot>
        )
      }
    >
      <Cover x={2} y={14.5} w={96} h={11} wTotal={w} hTotal={h} />
      <Text x={3} y={23} wTotal={w} hTotal={h} size={7} weight={800} fill={INK} lineHeight={0} lines={wrapJa(headline, fitChars(w, h, 96, 7), 1)} />
      <Cover x={2} y={25.5} w={96} h={4.5} wTotal={w} hTotal={h} />
      <Text x={3} y={29} wTotal={w} hTotal={h} size={3.3} lineHeight={0} lines={wrapJa(subhead, fitChars(w, h, 96, 3.3), 1)} />
      <Cover x={2} y={59} w={96} h={19} wTotal={w} hTotal={h} />
      <Text x={3} y={62} wTotal={w} hTotal={h} size={2.8} lineHeight={3.8} lines={wrapJa(body, fitChars(w, h, 96, 2.8), 5)} />
      <Cover x={2} y={78} w={62} h={13} wTotal={w} hTotal={h} />
      <Text x={8} y={83} wTotal={w} hTotal={h} size={3.3} weight={700} fill={INK} lineHeight={4.4} lines={wrapJa(catchphrase, fitChars(w, h, 54, 3.3), 2)} />
    </TemplateFrame>
  );
}
