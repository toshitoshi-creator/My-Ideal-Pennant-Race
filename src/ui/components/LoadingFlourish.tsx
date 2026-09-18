import { useEffect, useState } from 'react';
import { useReducedMotion } from '../anim';
import loadingGif from '../../assets/ui/loading-flourish.gif';

/**
 * 画面の切り替わりに一瞬だけ重ねる、読み込み中を思わせる演出。
 *
 * いまはどの画面切り替えも待ち時間が無いが、将来ロードが必要になる場面が
 * 出てきたときにも同じ見せ方で対応できるよう、待ち時間が無くても先に
 * 挟み込んでおく（実際の表示や操作をブロックはしない）。
 * 呼び出し側が key を変えるたびに新しく mount され、そのたびに出る。
 */
export function LoadingFlourish() {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(() => setVisible(false), 550);
    return () => clearTimeout(timer);
  }, [reduced]);

  if (reduced || !visible) return null;

  return (
    <div className="loading-flourish" aria-hidden="true">
      <img src={loadingGif} alt="" />
    </div>
  );
}
