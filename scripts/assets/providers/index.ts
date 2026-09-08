/**
 * どのプロバイダーを使うかを決めるところ（§2・§3・§52）。
 *
 * 大事な決まり：
 *   - 鍵が無ければ「使えない」と正直に返す。生成できたことにしない（§34）
 *   - 勝手にプロバイダーを選んで有料の要求を投げない（§52）
 *   - 鍵の値はここから外へ持ち出さない。長さも中身も表示しない（§3）
 */
import type { ImageGenerationProvider } from '../provider';
import { OpenAIImageProvider } from './openai';
import { ReplicateProvider } from './replicate';
import { FalProvider } from './fal';
import { LocalProvider, type ReadImage } from './local';

export { OpenAIImageProvider, ReplicateProvider, FalProvider, LocalProvider };
export type { ReadImage };

/** 使えるプロバイダーの名前 */
export const PROVIDER_IDS = ['openai', 'replicate', 'fal', 'local'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** そのプロバイダーを使うために要るもの */
export interface ProviderRequirement {
  id: ProviderId;
  label: string;
  /** 要る環境変数。local は鍵が要らないので空 */
  envKeys: string[];
  /** 既定のモデル */
  defaultModel: string;
  note: string;
}

export const PROVIDER_REQUIREMENTS: ProviderRequirement[] = [
  {
    id: 'openai',
    label: 'OpenAI Images',
    envKeys: ['IMAGE_API_KEY'],
    defaultModel: 'gpt-image-1',
    note: '透明背景を指定できる。素材づくりには向いている',
  },
  {
    id: 'replicate',
    label: 'Replicate',
    envKeys: ['IMAGE_API_KEY'],
    defaultModel: 'black-forest-labs/flux-1.1-pro',
    note: 'モデルを選べる。透明背景は自分で抜く必要がある',
  },
  {
    id: 'fal',
    label: 'fal.ai',
    envKeys: ['IMAGE_API_KEY'],
    defaultModel: 'fal-ai/flux/dev',
    note: '速い。透明背景は自分で抜く必要がある',
  },
  {
    id: 'local',
    label: '手元のフォルダ',
    envKeys: [],
    defaultModel: 'manual',
    note: 'APIを使わない。assets/incoming/ へ置いた PNG を読む',
  },
];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/** CLI から渡す環境変数の写し。process には触れない */
export type Env = Record<string, string | undefined>;

export type ProviderResolution =
  | { available: true; provider: ImageGenerationProvider; id: ProviderId }
  | { available: false; reason: string; missing: string[]; hint: string };

/**
 * 環境変数からプロバイダーを決める。
 * 決められなければ、何が足りないのかを返す。ここで例外は投げない。
 */
export function resolveProvider(
  env: Env,
  options: { readImage?: ReadImage; dropDir?: string } = {},
): ProviderResolution {
  const wanted = (env.IMAGE_PROVIDER ?? '').trim().toLowerCase();

  if (!wanted) {
    return {
      available: false,
      reason: 'どの画像生成プロバイダーを使うか決まっていません',
      missing: ['IMAGE_PROVIDER'],
      hint: `IMAGE_PROVIDER に ${PROVIDER_IDS.join(' / ')} のどれかを指定してください`,
    };
  }

  if (!isProviderId(wanted)) {
    return {
      available: false,
      reason: `知らないプロバイダーです: ${wanted}`,
      missing: ['IMAGE_PROVIDER'],
      hint: `使えるのは ${PROVIDER_IDS.join(' / ')} です`,
    };
  }

  if (wanted === 'local') {
    const read = options.readImage;
    if (!read) {
      return {
        available: false,
        reason: '手元のフォルダを読む手段が渡されていません',
        missing: [],
        hint: 'CLI から readImage を渡してください（実装の不具合です）',
      };
    }
    return {
      available: true,
      id: 'local',
      provider: new LocalProvider(read, options.dropDir ?? 'assets/incoming'),
    };
  }

  const apiKey = (env.IMAGE_API_KEY ?? '').trim();
  if (!apiKey) {
    return {
      available: false,
      reason: `${wanted} を使うには鍵が要ります`,
      missing: ['IMAGE_API_KEY'],
      hint: '.env に IMAGE_API_KEY を書いてください（.env は git に入りません）',
    };
  }

  const config = {
    apiKey,
    ...(env.IMAGE_MODEL ? { model: env.IMAGE_MODEL } : {}),
    ...(env.IMAGE_BASE_URL ? { baseUrl: env.IMAGE_BASE_URL } : {}),
  };

  switch (wanted) {
    case 'openai':
      return { available: true, id: 'openai', provider: new OpenAIImageProvider(config) };
    case 'replicate':
      return { available: true, id: 'replicate', provider: new ReplicateProvider(config) };
    case 'fal':
      return { available: true, id: 'fal', provider: new FalProvider(config) };
  }
}
