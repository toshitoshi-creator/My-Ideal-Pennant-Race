import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../store';
import { Sheet, Tabs } from '../components/common';
import { NewsCard } from '../components/NewsCard';
import { PlayerHistoryView } from '../components/PlayerHistoryView';
import { CATEGORY_LABELS, markNewsRead, newsOfCategory } from '../../domain/news';
import { recentStories } from '../../domain/story';
import type { NewsCategory, PlayerHistory } from '../../domain/types';

type Filter = NewsCategory | 'ALL';
type Tab = 'news' | 'stories';

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
          { id: 'stories', label: '年度の物語' },
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
            <div className="card">
              {items.length === 0 ? (
                <p className="muted">まだニュースはありません。</p>
              ) : (
                items.map((item, i) => (
                  <NewsCard key={item.id} item={item} index={i} onSelectPlayer={openPlayer} />
                ))
              )}
            </div>
          </>
        ) : (
          <div className="card">
            <h2>年度の物語</h2>
            {stories.length === 0 ? (
              <p className="muted">
                シーズンを終えると、その年を振り返る物語がここに残ります。
              </p>
            ) : (
              stories.map((story) => (
                <div
                  key={story.year}
                  style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}
                >
                  <div className="spread">
                    <strong style={{ fontSize: 16 }}>{story.year}年</strong>
                    {story.upset !== 'NONE' && (
                      <span className="chip on">
                        {story.upset === 'MAJOR_UPSET' ? '大下剋上' : '下剋上'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, marginTop: 2 }}>{story.headline}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                    記録更新{story.recordCount}件 ／ 移籍{story.transferCount}件 ／ 引退
                    {story.retirementPlayerIds.length}人
                  </div>
                </div>
              ))
            )}
          </div>
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
