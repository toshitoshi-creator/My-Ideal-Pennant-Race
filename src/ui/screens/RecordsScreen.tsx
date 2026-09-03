import { useMemo, useState } from 'react';
import { useGame } from '../store';
import { Sheet, Tabs } from '../components/common';
import {
  CAREER_RECORD_LABELS,
  LEADER_KEYS,
  LEADER_LABELS,
  higherIsBetter,
} from '../../domain/history';
import { formatAverage } from '../../domain/stats';
import { PlayerHistoryView } from '../components/PlayerHistoryView';
import type {
  CareerRecordKey,
  LeaderKey,
  PlayerHistory,
  RecordBook,
} from '../../domain/types';

type Tab = 'league' | 'team' | 'season' | 'career';

const CAREER_KEYS: CareerRecordKey[] = [
  'hits',
  'homeRuns',
  'rbi',
  'steals',
  'wins',
  'strikeouts',
  'saves',
];

/** 記録の値を見せ方に合わせて整える */
function formatRecord(key: string, value: number): string {
  if (key === 'average') return formatAverage(value);
  if (key === 'era') return value.toFixed(2);
  return String(Math.round(value));
}

export function RecordsScreen() {
  const { state } = useGame();
  const [tab, setTab] = useState<Tab>('league');
  const [selected, setSelected] = useState<PlayerHistory | null>(null);
  const open = (playerId: string) => {
    const history = state.history.players[playerId];
    if (history) setSelected(history);
  };

  if (state.history.seasons.length === 0) {
    return (
      <div className="screen">
        <div className="card">
          <h2>記録</h2>
          <p className="muted">
            まだ記録がありません。1シーズンを終えると、リーグ記録・球団記録が
            ここに残っていきます。
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Tabs
        tabs={[
          { id: 'league', label: 'リーグ' },
          { id: 'team', label: '球団' },
          { id: 'season', label: 'シーズン' },
          { id: 'career', label: '通算' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="screen">
        {tab === 'league' && <LeagueRecords onOpen={open} />}
        {tab === 'team' && <TeamRecords onOpen={open} />}
        {tab === 'season' && <SeasonBest onOpen={open} />}
        {tab === 'career' && <CareerBest onOpen={open} />}
      </div>
      {selected && (
        <Sheet title={selected.name} onClose={() => setSelected(null)}>
          <PlayerHistoryView history={selected} />
        </Sheet>
      )}
    </>
  );
}

function RecordTable({
  book,
  kind,
  onOpen,
}: {
  book: RecordBook | undefined;
  kind: 'season' | 'career';
  onOpen: (playerId: string) => void;
}) {
  const { state } = useGame();
  const teamName = (id: string) => state.teams.find((t) => t.id === id)?.shortName ?? '―';
  const rows: Array<{ key: string; label: string; holder: (typeof book extends undefined ? never : NonNullable<RecordBook['season'][LeaderKey]>) | undefined }> =
    kind === 'season'
      ? LEADER_KEYS.map((key) => ({
          key,
          label: LEADER_LABELS[key],
          holder: book?.season[key],
        }))
      : CAREER_KEYS.map((key) => ({
          key,
          label: CAREER_RECORD_LABELS[key],
          holder: book?.career[key],
        }));

  return (
    <div className="scroll-x">
      <table className="data">
        <thead>
          <tr>
            <th className="l">記録</th>
            <th>値</th>
            <th className="l">選手</th>
            <th className="l">球団</th>
            <th>年</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="l">{row.label}</td>
              <td style={{ fontWeight: 700 }}>
                {row.holder ? formatRecord(row.key, row.holder.value) : '―'}
              </td>
              <td className="l">
                {row.holder ? (
                  <button className="linky" onClick={() => onOpen(row.holder!.playerId)}>
                    {row.holder.name}
                  </button>
                ) : (
                  '―'
                )}
              </td>
              <td className="l">{row.holder ? teamName(row.holder.teamId) : '―'}</td>
              <td>{row.holder?.year ?? '―'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeagueRecords({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useGame();
  return (
    <>
      {state.leagues.map((league) => (
        <div className="card" key={league.id}>
          <h2>{league.name}　シーズン記録</h2>
          <RecordTable
            book={state.history.leagueRecords[league.id]}
            kind="season"
            onOpen={onOpen}
          />
          <h2 style={{ marginTop: 14 }}>通算記録</h2>
          <RecordTable
            book={state.history.leagueRecords[league.id]}
            kind="career"
            onOpen={onOpen}
          />
        </div>
      ))}
    </>
  );
}

function TeamRecords({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useGame();
  const [teamId, setTeamId] = useState(state.playerTeamId);
  return (
    <>
      <div className="card">
        <h2>球団</h2>
        <div className="scroll-x" style={{ paddingBottom: 4 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {state.teams.map((team) => (
              <button
                key={team.id}
                className={team.id === teamId ? 'chip on' : 'chip'}
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => setTeamId(team.id)}
              >
                {team.shortName}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
        <h2>シーズン記録</h2>
        <RecordTable book={state.history.teamRecords[teamId]} kind="season" onOpen={onOpen} />
      </div>
      <div className="card">
        <h2>通算記録</h2>
        <RecordTable book={state.history.teamRecords[teamId]} kind="career" onOpen={onOpen} />
      </div>
    </>
  );
}

/** シーズン記録の上位（リーグを問わず） */
function SeasonBest({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useGame();
  const [key, setKey] = useState<LeaderKey>('homeRuns');

  const rows = useMemo(() => {
    const list: Array<{ playerId: string; name: string; teamId: string; year: number; value: number }> = [];
    for (const season of state.history.seasons) {
      for (const league of season.leagues) {
        const leader = league.leaders[key];
        if (leader) list.push({ ...leader, year: season.year });
      }
    }
    list.sort((a, b) => (higherIsBetter(key) ? b.value - a.value : a.value - b.value));
    return list.slice(0, 20);
  }, [state.history, key]);

  const teamName = (id: string) => state.teams.find((t) => t.id === id)?.shortName ?? '―';

  return (
    <div className="card">
      <h2>シーズンの上位記録</h2>
      <div className="scroll-x" style={{ paddingBottom: 4 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {LEADER_KEYS.map((k) => (
            <button
              key={k}
              className={k === key ? 'chip on' : 'chip'}
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => setKey(k)}
            >
              {LEADER_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll-x" style={{ marginTop: 10 }}>
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>値</th>
              <th className="l">選手</th>
              <th className="l">球団</th>
              <th>年</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.playerId}-${row.year}`}>
                <td>{i + 1}</td>
                <td style={{ fontWeight: 700 }}>{formatRecord(key, row.value)}</td>
                <td className="l">
                  <button className="linky" onClick={() => onOpen(row.playerId)}>
                    {row.name}
                  </button>
                </td>
                <td className="l">{teamName(row.teamId)}</td>
                <td>{row.year}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 通算成績の上位（現役・引退をまとめて） */
function CareerBest({ onOpen }: { onOpen: (id: string) => void }) {
  const { state } = useGame();
  const [key, setKey] = useState<CareerRecordKey>('homeRuns');

  const rows = useMemo(() => {
    const valueOf = (h: PlayerHistory): number => {
      switch (key) {
        case 'hits':
          return h.career.batting.hits;
        case 'homeRuns':
          return h.career.batting.homeRuns;
        case 'rbi':
          return h.career.batting.rbi;
        case 'steals':
          return h.career.batting.steals;
        case 'wins':
          return h.career.pitching.wins;
        case 'strikeouts':
          return h.career.pitching.strikeouts;
        case 'saves':
          return h.career.pitching.saves;
      }
    };
    return Object.values(state.history.players)
      .map((h) => ({ h, value: valueOf(h) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);
  }, [state.history, key]);

  return (
    <div className="card">
      <h2>通算の上位</h2>
      <div className="scroll-x" style={{ paddingBottom: 4 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {CAREER_KEYS.map((k) => (
            <button
              key={k}
              className={k === key ? 'chip on' : 'chip'}
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => setKey(k)}
            >
              {CAREER_RECORD_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll-x" style={{ marginTop: 10 }}>
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>値</th>
              <th className="l">選手</th>
              <th>期間</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.h.playerId}>
                <td>{i + 1}</td>
                <td style={{ fontWeight: 700 }}>{row.value}</td>
                <td className="l">
                  <button className="linky" onClick={() => onOpen(row.h.playerId)}>
                    {row.h.name}
                    {row.h.retiredAt === null && <span className="muted">（現役）</span>}
                  </button>
                </td>
                <td>
                  {row.h.debutYear}〜{row.h.retiredAt ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
