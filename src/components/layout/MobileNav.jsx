import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { MOBILE_NAV, NAV_ITEMS, SCOPE_LIST } from '@/lib/constants';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useModals } from '@/context/ModalContext';
import { useTheme } from '@/context/ThemeContext';
import { cx, icon as resolveIcon } from '@/lib/utils';

/**
 * Mobile bottom bar. Five slots with the primary add action raised into a
 * lime disc at the centre — the same visual weight the desktop hero gives it.
 */
export function MobileNav() {
  const [sheet, setSheet] = useState(false);
  const { open } = useModals();
  const { isPersonal, scope, setScope } = useWorkspace();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <>
      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-hair bg-base/92 px-2 pt-2 backdrop-blur-xl lg:hidden"
        aria-label="Primary"
      >
        <ul className="mx-auto flex max-w-md items-end justify-between">
          {MOBILE_NAV.map((item) => {
            const Icon = resolveIcon(item.icon);

            if (item.action === 'add') {
              return (
                <li key="add" className="flex-1">
                  <button
                    type="button"
                    onClick={() => open('transaction')}
                    aria-label="Add transaction"
                    className="mx-auto -mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-lime text-black shadow-[0_12px_32px_-10px_rgba(200,255,0,0.75)] transition-transform duration-300 active:scale-95"
                  >
                    <Plus size={24} strokeWidth={2.6} />
                  </button>
                </li>
              );
            }

            if (item.action === 'more') {
              return (
                <li key="more" className="flex-1">
                  <button
                    type="button"
                    onClick={() => setSheet(true)}
                    className="flex w-full flex-col items-center gap-1 py-2 text-ink-muted"
                  >
                    <Icon size={19} strokeWidth={1.9} />
                    <span className="text-[10px] font-medium">{item.label}</span>
                  </button>
                </li>
              );
            }

            return (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cx(
                      'flex w-full flex-col items-center gap-1 py-2 transition-colors duration-300',
                      isActive ? 'text-accent' : 'text-ink-muted',
                    )
                  }
                >
                  <Icon size={19} strokeWidth={1.9} />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* "More" sheet — the rest of the nav plus workspace and theme */}
      {sheet && (
        <div className="fixed inset-0 z-[85] lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSheet(false)}
            className="absolute inset-0 animate-fade-in bg-[var(--c-scrim)] backdrop-blur-sm"
          />
          <div className="safe-bottom absolute inset-x-0 bottom-0 max-h-[82vh] animate-fade-up overflow-y-auto rounded-t-3xl border-t border-hair bg-card p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-ink">More</h2>
              <button
                type="button"
                onClick={() => setSheet(false)}
                aria-label="Close"
                className="rounded-xl border border-hair p-2 text-ink-dim"
              >
                <X size={16} />
              </button>
            </div>

            <p className="eyebrow mb-2.5">Workspace</p>
            <div className="mb-6 grid grid-cols-3 gap-2">
              {SCOPE_LIST.map(({ id, label, icon: iconName }) => {
                const Icon = resolveIcon(iconName);
                const active = scope === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setScope(id)}
                    className={cx(
                      'flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 transition-colors',
                      active
                        ? 'border-accent/40 bg-accent/10 text-accent'
                        : 'border-hair bg-surface text-ink-muted',
                    )}
                  >
                    <Icon size={16} />
                    <span className="text-[11px] font-semibold">{label}</span>
                  </button>
                );
              })}
            </div>

            <p className="eyebrow mb-2.5">Go to</p>
            <div className="grid grid-cols-2 gap-2">
              {NAV_ITEMS.filter((n) => !(n.businessOnly && isPersonal)).map((item) => {
                const Icon = resolveIcon(item.icon);
                return (
                  <button
                    key={item.to}
                    type="button"
                    onClick={() => {
                      setSheet(false);
                      navigate(item.to);
                    }}
                    className="flex items-center gap-3 rounded-2xl border border-hair bg-surface px-4 py-3 text-left text-[13px] text-ink-dim transition-colors active:bg-elevated"
                  >
                    <Icon size={16} className="shrink-0 text-ink-muted" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="btn-secondary btn-md mt-5 w-full"
            >
              Switch to {theme === 'dark' ? 'light' : 'dark'} theme
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default MobileNav;
