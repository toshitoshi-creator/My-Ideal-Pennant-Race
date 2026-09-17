/**
 * ニュースの誌面（テンプレート画像の枠に、実際の文字を書き込む版）。
 *
 * テンプレート画像（src/assets/ui/paper/page*.webp）は、ユーザーが用意した
 * 「枠」だけの画像（写真欄・表・見出し欄はすべて空の罫線）。ここでは、
 * その枠の中に実際のデータだけを配置する。文字数が変わっても崩れないよう、
 * SVGの viewBox 座標系（画像と同じ大きさ）に文字を置き、画像ごと拡大縮小
 * させる（キャラクターSVGや球場SVGと同じ、既存のやり方）。
 *
 * 各枠の位置は、実際の画像を1%刻みの方眼で読み取って決めた（目分量では
 * ない）。枠の中は空白なので、プレースホルダーを消す処理は不要（前バージョン
 * にあった白い下地での「文字消し」は、この版では使っていない）。
 *
 * 守ること：
 *  - 実在しない項目（出身地・監督名・ファン数など）は書かない
 *  - 文字が長くて欄に収まらない場合は「…」で切り、架空の値で埋めない
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

/** 元画像の実ピクセルサイズ（viewBox に使う） */
const SIZE = {
  page3: { w: 370, h: 486, bg: page3Bg },
  page4: { w: 369, h: 486, bg: page4Bg },
  page5: { w: 368, h: 486, bg: page5Bg },
  page6: { w: 366, h: 486, bg: page6Bg },
  page7: { w: 370, h: 498, bg: page7Bg },
  page8: { w: 369, h: 498, bg: page8Bg },
  page9: { w: 369, h: 498, bg: page9Bg },
  page10: { w: 368, h: 498, bg: page10Bg },
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
 * 日本語（全角）の実際の字送りは、フォントサイズの9割前後になることが
 * 多いため、その係数で概算する。ボックスごとに手で文字数を決め打ちして
 * 食い違う、という間違いを防ぐ。
 */
function fitChars(wTotal: number, hTotal: number, widthPct: number, sizePct: number): number {
  const availPx = (widthPct / 100) * wTotal;
  const fontPx = (sizePct / 100) * hTotal;
  return Math.max(1, Math.floor(availPx / (fontPx * 1.02)));
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

/** 見出し帯（キッカー）に載せる白文字のラベル（TOPICS・選手特集…等） */
function RibbonLabel({ w, h, label }: { w: number; h: number; label: string }) {
  return (
    <text x={w * 0.05} y={h * 0.145} fontSize={h * 0.024} fontWeight={700} fill={WHITE}>
      {label}
    </text>
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
  kicker,
  children,
  htmlLayer,
}: {
  name: TemplateName;
  date: string;
  /** キッカー帯に載せる白文字（TOPICS・選手特集…等） */
  kicker: string;
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
        <RibbonLabel w={w} h={h} label={kicker} />
        {children}
      </svg>
      {htmlLayer}
    </div>
  );
}

/** 写真・図解の枠に procedural な絵（選手肖像・球団マーク等）を重ねる位置指定つきラッパー（% 座標） */
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
      }}
    >
      {children}
    </div>
  );
}

/**
 * 見出し・サブ見出し（テキスト欄の先頭に置く、共通の書き方）。
 * 見出しの行数は欄の幅によって変わる（狭い欄では小さめの文字で3行まで
 * 許す）ため、サブ見出しの位置は実際に使った行数から計算する
 * （行数を決め打ちすると、狭い欄で見出しとサブ見出しが重なるため）。
 */
function HeadingLines({
  w,
  h,
  x,
  yTop,
  boxWidthPct,
  headline,
  subhead,
  headlineSize = 4.6,
  headlineMaxLines = 2,
  headlineLineHeight = 5,
}: {
  w: number;
  h: number;
  x: number;
  yTop: number;
  boxWidthPct: number;
  headline: string;
  subhead: string;
  headlineSize?: number;
  headlineMaxLines?: number;
  headlineLineHeight?: number;
}) {
  const headlineLines = wrapJa(headline, fitChars(w, h, boxWidthPct, headlineSize), headlineMaxLines);
  const subheadY = yTop + Math.max(1, headlineLines.length) * headlineLineHeight + 2.5;
  return (
    <>
      <Text
        x={x}
        y={yTop}
        wTotal={w}
        hTotal={h}
        size={headlineSize}
        weight={800}
        fill={INK}
        lineHeight={headlineLineHeight}
        lines={headlineLines}
      />
      <Text
        x={x}
        y={subheadY}
        wTotal={w}
        hTotal={h}
        size={3}
        lineHeight={0}
        lines={wrapJa(subhead, fitChars(w, h, boxWidthPct, 3), 1)}
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
  /** 本文（テキスト欄に入れる） */
  lead: string;
  /** 「試合結果」欄。無ければ空配列（最大3件） */
  results: Array<{ opponent: string; score: string; outcome: string }>;
  /** 「注目ポイント」欄。無ければ空配列 */
  highlights: string[];
  photo?: ReactNode;
}) {
  const { w, h } = SIZE.page3;
  return (
    <TemplateFrame
      name="page3"
      date={date}
      kicker="TOPICS"
      htmlLayer={
        photo && (
          <PhotoSlot top="17%" left="4%" width="59%" height="35%">
            {photo}
          </PhotoSlot>
        )
      }
    >
      <HeadingLines
        w={w}
        h={h}
        x={67}
        yTop={20}
        boxWidthPct={29}
        headline={headline}
        subhead={subhead}
        headlineSize={3.4}
        headlineMaxLines={3}
        headlineLineHeight={3.8}
      />
      <Text x={67} y={38} wTotal={w} hTotal={h} size={2.8} lineHeight={4} lines={wrapJa(lead, fitChars(w, h, 29, 2.8), 3)} />
      <text x={(w * 6) / 100} y={(h * 57.5) / 100} fontSize={h * 0.021} fill={WHITE} fontWeight={700}>対戦相手</text>
      <text x={(w * 42) / 100} y={(h * 57.5) / 100} fontSize={h * 0.021} fill={WHITE} fontWeight={700} textAnchor="middle">スコア</text>
      <text x={(w * 56) / 100} y={(h * 57.5) / 100} fontSize={h * 0.021} fill={WHITE} fontWeight={700} textAnchor="middle">勝敗</text>
      {results.slice(0, 3).map((r, i) => {
        const y = 64 + i * 6.5;
        return (
          <g key={i}>
            <text x={(w * 6) / 100} y={(h * y) / 100} fontSize={h * 0.024} fill={INK}>
              {wrapJa(r.opponent, fitChars(w, h, 28, 2.4), 1)[0]}
            </text>
            <text x={(w * 42) / 100} y={(h * y) / 100} fontSize={h * 0.026} fill={INK} textAnchor="middle">
              {r.score}
            </text>
            <text x={(w * 56) / 100} y={(h * y) / 100} fontSize={h * 0.024} fill={INK} textAnchor="middle">
              {wrapJa(r.outcome, fitChars(w, h, 12, 2.4), 1)[0]}
            </text>
          </g>
        );
      })}
      {highlights.length > 0 && (
        <Text
          x={67}
          y={60}
          wTotal={w}
          hTotal={h}
          size={2.6}
          lineHeight={4.4}
          lines={highlights.slice(0, 3).map((t) => `・${wrapJa(t, fitChars(w, h, 27, 2.6) - 1, 1)[0]}`)}
        />
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

function DataRowsPage({ name, headline, subhead, body, rows, highlight }: Omit<DataRowsPageProps, 'date' | 'photo'> & { name: 'page4' | 'page5' | 'page6' }) {
  const { w, h } = SIZE[name];
  return (
    <>
      <HeadingLines
        w={w}
        h={h}
        x={71}
        yTop={20}
        boxWidthPct={25}
        headline={headline}
        subhead={subhead}
        headlineSize={3.4}
        headlineMaxLines={3}
        headlineLineHeight={3.8}
      />
      <Text x={71} y={38} wTotal={w} hTotal={h} size={2.7} lineHeight={4} lines={wrapJa(body, fitChars(w, h, 25, 2.7), 3)} />
      {rows.slice(0, 5).map((r, i) => {
        const y = 61.5 + i * 5.2;
        return (
          <g key={i}>
            {r.label && (
              <text x={(w * 6) / 100} y={(h * y) / 100} fontSize={h * 0.024} fill={INK_DIM}>
                {wrapJa(r.label, fitChars(w, h, 14, 2.4), 1)[0]}
              </text>
            )}
            <text x={(w * 21) / 100} y={(h * y) / 100} fontSize={h * 0.026} fill={INK}>
              {wrapJa(r.value, fitChars(w, h, 45, 2.6), 1)[0]}
            </text>
          </g>
        );
      })}
      {highlight && (
        <Text x={71} y={62} wTotal={w} hTotal={h} size={2.7} lineHeight={4.4} lines={wrapJa(highlight, fitChars(w, h, 25, 2.7), 5)} />
      )}
    </>
  );
}

export function Page4Batter({ date, photo, ...rest }: DataRowsPageProps) {
  return (
    <TemplateFrame
      name="page4"
      date={date}
      kicker="選手特集"
      htmlLayer={
        photo && (
          <PhotoSlot top="17%" left="4%" width="62%" height="35%">
            {photo}
          </PhotoSlot>
        )
      }
    >
      <DataRowsPage name="page4" {...rest} />
    </TemplateFrame>
  );
}

export function Page5Pitcher({ date, photo, ...rest }: DataRowsPageProps) {
  return (
    <TemplateFrame
      name="page5"
      date={date}
      kicker="ピッチャー特集"
      htmlLayer={
        photo && (
          <PhotoSlot top="17%" left="4%" width="62%" height="35%">
            {photo}
          </PhotoSlot>
        )
      }
    >
      <DataRowsPage name="page5" {...rest} />
    </TemplateFrame>
  );
}

export function Page6Team(props: DataRowsPageProps) {
  return (
    <TemplateFrame
      name="page6"
      date={props.date}
      kicker="チーム情報"
      htmlLayer={
        props.photo && (
          <PhotoSlot top="17%" left="4%" width="62%" height="35%">
            {props.photo}
          </PhotoSlot>
        )
      }
    >
      <DataRowsPage name="page6" {...props} />
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
  return (
    <TemplateFrame name="page7" date={date} kicker="順位・成績">
      <HeadingLines w={w} h={h} x={5} yTop={20} boxWidthPct={90} headline={headline} subhead={subhead} />
      <text x={(w * 6) / 100} y={(h * 39) / 100} fontSize={h * 0.02} fill={WHITE} fontWeight={700}>チーム</text>
      <text x={(w * 31) / 100} y={(h * 39) / 100} fontSize={h * 0.02} fill={WHITE} fontWeight={700} textAnchor="middle">試合</text>
      <text x={(w * 51) / 100} y={(h * 39) / 100} fontSize={h * 0.02} fill={WHITE} fontWeight={700} textAnchor="middle">勝敗分</text>
      <text x={(w * 71) / 100} y={(h * 39) / 100} fontSize={h * 0.02} fill={WHITE} fontWeight={700} textAnchor="middle">勝率</text>
      <text x={(w * 88) / 100} y={(h * 39) / 100} fontSize={h * 0.02} fill={WHITE} fontWeight={700} textAnchor="middle">差</text>
      {standings.slice(0, 6).map((row, i) => {
        const y = 44 + i * 3.33;
        return (
          <g key={row.rank}>
            <text x={(w * 6) / 100} y={(h * y) / 100} fontSize={h * 0.021} fill={INK}>{wrapJa(row.teamShort, fitChars(w, h, 15, 2.1), 1)[0]}</text>
            <text x={(w * 31) / 100} y={(h * y) / 100} fontSize={h * 0.021} textAnchor="middle" fill={INK}>{row.games}</text>
            <text x={(w * 51) / 100} y={(h * y) / 100} fontSize={h * 0.021} textAnchor="middle" fill={INK}>{row.wins}-{row.losses}-{row.draws}</text>
            <text x={(w * 71) / 100} y={(h * y) / 100} fontSize={h * 0.021} textAnchor="middle" fill={INK}>{row.winPct}</text>
            <text x={(w * 88) / 100} y={(h * y) / 100} fontSize={h * 0.021} textAnchor="middle" fill={INK}>{row.gamesBehind}</text>
          </g>
        );
      })}
      <text x={(w * 6) / 100} y={(h * 66) / 100} fontSize={h * 0.02} fill={WHITE} fontWeight={700}>打者成績上位</text>
      <text x={(w * 51) / 100} y={(h * 66) / 100} fontSize={h * 0.02} fill={WHITE} fontWeight={700} textAnchor="middle">打率</text>
      <text x={(w * 71) / 100} y={(h * 66) / 100} fontSize={h * 0.02} fill={WHITE} fontWeight={700} textAnchor="middle">本塁打</text>
      <text x={(w * 88) / 100} y={(h * 66) / 100} fontSize={h * 0.02} fill={WHITE} fontWeight={700} textAnchor="middle">打点</text>
      {leaders.slice(0, 5).map((row, i) => {
        const y = 69.5 + i * 2.3;
        return (
          <g key={row.rank}>
            <text x={(w * 6) / 100} y={(h * y) / 100} fontSize={h * 0.019} fill={INK}>{wrapJa(row.name, fitChars(w, h, 34, 1.9), 1)[0]}</text>
            <text x={(w * 51) / 100} y={(h * y) / 100} fontSize={h * 0.019} textAnchor="middle" fill={INK}>{row.average}</text>
            <text x={(w * 71) / 100} y={(h * y) / 100} fontSize={h * 0.019} textAnchor="middle" fill={INK}>{row.homeRuns}</text>
            <text x={(w * 88) / 100} y={(h * y) / 100} fontSize={h * 0.019} textAnchor="middle" fill={INK}>{row.rbi}</text>
          </g>
        );
      })}
      <Text x={23} y={84.5} wTotal={w} hTotal={h} size={2.5} fill={WHITE} lineHeight={3.6} lines={wrapJa(catchphrase, fitChars(w, h, 50, 2.5), 2)} />
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
      kicker="ファーム情報"
      htmlLayer={
        photo && (
          <PhotoSlot top="17%" left="4%" width="62%" height="25%">
            {photo}
          </PhotoSlot>
        )
      }
    >
      <HeadingLines
        w={w}
        h={h}
        x={71}
        yTop={20}
        boxWidthPct={25}
        headline={headline}
        subhead={subhead}
        headlineSize={3.2}
        headlineMaxLines={2}
        headlineLineHeight={3.6}
      />
      <Text x={71} y={33} wTotal={w} hTotal={h} size={2.6} lineHeight={3.8} lines={wrapJa(body, fitChars(w, h, 25, 2.6), 2)} />
      <text x={(w * 6) / 100} y={(h * 47.5) / 100} fontSize={h * 0.021} fill={WHITE} fontWeight={700}>選手名</text>
      <text x={(w * 45) / 100} y={(h * 47.5) / 100} fontSize={h * 0.021} fill={WHITE} fontWeight={700}>成績</text>
      {rows.slice(0, 5).map((r, i) => {
        const y = 53.5 + i * 4.8;
        return (
          <g key={r.rank}>
            <text x={(w * 6) / 100} y={(h * y) / 100} fontSize={h * 0.023} fill={INK}>{wrapJa(r.name, fitChars(w, h, 36, 2.3), 1)[0]}</text>
            <text x={(w * 45) / 100} y={(h * y) / 100} fontSize={h * 0.023} fill={INK}>{wrapJa(r.line, fitChars(w, h, 46, 2.3), 1)[0]}</text>
          </g>
        );
      })}
      <Text x={9} y={81} wTotal={w} hTotal={h} size={2.9} fill={WHITE} lineHeight={4.2} lines={wrapJa(catchphrase, fitChars(w, h, 68, 2.9), 2)} />
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
      kicker="コラム"
      htmlLayer={
        <>
          {photo && (
            <PhotoSlot top="17%" left="71%" width="25%" height="43%">
              {photo}
            </PhotoSlot>
          )}
          {scene && (
            <PhotoSlot top="64%" left="71%" width="25%" height="25%">
              {scene}
            </PhotoSlot>
          )}
        </>
      }
    >
      <HeadingLines w={w} h={h} x={6} yTop={22} boxWidthPct={60} headline={headline} subhead={subhead} />
      <Text x={6} y={35} wTotal={w} hTotal={h} size={2.7} lineHeight={4} lines={wrapJa(body, fitChars(w, h, 60, 2.7), 6)} />
      <text x={(w * 6) / 100} y={(h * 58) / 100} fontSize={h * 0.023} fill={INK_DIM}>
        {wrapJa(authorLabel, fitChars(w, h, 60, 2.3), 1)[0]}
      </text>
      <Text x={6} y={71} wTotal={w} hTotal={h} size={2.9} weight={700} fill={INK} lineHeight={4.4} lines={wrapJa(quote, fitChars(w, h, 59, 2.9), 5)} />
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
      kicker="特集"
      htmlLayer={
        scene && (
          <PhotoSlot top="17%" left="4%" width="92%" height="24%">
            {scene}
          </PhotoSlot>
        )
      }
    >
      <HeadingLines w={w} h={h} x={6} yTop={45} boxWidthPct={90} headline={headline} subhead={subhead} />
      <Text x={6} y={57} wTotal={w} hTotal={h} size={2.8} lineHeight={4} lines={wrapJa(body, fitChars(w, h, 90, 2.8), 3)} />
      <Text x={9} y={80} wTotal={w} hTotal={h} size={3.1} weight={700} fill={INK} lineHeight={4.4} lines={wrapJa(catchphrase, fitChars(w, h, 55, 3.1), 2)} />
    </TemplateFrame>
  );
}
