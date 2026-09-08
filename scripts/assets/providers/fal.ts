/**
 * fal.ai のつなぎ（§2・§32）。
 */
import {
  BaseImageProvider,
  redact,
  type GenerationRequest,
  type GenerationResult,
  type ProviderConfig,
} from '../provider';

const DEFAULT_MODEL = 'fal-ai/flux/dev';
const DEFAULT_BASE_URL = 'https://fal.run';

export class FalProvider extends BaseImageProvider {
  readonly name = 'fal';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super();
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  override supportsReferenceImage(): boolean {
    return true;
  }

  override supportsTransparency(): boolean {
    return false;
  }

  async generateImage(request: GenerationRequest): Promise<GenerationResult> {
    const response = await this.post(
      `${this.baseUrl}/${this.model}`,
      {
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        image_size: { width: request.width, height: request.height },
        num_images: 1,
        output_format: 'png',
        ...(request.seed === undefined ? {} : { seed: request.seed }),
      },
      { authorization: `Key ${this.apiKey}` },
    );

    if (!response.ok) {
      const text = redact(await response.text());
      return {
        ok: false,
        id: request.id,
        reason: `fal が ${response.status} を返しました: ${text.slice(0, 200)}`,
        retryable: response.status === 429 || response.status >= 500,
      };
    }

    const payload = (await response.json()) as { images?: Array<{ url?: string }> };
    const url = payload.images?.[0]?.url;
    if (!url) {
      return {
        ok: false,
        id: request.id,
        reason: 'fal の応答に画像が入っていませんでした',
        retryable: true,
      };
    }
    const file = await fetch(url);
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
