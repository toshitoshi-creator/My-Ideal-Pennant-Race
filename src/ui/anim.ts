/**
 * PHASE 4.1 アニメーションの共通部品。
 *
 * ここにあるのは「見せ方」だけで、ゲームの状態には一切触れない。
 * 演出が途中でも中断でき、途中の状態はセーブしない。
 * prefers-reduced-motion が有効なときは、どの関数も即座に最終状態を返す。
 */
import { useEffect, useMemo, useRef, useState } from 'react';

/** OS で「視差効果を減らす」が有効かどうか */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => matchReduced());
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    onChange();
    if (query.addEventListener) {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    // 古い Safari 向け
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);
  return reduced;
}

function matchReduced(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 一度きりの「出現」。
 * 初回だけ演出し、同じキーで戻ってきたときは即表示にする（§19）。
 */
const seen = new Set<string>();

export function useFirstVisit(key: string): boolean {
  const first = useMemo(() => !seen.has(key), [key]);
  useEffect(() => {
    seen.add(key);
  }, [key]);
  return first;
}

/** テスト・画面遷移のために出現記録を消す */
export function resetFirstVisits(): void {
  seen.clear();
}

/**
 * 0 → 1 に進む進行度。duration が 0 か reduced なら最初から 1。
 * 依存キーが変わるとやり直す。
 */
export function useProgress(duration: number, key: unknown = null): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(() => (reduced || duration <= 0 ? 1 : 0));
  const frame = useRef(0);

  useEffect(() => {
    if (reduced || duration <= 0) {
      setValue(1);
      return;
    }
    setValue(0);
    let start = 0;
    const step = (now: number) => {
      if (start === 0) start = now;
      const t = Math.min(1, (now - start) / duration);
      setValue(t);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [duration, reduced, key]);

  return value;
}

/** 数字のカウントアップ（§18・§26）。意味のある変化にだけ使う */
export function useCountUp(target: number, duration = 400, decimals = 0): number {
  const progress = useProgress(duration, target);
  const from = useRef(target);
  const previous = useRef(target);

  useEffect(() => {
    from.current = previous.current;
    previous.current = target;
  }, [target]);

  const eased = easeOutCubic(progress);
  const value = from.current + (target - from.current) * eased;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/**
 * 段階的な再生（§17・§21〜§25）。
 * step は 0 から steps まで進み、skip() で即座に最後まで飛ぶ。
 * 連打しても二重に進まない。
 */
export interface Playback {
  step: number;
  done: boolean;
  skip: () => void;
  replay: () => void;
}

export function usePlayback(steps: number, interval = 320, enabled = true): Playback {
  const reduced = useReducedMotion();
  const instant = reduced || !enabled || interval <= 0;
  const [step, setStep] = useState(() => (instant ? steps : 0));
  const [run, setRun] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (instant) {
      setStep(steps);
      return;
    }
    setStep(0);
    let current = 0;
    const tick = () => {
      current += 1;
      setStep(current);
      if (current < steps) timer.current = setTimeout(tick, interval);
    };
    timer.current = setTimeout(tick, interval);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [steps, interval, instant, run]);

  return {
    step,
    done: step >= steps,
    // すでに最後まで進んでいれば何もしない（連打対策）
    skip: () => {
      if (timer.current) clearTimeout(timer.current);
      setStep(steps);
    },
    replay: () => setRun((n) => n + 1),
  };
}

export function easeOutCubic(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return 1 - (1 - x) ** 3;
}

/**
 * 順番に現れるカードの遅延（§19）。
 * reduced のときは 0 を返して全部同時に出す。
 */
export function staggerDelay(index: number, reduced: boolean, stepMs = 45, max = 8): number {
  if (reduced) return 0;
  return Math.min(index, max) * stepMs;
}
