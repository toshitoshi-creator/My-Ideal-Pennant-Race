import type { Player } from '../../domain/types';
import { useGame } from '../store';
import { AbilityBar, KeyValue, RankBadge, Sheet } from './common';
import { POSITION_LABELS, aptitudeLabel, FIELD_POSITIONS } from '../../domain/positions';
import { overallRating } from '../../domain/rating';
import { velocityToScale } from '../../domain/rank';
import {
  applyRosterChange,
  checkRosterChange,
  daysUntilChangeable,
  nextChangeDate,
} from '../../domain/roster';
import { average, formatAverage, formatEra, formatInnings } from '../../domain/stats';
import { formatDateJa } from '../../domain/dates';
import { personalityDef } from '../../domain/personality';
import { potentialLabel, growthTypeDef } from '../../domain/growth';
import {
  CONDITION_ICONS,
  CONDITION_LABELS,
  ABILITY_CATEGORY_LABELS,
  fatigueLabel,
} from '../../domain/condition';
import { injuryText } from '../../domain/injury';
import { specialAbilityDef } from '../../domain/specialAbilities';
import { effectiveBreakdown } from '../../domain/effective';
import { contractStatus, formatSalary, marketValue } from '../../domain/contract';

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
        <h2>コンディション</h2>
        <StatusPanel player={player} teamMorale={state.teamMorale[player.teamId] ?? 50} />
      </div>

      <div className="card">
        <h2>契約</h2>
        <ContractPanel player={player} />
      </div>

      <div className="card">
        <h2>個性</h2>
        <PersonalityPanel player={player} />
      </div>

      <div className="card">
        <h2>特殊能力</h2>
        <SpecialAbilityPanel player={player} />
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
            <AbilityBar label="弾道" value={player.batting.trajectory} />
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

function StatusPanel({ player, teamMorale }: { player: Player; teamMorale: number }) {
  const { state } = useGame();
  const ext = player.ext;
  const injury = injuryText(player, state.date);
  const breakdown = effectiveBreakdown(player, { teamMorale });
  const percent = Math.round((breakdown.finalMultiplier - 1) * 100);
  const allFactors: Array<{ label: string; value: number }> = [
    { label: '調子', value: breakdown.conditionModifier },
    { label: '疲労', value: breakdown.fatigueModifier },
    { label: 'モチベーション', value: breakdown.motivationModifier },
    { label: 'スランプ', value: breakdown.slumpModifier },
    { label: 'チーム士気', value: breakdown.moraleModifier },
    { label: '性格', value: breakdown.personalityModifier },
  ];
  const factors = allFactors.filter((f) => Math.abs(f.value) >= 0.005);
  const history = player.ext.conditionHistory ?? [];
  const categories = player.isPitcher
    ? (['pitchPower', 'pitchControl', 'pitchMovement', 'stamina'] as const)
    : (['contact', 'power', 'speed', 'defense'] as const);
  return (
    <>
      {injury && (
        <div
          style={{
            background: '#3a1f24',
            color: '#ff9aa2',
            borderRadius: 10,
            padding: '8px 10px',
            marginBottom: 10,
            fontWeight: 700,
          }}
        >
          🏥 {injury}
        </div>
      )}
      <KeyValue
        label="コンディション"
        value={
          <span style={{ color: conditionColor(ext.condition) }}>
            {CONDITION_ICONS[ext.condition]} {CONDITION_LABELS[ext.condition]}
          </span>
        }
      />
      <KeyValue label="疲労" value={`${Math.round(ext.fatigue)} / 100（${fatigueLabel(ext.fatigue)}）`} />
      <KeyValue label="モチベーション" value={`${Math.round(ext.motivation)} / 100`} />
      {ext.slump && <KeyValue label="状態" value={<span style={{ color: 'var(--bad)' }}>スランプ</span>} />}
      <KeyValue
        label="今日の実効能力"
        value={
          <span style={{ color: percent > 0 ? 'var(--good)' : percent < 0 ? 'var(--bad)' : undefined }}>
            {percent > 0 ? '+' : ''}
            {percent}%
          </span>
        }
      />

      {factors.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
            主な要因
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
            {factors.map((factor) => (
              <span key={factor.label} style={{ fontSize: 13 }}>
                <span className="muted">{factor.label} </span>
                <span
                  style={{
                    color: factor.value > 0 ? 'var(--good)' : 'var(--bad)',
                    fontWeight: 700,
                  }}
                >
                  {factor.value > 0 ? '+' : ''}
                  {(factor.value * 100).toFixed(1)}%
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
          能力カテゴリ別の実効倍率（調子はカテゴリごとに効き方が違う）
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
          {categories.map((category) => {
            const value = Math.round((breakdown.byCategory[category] - 1) * 100);
            return (
              <span key={category} style={{ fontSize: 13 }}>
                <span className="muted">{ABILITY_CATEGORY_LABELS[category]} </span>
                <span
                  style={{
                    color: value > 0 ? 'var(--good)' : value < 0 ? 'var(--bad)' : 'var(--text-dim)',
                    fontWeight: 700,
                  }}
                >
                  {value > 0 ? '+' : ''}
                  {value}%
                </span>
              </span>
            );
          })}
        </div>
      </div>

      {history.length > 1 && (
        <div style={{ marginTop: 10 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
            調子の推移（直近{history.length}日）
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {history.map((condition, i) => (
              <span
                key={i}
                className="chip"
                style={{ fontSize: 11, color: conditionColor(condition) }}
              >
                {CONDITION_ICONS[condition]} {CONDITION_LABELS[condition]}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        基本能力はそのままで、調子・疲労・モチベーションから「その日の実効能力」を計算しています。
      </div>
    </>
  );
}

function conditionColor(condition: Player['ext']['condition']): string {
  switch (condition) {
    case 'best':
      return '#ff9f43';
    case 'good':
      return 'var(--good)';
    case 'bad':
      return '#ffca7a';
    case 'worst':
      return 'var(--bad)';
    default:
      return 'var(--text)';
  }
}

function PersonalityPanel({ player }: { player: Player }) {
  const personality = personalityDef(player.ext.personality);
  const growth = growthTypeDef(player.ext.growthType);
  return (
    <>
      <KeyValue label="性格" value={personality.name} />
      <div className="muted" style={{ padding: '6px 0', fontSize: 13 }}>
        「{personality.description}」
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {personality.summary.map((line) => (
          <span key={line} className="chip" style={{ fontSize: 12 }}>
            {line}
          </span>
        ))}
      </div>
      <KeyValue label="将来性" value={potentialLabel(player.ext.potential)} />
      <KeyValue label="成長タイプ" value={growth.name} />
      <div className="muted" style={{ padding: '6px 0', fontSize: 13 }}>
        {growth.description}
      </div>
    </>
  );
}

function SpecialAbilityPanel({ player }: { player: Player }) {
  const entries = player.ext.specialAbilities;
  if (entries.length === 0) {
    return <div className="muted">特殊能力はありません。</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map((entry) => {
        const def = specialAbilityDef(entry.id);
        if (!def) return null;
        const positive = def.polarity === 'positive';
        return (
          <div
            key={entry.id}
            style={{
              borderLeft: `4px solid ${positive ? 'var(--good)' : 'var(--bad)'}`,
              background: positive ? 'rgba(77,208,122,0.08)' : 'rgba(255,107,107,0.08)',
              borderRadius: 8,
              padding: '8px 10px',
            }}
          >
            <div style={{ fontWeight: 800, color: positive ? 'var(--good)' : 'var(--bad)' }}>
              {def.name}
              {entry.level > 1 ? ` Lv${entry.level}` : ''}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {def.description}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ContractPanel({ player }: { player: Player }) {
  const { state } = useGame();
  const contract = player.ext.contract;
  const status = contractStatus(player);
  const market = marketValue(player, state.stats[player.id], state.year);

  if (!contract) {
    return (
      <>
        <KeyValue
          label="契約状態"
          value={<span style={{ color: 'var(--bad)' }}>無契約</span>}
        />
        <KeyValue label="市場価値" value={formatSalary(market)} />
      </>
    );
  }

  return (
    <>
      <KeyValue label="年俸" value={formatSalary(contract.salary)} />
      <KeyValue
        label="契約"
        value={
          status === 'expiring' ? (
            <span style={{ color: 'var(--accent)' }}>契約満了（更改が必要）</span>
          ) : (
            `${contract.totalYears}年契約 / 残り${contract.yearsRemaining}年`
          )
        }
      />
      <KeyValue label="市場価値" value={formatSalary(market)} />
      <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
        市場価値は能力・年齢・実績から算出した年俸の目安です。
      </div>
    </>
  );
}
