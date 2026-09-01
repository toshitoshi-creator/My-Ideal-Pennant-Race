import { useState } from 'react';
import { useStore } from '../store';
import { TEAM_SEEDS } from '../../domain/teams';
import { LEAGUES } from '../../domain/teams';
import { SEASON_LENGTH_OPTIONS } from '../../domain/schedule';
import type { SeasonLength } from '../../domain/types';

export function TitleScreen() {
  const { startNewGame, continueGame, saveExists, deleteSave, showToast } = useStore();
  const [phase, setPhase] = useState<'title' | 'team' | 'season'>('title');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [seasonLength, setSeasonLength] = useState<SeasonLength>(143);

  if (phase === 'title') {
    return (
      <div className="title-screen">
        <h1>My Ideal Pennant Race</h1>
        <div className="jp">プロ野球 球団経営シミュレーション</div>
        {saveExists && (
          <button
            className="btn primary"
            onClick={() => {
              if (!continueGame()) showToast('セーブデータを読み込めませんでした');
            }}
          >
            続きから
          </button>
        )}
        <button
          className={`btn ${saveExists ? '' : 'primary'}`}
          onClick={() => {
            if (saveExists && !window.confirm('現在のセーブデータは消えます。新しく始めますか？')) {
              return;
            }
            setPhase('team');
          }}
        >
          新規ゲーム
        </button>
        {saveExists && (
          <button
            className="btn secondary"
            onClick={() => {
              if (window.confirm('セーブデータを削除しますか？')) {
                deleteSave();
                showToast('セーブデータを削除しました');
              }
            }}
          >
            セーブデータを削除
          </button>
        )}
        <div className="muted" style={{ textAlign: 'center', marginTop: 8 }}>
          監督兼GMとして、編成と采配でチームを勝利へ導こう。
        </div>
      </div>
    );
  }

  if (phase === 'team') {
    return (
      <div className="screen">
        <h1 style={{ fontSize: 20 }}>球団を選択</h1>
        <div className="muted" style={{ marginBottom: 12 }}>
          あなたが監督兼GMを務める球団を選んでください。（残りの11球団はCPUが管理します）
        </div>
        {LEAGUES.map((league) => (
          <div key={league.id} className="card">
            <h2>
              {league.name}　{league.useDH ? 'DH制あり' : 'DH制なし'}
            </h2>
            {TEAM_SEEDS.filter((t) => t.leagueId === league.id).map((team) => (
              <button
                key={team.id}
                className={`team-pick ${teamId === team.id ? 'on' : ''}`}
                style={{ borderLeftColor: team.color }}
                onClick={() => setTeamId(team.id)}
              >
                <span className="grow">
                  <span style={{ fontWeight: 800, fontSize: 16 }}>{team.name}</span>
                  <span className="meta muted" style={{ display: 'block' }}>
                    本拠地: {team.homeTown}
                  </span>
                </span>
                {teamId === team.id && <span className="chip">選択中</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="btn-row">
          <button className="btn secondary" onClick={() => setPhase('title')}>
            戻る
          </button>
          <button className="btn primary" disabled={!teamId} onClick={() => setPhase('season')}>
            次へ
          </button>
        </div>
      </div>
    );
  }

  const team = TEAM_SEEDS.find((t) => t.id === teamId)!;
  return (
    <div className="screen">
      <h1 style={{ fontSize: 20 }}>シーズン設定</h1>
      <div className="card">
        <h2>選択した球団</h2>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{team.name}</div>
        <div className="muted">
          {LEAGUES.find((l) => l.id === team.leagueId)!.name} / 本拠地 {team.homeTown}
        </div>
      </div>
      <div className="card">
        <h2>シーズンの試合数</h2>
        {SEASON_LENGTH_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`team-pick ${seasonLength === option.value ? 'on' : ''}`}
            onClick={() => setSeasonLength(option.value)}
          >
            <span className="grow">
              <span style={{ fontWeight: 800, fontSize: 16 }}>{option.label}</span>
              <span className="meta muted" style={{ display: 'block' }}>
                {option.note}
              </span>
            </span>
            {seasonLength === option.value && <span className="chip">選択中</span>}
          </button>
        ))}
      </div>
      <div className="btn-row">
        <button className="btn secondary" onClick={() => setPhase('team')}>
          戻る
        </button>
        <button className="btn primary" onClick={() => startNewGame(team.id, seasonLength)}>
          この設定で開始
        </button>
      </div>
    </div>
  );
}
