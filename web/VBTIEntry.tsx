import './vbti.css';
export function VBTIMark() {
  const letters = [
    ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  ];
  return (
    <span className="vbti-wordmark" role="img" aria-label="VBTI">
      <svg viewBox="0 0 28 9" aria-hidden="true" shapeRendering="crispEdges">
        {letters.map((rows, letter) => (
          <g
            key={letter}
            transform={`translate(${[0, 7, 15, 21][letter]}, ${letter > 1 ? 1.4 : 0}) scale(${letter > 1 ? 0.8 : 1})`}
          >
            {rows.flatMap((row, y) =>
              [...row].map(
                (pixel, x) =>
                  pixel === '1' && (
                    <g key={`${x}-${y}`}>
                      <rect x={x + 0.4} y={y + 0.5} width="1" height="1" fill="#d9c6e7" />
                      <rect
                        x={x}
                        y={y}
                        width="1"
                        height="1"
                        fill={letter > 1 ? '#9c79b3' : '#574071'}
                      />
                    </g>
                  ),
              ),
            )}
          </g>
        ))}
      </svg>
    </span>
  );
}
export function VBTIEntry() {
  return (
    <aside className="vbti-side-rail" aria-label="VBTI 活动入口">
      <a href="/vbti/" className="vbti-side-icon" aria-label="VBTI · 测测你的 Vibe coding 类型">
        <img src="/brand/vbti-icon-96.png" alt="" width="40" height="40" />
        <strong>VBTI</strong>
        <span className="vbti-side-tooltip">测测你的 Vibe coding 类型 →</span>
      </a>
    </aside>
  );
}
