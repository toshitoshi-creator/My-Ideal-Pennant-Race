import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { TEAM_SEEDS } from '../../domain/teams';
import { LEAGUES } from '../../domain/teams';
import { SEASON_LENGTH_OPTIONS } from '../../domain/schedule';
import type { SeasonLength } from '../../domain/types';
import titleBg from '../../assets/backgrounds/bg-game.webp';

const TITLE_WORDS = ['My', 'Ideal', 'Pennant', 'Race'];

/** タイトルの野球ボール。縫い目ごと回る */
function TitleBall() {
  return (
    <svg className="title-ball" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill="#fbf8f1" stroke="#d9d2c3" strokeWidth="2" />
      <g className="title-ball-seams" fill="none" stroke="#c8352b" strokeWidth="2.2" strokeLinecap="round">
        <path d="M17 8c7 7 10 15 10 24s-3 17-10 24" />
        <path d="M47 8c-7 7-10 15-10 24s3 17 10 24" />
        <path d="M20 14l4-2M22 20l4-1.5M23.5 27l4-.8M23.5 37l4 .8M22 44l4 1.5M20 50l4 2" />
        <path d="M44 14l-4-2M42 20l-4-1.5M40.5 27l-4-.8M40.5 37l-4 .8M42 44l-4 1.5M44 50l-4 2" />
      </g>
    </svg>
  );
}

/** 取り返しのつかない操作の確認（ブラウザのダイアログは使わない） */
type Confirming = 'new' | 'delete' | null;

export function TitleScreen() {
  const { startNewGame, continueGame, saveExists, deleteSave, showToast } = useStore();
  const [phase, setPhase] = useState<'title' | 'team' | 'season'>('title');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [seasonLength, setSeasonLength] = useState<SeasonLength>(143);
  const [confirming, setConfirming] = useState<Confirming>(null);

  if (phase === 'title') {
    return (
      <div className="title-screen">
        <div className="title-bg" aria-hidden="true">
          <img src={titleBg} alt="" />
          <div className="title-rays" />
          <div className="title-dust">
            {Array.from({ length: 18 }, (_, i) => (
              <span
                key={i}
                style={{
                  left: `${(i * 37) % 100}%`,
                  animationDelay: `${((i * 13) % 50) / 10}s`,
                  animationDuration: `${6 + ((i * 7) % 6)}s`,
                }}
              />
            ))}
          </div>
        </div>
        <div className="title-logo">
          <TitleBall />
          <h1 aria-label="My Ideal Pennant Race">
            {TITLE_WORDS.map((word, i) => (
              <span key={word} className="title-word" style={{ animationDelay: `${180 + i * 110}ms` }}>
                {word}
              </span>
            ))}
          </h1>
          <div className="jp">プロ野球 球団経営シミュレーション</div>
        </div>
        <div className="title-menu">
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
            // セーブが無ければ確認は要らない
            if (!saveExists) {
              setPhase('team');
              return;
            }
            setConfirming('new');
          }}
        >
          新規ゲーム
        </button>
        {saveExists && (
          <button className="btn secondary" onClick={() => setConfirming('delete')}>
            セーブデータを削除
          </button>
        )}

        {/*
          window.confirm() は使わない。
          このゲームは単一HTMLとして iframe の中で配布されることがあり、
          sandbox に allow-modals が無いとブラウザが confirm() を無視して
          false を返す（ボタンが「押しても何も起きない」状態になる）。
          確認は必ず画面の中で行う。
        */}
        {confirming && (
          <section className="panel confirm-panel">
            <div className="confirm-head">
              <span className="label">CONFIRM</span>
              <span className="confirm-ja">確認</span>
            </div>
            <p className="confirm-text">
              {confirming === 'new'
                ? 'いま保存されている球団のデータは消えます。新しく始めますか？'
                : '保存されている球団のデータを削除します。元には戻せません。'}
            </p>
            <div className="btn-row">
              <button
                className="btn danger"
                onClick={() => {
                  if (confirming === 'new') {
                    setConfirming(null);
                    setPhase('team');
                    return;
                  }
                  deleteSave();
                  setConfirming(null);
                  showToast('セーブデータを削除しました');
                }}
              >
                {confirming === 'new' ? '新しく始める' : '削除する'}
              </button>
              <button className="btn secondary" onClick={() => setConfirming(null)}>
                やめる
              </button>
            </div>
          </section>
        )}

        <div className="title-tagline">
          監督兼GMとして、編成と采配でチームを勝利へ導こう。
        </div>
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
            {TEAM_SEEDS.filter((t) => t.leagueId === league.id).map((team, i) => (
              <button
                key={team.id}
                className={`team-pick ${teamId === team.id ? 'on' : ''}`}
                style={
                  {
                    borderLeftColor: team.color,
                    animationDelay: `${i * 55}ms`,
                    '--team': team.color,
                  } as CSSProperties
                }
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
