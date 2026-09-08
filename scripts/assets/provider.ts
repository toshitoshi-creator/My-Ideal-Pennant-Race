/**
 * PHASE 4.7 画像生成プロバイダーの共通の窓口（§2・§32）。
 *
 * ここは **開発時にしか動かない**。ゲーム本体（src/）からは絶対に読み込まない。
 * ゲームが読むのは、出来上がってローカルに置かれた画像だけ。
 *
 * 実装しているのは「どう呼ぶか」だけで、鍵は持たない。
 * 鍵は呼び出し側（CLI）が環境変数から読んで渡す。ソースにも manifest にも残さない（§3・§17）。
 */

/** 生成をお願いするときの中身 */
export interface GenerationRequest {
  /** 素材ID（head_001 など）。ファイル名にもなる */
  id: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  /** 見本の絵。プロバイダーが対応していれば渡す */
  referenceImage?: Uint8Array;
  /** 透明背景で返してほしいか */
  transparent: boolean;
  /** 同じ指定からは同じ絵が返ってほしいときの種 */
  seed?: number;
}

/** 生成の結果。成功でも失敗でも同じ形で返す */
export type GenerationResult =
  | {
      ok: true;
      id: string;
      /** PNG のバイト列 */
      bytes: Uint8Array;
      /** 記録に残す情報。鍵は絶対に入れない */
      meta: GenerationMeta;
    }
  | {
      ok: false;
      id: string;
      /** 人が読んで直せる文言 */
      reason: string;
      /** もう一度試せば通る見込みがあるか */
      retryable: boolean;
    };

/** manifest に残す出所（§17）。鍵・利用者情報は入れない */
export interface GenerationMeta {
  provider: string;
  model: string;
  promptVersion: number;
  /** 生成した日。プロバイダーの応答が持っていなければ空 */
  generatedAt: string;
  seed?: number;
}

/** プロバイダーの設定。apiKey はここより先へ持ち出さない */
export interface ProviderConfig {
  apiKey: string;
  model?: string;
  /** 既定以外の宛先を使うとき */
  baseUrl?: string;
}

/** 画像生成プロバイダー */
export interface ImageGenerationProvider {
  /** 表示名。manifest の source にも入る */
  readonly name: string;
  /** 使うモデル */
  readonly model: string;
  /** 見本画像を渡せるか（§11） */
  supportsReferenceImage(): boolean;
  /** 透明背景で返せるか */
  supportsTransparency(): boolean;
  /** 1枚だけ作る */
  generateImage(request: GenerationRequest): Promise<GenerationResult>;
  /** まとめて作る。中で1枚ずつ呼ぶだけでもよい */
  generateBatch(requests: GenerationRequest[]): Promise<GenerationResult[]>;
}

/**
 * どのプロバイダーでも同じように使える土台。
 * まとめ生成の間隔・再試行・打ち切りをここで面倒みる（§30）。
 */
export abstract class BaseImageProvider implements ImageGenerationProvider {
  abstract readonly name: string;
  abstract readonly model: string;

  /** 1回に走らせる数 */
  readonly batchSize: number = 2;
  /** 1枚あたりの再試行の上限 */
  readonly maxRetries: number = 2;
  /** 再試行までの待ち（ミリ秒）。回を追うごとに倍にする */
  readonly retryDelayMs: number = 2000;
  /** 1枚あたりの制限時間 */
  readonly timeoutMs: number = 120000;

  supportsReferenceImage(): boolean {
    return false;
  }

  supportsTransparency(): boolean {
    return false;
  }

  abstract generateImage(request: GenerationRequest): Promise<GenerationResult>;

  /**
   * まとめて作る。
   * 途中で失敗しても、そこまでに成功したものは必ず返す（§30）。
   */
  async generateBatch(requests: GenerationRequest[]): Promise<GenerationResult[]> {
    const results: GenerationResult[] = [];
    for (let i = 0; i < requests.length; i += this.batchSize) {
      const slice = requests.slice(i, i + this.batchSize);
      const done = await Promise.all(slice.map((request) => this.withRetry(request)));
      results.push(...done);
    }
    return results;
  }

  /** 一時的な失敗だけ、間を空けてやり直す */
  protected async withRetry(request: GenerationRequest): Promise<GenerationResult> {
    let last: GenerationResult = {
      ok: false,
      id: request.id,
      reason: '一度も試行されませんでした',
      retryable: false,
    };
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await delay(this.retryDelayMs * 2 ** (attempt - 1));
      try {
        last = await this.generateImage(request);
      } catch (error) {
        last = {
          ok: false,
          id: request.id,
          reason: describeError(error),
          retryable: true,
        };
      }
      if (last.ok || !last.retryable) return last;
    }
    return last;
  }

  /** 制限時間つきで叩く。鍵は引数で受け取り、ここから外へは出さない */
  protected async post(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** 出所の記録を作る。鍵は入れない */
  protected metaOf(request: GenerationRequest, promptVersion: number): GenerationMeta {
    return {
      provider: this.name,
      model: this.model,
      promptVersion,
      generatedAt: '',
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    };
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 例外を人が読める1行にする。鍵らしき文字は落とす */
export function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return redact(text);
}

/**
 * 記録に残す前に、鍵らしき文字を伏せる（§3・§47）。
 * 失敗の記録にうっかり鍵が混ざるのを防ぐための最後の砦。
 */
export function redact(text: string): string {
  return text
    .replace(/(sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/\br8_[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/("?(?:api[_-]?key|authorization|token|secret)"?\s*[:=]\s*)"?[^",\s]{8,}"?/gi, '$1[REDACTED]');
}

/** base64 の文字列をバイト列にする（プロバイダーの応答を読むため） */
export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int16Array(256).fill(-1);
  for (let i = 0; i < table.length; i++) lookup[table.charCodeAt(i)] = i;

  let length = clean.length;
  while (length > 0 && clean[length - 1] === '=') length -= 1;
  const out = new Uint8Array(Math.floor((length * 3) / 4));

  let bits = 0;
  let value = 0;
  let at = 0;
  for (let i = 0; i < length; i++) {
    const digit = lookup[clean.charCodeAt(i)];
    if (digit < 0) throw new Error('base64 として読めない文字が混ざっています');
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, at);
}
