import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Bell, Sun, Moon, Menu, ChevronDown, LogOut, User, Settings as SettingsIcon, AlertTriangle, CalendarClock, FileWarning } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useNotifications } from '@/hooks/useNotifications';
import { formatMoney } from '@/lib/format';
import { cx } from '@/lib/utils';
import { SCOPE_LIST } from '@/lib/constants';

/* ── Theme toggle — a single pill holding both states ────────────────────── */
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-hair bg-surface p-1">
      {[
        { id: 'light', Icon: Sun },
        { id: 'dark', Icon: Moon },
      ].map(({ id, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setTheme(id)}
          aria-label={`${id} theme`}
          aria-pressed={theme === id}
          className={cx(
            'rounded-full p-2 transition-all duration-300 ease-premium',
            theme === id ? 'bg-elevated text-accent' : 'text-ink-muted hover:text-ink-dim',
          )}
        >
          <Icon size={15} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}

/* ── Notifications ───────────────────────────────────────────────────────── */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { items, count, loading } = useNotifications();

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const ICONS = { overdue: FileWarning, due: CalendarClock, budget: AlertTriangle };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${count ? `, ${count} unread` : ''}`}
        className="relative rounded-full border border-hair bg-surface p-2.5 text-ink-dim transition-all duration-300 hover:border-hair-strong hover:text-ink"
      >
        <Bell size={16} strokeWidth={2} />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D32F42] px-1 text-[9px] font-bold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-[min(22rem,calc(100vw-2rem))] animate-scale-in overflow-hidden rounded-2xl border border-hair bg-raised shadow-lift">
          <div className="flex items-center justify-between border-b border-hair px-4 py-3">
            <p className="text-[13px] font-semibold text-ink">Notifications</p>
            {count > 0 && (
              <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-semibold text-accent">
                {count} new
              </span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-8 text-center text-[12px] text-ink-muted">Checking…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-10 text-center text-[12px] text-ink-muted">
                Nothing needs your attention.
              </p>
            ) : (
              items.map((n) => {
                const Icon = ICONS[n.kind] || Bell;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      navigate(n.to);
                    }}
                    className="flex w-full items-start gap-3 border-b border-hair-soft px-4 py-3 text-left transition-colors last:border-0 hover:bg-elevated"
                  >
                    <span
                      className={cx(
                        'icon-tile mt-0.5 h-8 w-8',
                        n.tone === 'negative' ? 'border-negative/25 text-negative' : 'border-warning/25 text-warning',
                      )}
                    >
                      <Icon size={14} strokeWidth={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{n.title}</span>
                      <span className="block text-[11.5px] text-ink-muted">{n.detail}</span>
                    </span>
                    {n.amount != null && (
                      <span className="shrink-0 text-[12px] font-semibold tnum text-ink-dim">
                        {formatMoney(n.amount)}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Profile dropdown ────────────────────────────────────────────────────── */
function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { profile, displayName, signOut } = useAuth();
  const { scope } = useWorkspace();

  const scopeLabel = useMemo(
    () => SCOPE_LIST.find((s) => s.id === scope)?.label ?? 'Personal',
    [scope],
  );

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-3 rounded-full border border-hair bg-surface py-1.5 pl-1.5 pr-3 transition-all duration-300 hover:border-hair-strong"
      >
        <Avatar name={displayName} src={profile?.avatar_url} size={32} />
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-[12.5px] font-semibold text-ink">{displayName}</span>
          <span className="block text-[10.5px] text-ink-muted">{scopeLabel} Workspace</span>
        </span>
        <ChevronDown
          size={14}
          className={cx('text-ink-muted transition-transform duration-300', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-56 animate-scale-in overflow-hidden rounded-2xl border border-hair bg-raised shadow-lift">
          <div className="border-b border-hair px-4 py-3">
            <p className="truncate text-[13px] font-semibold text-ink">{displayName}</p>
            <p className="truncate text-[11px] text-ink-muted">{profile?.email}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/settings');
            }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-ink-dim transition-colors hover:bg-elevated hover:text-ink"
          >
            <User size={15} /> Profile
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/settings');
            }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-ink-dim transition-colors hover:bg-elevated hover:text-ink"
          >
            <SettingsIcon size={15} /> Settings
          </button>
          <div className="hair-x" />
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] text-negative transition-colors hover:bg-negative/10"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   HEADER
   ══════════════════════════════════════════════════════════════════════════ */
export function TopHeader({ onOpenMenu, onOpenSearch }) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

  return (
    <header className="sticky top-0 z-30 border-b border-hair bg-base/80 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open navigation"
          className="rounded-xl border border-hair p-2.5 text-ink-dim transition-colors hover:text-ink md:hidden"
        >
          <Menu size={17} />
        </button>

        {/* Search trigger — the palette does the actual work */}
        <button
          type="button"
          onClick={onOpenSearch}
          className="group flex h-11 flex-1 items-center gap-3 rounded-full border border-hair bg-surface px-4 text-left transition-all duration-300 ease-premium hover:border-hair-strong sm:max-w-md"
        >
          <Search size={16} className="shrink-0 text-ink-muted transition-colors group-hover:text-ink-dim" />
          <span className="flex-1 truncate text-[13px] text-ink-muted">
            <span className="hidden sm:inline">Search transactions, invoices, accounts…</span>
            <span className="sm:hidden">Search…</span>
          </span>
          <kbd className="hidden shrink-0 items-center gap-0.5 rounded-md border border-hair bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-ink-muted sm:flex">
            {isMac ? '⌘' : 'Ctrl'} K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <NotificationBell />
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}

export default TopHeader;
