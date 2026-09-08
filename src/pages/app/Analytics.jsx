import { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { TrendingUp, TrendingDown, Percent, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, Segmented, EmptyState, LoadingBlock } from '@/components/ui';
import { ExpenseDonut } from '@/components/charts/ExpenseDonut';
import { useRpc } from '@/hooks/useCollection';
import { useWorkspace } from '@/context/WorkspaceContext';
import { formatMoney, formatCompact, startOfMonthISO, toISODate } from '@/lib/format';
import { CHART_COLORS } from '@/lib/constants';
import { useChartTheme } from '@/hooks/useChartTheme';
import { cx } from '@/lib/utils';

/* ── Shared dark tooltip ─────────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-hair bg-raised/95 p-3.5 shadow-lift backdrop-blur-xl">
      <p className="mb-2 text-[12px] font-semibold text-ink">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-5 py-0.5">
          <span className="flex items-center gap-2 text-[11.5px] text-ink-muted">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: entry.color }} />
            {entry.name}
          </span>
          <span className="ml-auto text-[12px] font-semibold tnum text-ink">
            {formatter ? formatter(entry.value) : formatMoney(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Small KPI tile ──────────────────────────────────────────────────────── */
function Kpi({ label, value, delta, Icon, tone }) {
  const positive = delta >= 0;
  const good = tone === 'inverse' ? !positive : positive;

  return (
    <Card>
      <div className="mb-4 flex items-start justify-between">
        <p className="text-[13px] text-ink-dim">{label}</p>
        <span className="icon-tile h-9 w-9 text-ink-dim">
          <Icon size={15} strokeWidth={2} />
        </span>
      </div>
      <p className="truncate text-figure-md tnum text-ink">{value}</p>
      {delta !== undefined && delta !== null && (
        <p className={cx('mt-2 flex items-center gap-1.5 text-[12px] font-medium', good ? 'text-accent' : 'text-negative')}>
          {positive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          {positive ? '+' : ''}
          {delta}%
          <span className="font-normal text-ink-muted">vs last month</span>
        </p>
      )}
    </Card>
  );
}

const RANGES = [
  { id: 6, label: '6 Months' },
  { id: 12, label: '12 Months' },
  { id: 24, label: '24 Months' },
];

export default function Analytics() {
  const { scope } = useWorkspace();
  const [months, setMonths] = useState(12);
  const [period, setPeriod] = useState('month');
  const palette = useChartTheme();

  const scopeParam = useMemo(() => ({ p_scope: scope }), [scope]);
  const flowParams = useMemo(() => ({ p_scope: scope, p_months: months }), [scope, months]);

  const breakdownParams = useMemo(() => {
    const now = new Date();
    const from =
      period === 'year'
        ? toISODate(new Date(now.getFullYear(), 0, 1))
        : period === 'quarter'
          ? toISODate(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1))
          : startOfMonthISO();
    return { p_scope: scope, p_from: from, p_to: toISODate() };
  }, [scope, period]);

  const summary = useRpc('dashboard_summary', scopeParam);
  const flow = useRpc('cash_flow_series', flowParams);
  const breakdown = useRpc('expense_breakdown', breakdownParams);

  const stats = summary.data || {};

  const series = useMemo(
    () =>
      (flow.data || []).map((row) => ({
        month: row.label,
        income: Number(row.income) || 0,
        expense: Number(row.expense) || 0,
        net: Number(row.net) || 0,
        savingsRate:
          Number(row.income) > 0
            ? Math.round(((Number(row.income) - Number(row.expense)) / Number(row.income)) * 100)
            : 0,
      })),
    [flow.data],
  );

  const donut = useMemo(
    () =>
      (breakdown.data || []).map((row) => ({
        id: row.category_id || row.name,
        name: row.name,
        value: Number(row.amount) || 0,
        percentage: Number(row.percentage) || 0,
        color: row.color,
      })),
    [breakdown.data],
  );

  const topCategories = useMemo(() => donut.slice(0, 8), [donut]);
  const hasFlow = series.some((s) => s.income > 0 || s.expense > 0);

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="The pattern"
        accent="behind the money."
        subtitle="Trends, ratios and concentrations across your whole book."
        actions={<Segmented options={RANGES} value={months} onChange={setMonths} />}
      />

      {/* KPI row */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Net worth" value={formatMoney(stats.net_worth)} delta={Number(stats.net_worth_growth)} Icon={Wallet} />
        <Kpi label="Income this month" value={formatMoney(stats.income_month)} delta={Number(stats.income_growth)} Icon={TrendingUp} />
        <Kpi label="Expenses this month" value={formatMoney(stats.expense_month)} delta={Number(stats.expense_growth)} Icon={TrendingDown} tone="inverse" />
        <Kpi label="Savings rate" value={`${Number(stats.savings_rate) || 0}%`} Icon={Percent} />
      </div>

      {/* Net trend */}
      <Card className="mb-6">
        <CardHeader title="Net Position Over Time" subtitle="Income minus expenses, month by month" />
        {flow.loading ? (
          <div className="h-[300px] animate-pulse rounded-2xl bg-elevated/40" />
        ) : !hasFlow ? (
          <EmptyState compact title="Not enough history yet" description="Record transactions across a few months to see the trend." />
        ) : (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="net-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={palette.netStop} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={palette.netStop} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={palette.grid} vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: palette.axis, fontSize: 11 }} dy={8} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: palette.axis, fontSize: 11 }}
                  tickFormatter={(v) => formatCompact(v, { withSymbol: false })}
                  width={48}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: palette.grid }} />
                <Area
                  type="monotone"
                  dataKey="net"
                  name="Net"
                  stroke={palette.net}
                  strokeWidth={2}
                  fill="url(#net-fill)"
                  dot={false}
                  activeDot={{ r: 4, fill: palette.net, stroke: palette.dotStroke, strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        {/* Income vs expense lines */}
        <Card>
          <CardHeader
            title="Income vs Expenses"
            subtitle="Two lines, one question: is the gap widening?"
            action={
              <div className="hidden items-center gap-4 sm:flex">
                {[
                  ['Income', palette.income],
                  ['Expenses', palette.negative],
                ].map(([name, color]) => (
                  <span key={name} className="flex items-center gap-2 text-[11.5px] text-ink-muted">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                    {name}
                  </span>
                ))}
              </div>
            }
          />
          {flow.loading ? (
            <div className="h-[260px] animate-pulse rounded-2xl bg-elevated/40" />
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke={palette.grid} vertical={false} />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: palette.axis, fontSize: 11 }} dy={8} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: palette.axis, fontSize: 11 }}
                    tickFormatter={(v) => formatCompact(v, { withSymbol: false })}
                    width={48}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="income" name="Income" stroke={palette.income} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="expense" name="Expenses" stroke={palette.negative} strokeWidth={2} dot={false} strokeDasharray="4 4" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Savings rate */}
        <Card>
          <CardHeader title="Savings Rate" subtitle="Share of income you kept each month" />
          {flow.loading ? (
            <div className="h-[260px] animate-pulse rounded-2xl bg-elevated/40" />
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid stroke={palette.grid} vertical={false} />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: palette.axis, fontSize: 11 }} dy={8} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: palette.axis, fontSize: 11 }}
                    tickFormatter={(v) => `${v}%`}
                    width={44}
                  />
                  <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} />} cursor={{ fill: palette.cursor }} />
                  <Bar dataKey="savingsRate" name="Savings rate" radius={[5, 5, 0, 0]} maxBarSize={26}>
                    {series.map((entry, index) => (
                      <Cell
                        key={`${entry.month}-${index}`}
                        fill={entry.savingsRate < 0 ? palette.negative : entry.savingsRate < 20 ? palette.warning : palette.income}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ExpenseDonut data={donut} loading={breakdown.loading} period={period} onPeriodChange={setPeriod} />

        {/* Top categories */}
        <Card>
          <CardHeader title="Where It Goes" subtitle="Largest categories this period" />
          {breakdown.loading ? (
            <LoadingBlock rows={6} />
          ) : !topCategories.length ? (
            <EmptyState compact title="No expenses in this period" />
          ) : (
            <ul className="space-y-3">
              {topCategories.map((cat, index) => {
                const max = topCategories[0].value || 1;
                const width = (cat.value / max) * 100;

                return (
                  <li key={cat.id}>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: cat.color || CHART_COLORS[index % CHART_COLORS.length] }}
                        />
                        <span className="truncate text-[13px] text-ink-dim">{cat.name}</span>
                      </span>
                      <span className="shrink-0 text-[13px] font-semibold tnum text-ink">
                        {formatMoney(cat.value)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-hair">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-premium"
                        style={{
                          width: `${width}%`,
                          backgroundColor: cat.color || CHART_COLORS[index % CHART_COLORS.length],
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
