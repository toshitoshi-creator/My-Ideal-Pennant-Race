/**
 * 効果音と振動（演出専用）。
 *
 * 音はすべて Web Audio でその場に合成する。音声ファイルを同梱しないので
 * 単一 HTML の配布でもオフラインで鳴り、外部へは一切取りに行かない。
 * ゲームの状態・乱数には触れない（ここでの Math.random はノイズの波形だけ）。
 *
 * 設定（効果音・試合中継演出）は localStorage に端末ごとに覚える。
 * 読み書きに失敗しても既定値で動く。
 */
import { useEffect, useState } from 'react';

const SOUND_KEY = 'mipr:pref:sound';
const BROADCAST_KEY = 'mipr:pref:broadcast';

type Listener = () => void;
const listeners = new Set<Listener>();

function readPref(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === 'on') return true;
    if (raw === 'off') return false;
  } catch {
    /* 使えない環境では既定値 */
  }
  return fallback;
}

function writePref(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? 'on' : 'off');
  } catch {
    /* 保存できなくてもこのセッションの間は効く */
  }
  listeners.forEach((fn) => fn());
}

export function soundEnabled(): boolean {
  return readPref(SOUND_KEY, true);
}
export function setSoundEnabled(on: boolean) {
  writePref(SOUND_KEY, on);
  if (on) sfx.tap();
}
export function broadcastEnabled(): boolean {
  return readPref(BROADCAST_KEY, true);
}
export function setBroadcastEnabled(on: boolean) {
  writePref(BROADCAST_KEY, on);
}

/** 設定の変化を画面に反映するためのフック */
export function usePrefs(): { sound: boolean; broadcast: boolean } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return { sound: soundEnabled(), broadcast: broadcastEnabled() };
}

/* ================= 合成エンジン ================= */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function audio(): { ac: AudioContext; out: GainNode } | null {
  if (typeof window === 'undefined') return null;
  if (!soundEnabled()) return null;
  // 利用者が一度も触れていないうちは鳴らさない（ブラウザの自動再生制限）
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation;
  if (activation && !activation.hasBeenActive) return null;
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.5;
      // 急な音量の山を丸めて、どの端末でも割れないようにする
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return { ac: ctx, out: master! };
  } catch {
    return null;
  }
}

function noise(ac: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate) return noiseBuffer;
  const length = ac.sampleRate * 2;
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

interface ToneOpts {
  freq: number;
  to?: number;
  type?: OscillatorType;
  at?: number;
  dur?: number;
  vol?: number;
  attack?: number;
}

function tone({ freq, to, type = 'sine', at = 0, dur = 0.12, vol = 0.3, attack = 0.005 }: ToneOpts) {
  const a = audio();
  if (!a) return;
  const { ac, out } = a;
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

interface NoiseOpts {
  at?: number;
  dur?: number;
  vol?: number;
  filter?: BiquadFilterType;
  freq?: number;
  to?: number;
  q?: number;
  attack?: number;
}

function burst({
  at = 0,
  dur = 0.2,
  vol = 0.3,
  filter = 'bandpass',
  freq = 1200,
  to,
  q = 1,
  attack = 0.004,
}: NoiseOpts) {
  const a = audio();
  if (!a) return;
  const { ac, out } = a;
  const t0 = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const f = ac.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t0);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  f.Q.value = q;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(gain);
  gain.connect(out);
  src.start(t0, Math.random() * 1.5);
  src.stop(t0 + dur + 0.05);
}

/** 振動（対応端末だけ。演出専用なので失敗しても無視） */
export function buzz(pattern: number | number[]) {
  if (!soundEnabled()) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 未対応 */
  }
}

const NOTE = (n: number) => 440 * 2 ** ((n - 69) / 12);

export const sfx = {
  /** ボタンを押した軽い音 */
  tap() {
    tone({ freq: 1250, to: 820, type: 'triangle', dur: 0.06, vol: 0.14 });
  },
  /** 画面の切り替え（紙をめくる風切り） */
  whoosh() {
    burst({ dur: 0.26, vol: 0.12, filter: 'bandpass', freq: 600, to: 2600, q: 0.9, attack: 0.05 });
  },
  /** シートを開く */
  open() {
    tone({ freq: 520, to: 880, type: 'sine', dur: 0.12, vol: 0.12 });
  },
  /** 投球（ミットに収まる） */
  pitch() {
    burst({ dur: 0.08, vol: 0.18, filter: 'lowpass', freq: 900, q: 0.7 });
    tone({ freq: 140, to: 70, type: 'sine', dur: 0.08, vol: 0.2 });
  },
  /** 打球音（快音） */
  hit() {
    burst({ dur: 0.09, vol: 0.5, filter: 'highpass', freq: 2200, q: 0.6, attack: 0.001 });
    tone({ freq: 1900, to: 1200, type: 'square', dur: 0.05, vol: 0.12, attack: 0.001 });
    tone({ freq: 260, to: 120, type: 'sine', dur: 0.1, vol: 0.25, attack: 0.001 });
  },
  /** 得点（チャイム＋歓声） */
  run(big = false) {
    const base = big ? 76 : 72;
    [0, 4, 7].forEach((s, i) =>
      tone({ freq: NOTE(base + s), type: 'triangle', at: i * 0.07, dur: 0.22, vol: 0.18 }),
    );
    sfx.crowd(big ? 1.6 : 0.9, big ? 0.34 : 0.2);
  },
  /** 歓声（帯域を絞ったノイズのうねり） */
  crowd(dur = 1.2, vol = 0.22) {
    burst({ dur, vol, filter: 'bandpass', freq: 900, to: 1400, q: 0.5, attack: 0.18 });
    burst({ at: 0.05, dur: dur * 0.9, vol: vol * 0.6, filter: 'bandpass', freq: 2200, to: 1600, q: 0.8, attack: 0.2 });
  },
  /** 試合開始のサイレン */
  siren() {
    tone({ freq: 420, to: 640, type: 'sawtooth', dur: 0.55, vol: 0.07, attack: 0.12 });
    tone({ freq: 423, to: 645, type: 'sawtooth', at: 0.01, dur: 0.55, vol: 0.05, attack: 0.12 });
    tone({ freq: 640, to: 600, type: 'sawtooth', at: 0.55, dur: 0.7, vol: 0.07, attack: 0.02 });
  },
  /** 太鼓の連打（最終回・結果発表の前） */
  drumroll(dur = 0.7) {
    const hits = Math.floor(dur / 0.045);
    for (let i = 0; i < hits; i++) {
      burst({ at: i * 0.045, dur: 0.05, vol: 0.06 + (i / hits) * 0.12, filter: 'lowpass', freq: 380, q: 1 });
    }
  },
  /** ドン（結果のスタンプ） */
  slam() {
    tone({ freq: 110, to: 42, type: 'sine', dur: 0.4, vol: 0.55, attack: 0.002 });
    burst({ dur: 0.18, vol: 0.28, filter: 'lowpass', freq: 700, q: 0.8, attack: 0.002 });
  },
  /** 勝利のファンファーレ */
  fanfare() {
    const seq: Array<[number, number, number]> = [
      [67, 0, 0.14],
      [67, 0.15, 0.1],
      [67, 0.26, 0.1],
      [72, 0.38, 0.5],
      [76, 0.38, 0.5],
      [79, 0.38, 0.6],
    ];
    seq.forEach(([n, at, dur]) => {
      tone({ freq: NOTE(n), type: 'square', at, dur, vol: 0.09 });
      tone({ freq: NOTE(n), type: 'triangle', at, dur, vol: 0.16 });
    });
    sfx.crowd(2.2, 0.32);
  },
  /** 敗戦（下がる2音） */
  lose() {
    tone({ freq: NOTE(64), type: 'triangle', dur: 0.3, vol: 0.16 });
    tone({ freq: NOTE(60), type: 'triangle', at: 0.28, dur: 0.55, vol: 0.14 });
    tone({ freq: NOTE(55), type: 'sine', at: 0.28, dur: 0.6, vol: 0.1 });
  },
  /** 引き分け */
  draw() {
    tone({ freq: NOTE(67), type: 'triangle', dur: 0.24, vol: 0.14 });
    tone({ freq: NOTE(67), type: 'triangle', at: 0.26, dur: 0.3, vol: 0.12 });
  },
  /** 成立・獲得など良い知らせ */
  success() {
    [0, 4, 7, 12].forEach((s, i) =>
      tone({ freq: NOTE(72 + s), type: 'triangle', at: i * 0.06, dur: 0.18, vol: 0.14 }),
    );
  },
};
