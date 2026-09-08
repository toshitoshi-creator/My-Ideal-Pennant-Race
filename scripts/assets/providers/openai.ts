/**
 * OpenAI 画像生成のつなぎ（§2・§32）。
 *
 * このファイルはゲームに入らない。開発時のCLIからだけ呼ばれる。
 * 鍵は呼び出し側から受け取り、ここから外へ持ち出さない。
 */
import {
  BaseImageProvider,
  decodeBase64,
  redact,
  type GenerationRequest,
  type GenerationResult,
  type ProviderConfig,
} from '../provider';

const DEFAULT_MODEL = 'gpt-image-1';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIImageProvider extends BaseImageProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super();
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /** 画像編集の口はあるが、素材づくりでは使わない */
  override supportsReferenceImage(): boolean {
    return false;
  }

  /** 透明背景を指定できる */
  override supportsTransparency(): boolean {
    return true;
  }

  async generateImage(request: GenerationRequest): Promise<GenerationResult> {
    const response = await this.post(
      `${this.baseUrl}/images/generations`,
      {
        model: this.model,
        prompt: `${request.prompt}\n\nDo not include: ${request.negativePrompt}`,
        size: `${request.width}x${request.height}`,
        background: request.transparent ? 'transparent' : 'opaque',
        output_format: 'png',
        n: 1,
      },
      { authorization: `Bearer ${this.apiKey}` },
    );

    if (!response.ok) {
      const text = redact(await response.text());
      return {
        ok: false,
        id: request.id,
        reason: `OpenAI が ${response.status} を返しました: ${text.slice(0, 200)}`,
        // 429（混雑）と 5xx（向こうの不調）だけやり直す
        retryable: response.status === 429 || response.status >= 500,
      };
    }

    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string }>;
    };
    const encoded = payload.data?.[0]?.b64_json;
    if (!encoded) {
      return {
        ok: false,
        id: request.id,
        reason: 'OpenAI の応答に画像が入っていませんでした',
        retryable: true,
      };
    }
    return {
      ok: true,
      id: request.id,
      bytes: decodeBase64(encoded),
      meta: this.metaOf(request, 0),
    };
  }
}
