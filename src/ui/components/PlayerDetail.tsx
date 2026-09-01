import type { Player } from '../../domain/types';
import { useGame } from '../store';
import { AbilityBar, KeyValue, RankBadge, Sheet } from './common';
import { POSITION_LABELS, aptitudeLabel, FIELD_POSITIONS } from '../../domain/positions';
import { overallRating, trajectoryScale } from '../../domain/rating';
import { velocityToScale } from '../../domain/rank';
import {
  applyRosterChange,
  checkRosterChange,
  daysUntilChangeable,
  nextChangeDate,
} from '../../domain/roster';
import { average, formatAverage, formatEra, formatInnings } from '../../domain/stats';
import { formatDateJa } from '../../domain/dates';

export function PlayerDetail({ player, onClose }: { player: Player; onClose: () => void }) {
  const { state, mutate, showToast } = useGame();
  const stats = state.stats[player.id];
  const team = state.teams.find((t) => t.id === player.teamId)!;
  const isPlayerTeam = player.teamId === state.playerTeamId;
  const lockDays = daysUntilChangeable(player, state.date);
  const target = player.roster === 'first' ? 'second' : 'first';
  const check = checkRosterChange(state, player.id, target);

  const changeRoster = () => {
    mutate((draft) => {
      const result = applyRosterChange(draft, player.id, target);
      showToast(
        result.ok
          ? `${player.name} を${target === 'first' ? '1軍' : '2軍'}に登録しました`
          : result.reason ?? '変更できません',
      );
    });
    onClose();
  };

  return (
    <Sheet title={player.name} onClose={onClose}>
      <div className="card">
        <div className="spread">
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              背番号 {player.uniformNumber}　{player.name}
            </div>
            <div className="muted">
              {team.name} / {player.age}歳 / {POSITION_LABELS[player.mainPosition]} /{' '}
              {player.throws === 'R' ? '右' : '左'}投
              {player.bats === 'R' ? '右' : '左'}打
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="muted" style={{ fontSize: 11 }}>
              総合
            </div>
            <RankBadge value={overallRating(player)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
          <span className={player.roster === 'first' ? 'badge-1st' : 'badge-2nd'}>
            {player.roster === 'first' ? '1軍登録' : '2軍'}
          </span>
          {lockDays > 0 && (
            <span className="badge-lock">
              登録変更まであと{lockDays}日（{formatDateJa(nextChangeDate(player)!)}〜）
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <h2>能力</h2>
        {player.isPitcher && player.pitching ? (
          <>
            <AbilityBar
              label="球速"
              value={velocityToScale(player.pitching.velocity)}
              display={`${player.pitching.velocity}`}
            />
            <AbilityBar label="制球" value={player.pitching.control} />
            <AbilityBar label="スタミナ" value={player.pitching.stamina} />
            <AbilityBar label="球威" value={player.pitching.power} />
            <AbilityBar label="変化量" value={player.pitching.movement} />
            <div className="muted" style={{ marginTop: 8 }}>
              守備 {player.batting.fielding} / 捕球 {player.batting.catching} / 走力{' '}
              {player.batting.speed}
            </div>
          </>
        ) : (
          <>
            <AbilityBar
              label="弾道"
              value={trajectoryScale(player.batting.trajectory)}
              display={`${player.batting.trajectory}`}
              showRank={false}
            />
            <AbilityBar label="ミート" value={player.batting.contact} />
            <AbilityBar label="パワー" value={player.batting.power} />
            <AbilityBar label="走力" value={player.batting.speed} />
            <AbilityBar label="肩力" value={player.batting.arm} />
            <AbilityBar label="守備力" value={player.batting.fielding} />
            <AbilityBar label="捕球" value={player.batting.catching} />
          </>
        )}
      </div>

      {!player.isPitcher && (
        <div className="card">
          <h2>守備適性</h2>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {FIELD_POSITIONS.map((pos) => {
              const label = aptitudeLabel(player, pos);
              const color =
                label === '本職'
                  ? 'var(--good)'
                  : label === '適性' || label === '可'
                    ? 'var(--accent)'
                    : 'var(--text-dim)';
              return (
                <span key={pos} className="chip" style={{ color }}>
                  {POSITION_LABELS[pos]} {label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <h2>今季成績</h2>
        {player.isPitcher ? (
          <>
            <KeyValue label="登板 / 先発" value={`${stats.pitching.games} / ${stats.pitching.starts}`} />
            <KeyValue label="勝敗" value={`${stats.pitching.wins}勝 ${stats.pitching.losses}敗`} />
            <KeyValue label="投球回" value={formatInnings(stats.pitching.outs)} />
            <KeyValue label="防御率" value={formatEra(stats.pitching)} />
            <KeyValue label="奪三振 / 与四球" value={`${stats.pitching.strikeouts} / ${stats.pitching.walks}`} />
            <KeyValue
              label="失点 / 自責点"
              value={`${stats.pitching.runsAllowed} / ${stats.pitching.earnedRuns}`}
            />
          </>
        ) : null}
        <KeyValue label="試合" value={stats.batting.games} />
        <KeyValue label="打数 / 安打" value={`${stats.batting.atBats} / ${stats.batting.hits}`} />
        <KeyValue label="打率" value={formatAverage(average(stats.batting))} />
        <KeyValue label="本塁打 / 打点" value={`${stats.batting.homeRuns} / ${stats.batting.rbi}`} />
        <KeyValue label="得点 / 盗塁" value={`${stats.batting.runs} / ${stats.batting.steals}`} />
        <KeyValue label="三振 / 四球" value={`${stats.batting.strikeouts} / ${stats.batting.walks}`} />
      </div>

      {isPlayerTeam && (
        <button
          className={`btn ${check.allowed ? 'primary' : ''}`}
          disabled={!check.allowed}
          onClick={changeRoster}
        >
          {check.allowed
            ? target === 'first'
              ? '1軍に登録する'
              : '2軍に降格する'
            : (check.reason ?? '変更できません')}
        </button>
      )}
    </Sheet>
  );
}
