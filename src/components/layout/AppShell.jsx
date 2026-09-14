import { useState, useEffect, useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopHeader } from '@/components/layout/TopHeader';
import { MobileNav } from '@/components/layout/MobileNav';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { ModalHost } from '@/components/forms/ModalHost';

/**
 * The persistent application frame: fixed sidebar, sticky header, scrolling
 * content, and the mobile bottom bar. Route content renders into <Outlet />.
 */
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { pathname } = useLocation();

  /* Ctrl/⌘ + K anywhere opens search; the browser default is suppressed. */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* Close the drawer and scroll to top on navigation. */
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }, [pathname]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div className="min-h-screen bg-base">
      {/* First stop for a keyboard user: otherwise every page begins with a
          sixteen-item tab crawl through the navigation. */}
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <Sidebar mobileOpen={menuOpen} onCloseMobile={closeMenu} />

      {/* Clears the icon rail from `md`, the full sidebar from `lg`. */}
      <div className="md:pl-railicon lg:pl-sidebar">
        <TopHeader onOpenMenu={() => setMenuOpen(true)} onOpenSearch={() => setSearchOpen(true)} />

        {/* The tall bottom padding only clears the phone bar, which is gone
            from `md` up — a tablet was reserving 7rem for nothing. */}
        <main id="main" className="px-4 pb-28 pt-6 sm:px-6 md:pb-12 lg:px-8">
          <Outlet />
        </main>
      </div>

      <MobileNav />
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ModalHost />
    </div>
  );
}

export default AppShell;
