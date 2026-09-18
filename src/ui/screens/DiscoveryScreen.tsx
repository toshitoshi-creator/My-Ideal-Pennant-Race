/**
 * PHASE 4.9-B 発掘。
 *
 * 入口は3つ：外国人助っ人 / トレード（既存画面） / スカウト（アマチュア）。
 *
 * 見せ方の約束：
 *  - 契約前の選手の能力は数値で出さない。既存のスカウト推定（幅）だけを見せる。
 *  - 備考は「外から見て分かること」だけ。能力の一覧は書かない。
 *  - 発掘力（見つける力）と調査力（推定の当たり具合）は別物として並べる。
 */
import { useEffect, useState } from 'react';
import type {
  AmateurCandidate,
  DiscoveryAgeBand,
  DiscoveryCondition,
  DiscoveryOrigin,
  DiscoveryPitcherRole,
  DiscoveryType,
  ForeignCandidate,
  PositionId,
} from '../../domain/types';
import {
  AGE_BAND_LABELS,
  DISCOVERY_TYPE_LABELS,
  ORIGIN_LABELS,
  PITCHER_ROLE_LABELS,
  amateurReportOf,
  cancelAmateurSearch,
  cancelForeignSearch,
  emptyCondition,
  discoveryPowerOf,
  foreignReportOf,
  removeAmateurPreset,
  saveAmateurPreset,
  searchStage,
  searchStageProgress,
  setAmateurCondition,
  signForeignCandidate,
  startAmateurSearch,
  startForeignSearch,
} from '../../domain/discovery';
import { scoutAbilityOf } from '../../domain/discovery';
import { abilityRangeText, SCOUT_ABILITY_LABELS } from '../../domain/scouting';
import { formatMoney } from '../../domain/contract';
import { POSITION_LABELS } from '../../domain/positions';
import { useGame } from '../store';
import { Sec } from '../components/Sec';
import { Sheet, Tabs } from '../components/common';
import { PictureButton } from '../components/PictureButton';
import { TradeScreen } from './TradeScreen';
import discoverStartArt from '../../assets/ui/discover-start.webp';
import discoverStopArt from '../../assets/ui/discover-stop.webp';

type Tab = 'foreign' | 'trade' | 'scout';

const BATTER_POSITIONS: PositionId[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const BATTER_TYPES: DiscoveryType[] = ['power', 'speed', 'defense'];
const PITCHER_TYPES: DiscoveryType[] = ['fastball', 'breaking', 'control'];
const ROLES: DiscoveryPitcherRole[] = ['starter', 'relief', 'closer'];
const AGE_BANDS: DiscoveryAgeBand[] = ['young', 'prime', 'veteran'];
const ORIGINS: DiscoveryOrigin[] = ['highschool', 'college', 'corporate'];

export function DiscoveryScreen() {
  const { discoveryTab, clearDiscoveryTab } = useGame();
  const [tab, setTab] = useState<Tab>(() => discoveryTab ?? 'foreign');
  useEffect(() => {
    if (discoveryTab) clearDiscoveryTab();
    // 開いたときの1回だけ、ニュースからの指定タブを消費する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <Tabs
        tabs={[
          { id: 'foreign', label: '外国人助っ人' },
          { id: 'trade', label: 'トレード' },
          { id: 'scout', label: 'スカウト' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'trade' ? (
        <TradeScreen />
      ) : (
        <div className="screen">
          <ScoutAbilityCard />
          {tab === 'foreign' ? <ForeignPanel /> : <AmateurPanel />}
        </div>
      )}
    </>
  );
}

/** 発掘力と調査力を並べて、役割の違いを言葉で書く */
function ScoutAbilityCard() {
  const { state } = useGame();
  const ability = scoutAbilityOf(state, state.playerTeamId);
  const power = discoveryPowerOf(state, state.playerTeamId);

  return (
    <div className="card">
      <Sec en="SCOUT" ja="スカウト陣" />
      <div className="stat-line">
        <span className="muted">{SCOUT_ABILITY_LABELS.discovery}</span>
        <span style={{ fontWeight: 700 }}>{power}</span>
      </div>
      <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 2 }}>
        候補を「どれだけ早く・多く・条件に近い形で見つけられるか」に効きます。
        見つけた選手が強くなるわけではありません。
      </p>
      <div className="stat-line" style={{ marginTop: 8 }}>
        <span className="muted">{SCOUT_ABILITY_LABELS.currentAbility}</span>
        <span style={{ fontWeight: 700 }}>{ability.currentAbility}</span>
      </div>
      <div className="stat-line">
        <span className="muted">{SCOUT_ABILITY_LABELS.potential}</span>
        <span style={{ fontWeight: 700 }}>{ability.potential}</span>
      </div>
      <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 2 }}>
        調査力は「推定の幅がどれだけ狭くなるか」に効きます。発掘力とは別です。
      </p>
    </div>
  );
}

/* ================= 条件を選ぶ ================= */

function ConditionEditor({
  condition,
  onChange,
  showAge,
  showOrigin,
}: {
  condition: DiscoveryCondition;
  onChange: (next: DiscoveryCondition) => void;
  showAge?: boolean;
  showOrigin?: boolean;
}) {
  const set = (patch: Partial<DiscoveryCondition>) => onChange({ ...condition, ...patch });
  const types = condition.pitcher ? PITCHER_TYPES : BATTER_TYPES;

  return (
    <>
      <div className="cond-row">
        <span className="cond-label">区分</span>
        <div className="cond-chips">
          <button
            className={condition.pitcher ? 'chip on' : 'chip'}
            onClick={() => onChange({ ...emptyCondition(true) })}
          >
            投手
          </button>
          <button
            className={!condition.pitcher ? 'chip on' : 'chip'}
            onClick={() => onChange({ ...emptyCondition(false) })}
          >
            野手
          </button>
        </div>
      </div>

      {condition.pitcher ? (
        <div className="cond-row">
          <span className="cond-label">役割</span>
          <div className="cond-chips">
            <button
              className={condition.role === null ? 'chip on' : 'chip'}
              onClick={() => set({ role: null })}
            >
              指定なし
            </button>
            {ROLES.map((role) => (
              <button
                key={role}
                className={condition.role === role ? 'chip on' : 'chip'}
                onClick={() => set({ role })}
              >
                {PITCHER_ROLE_LABELS[role]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="cond-row">
          <span className="cond-label">守備</span>
          <div className="cond-chips">
            <button
              className={condition.position === null ? 'chip on' : 'chip'}
              onClick={() => set({ position: null })}
            >
              指定なし
            </button>
            {BATTER_POSITIONS.map((position) => (
              <button
                key={position}
                className={condition.position === position ? 'chip on' : 'chip'}
                onClick={() => set({ position })}
              >
                {POSITION_LABELS[position]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="cond-row">
        <span className="cond-label">タイプ</span>
        <div className="cond-chips">
          <button
            className={condition.type === null ? 'chip on' : 'chip'}
            onClick={() => set({ type: null })}
          >
            指定なし
          </button>
          {types.map((type) => (
            <button
              key={type}
              className={condition.type === type ? 'chip on' : 'chip'}
              onClick={() => set({ type })}
            >
              {DISCOVERY_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      {showAge && (
        <div className="cond-row">
          <span className="cond-label">年齢</span>
          <div className="cond-chips">
            <button
              className={condition.ageBand === null ? 'chip on' : 'chip'}
              onClick={() => set({ ageBand: null })}
            >
              指定なし
            </button>
            {AGE_BANDS.map((band) => (
              <button
                key={band}
                className={condition.ageBand === band ? 'chip on' : 'chip'}
                onClick={() => set({ ageBand: band })}
              >
                {AGE_BAND_LABELS[band]}
              </button>
            ))}
          </div>
        </div>
      )}

      {showOrigin && (
        <div className="cond-row">
          <span className="cond-label">出身</span>
          <div className="cond-chips">
            <button
              className={condition.origin === null ? 'chip on' : 'chip'}
              onClick={() => set({ origin: null })}
            >
              指定なし
            </button>
            {ORIGINS.map((origin) => (
              <button
                key={origin}
                className={condition.origin === origin ? 'chip on' : 'chip'}
                onClick={() => set({ origin })}
              >
                {ORIGIN_LABELS[origin]}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ================= 外国人助っ人 ================= */

function ForeignPanel() {
  const { state, mutate, showToast } = useGame();
  const [condition, setCondition] = useState<DiscoveryCondition>(() => emptyCondition(false));
  const [offering, setOffering] = useState<string | null>(null);

  const discovery = state.discovery;
  const search = discovery?.foreign.search ?? null;
  const candidates = discovery?.foreign.candidates ?? [];
  const stage = search ? searchStage(search) : null;
  const stageProgress = search ? searchStageProgress(search) : 0;

  const start = () => {
    let message = '';
    mutate((draft) => {
      const result = startForeignSearch(draft, condition);
      message = result.ok ? '発掘を始めました' : (result.reason ?? '始められません');
    });
    showToast(message);
  };

  const stop = () => {
    mutate((draft) => cancelForeignSearch(draft));
    showToast('発掘をやめました');
  };

  return (
    <>
      <div className="card">
        <Sec en="FOREIGN PLAYER" ja="外国人助っ人の発掘" />
        {search ? (
          <>
            <div className="stat-line">
              <span className="muted">{stage === 'finding' ? '発掘中' : '調査中'}</span>
              <span style={{ fontWeight: 700 }}>{stageProgress}%</span>
            </div>
            <div className="meter" aria-label={`${stage === 'finding' ? '発掘' : '調査'}の進み具合 ${stageProgress}%`}>
              <div className="meter-fill" style={{ width: `${stageProgress}%` }} />
            </div>
            <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 6 }}>
              {stage === 'finding'
                ? '日付を進めると発掘が進みます。かかる日数は発掘力で決まります。'
                : '候補が見つかりました。日付を進めると調査が進みます。かかる日数・ギャップの狭さは調査力で決まります。'}
            </p>
            <PictureButton src={discoverStopArt} alt={stage === 'finding' ? '発掘をやめる' : '調査をやめる'} onClick={stop} />
          </>
        ) : (
          <>
            <ConditionEditor condition={condition} onChange={setCondition} showAge />
            <PictureButton src={discoverStartArt} alt="この条件で発掘する" onClick={start} />
            <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 6 }}>
              条件に合う選手が必ず見つかるわけではありません。
              発掘力が高いほど、条件どおりの選手が見つかりやすくなります。
            </p>
          </>
        )}
      </div>

      <div className="card">
        <Sec en="CANDIDATES" ja="発掘した候補" size="sub" />
        {candidates.length === 0 ? (
          <p className="muted">まだ候補はいません。</p>
        ) : (
          candidates.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              onOffer={() => setOffering(candidate.id)}
            />
          ))
        )}
      </div>

      {offering && (
        <OfferSheet
          candidateId={offering}
          onClose={() => setOffering(null)}
        />
      )}
    </>
  );
}

function CandidateRow({
  candidate,
  onOffer,
}: {
  candidate: ForeignCandidate;
  onOffer: () => void;
}) {
  const { state } = useGame();
  const report = foreignReportOf(state, candidate);
  const player = candidate.player;

  return (
    <div className="discovery-card">
      <div className="spread">
        <div>
          <div style={{ fontWeight: 700 }}>{player.name}</div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            {candidate.from}／{player.age}歳／
            {player.isPitcher ? '投手' : POSITION_LABELS[player.mainPosition]}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            推定
          </div>
          <div style={{ fontWeight: 700 }}>
            {report ? `${report.estimate.abilityLow}〜${report.estimate.abilityHigh}` : '調査中'}
          </div>
        </div>
      </div>

      <div className="stat-line">
        <span className="muted">将来性</span>
        <span>{report ? (report.estimate.potential ?? '未調査') : '調査中'}</span>
      </div>
      <div className="stat-line">
        <span className="muted">要求の目安</span>
        <span>{formatMoney(candidate.askingSalary)}</span>
      </div>

      <ul className="note-list">
        {candidate.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>

      {candidate.rejected ? (
        <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          交渉は終わっています。
        </p>
      ) : (
        <button className="btn secondary" onClick={onOffer}>
          契約金を提示
        </button>
      )}
    </div>
  );
}

function OfferSheet({ candidateId, onClose }: { candidateId: string; onClose: () => void }) {
  const { state, mutate, showToast } = useGame();
  const candidate = state.discovery?.foreign.candidates.find((c) => c.id === candidateId);
  const [salary, setSalary] = useState(() => candidate?.askingSalary ?? 100);
  const [years, setYears] = useState(2);

  if (!candidate) return null;

  const offer = () => {
    let message = '';
    mutate((draft) => {
      const result = signForeignCandidate(draft, candidateId, salary, years);
      message = result.ok ? `${candidate.player.name} と契約しました` : (result.reason ?? '契約できません');
    });
    showToast(message);
    onClose();
  };

  return (
    <Sheet title={`${candidate.player.name} への提示`} onClose={onClose}>
      <div className="card">
        <div className="stat-line">
          <span className="muted">要求の目安</span>
          <span style={{ fontWeight: 700 }}>{formatMoney(candidate.askingSalary)}</span>
        </div>

        <div className="cond-row">
          <span className="cond-label">年俸</span>
          <div className="cond-chips">
            {[0.8, 1, 1.2, 1.5].map((ratio) => {
              const value = Math.round(candidate.askingSalary * ratio);
              return (
                <button
                  key={ratio}
                  className={salary === value ? 'chip on' : 'chip'}
                  onClick={() => setSalary(value)}
                >
                  {formatMoney(value)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="cond-row">
          <span className="cond-label">年数</span>
          <div className="cond-chips">
            {[1, 2, 3].map((y) => (
              <button
                key={y}
                className={years === y ? 'chip on' : 'chip'}
                onClick={() => setYears(y)}
              >
                {y}年
              </button>
            ))}
          </div>
        </div>

        <div className="stat-line">
          <span className="muted">総額</span>
          <span style={{ fontWeight: 700 }}>{formatMoney(salary * years)}</span>
        </div>

        <button className="btn" style={{ marginTop: 10 }} onClick={offer}>
          この条件で提示する
        </button>
        <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 6 }}>
          契約しても能力が変わることはありません。隠れていた能力が見えるようになるだけです。
        </p>
      </div>
    </Sheet>
  );
}

/* ================= アマチュア（スカウト） ================= */

function AmateurPanel() {
  const { state, mutate, showToast } = useGame();
  const active = state.discovery?.amateur.active ?? null;
  const presets = state.discovery?.amateur.presets ?? [];
  const search = state.discovery?.amateur.search ?? null;
  const candidates = state.discovery?.amateur.candidates ?? [];
  const stage = search ? searchStage(search) : null;
  const stageProgress = search ? searchStageProgress(search) : 0;
  const [condition, setCondition] = useState<DiscoveryCondition>(
    () => active ?? emptyCondition(false),
  );
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const apply = () => {
    mutate((draft) => setAmateurCondition(draft, condition));
    showToast('スカウトに指示を出しました');
  };

  const clear = () => {
    mutate((draft) => setAmateurCondition(draft, null));
    showToast('指示を取り消しました');
  };

  const save = () => {
    const label = name.trim() || '名前のない条件';
    mutate((draft) => saveAmateurPreset(draft, label, condition));
    setNaming(false);
    setName('');
    showToast('条件を保存しました');
  };

  const startSearch = () => {
    let message = '';
    mutate((draft) => {
      const result = startAmateurSearch(draft, condition);
      message = result.ok ? '発掘を始めました' : (result.reason ?? '始められません');
    });
    showToast(message);
  };

  const stopSearch = () => {
    mutate((draft) => cancelAmateurSearch(draft));
    showToast('発掘をやめました');
  };

  return (
    <>
      <div className="card">
        <Sec en="AMATEUR SCOUTING" ja="アマチュアの発掘" />
        <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          この条件でシーズン中に1人ずつ発掘できます。見つかった選手はその場で
          調べられ、今年のドラフト候補にもそのまま加わります（指名の優先権は
          付きません）。「この条件で探させる」は従来どおり、
          発掘力に応じて次のドラフトの候補リストに何人か上乗せするだけの指示です。
        </p>

        <ConditionEditor
          condition={condition}
          onChange={setCondition}
          showOrigin
        />

        {search ? (
          <>
            <div className="stat-line" style={{ marginTop: 8 }}>
              <span className="muted">{stage === 'finding' ? '発掘中' : '調査中'}</span>
              <span style={{ fontWeight: 700 }}>{stageProgress}%</span>
            </div>
            <div className="meter" aria-label={`${stage === 'finding' ? '発掘' : '調査'}の進み具合 ${stageProgress}%`}>
              <div className="meter-fill" style={{ width: `${stageProgress}%` }} />
            </div>
            <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 6 }}>
              {stage === 'finding'
                ? '日付を進めると発掘が進みます。'
                : '候補が見つかりました。日付を進めると調査が進みます。かかる日数・ギャップの狭さは調査力で決まります。'}
            </p>
            <PictureButton src={discoverStopArt} alt={stage === 'finding' ? '発掘をやめる' : '調査をやめる'} onClick={stopSearch} />
          </>
        ) : (
          <>
            <PictureButton src={discoverStartArt} alt="この条件で発掘する" onClick={startSearch} />
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn secondary" onClick={apply}>
                この条件で探させる
              </button>
              <button className="btn secondary" onClick={() => setNaming(true)}>
                条件を保存
              </button>
            </div>
          </>
        )}

        <div className="stat-line" style={{ marginTop: 8 }}>
          <span className="muted">いまの指示</span>
          <span>{active ? conditionSummary(active) : '指示なし'}</span>
        </div>
        {active && (
          <button className="btn secondary" onClick={clear}>
            指示を取り消す
          </button>
        )}
      </div>

      <div className="card">
        <Sec en="CANDIDATES" ja="発掘した候補" size="sub" />
        {candidates.length === 0 ? (
          <p className="muted">まだ候補はいません。</p>
        ) : (
          candidates.map((candidate) => (
            <AmateurCandidateRow key={candidate.id} candidate={candidate} />
          ))
        )}
      </div>

      <div className="card">
        <Sec en="PRESETS" ja="保存した条件" size="sub" />
        {presets.length === 0 ? (
          <p className="muted">まだ保存した条件はありません。</p>
        ) : (
          presets.map((preset) => (
            <div className="stat-line" key={preset.id}>
              <span>
                {preset.name}
                <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                  ／{conditionSummary(preset.condition)}
                </span>
              </span>
              <span style={{ display: 'flex', gap: 5 }}>
                <button className="chip" onClick={() => setCondition({ ...preset.condition })}>
                  読み込む
                </button>
                <button
                  className="chip"
                  onClick={() => {
                    mutate((draft) => removeAmateurPreset(draft, preset.id));
                    showToast('条件を消しました');
                  }}
                >
                  消す
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {naming && (
        <Sheet title="条件に名前を付ける" onClose={() => setNaming(false)}>
          <div className="card">
            <input
              className="text-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：即戦力の左腕"
              maxLength={20}
            />
            <button className="btn" style={{ marginTop: 10 }} onClick={save}>
              保存する
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function AmateurCandidateRow({ candidate }: { candidate: AmateurCandidate }) {
  const { state } = useGame();
  const report = amateurReportOf(state, candidate);
  const player = candidate.prospect.player;

  return (
    <div className="discovery-card">
      <div className="spread">
        <div>
          <div style={{ fontWeight: 700 }}>{player.name}</div>
          <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            {ORIGIN_LABELS[candidate.origin]}／{player.age}歳／
            {player.isPitcher ? '投手' : POSITION_LABELS[player.mainPosition]}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            推定
          </div>
          <div style={{ fontWeight: 700 }}>{report ? abilityRangeText(report) : '調査中'}</div>
        </div>
      </div>

      <div className="stat-line">
        <span className="muted">将来性</span>
        <span>{report ? (report.estimate.potential ?? '未調査') : '調査中'}</span>
      </div>

      <ul className="note-list">
        {candidate.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>

      <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
        今年のドラフト候補にも加わります。
      </p>
    </div>
  );
}

/** 条件を1行で表す */
export function conditionSummary(condition: DiscoveryCondition): string {
  const parts: string[] = [condition.pitcher ? '投手' : '野手'];
  if (condition.pitcher && condition.role) parts.push(PITCHER_ROLE_LABELS[condition.role]);
  if (!condition.pitcher && condition.position) parts.push(POSITION_LABELS[condition.position]);
  if (condition.type) parts.push(DISCOVERY_TYPE_LABELS[condition.type]);
  if (condition.ageBand) parts.push(AGE_BAND_LABELS[condition.ageBand]);
  if (condition.origin) parts.push(ORIGIN_LABELS[condition.origin]);
  return parts.join('・');
}
