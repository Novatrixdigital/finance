import { useState, useMemo } from 'react';
import { Download, FileText, ArrowDownLeft, ArrowUpRight, Scale, AlertTriangle, Printer } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardHeader, Button, Select, EmptyState, LoadingBlock, Badge } from '@/components/ui';
import { useCollection, useRpc } from '@/hooks/useCollection';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { formatMoney, formatDate, toISODate } from '@/lib/format';
import { cx, downloadCSV, sumBy, groupBy } from '@/lib/utils';

/** Period presets, resolved to a concrete from/to pair. */
function periodRange(id) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  const map = {
    this_month: [new Date(y, m, 1), now],
    last_month: [new Date(y, m - 1, 1), new Date(y, m, 0)],
    this_quarter: [new Date(y, Math.floor(m / 3) * 3, 1), now],
    this_year: [new Date(y, 0, 1), now],
    // Indian financial year runs April → March.
    fy: m >= 3 ? [new Date(y, 3, 1), now] : [new Date(y - 1, 3, 1), now],
  };

  const [from, to] = map[id] || map.this_month;
  return { from: toISODate(from), to: toISODate(to) };
}

const PERIODS = [
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'this_quarter', label: 'This Quarter' },
  { id: 'this_year', label: 'This Year' },
  { id: 'fy', label: 'Financial Year (Apr–Mar)' },
];

export default function Reports() {
  const { scope } = useWorkspace();
  const toast = useToast();
  const [period, setPeriod] = useState('this_month');

  const range = useMemo(() => periodRange(period), [period]);

  /* Both bounds are applied server-side. Bounding only the start and clipping
     the tail in the browser meant a long period fetched rows it then threw
     away — and, under a row cap, threw away the wrong ones. */
  const filters = useMemo(
    () => ({
      txn_date: [
        { op: 'gte', value: range.from },
        { op: 'lte', value: range.to },
      ],
      status: 'completed',
    }),
    [range.from, range.to],
  );

  /*
    `all` rather than a limit. A statement that silently omits the oldest rows
    of the period — which is what `limit: 1000` with a descending sort did —
    reports a total that is simply wrong, and says nothing about it.
  */
  const { rows: inRange, loading, truncated } = useCollection('transactions', {
    select: 'id, description, amount, type, txn_date, workspace_id, category:categories(name, color), account:accounts!transactions_account_id_fkey(name)',
    orderBy: { column: 'txn_date', ascending: false },
    filters,
    all: true,
    pageSize: 1000,
  });

  const breakdownParams = useMemo(
    () => ({ p_scope: scope, p_from: range.from, p_to: range.to }),
    [scope, range.from, range.to],
  );
  const breakdown = useRpc('expense_breakdown', breakdownParams);

  const totals = useMemo(() => {
    const income = sumBy(inRange.filter((t) => t.type === 'income'), (t) => t.amount);
    const expense = sumBy(inRange.filter((t) => t.type === 'expense'), (t) => t.amount);
    return {
      income,
      expense,
      net: income - expense,
      margin: income > 0 ? Math.round(((income - expense) / income) * 100) : 0,
      count: inRange.length,
    };
  }, [inRange]);

  const incomeByCategory = useMemo(() => {
    const grouped = groupBy(
      inRange.filter((t) => t.type === 'income'),
      (t) => t.category?.name || 'Uncategorised',
    );
    return Object.entries(grouped)
      .map(([name, items]) => ({
        name,
        amount: sumBy(items, (t) => t.amount),
        color: items[0]?.category?.color || '#C8FF00',
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [inRange]);

  const expenseRows = useMemo(
    () =>
      (breakdown.data || []).map((r) => ({
        name: r.name,
        amount: Number(r.amount) || 0,
        percentage: Number(r.percentage) || 0,
        color: r.color,
      })),
    [breakdown.data],
  );

  const exportStatement = () => {
    if (!inRange.length) return toast.info('No transactions in this period.');
    downloadCSV(
      `novatrix-statement-${period}-${toISODate()}`,
      inRange.map((t) => ({
        Date: t.txn_date,
        Description: t.description,
        Type: t.type,
        Category: t.category?.name || '',
        Account: t.account?.name || '',
        Amount: t.amount,
      })),
    );
    toast.success(`Exported ${inRange.length} rows.`);
  };

  const exportSummary = () => {
    const rowsOut = [
      { Section: 'Income', Line: 'Total income', Amount: totals.income },
      ...incomeByCategory.map((c) => ({ Section: 'Income', Line: c.name, Amount: c.amount })),
      { Section: 'Expenses', Line: 'Total expenses', Amount: totals.expense },
      ...expenseRows.map((c) => ({ Section: 'Expenses', Line: c.name, Amount: c.amount })),
      { Section: 'Result', Line: 'Net', Amount: totals.net },
    ];
    downloadCSV(`novatrix-summary-${period}`, rowsOut);
    toast.success('Summary exported.');
  };

  const SummaryLine = ({ label, value, color, meta, strong }) => (
    <div className="flex items-center justify-between gap-4 border-b border-hair-soft py-2.5 last:border-0">
      <span className="flex min-w-0 items-center gap-2.5">
        {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
        <span className={cx('truncate text-[13px]', strong ? 'font-semibold text-ink' : 'text-ink-dim')}>
          {label}
        </span>
        {meta && <span className="shrink-0 text-[11px] text-ink-muted">{meta}</span>}
      </span>
      <span className={cx('shrink-0 tnum', strong ? 'text-[14px] font-bold text-ink' : 'text-[13px] text-ink-dim')}>
        {formatMoney(value)}
      </span>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="The numbers,"
        accent="stated plainly."
        subtitle="A period statement you can hand to an accountant without editing."
        actions={
          <>
            <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="h-11 w-auto">
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
            <Button variant="secondary" size="md" icon={Printer} onClick={() => window.print()}>
              Print
            </Button>
            <Button variant="secondary" size="md" icon={Download} onClick={exportSummary}>
              Summary
            </Button>
            <Button size="md" icon={Download} onClick={exportStatement}>
              Statement
            </Button>
          </>
        }
      />

      {/* A statement that cannot show everything has to say so. */}
      {truncated && (
        <Card className="mb-6 border-warning/30 bg-warning/[0.06]">
          <div className="flex items-start gap-3">
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warning" />
            <p className="text-[13px] leading-relaxed text-ink-dim">
              This period holds more transactions than a single statement can load, so the figures
              below cover only part of it.{' '}
              <span className="text-ink">Narrow the period</span> for an accurate total.
            </p>
          </div>
        </Card>
      )}

      {/* Period banner */}
      <Card className="mb-6 border-accent/20 bg-lime/[0.03]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow mb-1.5">Reporting period</p>
            <p className="text-[15px] font-semibold text-ink">
              {formatDate(range.from)} — {formatDate(range.to)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="text-[11.5px] text-ink-muted">Transactions</p>
              <p className="text-[17px] font-bold tnum text-ink">{totals.count}</p>
            </div>
            <div>
              <p className="text-[11.5px] text-ink-muted">Net margin</p>
              <p className={cx('text-[17px] font-bold tnum', totals.margin >= 0 ? 'text-accent' : 'text-negative')}>
                {totals.margin}%
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Headline three */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total Income', value: totals.income, Icon: ArrowDownLeft, tone: 'lime' },
          { label: 'Total Expenses', value: totals.expense, Icon: ArrowUpRight, tone: 'negative' },
          {
            label: 'Net Result',
            value: totals.net,
            Icon: Scale,
            tone: totals.net >= 0 ? 'lime' : 'negative',
          },
        ].map(({ label, value, Icon, tone }) => (
          <Card key={label}>
            <div className="mb-4 flex items-start justify-between">
              <p className="text-[13px] text-ink-dim">{label}</p>
              <span
                className={cx(
                  'icon-tile h-9 w-9',
                  tone === 'lime' ? 'border-accent/25 bg-accent/10 text-accent' : 'border-negative/25 bg-negative/10 text-negative',
                )}
              >
                <Icon size={15} strokeWidth={2} />
              </span>
            </div>
            <p className={cx('truncate text-figure-md tnum', tone === 'lime' ? 'text-accent' : 'text-ink')}>
              {formatMoney(value)}
            </p>
          </Card>
        ))}
      </div>

      {loading ? (
        <Card>
          <LoadingBlock rows={8} />
        </Card>
      ) : !inRange.length ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="Nothing in this period"
            description="Pick a wider range, or record some transactions first."
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Income" subtitle="By category" />
            {incomeByCategory.length ? (
              <>
                {incomeByCategory.map((c) => (
                  <SummaryLine key={c.name} label={c.name} value={c.amount} color={c.color} />
                ))}
                <div className="mt-2 border-t border-hair pt-2">
                  <SummaryLine label="Total income" value={totals.income} strong />
                </div>
              </>
            ) : (
              <EmptyState compact title="No income recorded" />
            )}
          </Card>

          <Card>
            <CardHeader title="Expenses" subtitle="By category" />
            {expenseRows.length ? (
              <>
                {expenseRows.map((c) => (
                  <SummaryLine
                    key={c.name}
                    label={c.name}
                    value={c.amount}
                    color={c.color}
                    meta={`${c.percentage}%`}
                  />
                ))}
                <div className="mt-2 border-t border-hair pt-2">
                  <SummaryLine label="Total expenses" value={totals.expense} strong />
                </div>
              </>
            ) : (
              <EmptyState compact title="No expenses recorded" />
            )}
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              title="Result"
              action={
                <Badge tone={totals.net >= 0 ? 'lime' : 'negative'} dot>
                  {totals.net >= 0 ? 'Surplus' : 'Deficit'}
                </Badge>
              }
            />
            <SummaryLine label="Income" value={totals.income} />
            <SummaryLine label="Less: Expenses" value={-totals.expense} />
            <div className="mt-2 border-t border-hair pt-3">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold text-ink">Net {totals.net >= 0 ? 'surplus' : 'deficit'}</span>
                <span className={cx('text-figure-sm tnum', totals.net >= 0 ? 'text-accent' : 'text-negative')}>
                  {formatMoney(totals.net)}
                </span>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
