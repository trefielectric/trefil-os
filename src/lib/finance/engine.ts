import { assertDebtPeriodOpen, getDebtModulePrincipalBalance, getDebtCalendar, getDebtModuleState, getDebtModuleAlerts, getRecurringBillBalance, getDebtCapitalBasis, getActualDebtModulePayments } from '../debts/engine';
import { getInventoryAlerts } from '../inventory/engine';
import { buildAmortization, validateDate } from './amortization';
import { add, fromCents, money, rateFraction, sub, toCents } from './money';
import type { Account, Actor, Alert, AuditEvent, Debt, DebtPaymentInput, Entry, Money, Reconciliation, State, Summary, Transaction, TransactionInput, UpcomingObligation } from './types';
import { assertCashPostingAllowed, attachCashSupport, getCashAlerts, getCashReport, hasCashSupport, isCashEnabled, validateCashSupport } from './cash';

export const ROLE_LABELS = { owner: 'Propietario', admin: 'Administrador general', treasury: 'Tesorería', accounting: 'Contabilidad', inventory: 'Inventarios', production: 'Producción', sales: 'Ventas', hr: 'Recursos humanos', employee: 'Empleado', auditor: 'Auditor de solo lectura' } as const;
const FINANCE_ROLES = ['owner', 'admin', 'treasury', 'accounting'];
const APPROVAL_ROLES = ['owner', 'admin'];
const APPROVAL_THRESHOLD = 500000000n;
const now = (): string => new Date().toISOString();
const uid = (): string => crypto.randomUUID();

export function todayBogota(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}-${parts.find(part => part.type === 'day')!.value}`;
}

function authorize(state: State, actor: Actor, allowed: readonly string[] = FINANCE_ROLES, locationId?: string): void {
  const member = state.members.find(item => item.id === actor.id);
  if (!member || !member.active || member.role !== actor.role || !allowed.includes(member.role)) throw new Error('Tu usuario no tiene permiso para esta operación.');
  if (locationId && !member.locationIds.includes(locationId)) throw new Error('No tienes permiso en esta sede.');
}

function audit(state: State, actor: Actor, action: string, entityType: string, entityId: string, reason?: string, locationId?: string): void {
  const event: AuditEvent = { id: uid(), action, entityType, entityId, actorId: actor.id, actorName: actor.name, timestamp: now(), reason, locationId };
  state.audit.unshift(event);
}

function copy(state: State): State { return structuredClone(state); }
function requireLocation(state: State, locationId: string): void { if (!state.locations.some(item => item.id === locationId)) throw new Error('La sede no existe.'); }
function requireText(value: string, label: string, min = 2): string { if (typeof value !== 'string' || value.trim().length < min || value.length > 2000) throw new Error(`${label} es obligatorio y debe tener entre ${min} y 2000 caracteres.`); return value.trim(); }
function accountFor(state: State, id: string, locationId: string): Account {
  const account = state.accounts.find(item => item.id === id && item.locationId === locationId);
  if (!account || !account.active || account.kind === 'ledger') throw new Error('La cuenta no está activa o no pertenece a la sede seleccionada.');
  if (account.kind === 'personal' && (!account.businessUseAuthorizedUntil || account.businessUseAuthorizedUntil < todayBogota())) throw new Error('La autorización de uso empresarial de esta cuenta personal venció.');
  return account;
}
function positiveAmount(value: Money): Money { const result = money(value); if (toCents(result) <= 0n) throw new Error('El valor debe ser mayor que cero.'); return result; }
function validateSupport(support: TransactionInput['support']): void {
  if (!support) return;
  requireText(support.name, 'El nombre del soporte');
  if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(support.type)) throw new Error('Solo se permiten soportes PDF, PNG, JPG o WebP.');
  if (!Number.isInteger(support.size) || support.size < 0 || support.size > 5 * 1024 * 1024) throw new Error('El soporte debe pesar como máximo 5 MB.');
  if (support.dataUrl && !support.dataUrl.startsWith(`data:${support.type};base64,`)) throw new Error('El contenido del soporte no coincide con su tipo.');
}

function control(state: State, locationId: string, name: string): string {
  const id = `ledger-${name}-${locationId}`;
  if (!state.accounts.some(account => account.id === id)) state.accounts.push({ id, name: `Control ${name}`, kind: 'ledger', custodian: 'Contabilidad', locationId, active: true, origin: 'system' });
  return id;
}

function entry(accountId: string, debit: Money, credit: Money): Entry { return { accountId, debit, credit }; }
export function isBalanced(transaction: Pick<Transaction, 'entries'>): boolean {
  if (transaction.entries.length < 2) return false;
  let debit = 0n; let credit = 0n;
  for (const item of transaction.entries) {
    const d = toCents(item.debit); const c = toCents(item.credit);
    if (d < 0n || c < 0n || (d > 0n && c > 0n) || (d === 0n && c === 0n)) return false;
    debit += d; credit += c;
  }
  return debit > 0n && debit === credit;
}

function needsApproval(kind: Transaction['kind'], amount: Money): boolean { return ['adjustment', 'personal_expense', 'opening', 'reversal', 'debt_payment'].includes(kind) || toCents(amount) >= APPROVAL_THRESHOLD; }

/** Every posting includes a compensating control account. Pending rows never alter balances. */
export function createTransaction(state: State, input: TransactionInput, actor: Actor): State {
  authorize(state, actor, FINANCE_ROLES, input.locationId);
  requireLocation(state, input.locationId);
  requireText(input.idempotencyKey, 'La clave de idempotencia', 8);
  const requestFingerprint = JSON.stringify({ kind: input.kind, date: input.date, description: input.description.trim(), party: input.party.trim(), category: input.category.trim(), locationId: input.locationId, amount: money(input.amount), accountId: input.accountId, destinationAccountId: input.destinationAccountId, support: input.support, direction: input.kind === 'adjustment' ? input.direction ?? 'in' : undefined, cashSessionIds: input.cashSessionIds });
  const existing = state.transactions.find(transaction => transaction.idempotencyKey === input.idempotencyKey);
  if (existing) {
    if (existing.requestedBy !== actor.id || existing.requestFingerprint !== requestFingerprint) throw new Error('La clave de idempotencia ya fue usada con otros datos.');
    return state;
  }
  if (!['income', 'expense', 'transfer', 'opening', 'advance', 'reimbursement', 'salary', 'loan', 'adjustment', 'personal_expense'].includes(input.kind)) throw new Error('Tipo de movimiento inválido.');
  if (input.direction && (!['in', 'out'].includes(input.direction) || input.kind !== 'adjustment')) throw new Error('La dirección solo se utiliza para ajustes de entrada o salida.');
  validateDate(input.date);
  if (input.date > todayBogota()) throw new Error('Un movimiento realizado no puede tener fecha futura.');
  const amount = positiveAmount(input.amount);
  const description = requireText(input.description, 'El concepto');
  const party = requireText(input.party, 'El tercero');
  const category = requireText(input.category, 'La clasificación');
  validateSupport(input.support);
  accountFor(state, input.accountId, input.locationId);
  const cashSessionIds = assertCashPostingAllowed(state, {date:input.date,accountIds:[input.accountId,...(input.destinationAccountId?[input.destinationAccountId]:[])],sessionIds:input.cashSessionIds});
  if(isCashEnabled(state)&&input.kind==='personal_expense')throw new Error('La salida personal excepcional requiere autorización institucional de CREADOR o GERENTE.');
  const next = copy(state);
  const debitKinds = ['income', 'opening', 'loan', 'adjustment'];
  let entries: Entry[];
  if (input.kind === 'transfer') {
    if (!input.destinationAccountId || input.destinationAccountId === input.accountId) throw new Error('Selecciona una cuenta de destino diferente.');
    accountFor(state, input.destinationAccountId, input.locationId);
    if(isCashEnabled(state)&&state.accounts.some(row=>[input.accountId,input.destinationAccountId].includes(row.id)&&row.kind==='personal'))throw new Error('El traslado personal excepcional requiere autorización institucional de CREADOR o GERENTE.');
    entries = [entry(input.destinationAccountId, amount, '0.00'), entry(input.accountId, '0.00', amount)];
  } else {
    const controls = { income: 'income', expense: 'expense', opening: 'equity', advance: 'advances', reimbursement: 'reimbursements', salary: 'salaries', loan: 'loans', adjustment: 'adjustments', personal_expense: 'personal' };
    const ledgerId = control(next, input.locationId, controls[input.kind]);
    const incoming = debitKinds.includes(input.kind) && !(input.kind === 'adjustment' && input.direction === 'out');
    entries = incoming ? [entry(input.accountId, amount, '0.00'), entry(ledgerId, '0.00', amount)] : [entry(ledgerId, amount, '0.00'), entry(input.accountId, '0.00', amount)];
  }
  const transaction: Transaction = { id: uid(), reference: `TF-${String(next.transactions.length + 1).padStart(5, '0')}`, date: input.date, description, party, category, locationId: input.locationId, kind: input.kind, status: needsApproval(input.kind, amount) ? 'pending' : 'posted', entries, amount, idempotencyKey: input.idempotencyKey, requestedBy: actor.id, createdAt: now(), support: input.support, origin: 'web', requestFingerprint, ...(isCashEnabled(state)?{cashSessionIds}:{}) };
  if (!isBalanced(transaction)) throw new Error('La transacción no está equilibrada.');
  next.transactions.unshift(transaction);
  audit(next, actor, transaction.status === 'pending' ? 'Solicitud de aprobación' : 'Movimiento registrado', 'financial_transaction', transaction.id, description, input.locationId);
  return next;
}

export function approveTransaction(state: State, transactionId: string, actor: Actor, reason = 'Revisado y aprobado'): State {
  const original = state.transactions.find(transaction => transaction.id === transactionId);
  if (!original) throw new Error('El movimiento no existe.');
  authorize(state, actor, APPROVAL_ROLES, original.locationId);
  if (original.status !== 'pending') throw new Error('Solo se puede aprobar un movimiento pendiente.');
  if (original.requestedBy === actor.id) throw new Error('La aprobación requiere otra persona autorizada.');
  if (!isBalanced(original)) throw new Error('No se puede aprobar un movimiento desequilibrado.');
  if(isCashEnabled(state)&&original.reversalOf)throw new Error('La corrección requiere autorización institucional; una aprobación local no aplica el reverso.');
  for(const payment of state.debtPayments.filter(row=>row.transactionId===transactionId)){if(state.debtModule)assertDebtPeriodOpen(state,original.date);if(toCents(payment.principal)>toCents(getDebtBalance(state,payment.debtId)))throw new Error('El saldo de la obligación cambió; revisa el pago antes de aprobar.');}
  const cashSessionIds=assertCashPostingAllowed(state,{date:original.date,accountIds:original.entries.map(row=>row.accountId),sessionIds:original.cashSessionIds});
  const next = copy(state);
  const transaction = next.transactions.find(row => row.id === transactionId)!;
  transaction.status = 'posted'; transaction.approvedBy = actor.id; transaction.reason = requireText(reason, 'El motivo');
  if(isCashEnabled(state))transaction.cashSessionIds=cashSessionIds;
  if (transaction.reversalOf) next.transactions.find(row => row.id === transaction.reversalOf)!.reversedBy = transaction.id;
  for (const payment of next.debtPayments.filter(row => row.transactionId === transactionId)) payment.status = 'posted';
  audit(next, actor, 'Movimiento aprobado', 'financial_transaction', transactionId, reason, transaction.locationId);
  return next;
}

export function rejectTransaction(state: State, transactionId: string, actor: Actor, reason = ''): State {
  const transaction = state.transactions.find(row => row.id === transactionId);
  if (!transaction) throw new Error('El movimiento no existe.');
  authorize(state, actor, APPROVAL_ROLES, transaction.locationId);
  if (transaction.requestedBy === actor.id) throw new Error('El rechazo requiere otra persona autorizada.');
  if (transaction.status !== 'pending') throw new Error('Solo se puede rechazar un movimiento pendiente.');
  requireText(reason, 'El motivo de rechazo', 5);
  const next = copy(state);
  next.transactions.find(row => row.id === transactionId)!.status = 'rejected';
  next.transactions.find(row => row.id === transactionId)!.rejectionReason = reason.trim();
  for (const payment of next.debtPayments.filter(row => row.transactionId === transactionId)) payment.status = 'rejected';
  audit(next, actor, 'Movimiento rechazado', 'financial_transaction', transactionId, reason, transaction.locationId);
  return next;
}

/** Reversals always require independent approval and preserve the original immutable entries. */
export function reverseTransaction(state: State, transactionId: string, reason: string, actor: Actor): State {
  const original = state.transactions.find(transaction => transaction.id === transactionId);
  if (!original) throw new Error('El movimiento no existe.');
  authorize(state, actor, FINANCE_ROLES, original.locationId);
  if (original.status !== 'posted' || original.kind === 'reversal' || original.reversedBy || state.transactions.some(row => row.reversalOf === transactionId && row.status !== 'rejected')) throw new Error('El movimiento no puede reversarse o ya tiene un reverso.');
  requireText(reason, 'El motivo del reverso', 5);
  if(isCashEnabled(state))throw new Error('Solicita una corrección de Caja pendiente de autorización institucional; no se permiten reversos locales sin esa autorización.');
  const next = copy(state);
  const transaction: Transaction = { ...original, id: uid(), reference: `TF-${String(next.transactions.length + 1).padStart(5, '0')}`, kind: 'reversal', description: `Reverso de ${original.reference}: ${reason.trim()}`, status: 'pending', entries: original.entries.map(row => ({ accountId: row.accountId, debit: row.credit, credit: row.debit })), date: todayBogota(), createdAt: now(), requestedBy: actor.id, idempotencyKey: `reversal:${transactionId}:${uid()}`, reversalOf: transactionId, reversedBy: undefined, approvedBy: undefined, reason: reason.trim(), origin: 'web' };
  next.transactions.unshift(transaction);
  audit(next, actor, 'Reverso solicitado', 'financial_transaction', transaction.id, reason, original.locationId);
  return next;
}

export function getAccountBalance(state: State, accountId: string, asOfDate?: string): Money {
  if (asOfDate) validateDate(asOfDate);
  let balance = 0n;
  for (const transaction of state.transactions) if (transaction.status === 'posted' && (!asOfDate || transaction.date <= asOfDate)) {
    for (const row of transaction.entries) if (row.accountId === accountId) balance += toCents(row.debit) - toCents(row.credit);
  }
  return fromCents(balance);
}

export function getEffectiveDebtPayments(state: State, debtId?: string) {
  return state.debtPayments.filter(payment => (!debtId || payment.debtId === debtId) && payment.status === 'posted' && state.transactions.some(transaction => transaction.id === payment.transactionId && transaction.status === 'posted' && !transaction.reversedBy));
}

/** Supplier compensation settles principal without a cash journal entry. */
export function getSupplierOffsets(state: State, debtId?: string) {
  return (state.inventory?.supplierOffsets ?? []).filter(row => (!debtId || row.debtId === debtId) && state.debts.some(debt => debt.id === row.debtId && debt.kind === 'supplier'));
}

export function getDebtBalance(state: State, debtId: string, asOfDate=todayBogota()): Money {
  return getDebtModulePrincipalBalance(state,debtId,asOfDate);
}

export function recordDebtPayment(state: State, input: DebtPaymentInput, actor: Actor): State {
  const debt = state.debts.find(item => item.id === input.debtId);
  if (!debt) throw new Error('La obligación no existe.');
  authorize(state, actor, FINANCE_ROLES, debt.locationId);
  requireText(input.idempotencyKey, 'La clave de idempotencia', 8);
  const insurance=money(input.insurance??'0.00');const commission=money(input.commission??'0.00');const lateFee=money(input.lateFee??'0.00');
  const requestFingerprint = JSON.stringify({ debtId: input.debtId, accountId: input.accountId, date: input.date, amount: money(input.amount), interest: money(input.interest), principal: money(input.principal), appliedMonthlyRate: input.appliedMonthlyRate, support: input.support, insurance, commission, lateFee, supportUrl:input.supportUrl });
  const existing = state.transactions.find(transaction => transaction.idempotencyKey === input.idempotencyKey);
  if (existing) {
    const payment = state.debtPayments.find(row => row.transactionId === existing.id);
    if (!payment || existing.requestedBy !== actor.id || existing.requestFingerprint !== requestFingerprint) throw new Error('La clave de idempotencia ya fue usada con otros datos.');
    return state;
  }
  validateDate(input.date);
  if (input.date > todayBogota()) throw new Error('Un pago realizado no puede tener fecha futura.');
  if(state.debtModule)assertDebtPeriodOpen(state,input.date);
  if (input.date < debt.startDate) throw new Error('El pago no puede ser anterior al desembolso de la obligación.');
  accountFor(state, input.accountId, debt.locationId);
  if(getDebtModuleState(state).obligations.some(row=>row.debtId===debt.id)&&getDebtCapitalBasis(state,debt.id,input.date)==='0.00')throw new Error('La obligación todavía no tiene ORIGEN o desembolso confirmado para aplicar pagos.');
  const cashSessionIds=assertCashPostingAllowed(state,{date:input.date,accountIds:[input.accountId]});
  const amount = positiveAmount(input.amount); const principal = money(input.principal); const interest = money(input.interest);
  if ([principal,interest,insurance,commission,lateFee].some(value=>toCents(value)<0n)||add(principal,interest,insurance,commission,lateFee)!==amount) throw new Error('El capital más el interés, seguros, comisiones y mora debe ser igual al pago.');
  validateCashSupport(input.support,input.supportUrl);
  if(toCents(lateFee)>0n&&!input.support&&!input.supportUrl)throw new Error('Los cargos de mora requieren comprobante o documento verificable.');
  const reservedPrincipal = state.debtPayments.filter(row => row.debtId === debt.id && row.status === 'pending').reduce((total, row) => total + toCents(row.principal), 0n);
  if (toCents(principal) > toCents(getDebtBalance(state, debt.id)) - reservedPrincipal) throw new Error('El abono a capital supera el saldo disponible de la deuda.');
  if (input.appliedMonthlyRate) rateFraction(input.appliedMonthlyRate);
  validateSupport(input.support);
  const next = copy(state);
  const entries = [entry(input.accountId, '0.00', amount)];
  if (toCents(principal) > 0n) entries.push(entry(control(next, debt.locationId, 'debt-principal'), principal, '0.00'));
  if (toCents(interest) > 0n) entries.push(entry(control(next, debt.locationId, 'debt-interest'), interest, '0.00'));
  for(const [name,value] of [['debt-insurance',insurance],['debt-commission',commission],['debt-late-fee',lateFee]] as const)if(toCents(value)>0n)entries.push(entry(control(next,debt.locationId,name),value,'0.00'));
  const transaction: Transaction = { id: uid(), reference: `TF-${String(next.transactions.length + 1).padStart(5, '0')}`, kind: 'debt_payment', date: input.date, description: `Pago de obligación · ${debt.creditor}`, party: debt.creditor, category: 'Deudas e inversionistas', locationId: debt.locationId, status: needsApproval('debt_payment', amount) ? 'pending' : 'posted', amount, entries, idempotencyKey: input.idempotencyKey, requestedBy: actor.id, createdAt: now(), support: input.support, origin: 'web', requestFingerprint, ...(isCashEnabled(state)?{cashSessionIds}:{}) };
  if (!isBalanced(transaction)) throw new Error('El pago no está equilibrado.');
  next.transactions.unshift(transaction);
  next.debtPayments.unshift({ id: uid(), debtId: debt.id, transactionId: transaction.id, date: input.date, amount, principal, interest, insurance,commission,lateFee,status: transaction.status, appliedMonthlyRate: input.appliedMonthlyRate });
  audit(next, actor, transaction.status === 'pending' ? 'Pago de deuda pendiente de aprobación' : 'Pago de deuda registrado', 'debt_payment', transaction.id, transaction.description, debt.locationId);
  return input.supportUrl?attachCashSupport(next,{transactionId:transaction.id,supportUrl:input.supportUrl,notes:'Comprobante del pago de deuda'},actor):next;
}

export function reconcileAccount(state: State, input: { accountId: string; date: string; bankAmount: Money; notes?: string }, actor: Actor): State {
  const account = state.accounts.find(item => item.id === input.accountId);
  if (!account) throw new Error('La cuenta no existe.');
  authorize(state, actor, FINANCE_ROLES, account.locationId);
  if (account.kind === 'ledger' || !account.active) throw new Error('La cuenta no está disponible para conciliación.');
  validateDate(input.date);
  if (input.date > todayBogota()) throw new Error('La conciliación no puede tener fecha futura.');
  const bankAmount = money(input.bankAmount);
  const bookAmount = getAccountBalance(state, account.id, input.date);
  const difference = sub(bankAmount, bookAmount);
  const next = copy(state);
  const reconciliation: Reconciliation = { id: uid(), accountId: account.id, locationId: account.locationId, date: input.date, bankAmount, bookAmount, difference, status: toCents(difference) === 0n ? 'matched' : 'difference', notes: input.notes?.trim() ?? '', actorId: actor.id, createdAt: now() };
  next.reconciliations.unshift(reconciliation);
  audit(next, actor, 'Conciliación registrada', 'reconciliation', reconciliation.id, `Diferencia: ${difference}. ${reconciliation.notes}`, account.locationId);
  return next;
}

export function createAccount(state: State, input: Omit<Account, 'id' | 'createdAt' | 'origin'>, actor: Actor): State {
  authorize(state, actor, ['owner', 'admin', 'treasury'], input.locationId);
  requireLocation(state, input.locationId);
  if (!['bank', 'cash', 'wallet', 'personal'].includes(input.kind)) throw new Error('Tipo de cuenta inválido.');
  requireText(input.name, 'El nombre de la cuenta'); requireText(input.custodian, 'El responsable');
  if (input.lastFour && !/^\d{4}$/.test(input.lastFour)) throw new Error('Escribe únicamente los últimos cuatro dígitos de la cuenta.');
  if(input.accountNumber!==undefined&&!/^\d{6,34}$/.test(input.accountNumber))throw new Error('El número de cuenta debe contener entre 6 y 34 dígitos.');
  if(input.accountNumber&&input.lastFour!==undefined&&input.lastFour!==input.accountNumber.slice(-4))throw new Error('Los últimos cuatro dígitos no coinciden con el número de cuenta.');
  validateSupport(input.accountDocument);
  if(isCashEnabled(state)&&input.kind==='bank'&&!input.accountNumber&&!input.accountDocument)throw new Error('Registra el número de cuenta bancaria o adjunta su documento.');
  if (input.kind === 'personal') { if (!input.businessUseAuthorizedUntil) throw new Error('Una cuenta personal requiere autorización temporal.'); validateDate(input.businessUseAuthorizedUntil); if (input.businessUseAuthorizedUntil < todayBogota()) throw new Error('La autorización no puede estar vencida.'); }
  const next = copy(state);
  const account: Account = { ...input, lastFour:input.accountNumber?.slice(-4)??input.lastFour,name: input.name.trim(), custodian: input.custodian.trim(), id: uid(), createdAt: now(), origin: 'web' };
  next.accounts.push(account);
  audit(next, actor, 'Cuenta creada', 'account', account.id, account.name, account.locationId);
  return next;
}

export function createDebt(state: State, input: Omit<Debt, 'id' | 'createdAt' | 'status'>, actor: Actor): State {
  authorize(state, actor, FINANCE_ROLES, input.locationId); requireLocation(state, input.locationId);
  if (!['loan', 'investment', 'supplier'].includes(input.kind)) throw new Error('Tipo de obligación inválido.');
  requireText(input.creditor, 'El acreedor'); buildAmortization(input); validateSupport(input.contract);
  if (input.startDate > todayBogota()) throw new Error('Una obligación desembolsada no puede tener fecha futura. Usa el simulador para condiciones proyectadas.');
  if(input.kind==='supplier'){
    requireText(input.supplierInvoice??'', 'La factura del proveedor'); validateDate(input.supplierDueDate??'');
    if(!input.contract?.dataUrl)throw new Error('Adjunta la factura real del proveedor.');validateCashSupport(input.contract);
    if(input.supplierDueDate!<input.startDate)throw new Error('El vencimiento del proveedor no puede ser anterior a la factura.');
    if(toCents(money(input.monthlyRate))!==0n||input.installments!==1||input.graceMonths||input.extraPayments?.length||input.rateChanges?.length)throw new Error('La obligación de proveedor se registra por su factura y vencimiento, sin intereses ni cuotas ficticias.');
    if(state.debts.some(row=>row.kind==='supplier'&&row.creditor.trim().toLocaleLowerCase('es')===input.creditor.trim().toLocaleLowerCase('es')&&row.supplierInvoice===input.supplierInvoice?.trim()))throw new Error('La factura del proveedor ya existe.');
  }
  const next = copy(state);
  const debt: Debt = { ...input, principal: money(input.principal), id: uid(), status: 'active', createdAt: now() };
  next.debts.push(debt);
  audit(next, actor, 'Obligación creada', 'debt', debt.id, `${debt.creditor}. No genera ingreso ni desembolso automático.`, debt.locationId);
  return next;
}

export function commentAlert(state: State, alertId: string, text: string, actor: Actor): State {
  authorize(state, actor); requireText(text, 'El comentario', 3);
  const next = copy(state);
  let alert = next.alerts.find(row => row.id === alertId);
  if (!alert) { const derived = deriveAlerts(state, todayBogota()).find(row => row.id === alertId); if (!derived) throw new Error('La alerta no existe.'); alert = structuredClone(derived); next.alerts.push(alert); }
  alert.comments.push({ id: uid(), actorName: actor.name, date: now(), text: text.trim() });
  alert.history.push({ date: now(), actorName: actor.name, action: 'Comentario añadido' });
  audit(next, actor, 'Comentario en alerta', 'alert', alertId, text);
  return next;
}

export function resolveAlert(state: State, alertId: string, comment: string, actor: Actor): State {
  requireText(comment, 'La evidencia de resolución', 5);
  authorize(state, actor);
  const activeCondition = deriveAlerts({ ...state, alerts: [] }, todayBogota()).find(alert => alert.id === alertId);
  if (activeCondition && activeCondition.type !== 'possible_duplicate') throw new Error('La condición sigue presente. Corrige y verifica la causa antes de resolver esta alerta; puedes registrar un comentario de seguimiento.');
  const next = commentAlert(state, alertId, comment, actor);
  const alert = next.alerts.find(row => row.id === alertId)!;
  alert.status = 'resolved'; alert.resolution = comment.trim(); alert.history.push({ date: now(), actorName: actor.name, action: 'Alerta resuelta' });
  audit(next, actor, 'Alerta resuelta', 'alert', alertId, comment);
  return next;
}

function dateDistance(left: string, right: string): number { return Math.floor((Date.parse(`${right}T12:00:00Z`) - Date.parse(`${left}T12:00:00Z`)) / 86400000); }

export function deriveAlerts(state: State, today = todayBogota()): Alert[] {
  validateDate(today);
  const results: Alert[] = [];
  const push = (id: string, type: string, title: string, description: string, severity: Alert['severity'], responsible: string, evidence: string, dueDate = today) => { results.push({ id, type, title, description, severity, responsible, status: 'open', dueDate, evidence, comments: [], history: [] }); };
  const cashAccounts = state.accounts.filter(account => account.kind !== 'ledger' && account.active);
  for (const account of cashAccounts) {
    const balance = getAccountBalance(state, account.id);
    if (toCents(balance) < 0n) push(`negative:${account.id}`, 'negative_balance', 'Saldo negativo', account.name, 'critical', account.custodian, `Saldo calculado: COP ${balance}`);
    if (account.kind === 'personal' && toCents(balance) !== 0n) push(`personal:${account.id}`, 'personal_account', 'Dinero empresarial en cuenta personal', account.name, 'warning', account.custodian, `Saldo COP ${balance}; autorización hasta ${account.businessUseAuthorizedUntil ?? 'sin autorización'}.`);
    const reconciliations = state.reconciliations.filter(row => row.accountId === account.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const latest = reconciliations[0];
    if (!latest || dateDistance(latest.date, today) > 7) push(`reconcile:${account.id}`, 'pending_reconciliation', 'Conciliación pendiente', account.name, 'warning', account.custodian, latest ? `Última conciliación: ${latest.date}` : 'La cuenta todavía no tiene conciliación.');
    if (latest && latest.status === 'difference') push(`difference:${latest.id}`, 'balance_difference', 'Diferencia de conciliación', account.name, 'critical', account.custodian, `Libros COP ${latest.bookAmount}; extracto COP ${latest.bankAmount}; diferencia COP ${latest.difference}.`);
  }
  for (const transaction of state.transactions.filter(row => row.status === 'posted' && !row.reversalOf && !row.reversedBy && row.kind !== 'opening')) {
    if (!hasCashSupport(state,transaction)) push(`support:${transaction.id}`, 'missing_support', 'Movimiento sin soporte', transaction.description, 'warning', 'Tesorería', transaction.reference);
    if (!transaction.category.trim() || /sin clasificar/i.test(transaction.category)) push(`category:${transaction.id}`, 'unclassified', 'Movimiento sin clasificar', transaction.description, 'warning', 'Contabilidad', transaction.reference);
    if (!isBalanced(transaction)) push(`balance:${transaction.id}`, 'unbalanced_transaction', transaction.kind === 'transfer' ? 'Traslado sin contrapartida' : 'Movimiento desequilibrado', transaction.description, 'critical', 'Contabilidad', transaction.reference);
  }
  const duplicateGroups = new Map<string, Transaction[]>();
  for (const transaction of state.transactions.filter(row => row.status !== 'rejected' && !row.reversalOf && !row.reversedBy && row.kind !== 'opening')) {
    const signature = `${transaction.date}|${transaction.kind}|${transaction.amount}|${transaction.party.toLocaleLowerCase('es-CO').trim()}|${transaction.entries.map(row => row.accountId).sort().join(',')}`;
    const group = duplicateGroups.get(signature) ?? []; group.push(transaction); duplicateGroups.set(signature, group);
  }
  for (const group of duplicateGroups.values()) if (group.length > 1) push(`duplicate:${group.map(row => row.id).sort().join(':')}`, 'possible_duplicate', 'Posible movimiento duplicado', group[0].description, 'warning', 'Tesorería', group.map(row => row.reference).join(' · '));
  const upcomingObligations = getUpcomingObligations(state, today);
  for (const debt of state.debts) {
    if(getDebtModuleState(state).obligations.some(row=>row.debtId===debt.id))continue;
    const balance = getDebtBalance(state, debt.id,today);
    if (toCents(balance) <= 0n) continue;
    const actualPayments = getEffectiveDebtPayments(state, debt.id);
    const firstUnpaid = upcomingObligations.find(row => row.debtId === debt.id);
    if (firstUnpaid) {
      const row = firstUnpaid;
      const days = dateDistance(today, row.date);
      if (days < 0) push(`overdue:${debt.id}:${row.period}`, 'overdue_debt', 'Cuota vencida', debt.creditor, 'critical', 'Tesorería', `Cuota proyectada ${row.period}, venció ${row.date}. Los pagos reales se revisan por separado.`, row.date);
      else if (days <= 7) push(`upcoming:${debt.id}:${row.period}`, 'upcoming_installment', 'Cuota próxima', debt.creditor, 'info', 'Tesorería', `Cuota proyectada ${row.period}, COP ${row.amount}.`, row.date);
    }
    for (const payment of actualPayments) {
      if (add(payment.principal,payment.interest,payment.insurance??'0.00',payment.commission??'0.00',payment.lateFee??'0.00') !== money(payment.amount)) push(`allocation:${payment.id}`, 'payment_allocation', 'Pago sin distribución válida', debt.creditor, 'critical', 'Contabilidad', `Pago COP ${payment.amount}; capital COP ${payment.principal}; interés COP ${payment.interest}.`);
      if (payment.appliedMonthlyRate) {
        const applied = rateFraction(payment.appliedMonthlyRate);
        // Without an installment reference, a late payment may legitimately use an earlier
        // contracted rate. Flag rates outside every agreed term, never a valid renegotiation.
        const contractedRates = [debt.monthlyRate, ...(debt.rateChanges ?? []).map(change => change.monthlyRate)];
        const matchesContract = contractedRates.some(value => { const agreed = rateFraction(value); return applied.numerator * agreed.denominator === agreed.numerator * applied.denominator; });
        if (!matchesContract) push(`rate:${payment.id}`, 'rate_difference', 'Tasa distinta a la pactada', debt.creditor, 'critical', 'Contabilidad', `Tasas contractuales ${contractedRates.join(' / ')} %; aplicada ${payment.appliedMonthlyRate} % mensual.`);
      }
    }
  }
  const backups = [...state.backups].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (backups[0]?.status === 'failed') push(`backup-failed:${backups[0].id}`, 'backup_failure', 'Respaldo fallido', 'El último proceso de respaldo falló.', 'critical', 'Administrador general', backups[0].error ?? backups[0].destination);
  const lastVerified = backups.find(run => run.status === 'success' && run.verified && run.completedAt);
  const cutoff = today === todayBogota() ? Date.now() : Date.parse(`${today}T23:59:59-05:00`);
  if (!lastVerified || cutoff - Date.parse(lastVerified.completedAt!) > 86400000) push('backup-stale', 'backup_stale', 'Respaldo verificado pendiente', 'Han pasado más de 24 horas sin un respaldo verificado, o todavía no existe uno.', 'critical', 'Administrador general', lastVerified ? `Último verificado: ${lastVerified.completedAt}` : 'No hay respaldos empresariales verificados.');
  if (!backups.some(run => run.status === 'success' && run.restoreVerifiedAt)) push('restore-unverified', 'restore_unverified', 'Restauración no verificada', 'Falta una prueba de recuperación en un ambiente aislado.', 'warning', 'Administrador general', 'Una copia no equivale a una restauración comprobada.');
  if(isCashEnabled(state))for(const alert of getCashAlerts(state,today))if(!results.some(row=>row.id===alert.id))results.push(alert);
  if(state.inventory)for(const row of getInventoryAlerts(state,today)){
    if(results.some(alert=>alert.id===row.id))continue;
    results.push({id:row.id,type:row.priority===2?'finished_product_shortage':'inventory_'+row.type,title:row.title,description:row.description,severity:row.severity,responsible:'Inventarios',status:row.status,dueDate:row.date,evidence:row.quantity?`Diferencia documentada: ${row.quantity}`:row.description,comments:[],history:row.history.map(event=>({date:event.date,actorName:state.members.find(member=>member.id===event.actorId)?.name??'Inventarios',action:event.action})),...(row.locationId?{locationId:row.locationId}:{})});
  }
  if(state.debtModule)for(const row of getDebtModuleAlerts(state,today)){if(results.some(alert=>alert.id===row.id))continue;results.push({id:row.id,type:'debts_'+row.type,title:row.title,description:row.description,severity:row.severity,responsible:'Administración / Deudas',status:row.status,dueDate:row.date,evidence:row.amount?`Importe documentado: ${row.amount} COP`:row.description,comments:[],history:row.history.map(event=>({date:event.date,actorName:state.members.find(member=>member.id===event.actorId)?.name??'Deudas',action:event.action})),locationId:row.locationId});}
  const persisted = new Map(state.alerts.map(alert => [alert.id, alert]));
  return results.map(alert => {
    const saved = persisted.get(alert.id);
    if (!saved) return alert;
    const reopened = saved.status === 'resolved' && alert.type !== 'possible_duplicate';
    return { ...saved, ...alert, comments: saved.comments, history: saved.history, status: reopened ? 'open' as const : saved.status, resolution: reopened ? undefined : saved.resolution };
  }).concat(state.alerts.filter(alert => !results.some(row => row.id === alert.id)));
}

export function getSummary(state: State, today = todayBogota()): Summary {
  const month = today.slice(0, 7);
  const cashReport=isCashEnabled(state)?getCashReport(state,{startDate:`${month}-01`,endDate:today}):undefined;
  const posted = state.transactions.filter(transaction => transaction.status === 'posted' && transaction.date.startsWith(month) && transaction.date <= today);
  const expenseKinds = ['expense', 'salary', 'reimbursement', 'personal_expense'];
  const payments = getActualDebtModulePayments(state,undefined,today);
  const netByKind = (kinds: string[]): Money => fromCents(posted.reduce((total, transaction) => {
    const source = transaction.reversalOf ? state.transactions.find(row => row.id === transaction.reversalOf) : transaction;
    return source && kinds.includes(source.kind) ? total + toCents(transaction.amount) * (transaction.reversalOf ? -1n : 1n) : total;
  }, 0n));
  return {
    available: cashReport?.closingAvailable??add(...state.accounts.filter(account => account.active && account.kind !== 'ledger').map(account => getAccountBalance(state, account.id))),
    income: cashReport?.externalInflows??netByKind(['income']),
    expenses: cashReport?.operatingExpenses??netByKind(expenseKinds),
    debt: add(...state.debts.map(debt => getDebtBalance(state, debt.id,today)),...getDebtModuleState(state).recurringBills.map(bill=>getRecurringBillBalance(state,bill.id,today))),
    interestPaid: add(...payments.map(payment => payment.interest)),
    principalPaid: add(...payments.map(payment => payment.principal)),
    pendingApprovals: state.transactions.filter(transaction => transaction.status === 'pending').length,
    pendingReconciliations: state.accounts.filter(account => account.active && account.kind !== 'ledger' && !state.reconciliations.some(row => row.accountId === account.id && row.status === 'matched' && dateDistance(row.date, today) <= 7)).length,
    alerts: deriveAlerts(state, today).filter(alert => alert.status !== 'resolved').length,
  };
}

export function recordAccess(state: State, actor: Actor, action: 'Inicio de sesión' | 'Cierre de sesión'): State {
  authorize(state, actor, Object.keys(ROLE_LABELS)); const next = copy(state); audit(next, actor, action, 'access', actor.id); return next;
}

export function getUpcomingObligations(state: State, today = todayBogota()): UpcomingObligation[] {
  validateDate(today);
  const results: UpcomingObligation[] = [];
  const officialCalendar=state.debtModule?getDebtCalendar(state,today):[];
  for (const debt of state.debts) {
    const modern=getDebtModuleState(state).obligations.some(row=>row.debtId===debt.id)||getDebtModuleState(state).officialPlans.some(row=>row.debtId===debt.id);
    if(modern){for(const item of officialCalendar.filter(row=>row.debtId===debt.id&&toCents(row.remaining)>0n)){const plan=getDebtModuleState(state).officialPlans.find(row=>row.id===item.planId);const installment=plan?.installments.find(row=>row.id===item.installmentId);const paidIds=new Set(getActualDebtModulePayments(state,debt.id,today).map(row=>row.id));const allocations=getDebtModuleState(state).installmentAllocations.filter(row=>row.installmentId===item.installmentId&&row.date<=today&&paidIds.has(row.debtPaymentId));const remainingComponent=(field:'principal'|'interest'|'insurance'|'commission'|'lateFee')=>{const expected=toCents(installment?.[field]??'0.00');const paid=allocations.reduce((sum,row)=>sum+toCents(row[field]),0n);return fromCents(expected>paid?expected-paid:0n);};const days=dateDistance(today,item.dueDate);results.push({debtId:debt.id,creditor:debt.creditor,period:installment?.number??1,date:item.dueDate,amount:item.remaining,interest:remainingComponent('interest'),principal:debt.kind==='supplier'?getDebtBalance(state,debt.id,today):remainingComponent('principal'),insurance:remainingComponent('insurance'),commission:remainingComponent('commission'),lateFee:remainingComponent('lateFee'),status:days<0?'overdue':days<=7?'upcoming':'future',projected:false});}continue;}
    if (toCents(getDebtBalance(state, debt.id)) <= 0n) continue;
    const payments = getEffectiveDebtPayments(state, debt.id);
    if(debt.kind==='supplier'){
      const date=debt.supplierDueDate!;const principal=getDebtBalance(state,debt.id);const days=dateDistance(today,date);
      results.push({debtId:debt.id,creditor:debt.creditor,period:1,date,amount:principal,principal,interest:'0.00',status:days<0?'overdue':days<=7?'upcoming':'future',projected:true});continue;
    }
    const paidPrincipal = payments.reduce((sum, payment) => sum + toCents(payment.principal), 0n) + getSupplierOffsets(state,debt.id).reduce((sum,row)=>sum+toCents(row.amount),0n);
    const paidInterest = payments.reduce((sum, payment) => sum + toCents(payment.interest), 0n);
    let expectedPrincipal = 0n;
    let expectedInterest = 0n;
    for (const row of buildAmortization(debt)) {
      expectedPrincipal += toCents(row.principal);
      expectedInterest += toCents(row.interest);
      const unpaidPrincipal = expectedPrincipal > paidPrincipal ? expectedPrincipal - paidPrincipal : 0n;
      const unpaidInterest = expectedInterest > paidInterest ? expectedInterest - paidInterest : 0n;
      if (unpaidPrincipal === 0n && unpaidInterest === 0n) continue;
      const principal = unpaidPrincipal < toCents(row.principal) ? unpaidPrincipal : toCents(row.principal);
      const interest = unpaidInterest < toCents(row.interest) ? unpaidInterest : toCents(row.interest);
      const amount = fromCents(principal + interest);
      const days = dateDistance(today, row.date);
      results.push({ debtId: debt.id, creditor: debt.creditor, period: row.period, date: row.date, amount, interest: fromCents(interest), principal: fromCents(principal), status: days < 0 ? 'overdue' : days <= 7 ? 'upcoming' : 'future', projected: true });
    }
  }
  return results.sort((a, b) => a.date.localeCompare(b.date));
}
