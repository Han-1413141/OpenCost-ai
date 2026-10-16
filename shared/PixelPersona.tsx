const atlases = [
  new URL('./assets/personas-pixel-01.png', import.meta.url).href,
  new URL('./assets/personas-pixel-02.png', import.meta.url).href,
];
export function PixelPersona({ index, small = false }: { index: number; small?: boolean }) {
  const cell = index % 16;
  return (
    <span
      aria-hidden="true"
      className={small ? 'pf-pixel-sprite small' : 'pf-pixel-sprite'}
      style={{
        backgroundImage: `url("${atlases[Math.floor(index / 16)]}")`,
        backgroundPosition: `${((cell % 4) * 100) / 3}% ${(Math.floor(cell / 4) * 100) / 3}%`,
      }}
    />
  );
}
