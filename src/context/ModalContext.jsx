import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const ModalContext = createContext(null);

/**
 * A single place to open the app's shared record forms.
 *
 * Quick Actions, the mobile "+ Add" button, empty states and page headers all
 * open the same forms, so the state lives once at the shell level instead of
 * being re-declared on every page.
 *
 *   const { open } = useModals();
 *   open('transaction', { type: 'expense' });
 */
export function ModalProvider({ children }) {
  const [modal, setModal] = useState(null); // { type, props }
  const [dirtyToken, setDirtyToken] = useState(0);

  const open = useCallback((type, props = {}) => setModal({ type, props }), []);
  const close = useCallback(() => setModal(null), []);

  /** Forms call this after a successful write so open pages can refetch. */
  const notifySaved = useCallback(() => setDirtyToken((n) => n + 1), []);

  const value = useMemo(
    () => ({ modal, open, close, notifySaved, dirtyToken }),
    [modal, open, close, notifySaved, dirtyToken],
  );

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

export function useModals() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModals must be used inside <ModalProvider>');
  return ctx;
}
