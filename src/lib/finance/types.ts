export type Money = string;
export type Role = 'owner' | 'admin' | 'treasury' | 'accounting' | 'inventory' | 'production' | 'sales' | 'hr' | 'employee' | 'auditor';
export interface Actor { id: string; name: string; role: Role }
export interface Member extends Actor { email: string; active: boolean; locationIds: string[] }
export interface Account { id: string; name: string; kind: 'bank' | 'cash' | 'wallet' | 'personal' | 'ledger'; bank?: string; lastFour?: string; custodian: string; locationId: string; active: boolean; businessUseAuthorizedUntil?: string; createdAt?: string; origin?: string }
export interface Support { name: string; type: string; size: number; dataUrl?: string }
export type TransactionKind = 'income' | 'expense' | 'transfer' | 'opening' | 'advance' | 'reimbursement' | 'salary' | 'loan' | 'adjustment' | 'reversal' | 'debt_payment' | 'personal_expense';
export type TransactionStatus = 'pending' | 'posted' | 'rejected';
export interface Entry { accountId: string; debit: Money; credit: Money }
export interface Transaction { id: string; reference: string; date: string; description: string; party: string; category: string; locationId: string; kind: TransactionKind; status: TransactionStatus; entries: Entry[]; amount: Money; idempotencyKey: string; requestedBy: string; createdAt: string; approvedBy?: string; rejectionReason?: string; reversalOf?: string; reversedBy?: string; reason?: string; support?: Support; origin: string; requestFingerprint?: string }
export interface TransactionInput { kind: Exclude<TransactionKind, 'reversal' | 'debt_payment'>; date: string; description: string; party: string; category: string; locationId: string; amount: Money; accountId: string; destinationAccountId?: string; support?: Support; idempotencyKey: string; direction?: 'in' | 'out' }
export type AmortizationMethod = 'fixed_payment' | 'fixed_principal' | 'interest_only';
export interface ExtraPayment { period: number; amount: Money }
export interface RateChange { period: number; monthlyRate: string }
export interface Debt { id: string; creditor: string; kind: 'loan' | 'investment'; principal: Money; monthlyRate: string; installments: number; startDate: string; dueDay: number; method: AmortizationMethod; locationId: string; status: 'active' | 'paid'; guarantee?: string; notes?: string; graceMonths?: number; extraPayments?: ExtraPayment[]; rateChanges?: RateChange[]; createdAt?: string; contract?: Support }
export interface DebtPayment { id: string; debtId: string; transactionId: string; date: string; amount: Money; interest: Money; principal: Money; status: TransactionStatus; appliedMonthlyRate?: string }
export interface DebtPaymentInput { debtId: string; accountId: string; date: string; amount: Money; interest: Money; principal: Money; idempotencyKey: string; support?: Support; appliedMonthlyRate?: string }
export interface AmortizationInput { principal: Money; monthlyRate: string; installments: number; startDate: string; dueDay?: number; method: AmortizationMethod; graceMonths?: number; extraPayments?: ExtraPayment[]; rateChanges?: RateChange[] }
export interface AmortizationRow { period: number; date: string; openingBalance: Money; payment: Money; interest: Money; principal: Money; extraPayment: Money; balance: Money; monthlyRate: string; projected: true }
export interface Reconciliation { id: string; accountId: string; locationId: string; date: string; bookAmount: Money; bankAmount: Money; difference: Money; status: 'matched' | 'difference'; notes: string; actorId: string; createdAt: string }
export interface AlertComment { id: string; actorName: string; date: string; text: string }
export interface AlertHistory { date: string; actorName: string; action: string }
export interface Alert { id: string; type: string; title: string; description: string; severity: 'critical' | 'warning' | 'info'; responsible: string; status: 'open' | 'in_progress' | 'resolved'; dueDate: string; evidence: string; comments: AlertComment[]; history: AlertHistory[]; resolution?: string }
export interface AuditEvent { id: string; action: string; entityType: string; entityId: string; actorId: string; actorName: string; timestamp: string; reason?: string; locationId?: string; before?: string; after?: string }
export interface BackupRun { id: string; startedAt: string; completedAt?: string; status: 'success' | 'failed' | 'running'; verified: boolean; sizeBytes?: number; checksum?: string; destination: string; restoreVerifiedAt?: string; error?: string }
export interface State { version: 1; organization: { id: string; name: string; taxId: string }; locations: { id: string; name: string }[]; accounts: Account[]; transactions: Transaction[]; debts: Debt[]; debtPayments: DebtPayment[]; reconciliations: Reconciliation[]; alerts: Alert[]; audit: AuditEvent[]; members: Member[]; backups: BackupRun[] }
export interface Summary { available: Money; income: Money; expenses: Money; debt: Money; interestPaid: Money; principalPaid: Money; pendingApprovals: number; pendingReconciliations: number; alerts: number }
export interface UpcomingObligation { debtId: string; creditor: string; period: number; date: string; amount: Money; interest: Money; principal: Money; status: 'overdue' | 'upcoming' | 'future'; projected: true }
