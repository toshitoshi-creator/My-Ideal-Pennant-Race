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
   * false。fal-ai/flux/dev は透明背景を返せない。
   * ここで true を返すと、抜けていない背景がそのまま取り込まれる。
   */
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
        // PNG 固定。JPEG にすると縁がにじんで、背景を綺麗に抜けなくなる
        output_format: 'png',
        // 生成をプロンプトに素直に従わせる（下地を単色に保つため）
        enable_safety_checker: true,
        /*
         * 画像を応答そのものに入れてもらう。
         *
         * これを付けないと、fal は配信用のホスト（v3b.fal.media など）の
         * URL を返してきて、こちらが取りに行くことになる。
         * 配信ホストは要求ごとに変わるうえ、閉じた環境では許可リストに
         * 入っていないことが多く、「生成はできたのに取ってこられない」
         * という失敗になる（実際にこれで詰まりました）。
         *
         * 応答に直接入れてもらえば、通信は1回で済み、宛先も1つで済む。
         */
        sync_mode: true,
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
