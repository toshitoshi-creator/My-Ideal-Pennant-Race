/**
 * 手元のフォルダから読むだけのプロバイダー（§2・§32）。
 *
 * 画像生成AIのAPIを契約していなくても、
 * 手元のツール（Web版のUIなど）で作った画像を置けば、
 * 後処理・検査・取り込みの流れはそのまま使える。
 *
 * ファイルの読み方は外から渡す。ここは node に依存しない。
 */
import {
  BaseImageProvider,
  type GenerationRequest,
  type GenerationResult,
  type GenerationMeta,
} from '../provider';

/** 素材IDを渡すと、その画像のバイト列を返す。無ければ null */
export type ReadImage = (id: string) => Promise<Uint8Array | null>;

export class LocalProvider extends BaseImageProvider {
  readonly name = 'local';
  readonly model = 'manual';
  /** 手元のファイルなので並べて読んでよい */
  override readonly batchSize = 8;
  override readonly maxRetries = 0;
  private readonly read: ReadImage;
  private readonly dropDir: string;

  constructor(read: ReadImage, dropDir: string) {
    super();
    this.read = read;
    this.dropDir = dropDir;
  }

  override supportsReferenceImage(): boolean {
    return true;
  }

  override supportsTransparency(): boolean {
    return true;
  }

  async generateImage(request: GenerationRequest): Promise<GenerationResult> {
    const bytes = await this.read(request.id);
    if (!bytes) {
      return {
        ok: false,
        id: request.id,
        reason: `${this.dropDir}/${request.id}.png が見つかりません。手元で作った画像をここへ置いてください`,
        // 置き直せば通るので、自動でやり直しても意味がない
        retryable: false,
      };
    }
    const meta: GenerationMeta = {
      provider: this.name,
      model: this.model,
      promptVersion: 0,
      generatedAt: '',
    };
    return { ok: true, id: request.id, bytes, meta };
  }
}
