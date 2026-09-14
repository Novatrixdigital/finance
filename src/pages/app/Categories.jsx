import { useState, useMemo, useEffect } from 'react';
import { Plus, Pencil, Trash2, Tags, Lock } from 'lucide-react';
import { PageHeader, StatStrip } from '@/components/layout/PageHeader';
import { Card, Button, EmptyState, LoadingBlock, Segmented, ConfirmDialog } from '@/components/ui';
import { useModals } from '@/context/ModalContext';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { supabase, readableError } from '@/lib/supabase';
import { icon as resolveIcon, groupBy } from '@/lib/utils';

const TABS = [
  { id: 'expense', label: 'Expense' },
  { id: 'income', label: 'Income' },
  { id: 'transfer', label: 'Transfer' },
];

export default function Categories() {
  const { open, dirtyToken } = useModals();
  const { user } = useAuth();
  const toast = useToast();

  const [kind, setKind] = useState('expense');
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  /* Categories are the one table where workspace_id may be NULL (shared), so
     they are fetched by user rather than through the scope helper. */
  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('categories')
      .select('*, workspace:workspaces(name, type)')
      .eq('user_id', user.id)
      .order('kind')
      .order('sort_order')
      .order('name');

    if (error) toast.error(readableError(error));
    setRows(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, dirtyToken]);

  const filtered = useMemo(() => rows.filter((c) => c.kind === kind), [rows, kind]);
  const byKind = useMemo(() => groupBy(rows, (c) => c.kind), [rows]);

  const confirmDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    const { error } = await supabase.from('categories').delete().eq('id', confirm.id);
    setDeleting(false);

    if (error) {
      toast.error(readableError(error));
    } else {
      toast.success('Category removed.');
      setRows((list) => list.filter((c) => c.id !== confirm.id));
    }
    setConfirm(null);
  };

  return (
    <div className="mx-auto max-w-[1560px]">
      <PageHeader
        title="Structure makes"
        accent="reports honest."
        subtitle="Group your spending and income so every chart in Novatrix means something."
        actions={
          <Button size="md" icon={Plus} onClick={() => open('category')}>
            New Category
          </Button>
        }
      >
        <StatStrip
          items={[
            { label: 'Total', value: rows.length },
            { label: 'Expense', value: (byKind.expense || []).length, tone: 'negative' },
            { label: 'Income', value: (byKind.income || []).length, tone: 'lime' },
            { label: 'Custom', value: rows.filter((c) => !c.is_system).length },
          ]}
        />
      </PageHeader>

      <div className="mb-6">
        <Segmented options={TABS} value={kind} onChange={setKind} />
      </div>

      {loading ? (
        <Card>
          <LoadingBlock rows={6} />
        </Card>
      ) : !filtered.length ? (
        <Card>
          <EmptyState
            icon={Tags}
            title={`No ${kind} categories`}
            description="Add one and it becomes available to every transaction form straight away."
            action={
              <Button size="sm" icon={Plus} onClick={() => open('category')}>
                Add category
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((category) => {
            const Icon = resolveIcon(category.icon, 'Tag');

            return (
              <Card key={category.id} hover className="group !p-4">
                <div className="flex items-center gap-3">
                  <span
                    className="icon-tile h-10 w-10"
                    style={{
                      borderColor: `${category.color}33`,
                      backgroundColor: `${category.color}14`,
                    }}
                  >
                    <Icon size={16} strokeWidth={1.9} style={{ color: category.color }} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">{category.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                      {category.workspace?.name ? `${category.workspace.name} only` : 'Both workspaces'}
                    </p>
                  </div>

                  {category.is_system ? (
                    <span title="Built-in category" className="shrink-0 text-ink-muted">
                      <Lock size={12} />
                    </span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-0.5 reveal-actions">
                      <button
                        type="button"
                        onClick={() => open('category', { record: category })}
                        aria-label="Edit category"
                        className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-hair hover:text-ink"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirm(category)}
                        aria-label="Delete category"
                        className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-negative/10 hover:text-negative"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-6 flex items-center gap-2 text-[12px] text-ink-muted">
        <Lock size={12} />
        Built-in categories cannot be deleted — they keep historical reports intact.
      </p>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Delete category?"
        message={`"${confirm?.name}" will be removed. Transactions using it become uncategorised.`}
      />
    </div>
  );
}
