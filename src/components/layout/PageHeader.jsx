import { useWorkspace } from '@/context/WorkspaceContext';
import { SCOPE_LIST } from '@/lib/constants';
import { cx } from '@/lib/utils';

/**
 * The standard opening of every module page: oversized title, one line of
 * context, and the page's primary actions on the right.
 */
export function PageHeader({ title, accent, subtitle, actions, children }) {
  const { scope } = useWorkspace();
  const scopeLabel = SCOPE_LIST.find((s) => s.id === scope)?.label ?? '';

  return (
    <header className="mb-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow mb-3">{scopeLabel} Workspace</p>
          <h1 className="headline text-[clamp(2rem,4.5vw,3rem)] text-ink">
            {title}
            {accent && (
              <>
                {' '}
                <span className="text-accent">{accent}</span>
              </>
            )}
          </h1>
          {subtitle && (
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-dim">{subtitle}</p>
          )}
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>

      {children && <div className="mt-6">{children}</div>}
    </header>
  );
}

/**
 * A compact stat strip used at the top of several module pages.
 *
 * The column count follows the number of figures. It was pinned at four, so
 * the fifth stat on a page — Accounts gained one when cash became its own
 * figure — dropped onto a row of its own and sat there looking orphaned.
 */
/**
 * Five and six figures used to go wide at `lg`, where a column is about
 * 110px — narrower than "₹ 58,442.90" renders at 19px, so on a laptop the
 * figures were being clipped to "₹ 58,44…". They now wait for 2xl and sit
 * three-across in between, which is two tidy rows rather than one cut-off one.
 */
const STRIP_COLUMNS = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  5: 'sm:grid-cols-3 2xl:grid-cols-5',
  6: 'sm:grid-cols-3 2xl:grid-cols-6',
};

export function StatStrip({ items }) {
  const columns = STRIP_COLUMNS[items.length] || 'sm:grid-cols-4';

  return (
    <div className={cx('grid grid-cols-2 gap-3', columns)}>
      {items.map(({ label, value, tone, meta }) => (
        <div key={label} className="rounded-2xl border border-hair bg-card px-4 py-3.5">
          <p className="truncate text-[11.5px] text-ink-muted">{label}</p>
          {/* No truncate: a figure that does not fit should wrap onto a
              second line, never lose its last digits. */}
          <p
            className={cx(
              'mt-1.5 break-words text-[17px] font-bold leading-tight tracking-tight tnum sm:text-[19px]',
              tone === 'lime' && 'text-accent',
              tone === 'negative' && 'text-negative',
              tone === 'warning' && 'text-warning',
              !tone && 'text-ink',
            )}
          >
            {value}
          </p>
          {meta && <p className="mt-0.5 truncate text-[11px] text-ink-muted">{meta}</p>}
        </div>
      ))}
    </div>
  );
}

export default PageHeader;
