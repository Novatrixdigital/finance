import { useModals } from '@/context/ModalContext';
import { TransactionForm } from '@/components/forms/TransactionForm';
import { InvoiceForm } from '@/components/forms/InvoiceForm';
import { SubscriptionForm } from '@/components/forms/SubscriptionForm';
import {
  AccountForm,
  PaymentForm,
  GoalForm,
  BudgetForm,
  ContactForm,
  CategoryForm,
  RecurringForm,
} from '@/components/forms/RecordForms';

/**
 * Renders whichever record form the shell has been asked to open.
 *
 * Mounted once inside <AppShell>, so Quick Actions, page headers, empty states
 * and the mobile "+" button all drive the same instances.
 */
export function ModalHost() {
  const { modal, close } = useModals();
  const type = modal?.type;
  const props = modal?.props || {};

  return (
    <>
      <TransactionForm open={type === 'transaction'} onClose={close} {...props} />
      <InvoiceForm open={type === 'invoice'} onClose={close} {...props} />
      <PaymentForm open={type === 'payment'} onClose={close} {...props} />
      <AccountForm open={type === 'account'} onClose={close} {...props} />
      <GoalForm open={type === 'goal'} onClose={close} {...props} />
      <BudgetForm open={type === 'budget'} onClose={close} {...props} />
      <ContactForm open={type === 'contact'} onClose={close} {...props} />
      <CategoryForm open={type === 'category'} onClose={close} {...props} />
      <RecurringForm open={type === 'recurring'} onClose={close} {...props} />
      <SubscriptionForm open={type === 'subscription'} onClose={close} {...props} />
    </>
  );
}

export default ModalHost;
