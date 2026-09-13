import { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { PieChart as PieIcon } from 'lucide-react';
import { Card, CardHeader, EmptyState, Select } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { CHART_COLORS } from '@/lib/constants';
import { cx } from '@/lib/utils';

function DonutTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-2xl border border-hair bg-raised/95 px-4 py-3 shadow-lift backdrop-blur-xl">
      <p className="flex items-center gap-2 text-[12px] font-semibold text-ink">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
        {item.name}
      </p>
      <p className="mt-1.5 text-[13px] font-bold tnum text-ink">{formatMoney(item.value)}</p>
      <p className="text-[11px] text-ink-muted">{item.percentage}% of spending</p>
    </div>
  );
}

const PERIODS = [
  { id: 'month', label: 'This Month' },
  { id: 'quarter', label: 'This Quarter' },
  { id: 'year', label: 'This Year' },
];

/**
 * Expense split. The lime ramp carries the largest slices so the eye lands on
 * what actually costs money; smaller tail categories pick up muted accents.
 */
export function ExpenseDonut({ data = [], loading, period = 'month', onPeriodChange }) {
  const [activeIndex, setActiveIndex] = useState(null);

  const slices = useMemo(
    () =>
      data.map((d, i) => ({
        ...d,
        // Fall back to the shared ramp when a category has no colour set.
        color: d.color || CHART_COLORS[i % CHART_COLORS.length],
      })),
    [data],
  );

  const total = useMemo(() => slices.reduce((sum, s) => sum + s.value, 0), [slices]);

  return (
    <Card className="h-full">
      <CardHeader
        title="Expense Breakdown"
        action={
          <Select
            value={period}
            onChange={(e) => onPeriodChange?.(e.target.value)}
            className="h-9 w-auto py-0 pl-3 pr-9 text-[12px]"
          >
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        }
      />

      {loading ? (
        <div className="h-[260px] animate-pulse rounded-2xl bg-elevated/40" />
      ) : !slices.length ? (
        <EmptyState
          icon={PieIcon}
          compact
          title="Nothing spent yet"
          description="Categorised expenses appear here as a split."
        />
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          {/* Donut */}
          <div className="relative h-[190px] w-[190px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  stroke="none"
                  startAngle={90}
                  endAngle={-270}
                  onMouseEnter={(_, index) => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                >
                  {slices.map((entry, index) => (
                    <Cell
                      key={entry.id ?? index}
                      fill={entry.color}
                      fillOpacity={activeIndex === null || activeIndex === index ? 1 : 0.28}
                      style={{ transition: 'fill-opacity 250ms ease', cursor: 'pointer' }}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            {/* Centre readout */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4">
              <p className="text-[17px] font-bold tracking-tight tnum text-ink">
                {formatMoney(activeIndex !== null ? slices[activeIndex].value : total)}
              </p>
              <p className="mt-0.5 max-w-[7.5rem] truncate text-center text-[10.5px] font-medium text-ink-muted">
                {activeIndex !== null ? slices[activeIndex].name : 'Total Expenses'}
              </p>
            </div>
          </div>

          {/* Legend */}
          <ul className="w-full flex-1 space-y-1 min-w-0">
            {slices.slice(0, 7).map((slice, index) => (
              <li key={slice.id ?? index}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors duration-200',
                    activeIndex === index ? 'bg-elevated' : 'hover:bg-elevated/60',
                  )}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-dim">{slice.name}</span>
                  <span className="shrink-0 text-[11.5px] font-semibold tnum text-ink whitespace-nowrap">{slice.percentage}%</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

export default ExpenseDonut;
