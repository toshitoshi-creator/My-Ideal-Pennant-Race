import type { League, Team } from './types';

export const LEAGUES: League[] = [
  { id: 'grand', name: 'グランドリーグ', useDH: false },
  { id: 'ocean', name: 'オーシャンリーグ', useDH: true },
];

/**
 * 架空 12 球団（2 リーグ × 6 球団）。
 * strength は初期選手生成時のチーム平均能力の目安（PHASE 1 のみの調整値）。
 */
export interface TeamSeed extends Team {
  strength: number;
}

export const TEAM_SEEDS: TeamSeed[] = [
  { id: 'phoenix', leagueId: 'grand', name: '東都フェニックス', shortName: '東都', homeTown: '東京', color: '#e4572e', strength: 41 },
  { id: 'bluewave', leagueId: 'grand', name: '関東ブルーウェーブ', shortName: '関東', homeTown: '横浜', color: '#2e86e4', strength: 40 },
  { id: 'grandvers', leagueId: 'grand', name: '名古屋グランバース', shortName: '名古屋', homeTown: '名古屋', color: '#f2a541', strength: 39 },
  { id: 'samurise', leagueId: 'grand', name: '京都サムライズ', shortName: '京都', homeTown: '京都', color: '#8e44ad', strength: 38 },
  { id: 'alpenwolves', leagueId: 'grand', name: '信州アルペンウルブズ', shortName: '信州', homeTown: '長野', color: '#3fa796', strength: 37 },
  { id: 'redstars', leagueId: 'grand', name: '瀬戸内レッドスターズ', shortName: '瀬戸内', homeTown: '広島', color: '#c0392b', strength: 36 },
  { id: 'blaze', leagueId: 'ocean', name: '大阪ブレイズ', shortName: '大阪', homeTown: '大阪', color: '#d35400', strength: 41 },
  { id: 'oceans', leagueId: 'ocean', name: '博多オーシャンズ', shortName: '博多', homeTown: '福岡', color: '#f6c90e', strength: 40 },
  { id: 'polarbears', leagueId: 'ocean', name: '札幌ポーラベアーズ', shortName: '札幌', homeTown: '札幌', color: '#4aa3df', strength: 39 },
  { id: 'northwinds', leagueId: 'ocean', name: '仙台ノースウィンズ', shortName: '仙台', homeTown: '仙台', color: '#1abc9c', strength: 38 },
  { id: 'marinbolts', leagueId: 'ocean', name: '幕張マリンボルツ', shortName: '幕張', homeTown: '千葉', color: '#2c3e9e', strength: 37 },
  { id: 'whitefox', leagueId: 'ocean', name: '新潟ホワイトフォックス', shortName: '新潟', homeTown: '新潟', color: '#7f8c8d', strength: 36 },
];

export const TEAMS: Team[] = TEAM_SEEDS.map(({ strength: _strength, ...team }) => team);

/** プレイヤーが選んだ球団は「弱小球団」としてスタートする */
export const PLAYER_TEAM_STRENGTH = 33;
