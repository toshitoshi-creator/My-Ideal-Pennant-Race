/**
 * fal.ai のつなぎ。
 *
 * fal-ai/flux/dev には**透明背景を指定するパラメータがありません**。
 * 「transparent background」とプロンプトに書いても透明にはならず、
 * 灰色の面や市松模様が描かれるだけです。
 *
 * そこでこのつなぎは、
 *   1. output_format は必ず png（劣化させない。JPEG の縁は抜けなくなる）
 *   2. 透明は返せないと宣言する（supportsTransparency は false）
 *   3. 呼び出し側は「単色の下地」を描かせるプロンプトを渡す
 *   4. 背景は開発時の後処理（assets:remove-background）で抜く
 * という前提で動きます。
 *
 * 鍵は呼び出し側から受け取り、ここから外へ持ち出しません。
 * 失敗の記録に混ざらないよう、応答の本文は redact を通してから残します。
 */
import {
  BaseImageProvider,
  decodeBase64,
  describeError,
  redact,
  type GenerationRequest,
  type GenerationResult,
  type ProviderConfig,
} from '../provider';

const DEFAULT_MODEL = 'fal-ai/flux/dev';
const DEFAULT_BASE_URL = 'https://fal.run';

/**
 * fal は1つの窓口でたくさんのモデルを扱うが、**受け付ける形はモデルごとに違う**。
 *
 *   flux 系      image_size は { width, height }。sync_mode で応答に画像を入れられる
 *   gpt-image-1  image_size は決まった文字列だけ。透明背景をそのまま出せる
 *   recraft-v3   プロンプトは1000字まで。絵柄を style で指定する
 *
 * ここを間違えると 422 で弾かれるだけなので、モデルごとに組み立て方を持っておく。
 */
interface FalModelProfile {
  /** そのモデルかどうか */
  matches(model: string): boolean;
  /** 透明背景をそのまま出せるか */
  transparent: boolean;
  /** プロンプトの文字数の上限 */
  maxPromptLength?: number;
  /** 画像を応答に直接入れてもらえるか（配信ホストを経由しなくて済む） */
  inlineImage: boolean;
  build(request: GenerationRequest, prompt: string): Record<string, unknown>;
}

const MODEL_PROFILES: FalModelProfile[] = [
  {
    // OpenAI の GPT Image。指示の読み取りが強く、透明背景をそのまま出せる
    matches: (model) => model.includes('gpt-image'),
    transparent: true,
    inlineImage: false,
    build: (request, prompt) => ({
      prompt,
      // 決まった文字列しか受け付けない。縦長はこれ
      image_size: request.height > request.width ? '1024x1536' : '1024x1024',
      background: request.transparent ? 'transparent' : 'opaque',
      output_format: 'png',
      quality: 'high',
      num_images: 1,
    }),
  },
  {
    // Recraft V3。線画・ベクター調が得意
    matches: (model) => model.includes('recraft'),
    transparent: false,
    maxPromptLength: 1000,
    inlineImage: false,
    build: (request, prompt) => ({
      prompt,
      image_size: { width: request.width, height: request.height },
      style: 'vector_illustration',
    }),
  },
  {
    // flux 系（dev / pro / schnell）
    matches: () => true,
    transparent: false,
    inlineImage: true,
    build: (request, prompt) => ({
      prompt,
      negative_prompt: request.negativePrompt,
      image_size: { width: request.width, height: request.height },
      num_images: 1,
      // PNG 固定。JPEG にすると縁がにじんで、背景を綺麗に抜けなくなる
      output_format: 'png',
      enable_safety_checker: true,
      /*
       * 画像を応答そのものに入れてもらう。
       *
       * これを付けないと、fal は配信用のホスト（v3b.fal.media など）の
       * URL を返してきて、こちらが取りに行くことになる。
       * 配信ホストは要求ごとに変わるうえ、閉じた環境では許可リストに
       * 入っていないことが多く、「生成はできたのに取ってこられない」
       * という失敗になる。
       */
      sync_mode: true,
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    }),
  },
];

function profileFor(model: string): FalModelProfile {
  return MODEL_PROFILES.find((profile) => profile.matches(model)) ?? MODEL_PROFILES[MODEL_PROFILES.length - 1];
}

/** そのモデルが透明背景をそのまま出せるか（CLI がプロンプトを切り替えるのに使う） */
export function falModelSupportsTransparency(model: string): boolean {
  return profileFor(model).transparent;
}

/** そのモデルのプロンプト文字数の上限（無ければ undefined） */
export function falModelPromptLimit(model: string): number | undefined {
  return profileFor(model).maxPromptLength;
}

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

  /**
   * モデルによる。
   * flux 系は返せない（false）。GPT Image は返せる（true）。
   * ここを間違えると、抜けていない背景がそのまま取り込まれる。
   */
  override supportsTransparency(): boolean {
    return profileFor(this.model).transparent;
  }

  /** そのモデルのプロンプト文字数の上限 */
  promptLimit(): number | undefined {
    return profileFor(this.model).maxPromptLength;
  }

  async generateImage(request: GenerationRequest): Promise<GenerationResult> {
    const profile = profileFor(this.model);
    const prompt = profile.maxPromptLength
      ? request.prompt.slice(0, profile.maxPromptLength)
      : request.prompt;
    const response = await this.post(
      `${this.baseUrl}/${this.model}`,
      profile.build(request, prompt),
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

    const payload = (await response.json()) as {
      images?: Array<{ url?: string; content_type?: string }>;
    };
    const url = payload.images?.[0]?.url;
    if (!url) {
      return {
        ok: false,
        id: request.id,
        reason: 'fal の応答に画像が入っていませんでした',
        retryable: true,
      };
    }

    // sync_mode のときは data URI で直接入っている（取りに行かなくてよい）
    if (url.startsWith('data:')) {
      try {
        return {
          ok: true,
          id: request.id,
          bytes: decodeBase64(url),
          meta: this.metaOf(request, 0),
        };
      } catch (error) {
        return {
          ok: false,
          id: request.id,
          reason: `応答の画像を読めませんでした: ${describeError(error)}`,
          retryable: false,
        };
      }
    }

    // 念のため、URL で返ってきた場合にも対応しておく
    let file: Response;
    try {
      file = await fetch(url);
    } catch (error) {
      const host = hostOf(url);
      return {
        ok: false,
        id: request.id,
        reason:
          `生成はできましたが、置き場所（${host}）から取ってこられませんでした: ` +
          `${describeError(error)}。閉じた環境では ${host} を許可リストに足すか、` +
          'sync_mode で応答に直接入れてもらってください',
        retryable: true,
      };
    }
    if (!file.ok) {
      return {
        ok: false,
        id: request.id,
        reason: `生成物の取得に失敗しました（${hostOf(url)} が ${file.status}）`,
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

/** URL からホスト名だけを取り出す（失敗の説明に使う） */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '不明なホスト';
  }
}
