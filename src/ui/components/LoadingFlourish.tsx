import { useEffect, useState } from 'react';
import { useReducedMotion } from '../anim';
import { sfx } from '../sfx';
import loadingGif from '../../assets/ui/loading-flourish.gif';

/**
 * 画面の切り替わりに一瞬だけ重ねる、読み込み中を思わせる演出。
 *
 * 斜めの帯が右から画面を横切り、中央で投球の絵を一瞬見せてから左へ抜ける。
 * いまはどの画面切り替えも待ち時間が無いが、将来ロードが必要になる場面が
 * 出てきたときにも同じ見せ方で対応できるよう、待ち時間が無くても先に
 * 挟み込んでおく（実際の表示や操作をブロックはしない）。
 * 呼び出し側が key を変えるたびに新しく mount され、そのたびに出る。
 */
const DURATION = 640;

export function LoadingFlourish() {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (reduced) return;
    sfx.whoosh();
    const timer = setTimeout(() => setVisible(false), DURATION);
    return () => clearTimeout(timer);
  }, [reduced]);

  if (reduced || !visible) return null;

  return (
    <div className="loading-flourish" aria-hidden="true">
      <div className="lf-band lf-band-1" />
      <div className="lf-band lf-band-2" />
      <div className="lf-band lf-band-3" />
      <div className="lf-center">
        <img src={loadingGif} alt="" />
        <div className="lf-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
