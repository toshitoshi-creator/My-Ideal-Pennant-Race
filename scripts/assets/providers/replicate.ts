/**
 * Replicate のつなぎ（§2・§32）。
 *
 * Replicate は「頼んで、できるまで待つ」形なので、
 * 出来上がるまで様子を見に行く必要がある。
 */
import {
  BaseImageProvider,
  delay,
  redact,
  type GenerationRequest,
  type GenerationResult,
  type ProviderConfig,
} from '../provider';

const DEFAULT_MODEL = 'black-forest-labs/flux-1.1-pro';
const DEFAULT_BASE_URL = 'https://api.replicate.com/v1';

export class ReplicateProvider extends BaseImageProvider {
  readonly name = 'replicate';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  /** 様子を見に行く間隔と回数 */
  private readonly pollIntervalMs = 2500;
  private readonly maxPolls = 60;

  constructor(config: ProviderConfig) {
    super();
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /** モデルによっては見本の絵を渡せる */
  override supportsReferenceImage(): boolean {
    return true;
  }

  override supportsTransparency(): boolean {
    return false;
  }

  async generateImage(request: GenerationRequest): Promise<GenerationResult> {
    const started = await this.post(
      `${this.baseUrl}/models/${this.model}/predictions`,
      {
        input: {
          prompt: request.prompt,
          negative_prompt: request.negativePrompt,
          width: request.width,
          height: request.height,
          output_format: 'png',
          ...(request.seed === undefined ? {} : { seed: request.seed }),
        },
      },
      { authorization: `Bearer ${this.apiKey}`, prefer: 'wait' },
    );

    if (!started.ok) {
      const text = redact(await started.text());
      return {
        ok: false,
        id: request.id,
        reason: `Replicate が ${started.status} を返しました: ${text.slice(0, 200)}`,
        retryable: started.status === 429 || started.status >= 500,
      };
    }

    let prediction = (await started.json()) as ReplicatePrediction;
    for (let i = 0; i < this.maxPolls && isPending(prediction); i++) {
      await delay(this.pollIntervalMs);
      const url = prediction.urls?.get ?? `${this.baseUrl}/predictions/${prediction.id}`;
      const next = await fetch(url, { headers: { authorization: `Bearer ${this.apiKey}` } });
      if (!next.ok) break;
      prediction = (await next.json()) as ReplicatePrediction;
    }

    if (prediction.status !== 'succeeded') {
      return {
        ok: false,
        id: request.id,
        reason: `Replicate の生成が ${prediction.status ?? '不明'} で終わりました${
          prediction.error ? `: ${redact(String(prediction.error)).slice(0, 200)}` : ''
        }`,
        retryable: prediction.status !== 'failed',
      };
    }

    const imageUrl = firstUrl(prediction.output);
    if (!imageUrl) {
      return {
        ok: false,
        id: request.id,
        reason: 'Replicate の応答に画像のURLが入っていませんでした',
        retryable: true,
      };
    }
    const file = await fetch(imageUrl);
    if (!file.ok) {
      return {
        ok: false,
        id: request.id,
        reason: `生成物の取得に失敗しました（${file.status}）`,
        retryable: true,
      };
    }
    return {
      ok: true,
      id: request.id,
      bytes: new Uint8Array(await file.arrayBuffer()),
      meta: this.metaOf(request, 0),
    };
  }
}

interface ReplicatePrediction {
  id?: string;
  status?: string;
  error?: unknown;
  output?: unknown;
  urls?: { get?: string };
}

function isPending(prediction: ReplicatePrediction): boolean {
  return prediction.status === 'starting' || prediction.status === 'processing';
}

function firstUrl(output: unknown): string | null {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item === 'string') return item;
    }
  }
  return null;
}
