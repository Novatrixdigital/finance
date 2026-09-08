import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { NAV_ITEMS } from '@/lib/constants';
import { formatMoney, formatDateShort } from '@/lib/format';
import { cx, icon as resolveIcon, debounce } from '@/lib/utils';

/**
 * Ctrl/⌘ + K search across transactions, invoices, contacts and accounts,
 * plus direct navigation. Results are scoped to the active workspace, so a
 * Personal search never surfaces a business invoice.
 */
export function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { scopeQuery, isPersonal } = useWorkspace();
  const inputRef = useRef(null);
  const listRef = useRef(null);

  /* Navigation entries always match on name. */
  const pages = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NAV_ITEMS.filter(({ label, businessOnly }) => {
      if (businessOnly && isPersonal) return false;
      return !q || label.toLowerCase().includes(q);
    })
      .slice(0, q ? 4 : 6)
      .map((item) => ({
        id: `page-${item.to}`,
        group: 'Navigate',
        title: item.label,
        icon: item.icon,
        to: item.to,
      }));
  }, [query, isPersonal]);

  const runSearch = useMemo(
    () =>
      debounce(async (term) => {
        if (!user || term.trim().length < 2) {
          setResults([]);
          setBusy(false);
          return;
        }
        const like = `%${term.trim()}%`;

        try {
          const [txns, invoices, contacts, accounts, subs] = await Promise.all([
            scopeQuery(
              supabase
                .from('transactions')
                .select('id, description, amount, type, txn_date')
                .ilike('description', like)
                .order('txn_date', { ascending: false })
                .limit(5),
            ),
            scopeQuery(
              supabase
                .from('invoices')
                .select('id, invoice_number, total, status')
                .ilike('invoice_number', like)
                .limit(4),
            ),
            scopeQuery(
              supabase.from('contacts').select('id, name, company, type').ilike('name', like).limit(4),
            ),
            scopeQuery(
              supabase
                .from('accounts')
                .select('id, name, current_balance, type')
                .ilike('name', like)
                .limit(4),
            ),
            scopeQuery(
              supabase
                .from('subscriptions')
                .select('id, name, amount, billing_cycle, next_renewal_date')
                .ilike('name', like)
                .limit(4),
            ),
          ]);

          const merged = [
            ...(txns.data || []).map((t) => ({
              id: `txn-${t.id}`,
              group: 'Transactions',
              title: t.description || 'Transaction',
              meta: `${formatDateShort(t.txn_date)} · ${formatMoney(t.amount)}`,
              icon: t.type === 'income' ? 'ArrowDownLeft' : 'ArrowUpRight',
              to: '/transactions',
            })),
            ...(invoices.data || []).map((i) => ({
              id: `inv-${i.id}`,
              group: 'Invoices',
              title: i.invoice_number,
              meta: `${i.status} · ${formatMoney(i.total)}`,
              icon: 'FileText',
              to: '/invoices',
            })),
            ...(contacts.data || []).map((c) => ({
              id: `con-${c.id}`,
              group: 'Contacts',
              title: c.name,
              meta: c.company || c.type,
              icon: 'Users',
              to: '/contacts',
            })),
            ...(accounts.data || []).map((a) => ({
              id: `acc-${a.id}`,
              group: 'Accounts',
              title: a.name,
              meta: formatMoney(a.current_balance),
              icon: 'Landmark',
              to: '/accounts',
            })),
            ...(subs.data || []).map((s) => ({
              id: `sub-${s.id}`,
              group: 'Subscriptions',
              title: s.name,
              meta: `${formatMoney(s.amount)} · renews ${formatDateShort(s.next_renewal_date)}`,
              icon: 'RefreshCw',
              to: '/subscriptions',
            })),
          ];

          setResults(merged);
        } catch {
          setResults([]);
        } finally {
          setBusy(false);
        }
      }, 220),
    [user, scopeQuery],
  );

  useEffect(() => {
    if (query.trim().length >= 2) setBusy(true);
    runSearch(query);
    return () => runSearch.cancel();
  }, [query, runSearch]);

  const items = useMemo(() => [...pages, ...results], [pages, results]);

  useEffect(() => setCursor(0), [items.length]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const choose = useCallback(
    (item) => {
      if (!item) return;
      onClose();
      navigate(item.to);
    },
    [navigate, onClose],
  );

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[cursor]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  let lastGroup = null;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-[var(--c-scrim)] backdrop-blur-md"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative z-10 w-full max-w-2xl animate-scale-in overflow-hidden rounded-3xl border border-hair bg-card shadow-lift"
      >
        <div className="flex items-center gap-3 border-b border-hair px-5">
          <Search size={18} className="shrink-0 text-ink-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search transactions, invoices, accounts…"
            className="w-full bg-transparent py-5 text-[15px] text-ink outline-none placeholder:text-ink-muted"
          />
          {busy && <Loader2 size={16} className="animate-spin text-accent" />}
          <kbd className="hidden shrink-0 rounded-md border border-hair bg-surface px-2 py-1 text-[10px] font-medium text-ink-muted sm:block">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-ink-muted">
              {query.trim().length >= 2 ? 'Nothing matched that search.' : 'Type at least two characters.'}
            </p>
          ) : (
            items.map((item, index) => {
              const Icon = resolveIcon(item.icon);
              const showGroup = item.group !== lastGroup;
              lastGroup = item.group;
              const active = index === cursor;

              return (
                <div key={item.id}>
                  {showGroup && <p className="eyebrow px-3 pb-1.5 pt-3">{item.group}</p>}
                  <button
                    type="button"
                    data-active={active}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => choose(item)}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors duration-200',
                      active ? 'bg-elevated' : 'hover:bg-elevated/60',
                    )}
                  >
                    <span
                      className={cx(
                        'icon-tile h-9 w-9',
                        active ? 'border-accent/30 bg-accent/10 text-accent' : 'text-ink-dim',
                      )}
                    >
                      <Icon size={15} strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{item.title}</span>
                      {item.meta && (
                        <span className="block truncate text-[11.5px] text-ink-muted">{item.meta}</span>
                      )}
                    </span>
                    {active && <CornerDownLeft size={14} className="shrink-0 text-ink-muted" />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-hair bg-surface/50 px-5 py-3 text-[11px] text-ink-muted">
          <span className="flex items-center gap-1.5">
            <ArrowUp size={11} />
            <ArrowDown size={11} /> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <CornerDownLeft size={11} /> open
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default CommandPalette;
