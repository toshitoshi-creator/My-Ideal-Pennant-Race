/**
 * PHASE 4.5 ニュースに添える絵（§20）。
 *
 * 記事の中身と合わないときは、絵を出さない。
 * 速報は大きく、通常は小さく、短信は絵なし。
 */
import { useMemo } from 'react';
import type { NewsItem } from '../../../domain/types';
import { newsVisualKind, teamVisual } from '../../../domain/visuals';
import { useGame } from '../../store';
import { PlayerPortrait } from '../PlayerPortrait';
import { StadiumScene } from './TeamVisuals';

const KIND_LABELS: Record<string, { en: string; ja: string }> = {
  CHAMPION: { en: 'CHAMPIONS', ja: '優勝' },
  POSTSEASON: { en: 'POSTSEASON', ja: 'ポストシーズン' },
  PLAYER: { en: 'PLAYER', ja: '選手' },
  DRAFT: { en: 'DRAFT', ja: 'ドラフト' },
  TRANSFER: { en: 'TRANSFER', ja: '移籍' },
  INJURY: { en: 'INJURY', ja: '離脱' },
  RETIREMENT: { en: 'RETIREMENT', ja: '引退' },
  RECORD: { en: 'RECORD', ja: '記録' },
  STADIUM: { en: 'GAME', ja: '試合' },
};

/**
 * 記事に合う絵を返す。合うものが無ければ null（絵を出さない）。
 * 大きさは記事の扱いに合わせる。
 */
export function NewsVisual({ item, tier }: { item: NewsItem; tier: 'lead' | 'normal' | 'brief' }) {
  const { state } = useGame();
  const kind = useMemo(() => newsVisualKind(item), [item]);
  // 短信には絵を付けない（§20）
  if (!kind || tier === 'brief') return null;

  const player = item.playerId ? state.players.find((p) => p.id === item.playerId) : undefined;
  const team = item.teamId ? state.teams.find((t) => t.id === item.teamId) : undefined;
  const label = KIND_LABELS[kind];

  // 選手の記事は、その選手の顔を出す（別人にならない。§7）
  if ((kind === 'PLAYER' || kind === 'INJURY' || kind === 'RETIREMENT' || kind === 'RECORD') && player) {
    return (
      <figure className={`news-visual news-visual-${tier}`}>
        <PlayerPortrait
          player={player}
          size={tier === 'lead' ? 'medium' : 'small'}
          teamColor={team?.color}
        />
        <figcaption className="label">{label.en}</figcaption>
      </figure>
    );
  }

  // 球団の記事は球場を出す
  if (team && (kind === 'CHAMPION' || kind === 'POSTSEASON' || kind === 'STADIUM')) {
    const visual = teamVisual(team);
    return (
      <figure className={`news-visual news-visual-wide news-visual-${tier}`}>
        <StadiumScene
          visual={visual}
          name={visual.stadiumName}
          mood={kind === 'CHAMPION' ? 'CHAMPION' : kind === 'POSTSEASON' ? 'POSTSEASON' : 'PACKED'}
          height={tier === 'lead' ? 96 : 64}
        />
        <figcaption className="label">{label.en}</figcaption>
      </figure>
    );
  }

  // 選手が特定できない移籍・ドラフトの記事には絵を付けない（内容と合わないため）
  return null;
}
