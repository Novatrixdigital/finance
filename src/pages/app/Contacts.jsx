import { useState, useMemo, useEffect } from 'react';
import { Plus, Pencil, Trash2, Users, Mail, Phone, Building2, Briefcase } from 'lucide-react';
import { PageHeader, StatStrip } from '@/components/layout/PageHeader';
import {
  Card,
  Button,
  Badge,
  EmptyState,
  LoadingBlock,
  SearchInput,
  Segmented,
  ConfirmDialog,
  Avatar,
} from '@/components/ui';
import { useCollection } from '@/hooks/useCollection';
import { useModals } from '@/context/ModalContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useToast } from '@/context/ToastContext';
import { CONTACT_TYPES, SCOPES } from '@/lib/constants';

const TABS = [{ id: 'all', label: 'All' }, ...CONTACT_TYPES.slice(0, 3).map((t) => ({ id: t.id, label: `${t.label}s` }))];

export default function Contacts() {
  const { open, dirtyToken } = useModals();
  const { isPersonal, setScope, business } = useWorkspace();
  const toast = useToast();

  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const { rows, loading, remove, refresh } = useCollection('contacts', {
    select: '*',
    orderBy: { column: 'name', ascending: true },
    enabled: !isPersonal,
    includeShared: true,
  });

  useEffect(() => {
    if (dirtyToken > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyToken]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (tab !== 'all' && c.type !== tab) return false;
      if (!term) return true;
      return `${c.name} ${c.company || ''} ${c.email || ''} ${c.city || ''}`.toLowerCase().includes(term);
    });
  }, [rows, tab, search]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      customers: rows.filter((c) => c.type === 'customer').length,
      vendors: rows.filter((c) => c.type === 'vendor').length,
      employees: rows.filter((c) => c.type === 'employee').length,
    }),
    [rows],
  );

  if (isPersonal) {
    return (
      <div className="mx-auto max-w-[1560px]">
        <PageHeader title="Contacts live in" accent="your business books." />
        <Card>
          <EmptyState
            icon={Briefcase}
            title="Switch to your Business workspace"
            description="Customers, vendors and employees belong to the business side. Personal stays free of them by design."
            action={
              <Button size="sm" onClick={() => setScope(business ? SCOPES.BUSINESS : SCOPES.COMBINED)}>
                Switch to Business
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const confirmDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    const { error } = await remove(confirm.id);
    setDeleting(false);
    if (!error) toast.success(`${confirm.name} removed.`);
    setConfirm(null);
  };

  const TYPE_TONE = { customer: 'lime', vendor: 'warning', employee: 'info' };

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="The people"
        accent="behind the numbers."
        subtitle="Customers you bill, vendors you pay, and the team you run."
        actions={
          <Button size="md" icon={Plus} onClick={() => open('contact')}>
            Add Contact
          </Button>
        }
      >
        <StatStrip
          items={[
            { label: 'Contacts', value: counts.total },
            { label: 'Customers', value: counts.customers, tone: 'lime' },
            { label: 'Vendors', value: counts.vendors, tone: 'warning' },
            { label: 'Employees', value: counts.employees },
          ]}
        />
      </PageHeader>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented options={TABS} value={tab} onChange={setTab} />
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, company, email…" className="sm:w-80" />
      </div>

      {loading ? (
        <Card>
          <LoadingBlock rows={5} />
        </Card>
      ) : !filtered.length ? (
        <Card>
          <EmptyState
            icon={Users}
            title={rows.length ? 'No matches' : 'No contacts yet'}
            description={
              rows.length
                ? 'Try a different tab or clear the search.'
                : 'Add the customers and vendors you deal with — invoices and payments can then link straight to them.'
            }
            action={
              <Button size="sm" icon={Plus} onClick={() => open('contact')}>
                Add contact
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((contact) => (
            <Card key={contact.id} hover className="group">
              <div className="flex items-start gap-3.5">
                <Avatar name={contact.name} size={44} />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">{contact.name}</p>
                  {contact.company && (
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-ink-muted">
                      <Building2 size={11} className="shrink-0" />
                      {contact.company}
                    </p>
                  )}
                  <Badge tone={TYPE_TONE[contact.type] || 'neutral'} className="mt-2 capitalize">
                    {contact.type}
                  </Badge>
                </div>

                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => open('contact', { record: contact })}
                    aria-label="Edit contact"
                    className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirm(contact)}
                    aria-label="Delete contact"
                    className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {(contact.email || contact.phone) && (
                <div className="mt-4 space-y-2 border-t border-hair-soft pt-4">
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="flex items-center gap-2 truncate text-[12.5px] text-ink-dim transition-colors hover:text-accent"
                    >
                      <Mail size={13} className="shrink-0 text-ink-muted" />
                      <span className="truncate">{contact.email}</span>
                    </a>
                  )}
                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone}`}
                      className="flex items-center gap-2 truncate text-[12.5px] text-ink-dim transition-colors hover:text-accent"
                    >
                      <Phone size={13} className="shrink-0 text-ink-muted" />
                      <span className="truncate">{contact.phone}</span>
                    </a>
                  )}
                </div>
              )}

              {(contact.gstin || contact.city) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {contact.city && <Badge tone="neutral">{contact.city}</Badge>}
                  {contact.gstin && (
                    <Badge tone="neutral" className="font-mono">
                      {contact.gstin}
                    </Badge>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete contact?"
        message={`"${confirm?.name}" will be removed. Invoices and payments that referenced them are kept.`}
      />
    </div>
  );
}
