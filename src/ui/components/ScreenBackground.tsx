/** 画面全体の裏に敷く、雰囲気だけの写真。ぼかしてあるので中身の判断には一切関わらない */
export function ScreenBackground({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="screen-bg" aria-hidden="true">
      <img src={src} alt={alt} />
    </div>
  );
}
