import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { Card, CardHeader, Select, EmptyState } from '@/components/ui';
import { useChartTheme } from '@/hooks/useChartTheme';
import { formatMoney, formatCompact } from '@/lib/format';

/** Tooltip on the raised surface, matching menus and popovers. */
function FlowTooltip({ active, payload, label, palette }) {
  if (!active || !payload?.length) return null;

  const income = payload.find((p) => p.dataKey === 'income')?.value ?? 0;
  const expense = payload.find((p) => p.dataKey === 'expense')?.value ?? 0;
  const net = income - expense;

  return (
    <div className="rounded-2xl border border-hair bg-raised/95 p-4 shadow-lift backdrop-blur-xl">
      <p className="mb-3 text-[12px] font-semibold text-ink">{label}</p>
      <div className="space-y-2">
        {[
          ['Income', income, palette.income],
          ['Expenses', expense, palette.expense],
        ].map(([name, value, color]) => (
          <div key={name} className="flex items-center gap-6">
            <span className="flex items-center gap-2 text-[11.5px] text-ink-muted">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
              {name}
            </span>
            <span className="ml-auto text-[12px] font-semibold tnum text-ink">{formatMoney(value)}</span>
          </div>
        ))}
        <div className="mt-1 border-t border-hair pt-2">
          <div className="flex items-center gap-6">
            <span className="text-[11.5px] text-ink-muted">Net</span>
            <span
              className="ml-auto text-[12px] font-semibold tnum"
              style={{ color: net >= 0 ? palette.net : palette.negative }}
            >
              {net >= 0 ? '+' : '−'}
              {formatMoney(Math.abs(net))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const RANGES = [
  { id: 6, label: 'Last 6 Months' },
  { id: 12, label: 'Last 12 Months' },
];

/**
 * Income versus expenses, month by month.
 *
 * Grouped bars rather than stacked: the comparison the user actually makes is
 * "did I earn more than I spent", and stacking hides exactly that.
 */
export function CashFlowChart({ data = [], loading, onRangeChange }) {
  const [range, setRange] = useState(6);
  const [hovered, setHovered] = useState(null);
  const palette = useChartTheme();

  const changeRange = (next) => {
    const value = Number(next);
    setRange(value);
    onRangeChange?.(value);
  };

  const hasData = data.some((d) => d.income > 0 || d.expense > 0);

  return (
    <Card className="h-full">
      <CardHeader
        title="Cash Flow Overview"
        subtitle="Income vs Expenses"
        action={
          <Select
            value={range}
            onChange={(e) => changeRange(e.target.value)}
            className="h-9 w-auto py-0 pl-3 pr-9 text-[12px]"
            aria-label="Time range"
          >
            {RANGES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        }
      />

      {/* Legend sits under the header rather than inside it — three controls in
          one row was wrapping the title at this column width. */}
      <div className="-mt-2 mb-4 flex items-center gap-4">
        {[
          ['Income', palette.income],
          ['Expenses', palette.expense],
        ].map(([name, color]) => (
          <span key={name} className="flex items-center gap-2 text-[11.5px] text-ink-muted">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            {name}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="h-[280px] animate-pulse rounded-2xl bg-elevated/60" />
      ) : !hasData ? (
        <EmptyState
          icon={BarChart3}
          compact
          title="No cash flow yet"
          description="Record a few transactions and this chart fills in automatically."
        />
      ) : (
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 4, left: -12, bottom: 0 }}
              barGap={6}
              onMouseMove={(state) => setHovered(state?.activeTooltipIndex ?? null)}
              onMouseLeave={() => setHovered(null)}
            >
              <CartesianGrid stroke={palette.grid} vertical={false} />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: palette.axis, fontSize: 11 }}
                dy={8}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: palette.axis, fontSize: 11 }}
                tickFormatter={(v) => formatCompact(v, { withSymbol: false })}
                width={48}
              />
              <Tooltip
                content={<FlowTooltip palette={palette} />}
                cursor={{ fill: palette.cursor }}
              />

              <Bar dataKey="income" radius={[5, 5, 0, 0]} maxBarSize={22}>
                {data.map((entry, index) => (
                  <Cell
                    key={`inc-${entry.month}-${index}`}
                    fill={palette.income}
                    fillOpacity={hovered === null || hovered === index ? 1 : 0.32}
                  />
                ))}
              </Bar>
              <Bar dataKey="expense" radius={[5, 5, 0, 0]} maxBarSize={22}>
                {data.map((entry, index) => (
                  <Cell
                    key={`exp-${entry.month}-${index}`}
                    fill={palette.expense}
                    fillOpacity={hovered === null || hovered === index ? 1 : 0.32}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

export default CashFlowChart;
