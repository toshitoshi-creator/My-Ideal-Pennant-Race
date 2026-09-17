/**
 * 絵だけのボタン。
 * ホーム画面の各入り口（次の試合を除く）と、試合開始ボタンで使う共通部品。
 * 読み上げには alt でラベルが伝わる。押した／押せない見た目は CSS 側で付ける。
 */
export function PictureButton({
  src,
  alt,
  onClick,
  disabled,
  className,
}: {
  src: string;
  alt: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`btn-img${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <img src={src} alt={alt} />
    </button>
  );
}
