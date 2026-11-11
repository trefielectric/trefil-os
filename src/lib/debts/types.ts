import type { Debt, Money, State, Support } from '../finance/types';
import type { InventoryLine } from '../inventory/types';

export type DebtCategory = 'bank' | 'investment' | 'supplier' | 'recurring';
export type DebtOriginMode =
  | 'cash_new'
  | 'historical_bank_request'
  | 'historical_investment'
  | 'historical_supplier'
  | 'credit_purchase';
export interface DebtObligationMetadata {
  debtId: string;
  category: Exclude<DebtCategory, 'recurring'>;
  originMode: DebtOriginMode;
  concept: string;
  documentReference: string;
  originDate: string;
  openingAsOfDate?: string;
  openingPrincipal: Money;
  terminationDate?: string;
  interestRule?: string;
  statedInterest?: Money;
  bankStatement?: Support;
  officialPlanSupport?: Support;
  contract?: Support;
  initialReceipt?: Support;
  support: Support;
  supplierId?: string;
  status: 'documented' | 'draft_funding' | 'pending_institutional';
  createdBy: string;
  createdAt: string;
}
export interface DebtComponentAmounts {
  principal: Money;
  interest: Money;
  insurance: Money;
  commission: Money;
  lateFee: Money;
}
export interface OfficialDebtInstallment extends DebtComponentAmounts {
  id: string;
  number: number;
  dueDate: string;
  amount: Money;
  notes: string;
}
export interface OfficialDebtPlan {
  id: string;
  debtId: string;
  reference: string;
  effectiveDate: string;
  support: Support;
  installments: OfficialDebtInstallment[];
  version: number;
  replacesPlanId?: string;
  reason: string;
  recordedBy: string;
  recordedAt: string;
}
export interface DebtInstallmentAllocation extends DebtComponentAmounts {
  id: string;
  debtPaymentId: string;
  planId: string;
  installmentId: string;
  reference: string;
  date: string;
  recordedBy: string;
  recordedAt: string;
}
export interface DebtExtraordinaryPayment {
  id: string;
  debtPaymentId: string;
  date: string;
  reference: string;
  support: Support;
  notes: string;
  recordedBy: string;
  recordedAt: string;
}
export interface DebtStatementReconciliation {
  id: string;
  debtId: string;
  date: string;
  reference: string;
  statementPrincipal: Money;
  bookPrincipal: Money;
  difference: Money;
  support: Support;
  notes: string;
  status: 'matched' | 'difference';
  recordedBy: string;
  recordedAt: string;
}
export interface DebtAuthorizationRequest {
  id: string;
  debtId?: string;
  billId?: string;
  kind:
    | 'bank_origin'
    | 'investment_renegotiation'
    | 'correction'
    | 'exceptional_adjustment'
    | 'closed_period_change';
  reason: string;
  effectiveDate: string;
  proposedPrincipal?: Money;
  proposedMonthlyRate?: string;
  proposedTerminationDate?: string;
  proposedConditions?: string;
  support: Support;
  before: string;
  status: 'pending_institutional';
  requiredAuthority: 'creator_or_manager' | 'not_defined';
  requestedBy: string;
  createdAt: string;
}
export interface DebtSupplier {
  id: string;
  identification: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  active: boolean;
  locationId: string;
  createdBy: string;
  createdAt: string;
}
export interface SupplierDocumentLine {
  itemId?: string;
  warehouseId?: string;
  description: string;
  category: string;
  quantity: string;
  unit: 'unit' | 'kg' | 'm' | 'l';
  unitPrice: Money;
  totalValue: Money;
}
export interface SupplierInvoiceMetadata {
  debtId: string;
  supplierId: string;
  invoiceReference: string;
  date: string;
  dueDate: string;
  amount: Money;
  source: 'historical' | 'credit_purchase';
  support: Support;
  lines: SupplierDocumentLine[];
  inventoryMovementIds: string[];
  createdBy: string;
  createdAt: string;
}
export interface DebtSupplierPurchase {
  id: string;
  debtId: string;
  supplierId: string;
  date: string;
  reference: string;
  lines: (InventoryLine & { totalValue: Money })[];
  totalValue: Money;
  support: Support;
  actorId: string;
  createdAt: string;
}
export interface DebtSupplierReturn {
  id: string;
  purchaseId: string;
  debtId: string;
  supplierId: string;
  date: string;
  reference: string;
  lines: InventoryLine[];
  reason: string;
  support: Support;
  status: 'pending' | 'disputed' | 'accepted';
  acceptedAmount?: Money;
  acceptedDate?: string;
  acceptanceReference?: string;
  acceptanceSupport?: Support;
  acceptedBy?: string;
  actorId: string;
  createdAt: string;
  history: { date: string; actorId: string; action: string; notes: string }[];
}
export interface RecurringDebtTemplate {
  id: string;
  name: string;
  creditor: string;
  concept: string;
  locationId: string;
  frequency: 'monthly';
  dueDay?: number;
  consumptionUnit?: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
}
export interface RecurringDebtBill {
  id: string;
  templateId: string;
  month: string;
  reference: string;
  invoiceDate: string;
  receivedDate: string;
  dueDate: string;
  amount: Money;
  support: Support;
  consumption?: string;
  consumptionUnit?: string;
  notes: string;
  receivedBy: string;
  createdAt: string;
}
export interface RecurringDebtPayment {
  id: string;
  billId: string;
  transactionId: string;
  date: string;
  amount: Money;
  recordedBy: string;
  createdAt: string;
}
export interface DebtLinkedCashPayment extends DebtComponentAmounts {
  id: string;
  debtId: string;
  transactionId: string;
  date: string;
  amount: Money;
  reference: string;
  recordedBy: string;
  createdAt: string;
}
export interface DebtModuleAlert {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  category: DebtCategory;
  debtId?: string;
  billId?: string;
  templateId?: string;
  creditor?: string;
  locationId: string;
  date: string;
  amount?: Money;
  status: 'open' | 'resolved';
  history: { date: string; actorId: string; action: string }[];
}
export interface DebtReview {
  id: string;
  alertId: string;
  date: string;
  reason: string;
  support: Support;
  conditionSignature?: string;
  actorId: string;
  createdAt: string;
}
export interface DebtCalendarEntry {
  id: string;
  source: 'official_installment' | 'supplier_invoice' | 'recurring_bill';
  category: DebtCategory;
  debtId?: string;
  billId?: string;
  planId?: string;
  installmentId?: string;
  creditor: string;
  concept: string;
  locationId: string;
  dueDate: string;
  amount: Money;
  paidAmount: Money;
  remaining: Money;
  status: 'upcoming' | 'overdue' | 'partially_paid' | 'paid' | 'future';
  official: true;
}
export interface DebtReportRow {
  id: string;
  debtId?: string;
  billId?: string;
  category: DebtCategory;
  creditor: string;
  concept: string;
  documentReference: string;
  locationId: string;
  openingBalance: Money;
  newObligations: Money;
  principalPaid: Money;
  noncashScrap: Money;
  acceptedReturns: Money;
  documentedAdjustments: Money;
  closingBalance: Money;
  interestPaid: Money;
  insurancePaid: Money;
  commissionPaid: Money;
  lateFeePaid: Money;
  cashPaid: Money;
  dueDate?: string;
  status:
    | 'pending_funding'
    | 'pending_authorization'
    | 'current'
    | 'upcoming'
    | 'overdue'
    | 'partially_paid'
    | 'paid';
  supportMissing: boolean;
}
export interface DebtReportTotals {
  openingBalance: Money;
  newObligations: Money;
  principalPaid: Money;
  noncashScrap: Money;
  acceptedReturns: Money;
  documentedAdjustments: Money;
  closingBalance: Money;
  interestPaid: Money;
  insurancePaid: Money;
  commissionPaid: Money;
  lateFeePaid: Money;
  cashPaid: Money;
}
export interface DebtReportMovement extends DebtComponentAmounts {
  id: string;
  date: string;
  category: DebtCategory;
  creditor: string;
  documentReference: string;
  locationId: string;
  debtId?: string;
  billId?: string;
  kind: 'cash_payment' | 'scrap_offset' | 'accepted_return' | 'new_obligation' | 'opening' | 'recurring_bill';
  total: Money;
  sourceReference: string;
  supportName?: string;
}
export interface DebtModuleReport {
  startDate: string;
  endDate: string;
  generatedAt: string;
  scope: 'local';
  status: 'draft' | 'closed';
  version: number;
  closedAt?: string;
  closedBy?: string;
  category?: DebtCategory;
  locationId?: string;
  rows: DebtReportRow[];
  totals: DebtReportTotals;
  movements: DebtReportMovement[];
  calendar: DebtCalendarEntry[];
  issues: DebtModuleAlert[];
  plans: OfficialDebtPlan[];
  reconciliations: DebtStatementReconciliation[];
  requests: DebtAuthorizationRequest[];
  reconciled: boolean;
}
export interface DebtMonthClosure {
  id: string;
  month: string;
  scope: 'local';
  status: 'closed';
  version: number;
  report: DebtModuleReport;
  closedBy: string;
  closedAt: string;
  notes: string;
}
export interface DebtModuleState {
  version: 1;
  obligations: DebtObligationMetadata[];
  officialPlans: OfficialDebtPlan[];
  installmentAllocations: DebtInstallmentAllocation[];
  extraordinaryPayments: DebtExtraordinaryPayment[];
  reconciliations: DebtStatementReconciliation[];
  requests: DebtAuthorizationRequest[];
  suppliers: DebtSupplier[];
  supplierInvoices: SupplierInvoiceMetadata[];
  supplierPurchases: DebtSupplierPurchase[];
  supplierReturns: DebtSupplierReturn[];
  cashPaymentLinks: DebtLinkedCashPayment[];
  recurringTemplates: RecurringDebtTemplate[];
  recurringBills: RecurringDebtBill[];
  recurringPayments: RecurringDebtPayment[];
  alerts: DebtModuleAlert[];
  reviews: DebtReview[];
  monthClosures: DebtMonthClosure[];
}
export type DebtWorkspace = State & { debtModule?: DebtModuleState };
export interface RegisterDebtObligationInput extends Omit<Debt, 'id' | 'status' | 'createdAt'> {
  originMode: DebtOriginMode;
  openingPrincipal?: Money;
  openingAsOfDate?: string;
  concept: string;
  documentReference: string;
  terminationDate?: string;
  interestRule?: string;
  statedInterest?: Money;
  bankStatement?: Support;
  officialPlanSupport?: Support;
  initialReceipt?: Support;
  support: Support;
  supplierId?: string;
}
export interface RecordDebtMetadataInput extends Omit<
  DebtObligationMetadata,
  'createdBy' | 'createdAt' | 'status' | 'category'
> {}
export interface OfficialDebtPlanInput {
  debtId: string;
  reference: string;
  effectiveDate: string;
  support: Support;
  reason: string;
  installments: (Omit<OfficialDebtInstallment, 'id' | 'notes'> & { notes?: string })[];
}
export interface DebtReportInput {
  startDate: string;
  endDate: string;
  category?: DebtCategory;
  locationId?: string;
  creditor?: string;
}
