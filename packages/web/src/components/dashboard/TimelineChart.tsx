import type { BreakdownResponse } from '../../lib/api';

const WIDTH = 760;
const HEIGHT = 230;
const PAD_X = 34;
const PAD_TOP = 18;
const PAD_BOTTOM = 42;

function formatDate(value: string, count: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = count <= 2
    ? { hour: '2-digit' }
    : count <= 45
      ? { day: 'numeric', month: 'short' }
      : { month: 'short', year: '2-digit' };
  return new Intl.DateTimeFormat('ar', options).format(date);
}

export default function TimelineChart({ data }: { data: BreakdownResponse }) {
  const groups = data.groups;
  const max = Math.max(1, ...groups.map(group => group.value));
  const chartHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const chartWidth = WIDTH - PAD_X * 2;
  const points = groups.map((group, index) => {
    const x = groups.length <= 1 ? WIDTH / 2 : PAD_X + (index / (groups.length - 1)) * chartWidth;
    const y = PAD_TOP + chartHeight - (group.value / max) * chartHeight;
    return { ...group, x, y };
  });
  const linePath = points.length > 0
    ? points.slice(1).reduce((path, point, index) => {
        const previous = points[index];
        const middleX = (previous.x + point.x) / 2;
        return `${path} C ${middleX} ${previous.y}, ${middleX} ${point.y}, ${point.x} ${point.y}`;
      }, `M ${points[0].x} ${points[0].y}`)
    : '';
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${HEIGHT - PAD_BOTTOM} L ${points[0].x} ${HEIGHT - PAD_BOTTOM} Z`
    : '';
  const labelIndexes = new Set<number>();
  const labelCount = Math.min(7, groups.length);
  for (let index = 0; index < labelCount; index += 1) {
    labelIndexes.add(labelCount <= 1 ? 0 : Math.round((index / (labelCount - 1)) * (groups.length - 1)));
  }
  const total = groups.reduce((sum, group) => sum + group.value, 0);
  const average = groups.length > 0 ? Math.round((total / groups.length) * 10) / 10 : 0;
  const peak = groups.reduce<typeof groups[number] | null>((best, group) => !best || group.value > best.value ? group : best, null);

  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
        <div><p className="text-[10px] text-slate-400">إجمالي الفترة</p><p className="mt-0.5 text-sm font-black text-slate-700">{total.toLocaleString('ar')}</p></div>
        <div className="border-x border-slate-200"><p className="text-[10px] text-slate-400">متوسط الفترة</p><p className="mt-0.5 text-sm font-black text-slate-700">{average.toLocaleString('ar')}</p></div>
        <div><p className="text-[10px] text-slate-400">أعلى نقطة</p><p className="mt-0.5 text-sm font-black text-sky-700">{(peak?.value ?? 0).toLocaleString('ar')}</p></div>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-[240px] w-full" preserveAspectRatio="none" role="img" aria-label="مخطط تطور اكتساب الزبائن">
        <defs>
          <linearGradient id="client-acquisition-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map(ratio => {
          const y = PAD_TOP + chartHeight * ratio;
          return <line key={ratio} x1={PAD_X} x2={WIDTH - PAD_X} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="4 6" />;
        })}
        {areaPath && <path d={areaPath} fill="url(#client-acquisition-area)" />}
        {linePath && <path d={linePath} fill="none" stroke="#0284c7" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {points.map((point, index) => (
          <g key={point.key}>
            <circle cx={point.x} cy={point.y} r="10" fill="transparent" stroke="none">
              <title>{`${formatDate(point.key, groups.length)}: ${point.value.toLocaleString('ar')}`}</title>
            </circle>
            {labelIndexes.has(index) && (
              <text x={point.x} y={HEIGHT - 14} textAnchor="middle" fontSize="11" fill="#64748b">
                {formatDate(point.key, groups.length)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
