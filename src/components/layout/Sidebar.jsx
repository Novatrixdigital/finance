import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { MoreVertical, LogOut, User, Settings as SettingsIcon, X, Sparkles } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { WaveViz } from '@/components/brand/WaveViz';
import { Avatar } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { NAV_ITEMS, SCOPE_LIST } from '@/lib/constants';
import { cx, icon as resolveIcon } from '@/lib/utils';

/* ══════════════════════════════════════════════════════════════════════════
   WORKSPACE SWITCHER — Personal · Business · Combined
   ══════════════════════════════════════════════════════════════════════════ */
function WorkspaceSwitcher() {
  const { scope, setScope } = useWorkspace();

  return (
    <div className="px-4 pb-4">
      <p className="eyebrow mb-2.5 px-1">Switch Workspace</p>
      <div className="grid grid-cols-3 gap-1.5">
        {SCOPE_LIST.map(({ id, label, icon: iconName, hint }) => {
          const Icon = resolveIcon(iconName);
          const active = scope === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setScope(id)}
              title={hint}
              aria-pressed={active}
              className={cx(
                'group flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 transition-all duration-400 ease-premium',
                active
                  ? 'border-accent/40 bg-accent/10 text-accent shadow-[0_0_0_1px_rgba(200,255,0,0.15)]'
                  : 'border-hair bg-surface text-ink-muted hover:border-hair-strong hover:text-ink-dim',
              )}
            >
              <Icon size={15} strokeWidth={2} />
              <span className="text-[10px] font-semibold tracking-[0.02em]">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PROMO PANEL
   ══════════════════════════════════════════════════════════════════════════ */
function PromoPanel() {
  return (
    <div className="mx-4 mb-4 overflow-hidden rounded-3xl border border-hair bg-surface">
      <div className="relative px-5 pt-5">
        <p className="text-[17px] font-extrabold leading-[1.12] tracking-[-0.03em] text-ink">
          Better
          <br />
          Money Habits
          <br />
          <span className="text-accent">Brighter Tomorrows</span>
        </p>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-muted">
          Personal. Business.
          <br />
          All in One Place.
        </p>
      </div>

      <div className="relative mt-3 h-20 w-full overflow-hidden">
        <div className="absolute inset-x-0 bottom-0 h-full">
          <WaveViz seed={1.2} lines={8} opacity={0.7} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent" />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   USER CARD
   ══════════════════════════════════════════════════════════════════════════ */
function UserCard() {
  const { profile, user, signOut, displayName } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (path) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div ref={ref} className="relative border-t border-hair px-4 py-4">
      <div className="flex items-center gap-3">
        <Avatar name={displayName} src={profile?.avatar_url} size={38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-ink">{displayName}</p>
          <p className="truncate text-[11px] text-ink-muted">{profile?.email || user?.email}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Account menu"
          aria-expanded={open}
          className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
        >
          <MoreVertical size={16} />
        </button>
      </div>

      {open && (
        <div className="absolute bottom-[calc(100%-0.5rem)] left-4 right-4 z-50 animate-scale-in overflow-hidden rounded-2xl border border-hair bg-raised shadow-lift">
          <button
            type="button"
            onClick={() => go('/settings')}
            className="flex w-full items-center gap-3 px-4 py-3 text-[13px] text-ink-dim transition-colors hover:bg-elevated hover:text-ink"
          >
            <User size={15} /> Profile
          </button>
          <button
            type="button"
            onClick={() => go('/settings')}
            className="flex w-full items-center gap-3 px-4 py-3 text-[13px] text-ink-dim transition-colors hover:bg-elevated hover:text-ink"
          >
            <SettingsIcon size={15} /> Settings
          </button>
          <div className="hair-x" />
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-3 px-4 py-3 text-[13px] text-negative transition-colors hover:bg-negative/10"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SIDEBAR
   ══════════════════════════════════════════════════════════════════════════ */
export function Sidebar({ mobileOpen, onCloseMobile }) {
  const { isPersonal } = useWorkspace();

  const content = (
    <>
      {/* Brand */}
      <div className="flex items-center justify-between px-5 py-5">
        <Logo size={38} />
        <button
          type="button"
          onClick={onCloseMobile}
          className="rounded-xl border border-hair p-2 text-ink-dim lg:hidden"
          aria-label="Close navigation"
        >
          <X size={16} />
        </button>
      </div>

      {/*
        Scroll region: navigation + promo.
        `min-h-0` is what actually lets a flex child shrink below its content
        height — without it the list silently overflows and the last items
        (Settings, Recurring) become unreachable. The scrollbar is left visible
        rather than hidden, so when it does overflow there is an affordance.
      */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <nav className="px-3 pb-2" aria-label="Main">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map(({ to, label, icon: iconName, businessOnly }) => {
              // Invoices and Contacts are business concepts; hide them in
              // Personal mode rather than showing an empty screen.
              if (businessOnly && isPersonal) return null;
              const Icon = resolveIcon(iconName);

              return (
                <li key={to}>
                  <NavLink
                    to={to}
                    onClick={onCloseMobile}
                    className={({ isActive }) =>
                      cx(
                        'group relative flex items-center gap-3 rounded-2xl px-3.5 py-2 text-[13.5px] font-medium transition-all duration-300 ease-premium',
                        isActive
                          ? 'bg-elevated text-ink'
                          : 'text-ink-muted hover:bg-hair hover:text-ink-dim',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-lime" />
                        )}
                        <Icon
                          size={17}
                          strokeWidth={1.9}
                          className={cx(
                            'shrink-0 transition-colors duration-300',
                            isActive ? 'text-accent' : 'text-current',
                          )}
                        />
                        <span className="truncate">{label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Decorative, so it yields first: only shown when the viewport is
            tall enough to fit it without squeezing the navigation. */}
        <div className="mt-auto hidden [@media(min-height:900px)]:block">
          <PromoPanel />
        </div>
      </div>

      {/* Pinned: identity and workspace are always reachable. */}
      <UserCard />
      <WorkspaceSwitcher />
    </>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-sidebar flex-col border-r border-hair bg-base lg:flex">
        {content}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onCloseMobile}
            className="absolute inset-0 animate-fade-in bg-[var(--c-scrim)] backdrop-blur-sm"
          />
          <aside className="relative z-10 flex h-full w-[17rem] max-w-[85vw] animate-slide-right flex-col border-r border-hair bg-base">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

/** Small lime hint used when a scope hides part of the nav. */
export function ScopeHint() {
  return (
    <div className="mx-4 mb-3 flex items-center gap-2 rounded-xl border border-accent/20 bg-lime/[0.06] px-3 py-2">
      <Sparkles size={13} className="shrink-0 text-accent" />
      <p className="text-[11px] leading-snug text-ink-dim">
        Invoices and Contacts appear in Business and Combined.
      </p>
    </div>
  );
}

export default Sidebar;
