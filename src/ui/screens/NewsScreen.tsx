import { useEffect, useMemo, useState } from 'react';
import { Sec } from '../components/Sec';
import { useGame } from '../store';
import { Sheet, Tabs } from '../components/common';
import { NewsCard } from '../components/NewsCard';
import { PlayerHistoryView } from '../components/PlayerHistoryView';
import { CATEGORY_LABELS, markNewsRead, newsOfCategory } from '../../domain/news';
import { recentStories } from '../../domain/story';
import { formatDateJa } from '../../domain/dates';
import { dayFlow, seasonTimeline, timelineYears } from '../../domain/seasonFlow';
import {
  DECISION_KIND_LABELS,
  DECISION_KIND_TAGS,
  decisionOutcome,
  decisionYears,
  decisionsOfYear,
} from '../../domain/decisions';
import type { DecisionRecord } from '../../domain/types';
import type { NewsItem } from '../../domain/types';
import type { NewsCategory, PlayerHistory } from '../../domain/types';

type Filter = NewsCategory | 'ALL';
type Tab = 'news' | 'stories' | 'journal';

/** 絞り込みに出すカテゴリ（使う機会の多い順） */
const FILTERS: Filter[] = [
  'ALL',
  'GAME',
  'PLAYER',
  'TEAM',
  'CHAMPIONSHIP',
  'POSTSEASON',
  'RECORD',
  'AWARD',
  'TRADE',
  'FA',
  'DRAFT',
  'RETIREMENT',
  'INJURY',
];

/** 同じ日のニュースをひとまとめにする（並び順は変えない） */
function groupByDate(items: NewsItem[]): Array<{ date: string; items: NewsItem[] }> {
  const groups: Array<{ date: string; items: NewsItem[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.date) last.items.push(item);
    else groups.push({ date: item.date, items: [item] });
  }
  return groups;
}

export function NewsScreen() {
  const { state, mutate } = useGame();
  const [tab, setTab] = useState<Tab>('news');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [selected, setSelected] = useState<PlayerHistory | null>(null);

  // 開いたら既読にする（未読件数をホームに出しているため）
  useEffect(() => {
    mutate((draft) => markNewsRead(draft));
    // 開いた瞬間の1回だけでよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo(() => newsOfCategory(state, filter).slice(0, 120), [state, filter]);
  const stories = useMemo(() => recentStories(state), [state]);

  const openPlayer = (playerId: string) => {
    const history = state.history.players[playerId];
    if (history) setSelected(history);
  };

  return (
    <>
      <Tabs
        tabs={[
          { id: 'news', label: 'ニュース' },
          { id: 'stories', label: 'シーズンの記録' },
          { id: 'journal', label: 'GM日誌' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="screen">
        {tab === 'news' ? (
          <>
            <div className="card">
              <div className="scroll-x" style={{ paddingBottom: 4 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {FILTERS.map((f) => (
                    <button
                      key={f}
                      className={f === filter ? 'chip on' : 'chip'}
                      style={{ whiteSpace: 'nowrap' }}
                      onClick={() => setFilter(f)}
                    >
                      {f === 'ALL' ? 'すべて' : CATEGORY_LABELS[f]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <TodayFlow />
            <div className="card">
              <Sec en="CLUB NEWS" ja="ニュース" size="lead" note={`${items.length}件`} />
              {items.length === 0 ? (
                <p className="muted">まだニュースはありません。</p>
              ) : (
                /*
                 * PHASE 4.3: 新聞の紙面として日付ごとにまとめる。
                 * 1行ずつ日付を繰り返すと同じ濃さの行が並び、紙面に見えないため。
                 */
                groupByDate(items).map((group) => (
                  <section key={group.date} className="news-day">
                    <div className="news-day-head">
                      <span className="news-day-date">{formatDateJa(group.date)}</span>
                      <span className="news-day-rule" />
                    </div>
                    {group.items.map((item, i) => (
                      <NewsCard
                        key={item.id}
                        item={item}
                        index={i}
                        onSelectPlayer={openPlayer}
                      />
                    ))}
                  </section>
                ))
              )}
            </div>
          </>
        ) : tab === 'stories' ? (
          <SeasonRecord stories={stories} />
        ) : (
          <GmJournal />
        )}
      </div>
      {selected && (
        <Sheet title={selected.name} onClose={() => setSelected(null)}>
          <PlayerHistoryView history={selected} />
        </Sheet>
      )}
    </>
  );
}

/**
 * PHASE 4.4 §18「今日この球団で何が起きたか」。
 *
 * 時刻はゲームに存在しないので、時計の数字は出さない。
 * 出すのは「判断 → 試合 → 届いた記事」という順序だけ。
 */
function TodayFlow() {
  const { state } = useGame();
  const flow = useMemo(() => dayFlow(state, state.date), [state]);
  if (flow.length === 0) return null;
  return (
    <div className="card">
      <Sec en="TODAY" ja="今日の球団" note={formatDateJa(state.date)} />
      <ol className="flow-list">
        {flow.map((entry, i) => (
          <li key={i} className={`flow-item flow-${entry.kind.toLowerCase()}`}>
            <span className="flow-mark" />
            <div className="flow-body">
              <div className="flow-head">
                <span className="label">{entry.en}</span>
                <span className="flow-ja">{entry.ja}</span>
              </div>
              <p className="flow-text">{entry.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * PHASE 4.4 §19 シーズンの記録。
 * 既存のニュースと判断記録に実際に残っているものだけを月ごとに並べる。
 */
function SeasonRecord({ stories }: { stories: ReturnType<typeof recentStories> }) {
  const { state } = useGame();
  const years = useMemo(() => timelineYears(state), [state]);
  const [year, setYear] = useState<number>(() => state.year);
  const shown = years.includes(year) ? year : (years[0] ?? state.year);
  const timeline = useMemo(() => seasonTimeline(state, shown), [state, shown]);

  return (
    <>
      <div className="card">
        <Sec en="SEASON TIMELINE" ja="シーズンの記録" size="lead" note={`${shown}年`} />
        {years.length > 1 && (
          <div className="scroll-x" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {years.map((y) => (
                <button
                  key={y}
                  className={y === shown ? 'chip on' : 'chip'}
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={() => setYear(y)}
                >
                  {y}年
                </button>
              ))}
            </div>
          </div>
        )}
        {timeline.length === 0 ? (
          <p className="muted">
            この年にはまだ記録が残っていません。試合を進めると記録されます。
          </p>
        ) : (
          <ol className="timeline">
            {timeline.map((entry, i) => (
              <li key={`${entry.date}:${i}`} className="timeline-row">
                <span className="timeline-month">{entry.monthLabel}</span>
                <div className="timeline-body">
                  <div className="timeline-head">
                    <span className="label">{entry.en}</span>
                    <span className="timeline-date">{entry.dateLabel}</span>
                  </div>
                  <div className="timeline-title">{entry.ja}</div>
                  <p className="timeline-text">{entry.text}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="card">
        <Sec en="SEASON STORY" ja="年度の物語" />
        {stories.length === 0 ? (
          <p className="muted">シーズンを終えると、その年を振り返る物語がここに残ります。</p>
        ) : (
          stories.map((story) => (
            <div key={story.year} className="story-row">
              <div className="spread">
                <strong style={{ fontSize: 'var(--text-lg)' }}>{story.year}年</strong>
                {story.upset !== 'NONE' && (
                  <span className="chip on">
                    {story.upset === 'MAJOR_UPSET' ? '大下剋上' : '下剋上'}
                  </span>
                )}
              </div>
              <div style={{ fontWeight: 700, marginTop: 2 }}>{story.headline}</div>
              <div className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 3 }}>
                記録更新{story.recordCount}件 ／ 移籍{story.transferCount}件 ／ 引退
                {story.retirementPlayerIds.length}人
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

/**
 * PHASE 4.4 §21 GM日誌。
 *
 * 「その時点でどう判断し、後から何が起きたか」を並べる。
 * 結果が良かったかどうかの評価はしない。
 */
function GmJournal() {
  const { state } = useGame();
  const years = useMemo(() => decisionYears(state), [state]);
  const [year, setYear] = useState<number>(() => state.year);
  const shown = years.includes(year) ? year : (years[0] ?? state.year);
  const records = useMemo(() => decisionsOfYear(state, shown), [state, shown]);

  return (
    <div className="card">
      <Sec en="GM JOURNAL" ja="GM日誌" size="lead" note={`${records.length}件`} />
      {years.length > 1 && (
        <div className="scroll-x" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {years.map((y) => (
              <button
                key={y}
                className={y === shown ? 'chip on' : 'chip'}
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => setYear(y)}
              >
                {y}年
              </button>
            ))}
          </div>
        </div>
      )}
      {records.length === 0 ? (
        <p className="muted">
          まだ判断の記録はありません。球団方針・起用方針・経営案件・契約・トレード・FA を
          決めると、ここに残ります。
        </p>
      ) : (
        records.map((record) => <JournalRow key={record.id} record={record} />)
      )}
      <p className="journal-note">
        記録しているのは「そのときどう決めたか」です。良し悪しの採点はしていません。
      </p>
    </div>
  );
}

function JournalRow({ record }: { record: DecisionRecord }) {
  const { state } = useGame();
  const outcome = useMemo(() => decisionOutcome(state, record), [state, record]);
  return (
    <article className="journal-row">
      <div className="journal-head">
        <span className="label">{DECISION_KIND_TAGS[record.kind]}</span>
        <span className="journal-kind">{DECISION_KIND_LABELS[record.kind]}</span>
        <span className="journal-date">{formatDateJa(record.date)}</span>
      </div>
      <div className="journal-title">{record.title}</div>
      <div className="journal-choice">{record.choice}</div>
      {record.situation && (
        <div className="journal-part">
          <span className="label">REASON</span>
          <span className="journal-part-ja">そのときの状況</span>
          <p className="journal-text">{record.situation}</p>
        </div>
      )}
      {(outcome.games > 0 || outcome.players.length > 0) && (
        <div className="journal-part">
          <span className="label">AFTER</span>
          <span className="journal-part-ja">その後</span>
          {outcome.record && (
            <p className="journal-text">
              この日以降 {outcome.games}試合で {outcome.record}。
            </p>
          )}
          {outcome.players.map((entry) => (
            <p key={entry.playerId} className="journal-text">
              {entry.name}：{entry.text}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}
