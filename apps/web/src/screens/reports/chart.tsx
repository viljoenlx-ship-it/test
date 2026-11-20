type ChartKind = 'bar' | 'line' | 'pie';

const INK = '#243044';
const BAR = '#1f4e5f';

function chartLabel(label: string): string {
  const plain = label.replace(/\s*\(.*$/, '');
  return plain.length > 26 ? `${plain.slice(0, 24)}…` : plain;
}

function piePath(cx: number, cy: number, radius: number, start: number, end: number): string {
  const sweep = end - start;
  if (sweep >= Math.PI * 2 - 0.001) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius} Z`;
  }
  const large = sweep > Math.PI ? 1 : 0;
  const x1 = cx + radius * Math.sin(start);
  const y1 = cy - radius * Math.cos(start);
  const x2 = cx + radius * Math.sin(end);
  const y2 = cy - radius * Math.cos(end);
  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
}

const PIE = [
  '#1f4e5f',
  '#3d6b66',
  '#8a5a12',
  '#314056',
  '#0f6b4c',
  '#8f3044',
  '#5c6b7a',
  '#243044',
];

export function ReportChart({
  kind,
  labels,
  values,
  valueTexts,
}: {
  kind: ChartKind;
  labels: string[];
  values: number[];
  valueTexts: string[];
}) {
  if (labels.length === 0) {
    return <p className="ui-hint">Add a total to see a chart.</p>;
  }
  const max = Math.max(...values.map((value) => Math.abs(value)), 1);
  if (kind === 'pie') {
    const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0) || 1;
    let angle = 0;
    const slices = values.map((value, index) => {
      const sweep = (Math.max(value, 0) / total) * Math.PI * 2;
      const path = piePath(120, 110, 78, angle, angle + sweep);
      angle += sweep;
      return { path, colour: PIE[index % PIE.length] ?? BAR, label: labels[index] ?? '' };
    });
    return (
      <svg className="report-chart" viewBox="0 0 420 220" role="img" aria-label="Pie chart">
        {slices.map((slice) => (
          <path key={slice.label + slice.path} d={slice.path} fill={slice.colour} />
        ))}
        {slices.map((slice, index) => (
          <text key={slice.label} x="230" y={28 + index * 22} fill={INK} fontSize="12">
            {chartLabel(slice.label)}
          </text>
        ))}
      </svg>
    );
  }
  if (kind === 'line') {
    const step = labels.length > 1 ? 520 / (labels.length - 1) : 0;
    const points = values
      .map((value, index) => `${40 + index * step},${180 - (Math.abs(value) / max) * 140}`)
      .join(' ');
    return (
      <svg className="report-chart" viewBox="0 0 600 210" role="img" aria-label="Line chart">
        <polyline fill="none" stroke={BAR} strokeWidth="2.5" points={points} />
        {labels.map((label, index) => (
          <text
            key={label + String(index)}
            x={40 + index * step}
            y="202"
            fill={INK}
            fontSize="11"
            textAnchor="middle"
          >
            {chartLabel(label).slice(0, 12)}
          </text>
        ))}
      </svg>
    );
  }
  const height = Math.max(72, labels.length * 36 + 16);
  const barMax = 280;
  return (
    <svg className="report-chart" viewBox={`0 0 720 ${height}`} role="img" aria-label="Bar chart">
      {labels.map((label, index) => {
        const amount = Math.abs(values[index] ?? 0);
        const width = max === 0 ? 0 : (amount / max) * barMax;
        const y = 12 + index * 36;
        return (
          <g key={label + String(index)}>
            <text x="0" y={y + 15} fill={INK} fontSize="13">
              {chartLabel(label)}
            </text>
            <rect
              x="188"
              y={y}
              width={Math.max(width, amount > 0 ? 2 : 0)}
              height="18"
              rx="4"
              fill={BAR}
            />
            <text x={196 + width} y={y + 14} fill={INK} fontSize="12">
              {valueTexts[index] ?? ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
