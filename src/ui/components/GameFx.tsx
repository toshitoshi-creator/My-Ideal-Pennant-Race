/**
 * 画面全体にかかる「手ざわり」の演出（見せ方だけ。ゲームの状態には触れない）。
 *
 *  - TapFx      ボタンを押した場所に広がる輪と、軽い押下音
 *  - SettingsButton / SettingsSheet  効果音・試合中継の ON/OFF
 */
import { useEffect, useState } from 'react';
import { sfx, usePrefs, setSoundEnabled, setBroadcastEnabled } from '../sfx';
import { Sheet } from './common';

const PRESSABLE = 'button, [role="button"], a[href], .player-card, .team-pick';

/** 押した場所に輪を出す。DOM を直接触るので React の再描画は起きない */
export function TapFx() {
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const onDown = (e: PointerEvent) => {
      const target = (e.target as Element | null)?.closest?.(PRESSABLE) as HTMLElement | null;
      if (!target || (target as HTMLButtonElement).disabled) return;
      // 中継画面は独自の音を鳴らすので、押下音は重ねない
      if (!target.closest('.live-bc')) sfx.tap();
      if (reduced) return;
      const ring = document.createElement('span');
      ring.className = 'tap-ring';
      ring.style.left = `${e.clientX}px`;
      ring.style.top = `${e.clientY}px`;
      document.body.appendChild(ring);
      const spark = document.createElement('span');
      spark.className = 'tap-spark';
      spark.style.left = `${e.clientX}px`;
      spark.style.top = `${e.clientY}px`;
      document.body.appendChild(spark);
      const remove = () => {
        ring.remove();
        spark.remove();
      };
      ring.addEventListener('animationend', remove, { once: true });
      // animationend が来ない環境の保険
      setTimeout(remove, 800);
    };
    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);
  return null;
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.4 13a7.7 7.7 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.7 7.7 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.4-2.9c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5L19.4 13ZM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7Z"
        transform="translate(-1 0)"
      />
    </svg>
  );
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4z" />
      {on ? (
        <path
          d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      ) : (
        <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** アプリバーの設定ボタン。押すと設定シートが開く */
export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const { sound } = usePrefs();
  return (
    <>
      <button
        type="button"
        className="appbar-icon"
        aria-label="設定"
        onClick={() => {
          sfx.open();
          setOpen(true);
        }}
      >
        <GearIcon />
        <span className={`appbar-icon-badge${sound ? ' on' : ''}`}>
          <SpeakerIcon on={sound} />
        </span>
      </button>
      {open && <SettingsSheet onClose={() => setOpen(false)} />}
    </>
  );
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { sound, broadcast } = usePrefs();
  return (
    <Sheet title="設定" onClose={onClose}>
      <div className="card">
        <Toggle
          label="効果音・振動"
          note="ボタンの音、打球音、歓声、ファンファーレ"
          on={sound}
          onChange={setSoundEnabled}
        />
        <Toggle
          label="試合中継の演出"
          note="試合を1回ずつ中継してから結果の資料を開きます。OFF にすると結果だけを表示します"
          on={broadcast}
          onChange={setBroadcastEnabled}
        />
      </div>
    </Sheet>
  );
}

function Toggle({
  label,
  note,
  on,
  onChange,
}: {
  label: string;
  note: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`pref-toggle${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="pref-text">
        <span className="pref-label">{label}</span>
        <span className="pref-note">{note}</span>
      </span>
      <span className="pref-switch" aria-hidden="true">
        <span className="pref-knob" />
      </span>
    </button>
  );
}
