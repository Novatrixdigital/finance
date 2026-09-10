/**
 * Shared vocabulary — nav, enums, palettes and status maps.
 * Everything the UI needs to describe a domain value lives here so labels and
 * colours stay identical across pages.
 */

export const BRAND = {
  name: 'Novatrix Digital',
  short: 'Novatrix',
  tagline: 'Finance. Simplified.',
  quote: 'Money is a tool. A better you is the goal.',
};

/* ── Workspace scopes ───────────────────────────────────────────────────── */

export const SCOPES = {
  PERSONAL: 'personal',
  BUSINESS: 'business',
  COMBINED: 'combined',
};

export const SCOPE_LIST = [
  { id: SCOPES.PERSONAL, label: 'Personal', icon: 'User', hint: 'Your own money' },
  { id: SCOPES.BUSINESS, label: 'Business', icon: 'Briefcase', hint: 'Company books' },
  { id: SCOPES.COMBINED, label: 'Combined', icon: 'Layers', hint: 'Everything together' },
];

/* ── Navigation ─────────────────────────────────────────────────────────── */

export const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: 'LayoutGrid' },
  { to: '/transactions', label: 'Transactions', icon: 'ArrowLeftRight' },
  { to: '/accounts', label: 'Accounts', icon: 'Landmark' },
  { to: '/cash', label: 'Cash', icon: 'Wallet' },
  { to: '/payments', label: 'Payments', icon: 'IndianRupee' },
  { to: '/invoices', label: 'Invoices', icon: 'FileText', businessOnly: true },
  { to: '/budgets', label: 'Budgets', icon: 'PieChart' },
  { to: '/goals', label: 'Goals', icon: 'Target' },
  { to: '/reports', label: 'Reports', icon: 'ClipboardList' },
  { to: '/analytics', label: 'Analytics', icon: 'TrendingUp' },
  { to: '/contacts', label: 'Contacts', icon: 'Users', businessOnly: true },
  { to: '/categories', label: 'Categories', icon: 'Tags' },
  { to: '/subscriptions', label: 'Subscriptions', icon: 'RefreshCw' },
  { to: '/recurring', label: 'Recurring', icon: 'Repeat' },
  { to: '/reminders', label: 'Reminders', icon: 'BellRing' },
  { to: '/settings', label: 'Settings', icon: 'Settings' },
];

export const MOBILE_NAV = [
  { to: '/dashboard', label: 'Home', icon: 'LayoutGrid' },
  { to: '/transactions', label: 'Transactions', icon: 'ArrowLeftRight' },
  { action: 'add', label: 'Add', icon: 'Plus' },
  { to: '/payments', label: 'Payments', icon: 'IndianRupee' },
  { action: 'more', label: 'More', icon: 'Menu' },
];

/* ── Transactions ───────────────────────────────────────────────────────── */

export const TRANSACTION_TYPES = [
  { id: 'income', label: 'Income', icon: 'ArrowDownLeft', tone: 'positive' },
  { id: 'expense', label: 'Expense', icon: 'ArrowUpRight', tone: 'negative' },
  { id: 'transfer', label: 'Transfer', icon: 'ArrowLeftRight', tone: 'neutral' },
];

export const TRANSACTION_STATUSES = [
  { id: 'completed', label: 'Completed' },
  { id: 'pending', label: 'Pending' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export const PAYMENT_METHODS = [
  'Bank Transfer',
  'UPI',
  'Card',
  'Cash',
  'Cheque',
  'Auto Debit',
  'Net Banking',
  'Wallet',
];

/* ── Accounts ───────────────────────────────────────────────────────────── */

export const ACCOUNT_TYPES = [
  { id: 'bank', label: 'Bank Account', icon: 'Landmark' },
  { id: 'savings', label: 'Savings', icon: 'PiggyBank' },
  { id: 'cash', label: 'Cash', icon: 'Wallet' },
  { id: 'credit_card', label: 'Credit Card', icon: 'CreditCard' },
  { id: 'wallet', label: 'Digital Wallet', icon: 'Smartphone' },
  { id: 'investment', label: 'Investment', icon: 'TrendingUp' },
  { id: 'loan', label: 'Loan', icon: 'Receipt' },
];

/* ── Status colour maps ─────────────────────────────────────────────────── */

export const INVOICE_STATUS = {
  draft: { label: 'Draft', className: 'bg-hair text-ink-dim border-hair' },
  sent: { label: 'Sent', className: 'bg-info/10 text-info border-info/25' },
  partial: { label: 'Partial', className: 'bg-warning/10 text-warning border-warning/25' },
  paid: { label: 'Paid', className: 'bg-accent/12 text-accent border-accent/30' },
  overdue: { label: 'Overdue', className: 'bg-negative/12 text-negative border-negative/30' },
  cancelled: { label: 'Cancelled', className: 'bg-hair text-ink-muted border-hair' },
};

export const PAYMENT_STATUS = {
  upcoming: { label: 'Upcoming', className: 'bg-warning/10 text-warning border-warning/25' },
  pending: { label: 'Pending', className: 'bg-negative/10 text-negative border-negative/25' },
  paid: { label: 'Paid', className: 'bg-accent/12 text-accent border-accent/30' },
  overdue: { label: 'Overdue', className: 'bg-negative/20 text-negative border-negative/40' },
  cancelled: { label: 'Cancelled', className: 'bg-hair text-ink-muted border-hair' },
};

export const GOAL_STATUS = {
  active: { label: 'Active', className: 'bg-accent/10 text-accent border-accent/25' },
  achieved: { label: 'Achieved', className: 'bg-accent/20 text-accent border-accent/40' },
  paused: { label: 'Paused', className: 'bg-hair text-ink-dim border-hair' },
  archived: { label: 'Archived', className: 'bg-hair text-ink-muted border-hair' },
};

export const CONTACT_TYPES = [
  { id: 'customer', label: 'Customer' },
  { id: 'vendor', label: 'Vendor' },
  { id: 'employee', label: 'Employee' },
  { id: 'personal', label: 'Personal' },
  { id: 'other', label: 'Other' },
];

export const BUDGET_PERIODS = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'yearly', label: 'Yearly' },
];

export const FREQUENCIES = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'biweekly', label: 'Every 2 weeks' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'yearly', label: 'Yearly' },
];

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'];

/* ── Subscriptions ──────────────────────────────────────────────────────── */

export const BILLING_CYCLES = [
  { id: 'weekly', label: 'Weekly', perMonth: 52 / 12 },
  { id: 'monthly', label: 'Monthly', perMonth: 1 },
  { id: 'quarterly', label: 'Quarterly', perMonth: 1 / 3 },
  { id: 'half_yearly', label: 'Every 6 months', perMonth: 1 / 6 },
  { id: 'yearly', label: 'Yearly', perMonth: 1 / 12 },
  { id: 'lifetime', label: 'Lifetime (one-off)', perMonth: 0 },
];

export const SUBSCRIPTION_STATUS = {
  active: { label: 'Active', className: 'bg-accent/12 text-accent border-accent/30' },
  trial: { label: 'Free trial', className: 'bg-info/10 text-info border-info/25' },
  paused: { label: 'Paused', className: 'bg-hair text-ink-dim border-hair' },
  cancelled: { label: 'Cancelled', className: 'bg-hair text-ink-muted border-hair' },
  expired: { label: 'Expired', className: 'bg-negative/10 text-negative border-negative/25' },
};

/** Icons offered in the subscription picker — all present in lib/icons.js. */
export const SUBSCRIPTION_ICONS = [
  'monitor', 'music', 'cloud', 'book', 'dumbbell', 'shield',
  'globe', 'package', 'coffee', 'car', 'heart-pulse', 'shopping-bag',
];

/* ── Reminders ──────────────────────────────────────────────────────────── */

export const REMINDER_STATUS = {
  scheduled: { label: 'Scheduled', className: 'bg-warning/10 text-warning border-warning/25' },
  sent: { label: 'Sent', className: 'bg-accent/12 text-accent border-accent/30' },
  failed: { label: 'Failed', className: 'bg-negative/12 text-negative border-negative/30' },
  dismissed: { label: 'Dismissed', className: 'bg-hair text-ink-muted border-hair' },
  cancelled: { label: 'Cancelled', className: 'bg-hair text-ink-muted border-hair' },
};

export const REMINDER_KINDS = [
  { id: 'custom', label: 'Custom' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'payment', label: 'Payment' },
  { id: 'invoice', label: 'Invoice' },
  { id: 'goal', label: 'Goal' },
];

/* ── Chart palette ──────────────────────────────────────────────────────── */

/**
 * Deliberately narrow: a lime ramp carries the bulk of the weight and three
 * muted accents pick up the tail, so charts never turn into confetti.
 */
export const CHART_COLORS = [
  '#C8FF00',
  '#A8E600',
  '#89BF00',
  '#6E9900',
  '#FFB547',
  '#7DD3FC',
  '#6B7280',
  '#FF5C6C',
  '#A78BFA',
  '#F472B6',
];

export const CHART_INK = {
  grid: 'rgba(255,255,255,0.06)',
  axis: '#6B7280',
  income: '#C8FF00',
  expense: '#4B5563',
  tooltipBg: '#1A1F22',
};

/* ── Hero benefit points ────────────────────────────────────────────────── */

export const BENEFITS = [
  { icon: 'CircleDot', title: 'Track', sub: 'Everything' },
  { icon: 'Briefcase', title: 'Stay', sub: 'Organized' },
  { icon: 'CheckSquare', title: 'Build', sub: 'Your Goals' },
  { icon: 'TrendingUp', title: 'Grow', sub: 'Confidently' },
];

export const QUICK_ACTIONS = [
  { id: 'transaction', label: 'Add\nTransaction', icon: 'Plus', accent: true },
  { id: 'invoice', label: 'Create\nInvoice', icon: 'FileText' },
  { id: 'payment', label: 'Record\nPayment', icon: 'IndianRupee' },
  { id: 'transfer', label: 'Transfer\nMoney', icon: 'ArrowLeftRight' },
];
