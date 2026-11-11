import { createDebt, todayBogota } from '../finance/engine';
import { validateDate } from '../finance/amortization';
import { validateCashSupport, hasCashSupport, getCashTransactionMetadata } from '../finance/cash';
import { quantity } from '../inventory/quantity';
import { add, fromCents, money, rateFraction, sub, toCents } from '../finance/money';
import type { Actor, Debt, Money, Support } from '../finance/types';
import type {
  DebtAuthorizationRequest,
  DebtCalendarEntry,
  DebtCategory,
  DebtComponentAmounts,
  DebtLinkedCashPayment,
  DebtModuleAlert,
  DebtModuleReport,
  DebtModuleState,
  DebtObligationMetadata,
  DebtReportInput,
  DebtReportMovement,
  DebtReportRow,
  DebtReportTotals,
  DebtSupplier,
  DebtWorkspace,
  OfficialDebtPlanInput,
  RecordDebtMetadataInput,
  RecurringDebtBill,
  RecurringDebtTemplate,
  RegisterDebtObligationInput,
  SupplierInvoiceMetadata,
} from './types';

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const FIELDS = ['principal', 'interest', 'insurance', 'commission', 'lateFee'] as const;
const WRITERS = ['owner', 'admin', 'treasury', 'accounting'];
export const DEBT_CATEGORY_LABELS: Record<DebtCategory, string> = {
  bank: 'Entidades financieras',
  investment: 'Inversionistas',
  supplier: 'Proveedores',
  recurring: 'Control de pagos',
};
export function createEmptyDebtModuleState(): DebtModuleState {
  return {
    version: 1,
    obligations: [],
    officialPlans: [],
    installmentAllocations: [],
    extraordinaryPayments: [],
    reconciliations: [],
    requests: [],
    suppliers: [],
    supplierInvoices: [],
    supplierPurchases: [],
    supplierReturns: [],
    cashPaymentLinks: [],
    recurringTemplates: [],
    recurringBills: [],
    recurringPayments: [],
    alerts: [],
    reviews: [],
    monthClosures: [],
  };
}
export function getDebtModuleState(state: DebtWorkspace): DebtModuleState {
  return state.debtModule ?? createEmptyDebtModuleState();
}
function copy(state: DebtWorkspace): DebtWorkspace & { debtModule: DebtModuleState } {
  const next = structuredClone(state);
  return Object.assign(next, { debtModule: structuredClone(getDebtModuleState(state)) });
}
function text(value: string, label: string, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > 2000)
    throw new Error(`${label} es obligatorio y admite hasta 2000 caracteres.`);
  return value.trim();
}
function actualDate(value: string): void {
  validateDate(value);
  if (value > todayBogota()) throw new Error('La fecha efectiva no puede ser futura.');
}
function document(value: Support): void {
  if (!value) throw new Error('Adjunta el documento fuente.');
  validateCashSupport(value);
  if (!value.dataUrl) throw new Error('El documento requiere el archivo original adjunto.');
}
function authorize(state: DebtWorkspace, actor: Actor, locationId?: string, allowed = WRITERS): void {
  const member = state.members.find(
    (row) => row.id === actor.id && row.name === actor.name && row.role === actor.role && row.active,
  );
  if (!member || !allowed.includes(member.role))
    throw new Error('No tienes permiso para esta operación de Deudas.');
  if (locationId && !member.locationIds.includes(locationId))
    throw new Error('No tienes permiso en esta sede.');
}
function audit(
  state: DebtWorkspace,
  actor: Actor,
  action: string,
  entityId: string,
  reason: string,
  before?: unknown,
  after?: unknown,
): void {
  const compact = (value: unknown) =>
    JSON.stringify(value, (key, item) =>
      key === 'dataUrl'
        ? '[archivo original conservado]'
        : key === 'report'
          ? '[informe versionado conservado]'
          : item,
    ).slice(0, 2000);
  state.audit.unshift({
    id: uuid(),
    action,
    entityType: 'debt_module',
    entityId,
    actorId: actor.id,
    actorName: actor.name,
    timestamp: now(),
    reason: reason.slice(0, 2000),
    before: before === undefined ? undefined : compact(before),
    after: after === undefined ? undefined : compact(after),
  });
}
function debt(state: DebtWorkspace, id: string): Debt {
  const result = state.debts.find((row) => row.id === id);
  if (!result) throw new Error('La obligación no existe.');
  return result;
}
function categoryFor(debt: Debt): Exclude<DebtCategory, 'recurring'> {
  return debt.kind === 'loan' ? 'bank' : debt.kind;
}
function sameParty(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase('es-CO') === right.trim().toLocaleLowerCase('es-CO');
}
export function debtMonthBounds(month: string): { startDate: string; endDate: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Selecciona un mes AAAA-MM.');
  validateDate(`${month}-01`);
  return {
    startDate: `${month}-01`,
    endDate: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10),
  };
}
export function assertDebtPeriodOpen(state: DebtWorkspace, date: string): void {
  actualDate(date);
  if (getDebtModuleState(state).monthClosures.some((row) => row.month >= date.slice(0, 7)))
    throw new Error(
      'El período de Deudas está cerrado. Solicita revisión institucional, sin alterar el informe histórico.',
    );
}
function components(input: Partial<DebtComponentAmounts>): DebtComponentAmounts {
  const result = {
    principal: money(input.principal ?? '0.00'),
    interest: money(input.interest ?? '0.00'),
    insurance: money(input.insurance ?? '0.00'),
    commission: money(input.commission ?? '0.00'),
    lateFee: money(input.lateFee ?? '0.00'),
  };
  if (FIELDS.some((field) => toCents(result[field]) < 0n))
    throw new Error('Los componentes no pueden ser negativos.');
  return result;
}
function componentTotal(value: DebtComponentAmounts): Money {
  return add(...FIELDS.map((field) => value[field]));
}
function effectiveTransaction(state: DebtWorkspace, transactionId: string, cutoff: string): boolean {
  const transaction = state.transactions.find((row) => row.id === transactionId);
  if (!transaction || transaction.status !== 'posted' || transaction.date > cutoff) return false;
  return !state.transactions.some(
    (row) => row.reversalOf === transaction.id && row.status === 'posted' && row.date <= cutoff,
  );
}

/** Capital source only: callers subtract cash principal and confirmed noncash credits once. */
export function getDebtCapitalBasis(state: DebtWorkspace, debtId: string, asOfDate = todayBogota()): Money {
  validateDate(asOfDate);
  const obligation = debt(state, debtId);
  const metadata = getDebtModuleState(state).obligations.find((row) => row.debtId === debtId);
  if (!metadata) return obligation.startDate <= asOfDate ? obligation.principal : '0.00';
  if (
    metadata.originDate > asOfDate ||
    (metadata.originMode !== 'cash_new' && (metadata.openingAsOfDate ?? metadata.originDate) > asOfDate)
  )
    return '0.00';
  if (metadata.originMode === 'historical_bank_request') return '0.00';
  if (metadata.originMode !== 'cash_new') return metadata.openingPrincipal;
  const ids = new Set(
    state.cash?.metadata
      .filter((row) =>
        row.externalReferences.some((reference) => reference.module === 'debts' && reference.id === debtId),
      )
      .map((row) => row.transactionId) ?? [],
  );
  const funding = add(
    ...state.transactions
      .filter(
        (row) => row.kind === 'loan' && ids.has(row.id) && effectiveTransaction(state, row.id, asOfDate),
      )
      .map((row) => row.amount),
  );
  if (toCents(funding) > toCents(obligation.principal))
    throw new Error('El desembolso confirmado supera el capital pactado de la obligación.');
  return funding;
}
export function getDebtLinkedCashPayments(
  state: DebtWorkspace,
  debtId?: string,
  asOfDate = todayBogota(),
): DebtLinkedCashPayment[] {
  validateDate(asOfDate);
  return getDebtModuleState(state).cashPaymentLinks.filter(
    (row) =>
      (!debtId || row.debtId === debtId) &&
      row.date <= asOfDate &&
      effectiveTransaction(state, row.transactionId, asOfDate),
  );
}
export function getActualDebtModulePayments(
  state: DebtWorkspace,
  debtId?: string,
  asOfDate = todayBogota(),
): (DebtLinkedCashPayment & { source: 'debt_payment' | 'cash_link' })[] {
  validateDate(asOfDate);
  return [
    ...state.debtPayments
      .filter(
        (row) =>
          (!debtId || row.debtId === debtId) &&
          row.status === 'posted' &&
          row.date <= asOfDate &&
          effectiveTransaction(state, row.transactionId, asOfDate),
      )
      .map((row) => ({
        ...row,
        ...components(row),
        reference: state.transactions.find((tx) => tx.id === row.transactionId)!.reference,
        recordedBy: state.transactions.find((tx) => tx.id === row.transactionId)!.requestedBy,
        createdAt: state.transactions.find((tx) => tx.id === row.transactionId)!.createdAt,
        source: 'debt_payment' as const,
      })),
    ...getDebtLinkedCashPayments(state, debtId, asOfDate).map((row) => ({
      ...row,
      source: 'cash_link' as const,
    })),
  ];
}
function acceptedReturns(state: DebtWorkspace, debtId: string, cutoff: string): Money {
  return add(
    ...getDebtModuleState(state)
      .supplierReturns.filter(
        (row) =>
          row.debtId === debtId &&
          row.status === 'accepted' &&
          row.acceptedDate &&
          row.acceptedDate <= cutoff,
      )
      .map((row) => row.acceptedAmount ?? '0.00'),
  );
}
export function getDebtModulePrincipalBalance(
  state: DebtWorkspace,
  debtId: string,
  cutoff = todayBogota(),
): Money {
  return sub(
    getDebtCapitalBasis(state, debtId, cutoff),
    add(
      ...getActualDebtModulePayments(state, debtId, cutoff).map((row) => row.principal),
      ...(state.inventory?.supplierOffsets ?? [])
        .filter((row) => row.debtId === debtId && row.date <= cutoff)
        .map((row) => row.amount),
      acceptedReturns(state, debtId, cutoff),
    ),
  );
}

export function recordDebtObligationMetadata(
  state: DebtWorkspace,
  input: RecordDebtMetadataInput,
  actor: Actor,
): DebtWorkspace {
  const obligation = debt(state, input.debtId);
  authorize(state, actor, obligation.locationId);
  assertDebtPeriodOpen(state, input.originDate);
  if (getDebtModuleState(state).obligations.some((row) => row.debtId === obligation.id))
    throw new Error('El ORIGEN ya está documentado. Las modificaciones requieren solicitud institucional.');
  document(input.support);
  text(input.concept, 'El concepto');
  text(input.documentReference, 'El documento origen');
  if (input.originDate !== obligation.startDate)
    throw new Error('La fecha de ORIGEN debe coincidir con la ficha de la obligación.');
  if (input.originMode.startsWith('historical_')) {
    if (!input.openingAsOfDate) throw new Error('Registra la fecha de corte del saldo de ORIGEN histórico.');
    actualDate(input.openingAsOfDate);
    if (input.openingAsOfDate < input.originDate)
      throw new Error('El corte del saldo no puede ser anterior al inicio de la obligación.');
    if (
      state.debtPayments.some(
        (row) =>
          row.debtId === obligation.id && row.status !== 'rejected' && row.date < input.openingAsOfDate!,
      ) ||
      getDebtModuleState(state).cashPaymentLinks.some(
        (row) => row.debtId === obligation.id && row.date < input.openingAsOfDate!,
      )
    )
      throw new Error(
        'Existen pagos anteriores al corte; solicita revisión institucional del ORIGEN para no volver a descontarlos.',
      );
  }
  const openingPrincipal = money(input.openingPrincipal);
  if (toCents(openingPrincipal) < 0n || toCents(openingPrincipal) > toCents(obligation.principal))
    throw new Error('El saldo inicial documentado no puede superar el capital original ni ser negativo.');
  if (input.terminationDate) {
    validateDate(input.terminationDate);
    if (input.terminationDate < input.originDate)
      throw new Error('La terminación no puede ser anterior al inicio.');
  }
  if (input.statedInterest !== undefined && toCents(money(input.statedInterest)) < 0n)
    throw new Error('El interés documentado no puede ser negativo.');
  if (obligation.kind === 'loan') {
    if (!['cash_new', 'historical_bank_request'].includes(input.originMode))
      throw new Error('La entidad requiere préstamo nuevo desde Caja o solicitud de ORIGEN autorizado.');
    document(input.bankStatement!);
    document(input.officialPlanSupport!);
    if (!input.terminationDate) throw new Error('Registra la fecha de terminación del préstamo.');
  } else if (obligation.kind === 'investment') {
    if (!['cash_new', 'historical_investment'].includes(input.originMode))
      throw new Error('El ORIGEN de inversión es inválido.');
    document(input.contract ?? obligation.contract!);
    if (input.originMode === 'historical_investment') document(input.initialReceipt!);
    text(input.interestRule ?? '', 'La regla contractual de intereses');
  } else if (!['historical_supplier', 'credit_purchase'].includes(input.originMode))
    throw new Error('La factura debe identificar ORIGEN de proveedor o compra a crédito.');
  const next = copy(state);
  const record: DebtObligationMetadata = {
    ...input,
    openingPrincipal,
    statedInterest: input.statedInterest === undefined ? undefined : money(input.statedInterest),
    category: categoryFor(obligation),
    status:
      input.originMode === 'historical_bank_request'
        ? 'pending_institutional'
        : input.originMode === 'cash_new'
          ? 'draft_funding'
          : 'documented',
    createdBy: actor.id,
    createdAt: now(),
  };
  next.debtModule.obligations.push(record);
  audit(
    next,
    actor,
    'ORIGEN de obligación documentado sin crear dinero',
    obligation.id,
    input.documentReference,
    undefined,
    record,
  );
  if (input.originMode === 'historical_bank_request')
    return requestDebtAuthorization(
      next,
      {
        debtId: obligation.id,
        kind: 'bank_origin',
        effectiveDate: input.originDate,
        reason: 'Solicitud de autorización institucional del ORIGEN bancario documentado',
        support: input.support,
      },
      actor,
    );
  return next;
}
export function registerDebtObligation(
  state: DebtWorkspace,
  input: RegisterDebtObligationInput,
  actor: Actor,
): DebtWorkspace {
  authorize(state, actor, input.locationId);
  assertDebtPeriodOpen(state, input.startDate);
  const before = new Set(state.debts.map((row) => row.id));
  const {
    originMode,
    openingPrincipal,
    openingAsOfDate,
    concept,
    documentReference,
    terminationDate,
    interestRule,
    statedInterest,
    bankStatement,
    officialPlanSupport,
    initialReceipt,
    support,
    supplierId,
    ...baseInput
  } = input;
  const next = createDebt(state, baseInput, actor);
  const obligation = next.debts.find((row) => !before.has(row.id))!;
  return recordDebtObligationMetadata(
    next,
    {
      debtId: obligation.id,
      originMode: input.originMode,
      concept: input.concept,
      documentReference: input.documentReference,
      originDate: input.startDate,
      openingAsOfDate: input.openingAsOfDate,
      openingPrincipal: input.openingPrincipal ?? input.principal,
      terminationDate: input.terminationDate,
      interestRule: input.interestRule,
      statedInterest: input.statedInterest,
      bankStatement: input.bankStatement,
      officialPlanSupport: input.officialPlanSupport,
      contract: input.contract,
      initialReceipt: input.initialReceipt,
      support: input.support,
      supplierId: input.supplierId,
    },
    actor,
  );
}

export function createDebtSupplier(
  state: DebtWorkspace,
  input: Omit<DebtSupplier, 'id' | 'createdBy' | 'createdAt'>,
  actor: Actor,
): DebtWorkspace {
  authorize(state, actor, input.locationId);
  if (!state.locations.some((row) => row.id === input.locationId)) throw new Error('La sede no existe.');
  const identification = text(input.identification, 'La identificación')
    .replace(/\s/g, '')
    .toLocaleUpperCase('es-CO');
  const name = text(input.name, 'El nombre legal');
  if (typeof input.active !== 'boolean') throw new Error('El estado del proveedor es inválido.');
  if (
    getDebtModuleState(state).suppliers.some(
      (row) =>
        row.identification.replace(/\s/g, '').toLocaleUpperCase('es-CO') === identification ||
        sameParty(row.name, name),
    )
  )
    throw new Error('El proveedor ya existe en el directorio único.');
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
    throw new Error('El correo no es válido.');
  const next = copy(state);
  const record = { ...input, identification, name, id: uuid(), createdBy: actor.id, createdAt: now() };
  next.debtModule.suppliers.push(record);
  audit(
    next,
    actor,
    'Proveedor registrado en directorio único',
    record.id,
    identification,
    undefined,
    record,
  );
  return next;
}
export const createSupplier = createDebtSupplier;
export function registerSupplierInvoice(
  state: DebtWorkspace,
  input: Omit<
    SupplierInvoiceMetadata,
    'amount' | 'createdBy' | 'createdAt' | 'lines' | 'inventoryMovementIds'
  > & { lines?: SupplierInvoiceMetadata['lines']; inventoryMovementIds?: string[] },
  actor: Actor,
): DebtWorkspace {
  const obligation = debt(state, input.debtId);
  const supplier = getDebtModuleState(state).suppliers.find(
    (row) => row.id === input.supplierId && row.active,
  );
  if (
    obligation.kind !== 'supplier' ||
    !supplier ||
    !sameParty(obligation.creditor, supplier.name) ||
    obligation.locationId !== supplier.locationId
  )
    throw new Error('La obligación y el proveedor deben coincidir en tercero y sede.');
  authorize(state, actor, supplier.locationId);
  assertDebtPeriodOpen(state, input.date);
  validateDate(input.dueDate);
  if (
    input.dueDate < input.date ||
    input.dueDate !== obligation.supplierDueDate ||
    input.date !== obligation.startDate
  )
    throw new Error('La factura requiere fecha y vencimiento manual coincidentes con la obligación.');
  text(input.invoiceReference, 'La factura');
  document(input.support);
  if (
    getDebtModuleState(state).supplierInvoices.some(
      (row) =>
        row.debtId === input.debtId ||
        (row.supplierId === supplier.id && row.invoiceReference === input.invoiceReference),
    )
  )
    throw new Error('La factura del proveedor ya existe.');
  const next = copy(state);
  const record = {
    ...input,
    amount: obligation.principal,
    lines: input.lines ?? [],
    inventoryMovementIds: input.inventoryMovementIds ?? [],
    createdBy: actor.id,
    createdAt: now(),
  };
  next.debtModule.supplierInvoices.push(record);
  audit(
    next,
    actor,
    'Factura vinculada al proveedor; sin duplicar obligación ni egreso',
    obligation.id,
    input.invoiceReference,
    undefined,
    record,
  );
  if (!next.debtModule.obligations.some((row) => row.debtId === obligation.id))
    return recordDebtObligationMetadata(
      next,
      {
        debtId: obligation.id,
        originMode: input.source === 'historical' ? 'historical_supplier' : 'credit_purchase',
        concept: obligation.notes ?? `Factura ${input.invoiceReference}`,
        documentReference: input.invoiceReference,
        originDate: input.date,
        openingAsOfDate: input.date,
        openingPrincipal: obligation.principal,
        support: input.support,
        supplierId: supplier.id,
      },
      actor,
    );
  return next;
}

export function recordOfficialDebtPlan(
  state: DebtWorkspace,
  input: OfficialDebtPlanInput,
  actor: Actor,
): DebtWorkspace {
  const obligation = debt(state, input.debtId);
  if (obligation.kind === 'supplier')
    throw new Error('Las facturas de proveedor usan su vencimiento manual, no un plan de cuotas bancario.');
  authorize(state, actor, obligation.locationId);
  assertDebtPeriodOpen(state, input.effectiveDate);
  document(input.support);
  text(input.reference, 'La referencia del plan oficial');
  text(input.reason, 'La justificación de la versión', 5);
  if (input.effectiveDate < obligation.startDate) throw new Error('El plan no puede ser anterior al ORIGEN.');
  if (!Array.isArray(input.installments) || !input.installments.length || input.installments.length > 600)
    throw new Error('El plan debe incluir entre 1 y 600 cuotas reales del documento.');
  const existing = getDebtModuleState(state).officialPlans.filter((row) => row.debtId === obligation.id);
  if (obligation.kind === 'investment' && existing.length)
    throw new Error(
      'Un nuevo calendario de inversionista requiere solicitud de renegociación institucional; se conserva el acuerdo vigente.',
    );
  if (existing.some((row) => row.reference === input.reference))
    throw new Error('Este documento oficial ya fue registrado.');
  if (existing.some((row) => row.effectiveDate > input.effectiveDate))
    throw new Error('La versión del plan no puede retroceder su vigencia.');
  const numbers = new Set<number>();
  let principal = 0n;
  const installments = input.installments.map((row) => {
    if (!Number.isSafeInteger(row.number) || row.number < 1 || numbers.has(row.number))
      throw new Error('Los números de cuota deben ser positivos y únicos.');
    numbers.add(row.number);
    validateDate(row.dueDate);
    if (row.dueDate < obligation.startDate) throw new Error('La cuota no puede vencer antes del ORIGEN.');
    const amounts = components(row);
    const amount = money(row.amount);
    if (componentTotal(amounts) !== amount || toCents(amount) <= 0n)
      throw new Error('Los cinco componentes deben sumar el valor de cada cuota oficial.');
    principal += toCents(amounts.principal);
    return { ...row, ...amounts, amount, id: uuid(), notes: row.notes?.trim() ?? '' };
  });
  if (principal > toCents(obligation.principal))
    throw new Error('El capital programado supera el capital documentado.');
  const next = copy(state);
  const record = {
    ...input,
    installments,
    id: uuid(),
    version: existing.length + 1,
    replacesPlanId: existing.at(-1)?.id,
    recordedBy: actor.id,
    recordedAt: now(),
  };
  next.debtModule.officialPlans.push(record);
  audit(
    next,
    actor,
    'Plan oficial documentado y versionado; sin sustituirlo por simulación',
    record.id,
    input.reference,
    existing.at(-1),
    {
      debtId: record.debtId,
      version: record.version,
      reference: record.reference,
      installments: record.installments.length,
    },
  );
  return next;
}

export function requestDebtAuthorization(
  state: DebtWorkspace,
  input: Omit<
    DebtAuthorizationRequest,
    'id' | 'before' | 'status' | 'requiredAuthority' | 'requestedBy' | 'createdAt'
  >,
  actor: Actor,
): DebtWorkspace {
  const obligation = input.debtId ? debt(state, input.debtId) : undefined;
  const bill = input.billId
    ? getDebtModuleState(state).recurringBills.find((row) => row.id === input.billId)
    : undefined;
  if (Boolean(obligation) === Boolean(bill) || (input.billId && !bill))
    throw new Error('Vincula una sola obligación o factura recurrente a la solicitud.');
  const locationId =
    obligation?.locationId ??
    getDebtModuleState(state).recurringTemplates.find((row) => row.id === bill!.templateId)!.locationId;
  authorize(state, actor, locationId);
  if (
    ![
      'bank_origin',
      'investment_renegotiation',
      'correction',
      'exceptional_adjustment',
      'closed_period_change',
    ].includes(input.kind)
  )
    throw new Error('El tipo de autorización es inválido.');
  if (input.kind === 'bank_origin' && obligation?.kind !== 'loan')
    throw new Error('El ORIGEN bancario debe corresponder a una entidad financiera.');
  if (input.kind === 'investment_renegotiation' && obligation?.kind !== 'investment')
    throw new Error('La renegociación debe corresponder a un inversionista.');
  text(input.reason, 'La justificación', 5);
  validateDate(input.effectiveDate);
  document(input.support);
  if (input.proposedPrincipal !== undefined && toCents(money(input.proposedPrincipal)) < 0n)
    throw new Error('El capital propuesto no puede ser negativo.');
  if (input.proposedMonthlyRate !== undefined) rateFraction(input.proposedMonthlyRate);
  if (input.proposedTerminationDate !== undefined) validateDate(input.proposedTerminationDate);
  const next = copy(state);
  const record = {
    ...input,
    proposedPrincipal: input.proposedPrincipal === undefined ? undefined : money(input.proposedPrincipal),
    id: uuid(),
    before: JSON.stringify(obligation ?? bill, (key, value) =>
      key === 'dataUrl' ? '[documento original conservado]' : value,
    ).slice(0, 2000),
    status: 'pending_institutional' as const,
    requiredAuthority:
      input.kind === 'bank_origin' || input.kind === 'investment_renegotiation'
        ? ('creator_or_manager' as const)
        : ('not_defined' as const),
    requestedBy: actor.id,
    createdAt: now(),
  };
  next.debtModule.requests.push(record);
  audit(
    next,
    actor,
    'Autorización de Deudas solicitada; sin modificar capital, contrato ni historial',
    record.id,
    input.reason,
    obligation ?? bill,
    record,
  );
  return next;
}

export function linkDebtCashPayment(
  state: DebtWorkspace,
  input: {
    debtId: string;
    transactionId: string;
    amount: Money;
    principal: Money;
    interest?: Money;
    insurance?: Money;
    commission?: Money;
    lateFee?: Money;
    reference?: string;
    idempotencyKey: string;
  },
  actor: Actor,
): DebtWorkspace {
  const obligation = debt(state, input.debtId);
  authorize(state, actor, obligation.locationId);
  const key = text(input.idempotencyKey, 'La clave de aplicación', 8);
  const amounts = components(input);
  const amount = money(input.amount);
  if (toCents(amount) <= 0n || componentTotal(amounts) !== amount)
    throw new Error('Los cinco componentes deben sumar el importe aplicado.');
  const module = getDebtModuleState(state);
  const previous = module.cashPaymentLinks.find((row) => row.id === key);
  if (previous) {
    if (
      previous.debtId === input.debtId &&
      previous.transactionId === input.transactionId &&
      previous.amount === amount &&
      FIELDS.every((field) => previous[field] === amounts[field]) &&
      previous.reference ===
        (input.reference?.trim() ??
          state.transactions.find((row) => row.id === input.transactionId)?.reference)
    )
      return state;
    throw new Error('La clave de aplicación ya fue usada con otros datos.');
  }
  const cash = state.transactions.find(
    (row) =>
      row.id === input.transactionId &&
      row.kind === 'expense' &&
      effectiveTransaction(state, row.id, todayBogota()),
  );
  if (
    !cash ||
    cash.locationId !== obligation.locationId ||
    !sameParty(cash.party, obligation.creditor) ||
    cash.date < obligation.startDate
  )
    throw new Error('Selecciona un egreso real, vigente, del mismo acreedor y sede, posterior al ORIGEN.');
  assertDebtPeriodOpen(state, cash.date);
  if (
    getDebtModuleState(state).obligations.some((row) => row.debtId === obligation.id) &&
    getDebtCapitalBasis(state, obligation.id, cash.date) === '0.00'
  )
    throw new Error('El ORIGEN o desembolso de la obligación no está confirmado en la fecha del pago.');
  if (
    !hasCashSupport(state, cash) ||
    getCashTransactionMetadata(state, cash.id).businessStatus !== 'business'
  )
    throw new Error('El egreso necesita comprobante y clasificación empresarial.');
  if (state.debtPayments.some((row) => row.transactionId === cash.id && row.status !== 'rejected'))
    throw new Error('Ese comprobante ya tiene un pago de obligación registrado.');
  const allocated = add(
    ...module.cashPaymentLinks.filter((row) => row.transactionId === cash.id).map((row) => row.amount),
    ...module.recurringPayments.filter((row) => row.transactionId === cash.id).map((row) => row.amount),
  );
  if (toCents(allocated) + toCents(amount) > toCents(cash.amount))
    throw new Error('Las aplicaciones superan el egreso real disponible.');
  const reserved = state.debtPayments
    .filter((row) => row.debtId === obligation.id && row.status === 'pending')
    .reduce((sum, row) => sum + toCents(row.principal), 0n);
  if (
    toCents(amounts.principal) > toCents(getDebtModulePrincipalBalance(state, obligation.id)) - reserved ||
    toCents(amounts.principal) > toCents(getDebtModulePrincipalBalance(state, obligation.id, cash.date))
  )
    throw new Error(
      'El capital aplicado supera el saldo confirmado disponible en la fecha y tras pagos pendientes.',
    );
  const next = copy(state);
  const record = {
    id: key,
    debtId: obligation.id,
    transactionId: cash.id,
    date: cash.date,
    amount,
    ...amounts,
    reference: input.reference?.trim() ?? cash.reference,
    recordedBy: actor.id,
    createdAt: now(),
  };
  next.debtModule.cashPaymentLinks.push(record);
  audit(
    next,
    actor,
    'Egreso existente aplicado a obligación sin duplicar Caja',
    record.id,
    record.reference,
    undefined,
    record,
  );
  return next;
}
export function allocateDebtPayment(
  state: DebtWorkspace,
  input: DebtComponentAmounts & {
    debtPaymentId: string;
    planId: string;
    installmentId: string;
    reference: string;
  },
  actor: Actor,
): DebtWorkspace {
  const module = getDebtModuleState(state);
  const plan = module.officialPlans.find((row) => row.id === input.planId);
  const installment = plan?.installments.find((row) => row.id === input.installmentId);
  const payment = getActualDebtModulePayments(state).find((row) => row.id === input.debtPaymentId);
  if (module.extraordinaryPayments.some((row) => row.debtPaymentId === input.debtPaymentId))
    throw new Error('El pago ya está identificado como abono extraordinario, no como cuota ordinaria.');
  if (!plan || !installment || !payment || payment.debtId !== plan.debtId)
    throw new Error('El pago real, la cuota y el plan deben pertenecer a la misma obligación.');
  authorize(state, actor, debt(state, plan.debtId).locationId);
  assertDebtPeriodOpen(state, payment.date);
  text(input.reference, 'La referencia de aplicación');
  const amounts = components(input);
  if (toCents(componentTotal(amounts)) <= 0n) throw new Error('Aplica al menos un componente del pago.');
  const duplicate = module.installmentAllocations.find(
    (row) => row.debtPaymentId === payment.id && row.reference === input.reference,
  );
  if (duplicate) {
    if (
      duplicate.planId === plan.id &&
      duplicate.installmentId === installment.id &&
      FIELDS.every((field) => duplicate[field] === amounts[field])
    )
      return state;
    throw new Error('La referencia ya se utilizó para otra distribución.');
  }
  for (const field of FIELDS) {
    const assigned = module.installmentAllocations
      .filter((row) => row.debtPaymentId === payment.id)
      .reduce((sum, row) => sum + toCents(row[field]), 0n);
    if (assigned + toCents(amounts[field]) > toCents(payment[field]))
      throw new Error(`La aplicación de ${field} supera ese componente del pago real.`);
    const appliedToInstallment = module.installmentAllocations
      .filter((row) => row.planId === plan.id && row.installmentId === installment.id)
      .reduce((sum, row) => sum + toCents(row[field]), 0n);
    if (appliedToInstallment + toCents(amounts[field]) > toCents(installment[field])) {
      throw new Error('El componente aplicado supera el saldo de la cuota oficial.');
    }
  }
  const next = copy(state);
  const record = {
    ...input,
    ...amounts,
    id: uuid(),
    date: payment.date,
    recordedBy: actor.id,
    recordedAt: now(),
  };
  next.debtModule.installmentAllocations.push(record);
  audit(
    next,
    actor,
    'Pago real distribuido a cuota oficial sin nuevo movimiento',
    record.id,
    input.reference,
    undefined,
    record,
  );
  return next;
}
export function reconcileDebtStatement(
  state: DebtWorkspace,
  input: {
    debtId: string;
    date: string;
    reference: string;
    statementPrincipal: Money;
    support: Support;
    notes?: string;
  },
  actor: Actor,
): DebtWorkspace {
  const obligation = debt(state, input.debtId);
  authorize(state, actor, obligation.locationId);
  actualDate(input.date);
  text(input.reference, 'La referencia del extracto');
  document(input.support);
  const statementPrincipal = money(input.statementPrincipal);
  if (toCents(statementPrincipal) < 0n) throw new Error('El capital del extracto no puede ser negativo.');
  const bookPrincipal = getDebtModulePrincipalBalance(state, obligation.id, input.date);
  const difference = sub(statementPrincipal, bookPrincipal);
  const next = copy(state);
  const record = {
    ...input,
    id: uuid(),
    statementPrincipal,
    bookPrincipal,
    difference,
    notes: input.notes?.trim() ?? '',
    status: difference === '0.00' ? ('matched' as const) : ('difference' as const),
    recordedBy: actor.id,
    recordedAt: now(),
  };
  next.debtModule.reconciliations.push(record);
  audit(
    next,
    actor,
    'Extracto conciliado contra capital real sin modificar saldos',
    record.id,
    input.reference,
    undefined,
    record,
  );
  return next;
}

export function createRecurringDebtTemplate(
  state: DebtWorkspace,
  input: Omit<RecurringDebtTemplate, 'id' | 'createdBy' | 'createdAt'>,
  actor: Actor,
): DebtWorkspace {
  authorize(state, actor, input.locationId, ['owner', 'admin']);
  if (!state.locations.some((row) => row.id === input.locationId)) throw new Error('La sede no existe.');
  text(input.name, 'El nombre del compromiso');
  text(input.creditor, 'El acreedor');
  text(input.concept, 'El concepto');
  if (input.frequency !== 'monthly' || typeof input.active !== 'boolean')
    throw new Error('La plantilla debe ser mensual y tener estado explícito.');
  if (
    input.dueDay !== undefined &&
    (!Number.isSafeInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31)
  )
    throw new Error('El día orientativo debe estar entre 1 y 31; cada recibo confirma su vencimiento real.');
  if (input.consumptionUnit !== undefined) text(input.consumptionUnit, 'La unidad de consumo');
  if (
    getDebtModuleState(state).recurringTemplates.some(
      (row) =>
        row.locationId === input.locationId &&
        sameParty(row.creditor, input.creditor) &&
        sameParty(row.name, input.name),
    )
  )
    throw new Error('La plantilla recurrente ya existe.');
  if ((input as unknown as { debtId?: string }).debtId)
    throw new Error(
      'Los créditos y acuerdos de inversionistas se muestran desde sus planes; no dupliques una plantilla.',
    );
  const next = copy(state);
  const record = { ...input, id: uuid(), createdBy: actor.id, createdAt: now() };
  next.debtModule.recurringTemplates.push(record);
  audit(
    next,
    actor,
    'Compromiso operativo recurrente creado sin facturas ni pagos ficticios',
    record.id,
    input.name,
    undefined,
    record,
  );
  return next;
}
export function registerRecurringDebtBill(
  state: DebtWorkspace,
  input: Omit<RecurringDebtBill, 'id' | 'receivedBy' | 'createdAt'>,
  actor: Actor,
): DebtWorkspace {
  const module = getDebtModuleState(state);
  const template = module.recurringTemplates.find((row) => row.id === input.templateId && row.active);
  if (!template) throw new Error('La plantilla no existe o está inactiva.');
  authorize(state, actor, template.locationId, ['owner', 'admin']);
  debtMonthBounds(input.month);
  assertDebtPeriodOpen(state, `${input.month}-01`);
  actualDate(input.invoiceDate);
  actualDate(input.receivedDate);
  validateDate(input.dueDate);
  if (input.dueDate < input.invoiceDate || input.receivedDate < input.invoiceDate)
    throw new Error('Recepción y vencimiento no pueden ser anteriores a la factura.');
  text(input.reference, 'La factura o recibo');
  document(input.support);
  const amount = money(input.amount);
  if (toCents(amount) <= 0n) throw new Error('El valor cobrado debe ser positivo.');
  if (
    module.recurringBills.some(
      (row) =>
        (row.templateId === template.id && row.month === input.month) ||
        (row.reference === input.reference &&
          sameParty(
            module.recurringTemplates.find((item) => item.id === row.templateId)!.creditor,
            template.creditor,
          )),
    )
  )
    throw new Error('El recibo del período o documento del acreedor ya existe.');
  if (
    state.debts.some(
      (row) =>
        sameParty(row.creditor, template.creditor) &&
        (row.supplierInvoice === input.reference ||
          module.obligations.some(
            (meta) => meta.debtId === row.id && meta.documentReference === input.reference,
          )),
    )
  )
    throw new Error(
      'El documento ya pertenece a una obligación; consulta su agenda sin duplicarlo como recibo.',
    );
  let consumption: string | undefined;
  if (input.consumption !== undefined) {
    consumption = quantity(input.consumption);
    if (consumption.startsWith('-')) throw new Error('El consumo real no puede ser negativo.');
    text(input.consumptionUnit ?? '', 'La unidad del consumo');
  } else if (input.consumptionUnit !== undefined)
    throw new Error('La unidad requiere un consumo informado, sin convertir ausentes en cero.');
  const next = copy(state);
  const record = { ...input, amount, consumption, id: uuid(), receivedBy: actor.id, createdAt: now() };
  next.debtModule.recurringBills.push(record);
  audit(
    next,
    actor,
    'Factura recurrente recibida y reconocida; aún no pagada',
    record.id,
    input.reference,
    undefined,
    record,
  );
  return next;
}
export function getRecurringBillBalance(
  state: DebtWorkspace,
  billId: string,
  asOfDate = todayBogota(),
): Money {
  validateDate(asOfDate);
  const module = getDebtModuleState(state);
  const bill = module.recurringBills.find((row) => row.id === billId);
  if (!bill) throw new Error('La factura recurrente no existe.');
  if (bill.invoiceDate > asOfDate) return '0.00';
  return sub(
    bill.amount,
    add(
      ...module.recurringPayments
        .filter(
          (row) =>
            row.billId === billId &&
            row.date <= asOfDate &&
            effectiveTransaction(state, row.transactionId, asOfDate),
        )
        .map((row) => row.amount),
    ),
  );
}
export function linkRecurringDebtPayment(
  state: DebtWorkspace,
  input: { billId: string; transactionId: string; amount: Money; idempotencyKey: string },
  actor: Actor,
): DebtWorkspace {
  const module = getDebtModuleState(state);
  const bill = module.recurringBills.find((row) => row.id === input.billId);
  const template = module.recurringTemplates.find((row) => row.id === bill?.templateId);
  if (!bill || !template) throw new Error('La factura recurrente no existe.');
  authorize(state, actor, template.locationId);
  const amount = money(input.amount);
  const key = text(input.idempotencyKey, 'La clave de aplicación', 8);
  const duplicate = module.recurringPayments.find((row) => row.id === key);
  if (duplicate) {
    if (
      duplicate.billId === bill.id &&
      duplicate.transactionId === input.transactionId &&
      duplicate.amount === amount
    )
      return state;
    throw new Error('La clave ya fue usada para otro pago recurrente.');
  }
  const cash = state.transactions.find(
    (row) =>
      row.id === input.transactionId &&
      row.kind === 'expense' &&
      effectiveTransaction(state, row.id, todayBogota()),
  );
  if (
    !cash ||
    cash.locationId !== template.locationId ||
    !sameParty(cash.party, template.creditor) ||
    cash.date < bill.invoiceDate
  )
    throw new Error('El egreso real debe corresponder al acreedor, sede y fecha de la factura.');
  assertDebtPeriodOpen(state, cash.date);
  if (
    !hasCashSupport(state, cash) ||
    getCashTransactionMetadata(state, cash.id).businessStatus !== 'business'
  )
    throw new Error('El pago requiere comprobante y dinero empresarial identificado.');
  const assigned = add(
    ...module.recurringPayments.filter((row) => row.transactionId === cash.id).map((row) => row.amount),
    ...module.cashPaymentLinks.filter((row) => row.transactionId === cash.id).map((row) => row.amount),
  );
  if (
    toCents(amount) <= 0n ||
    toCents(amount) > toCents(getRecurringBillBalance(state, bill.id)) ||
    toCents(assigned) + toCents(amount) > toCents(cash.amount)
  )
    throw new Error('El abono supera el saldo de la factura o el egreso disponible.');
  const next = copy(state);
  const record = {
    id: key,
    billId: bill.id,
    transactionId: cash.id,
    date: cash.date,
    amount,
    recordedBy: actor.id,
    createdAt: now(),
  };
  next.debtModule.recurringPayments.push(record);
  audit(
    next,
    actor,
    'Pago real vinculado al recibo original sin repetir el egreso',
    record.id,
    cash.reference,
    undefined,
    record,
  );
  return next;
}

function withinDays(left: string, right: string): number {
  return Math.floor((Date.parse(`${right}T12:00:00Z`) - Date.parse(`${left}T12:00:00Z`)) / 86400000);
}
export function documentExtraordinaryDebtPayment(
  state: DebtWorkspace,
  input: { debtPaymentId: string; reference: string; support: Support; notes: string },
  actor: Actor,
): DebtWorkspace {
  const payment = getActualDebtModulePayments(state).find((row) => row.id === input.debtPaymentId);
  if (!payment || payment.amount !== payment.principal || toCents(payment.principal) <= 0n)
    throw new Error('El abono extraordinario debe ser un pago real compuesto exclusivamente de capital.');
  const obligation = debt(state, payment.debtId);
  authorize(state, actor, obligation.locationId);
  assertDebtPeriodOpen(state, payment.date);
  document(input.support);
  text(input.reference, 'La referencia del abono extraordinario');
  text(input.notes, 'La explicación documental', 5);
  const module = getDebtModuleState(state);
  if (
    module.extraordinaryPayments.some((row) => row.debtPaymentId === payment.id) ||
    module.installmentAllocations.some((row) => row.debtPaymentId === payment.id)
  )
    throw new Error('El pago ya está clasificado o aplicado; no se duplica su identificación.');
  const next = copy(state);
  const record = { ...input, id: uuid(), date: payment.date, recordedBy: actor.id, recordedAt: now() };
  next.debtModule.extraordinaryPayments.push(record);
  audit(
    next,
    actor,
    'Abono extraordinario identificado sin inventar nuevas cuotas',
    record.id,
    input.reference,
    undefined,
    { debtPaymentId: payment.id, principal: payment.principal, reference: input.reference },
  );
  return next;
}
function calendarStatus(
  remaining: Money,
  paid: Money,
  dueDate: string,
  today: string,
): DebtCalendarEntry['status'] {
  return remaining === '0.00'
    ? 'paid'
    : dueDate < today
      ? 'overdue'
      : toCents(paid) > 0n
        ? 'partially_paid'
        : withinDays(today, dueDate) <= 7
          ? 'upcoming'
          : 'future';
}
export function getDebtCalendar(
  state: DebtWorkspace,
  today = todayBogota(),
  filter: { category?: DebtCategory; locationId?: string } = {},
): DebtCalendarEntry[] {
  validateDate(today);
  const module = getDebtModuleState(state);
  const result: DebtCalendarEntry[] = [];
  const actualIds = new Set(getActualDebtModulePayments(state, undefined, today).map((row) => row.id));
  for (const obligation of state.debts.filter(
    (row) => row.startDate <= today && (!filter.locationId || row.locationId === filter.locationId),
  )) {
    const category = categoryFor(obligation);
    if (filter.category && filter.category !== category) continue;
    if (getDebtCapitalBasis(state, obligation.id, today) === '0.00') continue;
    if (obligation.kind === 'supplier') {
      const amount = getDebtCapitalBasis(state, obligation.id, today);
      const remaining = getDebtModulePrincipalBalance(state, obligation.id, today);
      const paidAmount = sub(amount, remaining);
      result.push({
        id: `supplier:${obligation.id}`,
        source: 'supplier_invoice',
        category,
        debtId: obligation.id,
        creditor: obligation.creditor,
        concept: obligation.supplierInvoice ?? 'Factura de proveedor',
        locationId: obligation.locationId,
        dueDate: obligation.supplierDueDate!,
        amount,
        paidAmount,
        remaining,
        status: calendarStatus(remaining, paidAmount, obligation.supplierDueDate!, today),
        official: true,
      });
      continue;
    }
    const plan = module.officialPlans
      .filter((row) => row.debtId === obligation.id && row.effectiveDate <= today)
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.version - b.version)
      .at(-1);
    if (!plan) continue;
    for (const installment of plan.installments) {
      const allocations = module.installmentAllocations.filter(
        (row) =>
          row.planId === plan.id &&
          row.installmentId === installment.id &&
          row.date <= today &&
          actualIds.has(row.debtPaymentId),
      );
      let remaining = 0n;
      for (const field of FIELDS) {
        const assigned = allocations.reduce((sum, row) => sum + toCents(row[field]), 0n);
        const expected = toCents(installment[field]);
        remaining += assigned < expected ? expected - assigned : 0n;
      }
      const pending = fromCents(remaining);
      const paidAmount = sub(installment.amount, pending);
      result.push({
        id: `installment:${installment.id}`,
        source: 'official_installment',
        category,
        debtId: obligation.id,
        planId: plan.id,
        installmentId: installment.id,
        creditor: obligation.creditor,
        concept: `Cuota oficial ${installment.number} · ${plan.reference}`,
        locationId: obligation.locationId,
        dueDate: installment.dueDate,
        amount: installment.amount,
        paidAmount,
        remaining: pending,
        status: calendarStatus(pending, paidAmount, installment.dueDate, today),
        official: true,
      });
    }
  }
  if (!filter.category || filter.category === 'recurring')
    for (const bill of module.recurringBills.filter((row) => row.invoiceDate <= today)) {
      const template = module.recurringTemplates.find((row) => row.id === bill.templateId)!;
      if (filter.locationId && template.locationId !== filter.locationId) continue;
      const remaining = getRecurringBillBalance(state, bill.id, today);
      const paidAmount = sub(bill.amount, remaining);
      result.push({
        id: `bill:${bill.id}`,
        source: 'recurring_bill',
        category: 'recurring',
        billId: bill.id,
        creditor: template.creditor,
        concept: `${template.name} · ${bill.reference}`,
        locationId: template.locationId,
        dueDate: bill.dueDate,
        amount: bill.amount,
        paidAmount,
        remaining,
        status: calendarStatus(remaining, paidAmount, bill.dueDate, today),
        official: true,
      });
    }
  return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
}

export function getDebtModuleAlerts(state: DebtWorkspace, today = todayBogota()): DebtModuleAlert[] {
  validateDate(today);
  const module = getDebtModuleState(state);
  const result: DebtModuleAlert[] = [];
  const push = (input: Omit<DebtModuleAlert, 'status' | 'history'>) =>
    result.push({ ...input, status: 'open', history: [] });
  for (const obligation of state.debts) {
    const metadata = module.obligations.find((row) => row.debtId === obligation.id);
    const effective = metadata?.openingAsOfDate ?? metadata?.originDate ?? obligation.startDate;
    if (effective > today) continue;
    const base = {
      category: categoryFor(obligation),
      debtId: obligation.id,
      creditor: obligation.creditor,
      locationId: obligation.locationId,
      date: effective,
    };
    if (!metadata)
      push({
        ...base,
        id: `debt-origin:${obligation.id}`,
        type: 'origin_missing',
        title: 'ORIGEN de obligación pendiente de documentar',
        description:
          'La ficha heredada conserva sus movimientos y saldo; requiere documento verificable, sin reconstrucción ficticia.',
        severity: 'warning',
      });
    else if (metadata.status === 'pending_institutional')
      push({
        ...base,
        id: `debt-origin-authorization:${obligation.id}`,
        type: 'origin_authorization_pending',
        title: 'ORIGEN bancario pendiente de autorización institucional',
        description: metadata.documentReference,
        severity: 'warning',
        amount: metadata.openingPrincipal,
      });
    const basis = getDebtCapitalBasis(state, obligation.id, today);
    if (metadata?.originMode === 'cash_new' && basis === '0.00')
      push({
        ...base,
        id: `debt-funding:${obligation.id}`,
        type: 'funding_pending',
        title: 'Ficha pendiente de desembolso real desde Caja',
        description:
          'No existe ingreso contabilizado y vinculado; la ficha no crea dinero ni capital confirmado.',
        severity: 'info',
        amount: obligation.principal,
      });
    if (obligation.kind !== 'supplier' && toCents(basis) > 0n) {
      if (!module.officialPlans.some((row) => row.debtId === obligation.id && row.effectiveDate <= today))
        push({
          ...base,
          id: `debt-plan:${obligation.id}`,
          type: 'official_plan_missing',
          title: 'Calendario documental de cuotas pendiente',
          description:
            'Registra las cuotas reales del documento oficial o acuerdo; la simulación no reemplaza ese calendario.',
          severity: 'warning',
        });
      if (obligation.kind === 'loan') {
        const latest = module.reconciliations
          .filter((row) => row.debtId === obligation.id && row.date <= today)
          .sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt))
          .at(-1);
        if (!latest || latest.date.slice(0, 7) < today.slice(0, 7))
          push({
            ...base,
            id: `debt-statement-missing:${obligation.id}:${today.slice(0, 7)}`,
            type: 'statement_review_missing',
            title: 'Extracto de la entidad pendiente de revisión del período',
            description: `Período ${today.slice(0, 7)}; el saldo se conserva calculado desde fuentes reales.`,
            severity: 'warning',
            date: `${today.slice(0, 7)}-01`,
          });
      }
    }
    const latest = module.reconciliations
      .filter((row) => row.debtId === obligation.id && row.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt))
      .at(-1);
    if (latest) {
      const book = getDebtModulePrincipalBalance(state, obligation.id, latest.date);
      const difference = sub(latest.statementPrincipal, book);
      if (difference !== '0.00')
        push({
          ...base,
          id: `debt-statement:${obligation.id}`,
          type: 'statement_difference',
          title: 'Diferencia entre extracto y capital real',
          description: `${latest.reference}; extracto ${latest.statementPrincipal}; libro al corte ${book}; diferencia ${difference}.`,
          severity: 'critical',
          date: latest.date,
          amount: difference,
        });
    }
  }
  for (const payment of getActualDebtModulePayments(state, undefined, today)) {
    const obligation = debt(state, payment.debtId);
    const cash = state.transactions.find((row) => row.id === payment.transactionId)!;
    const base = {
      category: categoryFor(obligation),
      debtId: obligation.id,
      creditor: obligation.creditor,
      locationId: obligation.locationId,
      date: payment.date,
    };
    if (!hasCashSupport(state, cash))
      push({
        ...base,
        id: `debt-support:${payment.id}`,
        type: 'payment_support_missing',
        title: 'Pago de obligación sin comprobante',
        description: cash.reference,
        severity: 'warning',
        amount: payment.amount,
      });
    if (toCents(payment.lateFee) > 0n)
      push({
        ...base,
        id: `debt-late-charge:${payment.id}`,
        type: 'late_charge',
        title: 'Cargo de mora documentado en un pago',
        description: `${cash.reference}; conservar justificación y comprobante de la entidad.`,
        severity: 'warning',
        amount: payment.lateFee,
      });
    if (obligation.kind !== 'supplier' && getDebtCapitalBasis(state, obligation.id, today) !== '0.00') {
      const extra = module.extraordinaryPayments.find((row) => row.debtPaymentId === payment.id);
      if (extra) {
        if (
          obligation.kind === 'loan' &&
          !module.officialPlans.some(
            (row) =>
              row.debtId === obligation.id &&
              row.effectiveDate >= payment.date &&
              row.recordedAt >= extra.recordedAt,
          )
        )
          push({
            ...base,
            id: `debt-extra-plan:${payment.id}`,
            type: 'extraordinary_plan_review',
            title: 'Abono extraordinario pendiente de contrastar con plan oficial actualizado',
            description: extra.reference,
            severity: 'warning',
            amount: payment.principal,
          });
      } else {
        const allocations = module.installmentAllocations.filter((row) => row.debtPaymentId === payment.id);
        const missing = add(
          ...FIELDS.map((field) => sub(payment[field], add(...allocations.map((row) => row[field])))),
        );
        if (missing !== '0.00')
          push({
            ...base,
            id: `debt-unallocated:${payment.id}`,
            type: 'payment_unallocated',
            title: 'Pago real pendiente de distribuir en cuota o identificar como abono extraordinario',
            description: cash.reference,
            severity: 'warning',
            amount: missing,
          });
      }
    }
  }
  for (const entry of getDebtCalendar(state, today)) {
    if (entry.remaining === '0.00') continue;
    if (entry.status === 'overdue')
      push({
        id: `debt-overdue:${entry.id}`,
        type: 'overdue',
        title: 'Obligación documentada vencida',
        description: entry.concept,
        severity: 'warning',
        category: entry.category,
        debtId: entry.debtId,
        billId: entry.billId,
        creditor: entry.creditor,
        locationId: entry.locationId,
        date: entry.dueDate,
        amount: entry.remaining,
      });
    else if (withinDays(today, entry.dueDate) <= 7)
      push({
        id: `debt-upcoming:${entry.id}`,
        type: 'upcoming',
        title: 'Vencimiento documentado próximo',
        description: entry.concept,
        severity: 'info',
        category: entry.category,
        debtId: entry.debtId,
        billId: entry.billId,
        creditor: entry.creditor,
        locationId: entry.locationId,
        date: entry.dueDate,
        amount: entry.remaining,
      });
  }
  for (const template of module.recurringTemplates.filter((row) => row.active)) {
    const first = [
      template.createdAt.slice(0, 7),
      ...module.recurringBills.filter((row) => row.templateId === template.id).map((row) => row.month),
    ].sort()[0];
    const month = today.slice(0, 7);
    if (
      first <= month &&
      !module.recurringBills.some((row) => row.templateId === template.id && row.month === month)
    )
      push({
        id: `debt-bill-missing:${template.id}:${month}`,
        type: 'recurring_bill_missing',
        title: 'Recepción mensual de factura o recibo sin confirmar',
        description: `${template.name}; importe y vencimiento reales todavía no informados.`,
        severity: 'warning',
        category: 'recurring',
        templateId: template.id,
        creditor: template.creditor,
        locationId: template.locationId,
        date: `${month}-01`,
      });
  }
  for (const returned of module.supplierReturns.filter((row) => row.date <= today)) {
    const obligation = state.debts.find((row) => row.id === returned.debtId);
    if (!obligation) continue;
    if (returned.status !== 'accepted' || !returned.acceptedDate || returned.acceptedDate > today)
      push({
        id: `debt-return:${returned.id}`,
        type: 'supplier_return_pending',
        title:
          returned.status === 'disputed'
            ? 'Devolución en disputa: no reduce la deuda'
            : 'Devolución pendiente de aceptación del proveedor',
        description: returned.reference,
        severity: 'warning',
        category: 'supplier',
        debtId: obligation.id,
        creditor: obligation.creditor,
        locationId: obligation.locationId,
        date: returned.date,
      });
  }
  for (const request of module.requests.filter((row) => row.createdAt.slice(0, 10) <= today)) {
    const obligation = request.debtId ? state.debts.find((row) => row.id === request.debtId) : undefined;
    const bill = request.billId ? module.recurringBills.find((row) => row.id === request.billId) : undefined;
    const template = bill ? module.recurringTemplates.find((row) => row.id === bill.templateId) : undefined;
    if (!obligation && !template) continue;
    push({
      id: `debt-request:${request.id}`,
      type: 'authorization_pending',
      title: 'Solicitud de Deudas pendiente de autorización institucional',
      description: request.reason,
      severity: 'warning',
      category: obligation ? categoryFor(obligation) : 'recurring',
      debtId: obligation?.id,
      billId: bill?.id,
      creditor: obligation?.creditor ?? template!.creditor,
      locationId: obligation?.locationId ?? template!.locationId,
      date: request.createdAt.slice(0, 10),
    });
  }
  const stored = new Map(module.alerts.map((row) => [row.id, row]));
  return result
    .map((row) => {
      const prior = stored.get(row.id);
      return prior ? { ...row, history: prior.history, status: 'open' as const } : row;
    })
    .concat(module.alerts.filter((row) => row.date <= today && !result.some((alert) => alert.id === row.id)))
    .sort(
      (a, b) =>
        (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1) ||
        b.date.localeCompare(a.date),
    );
}

function issueSignature(issue: DebtModuleAlert): string {
  return JSON.stringify({
    id: issue.id,
    type: issue.type,
    debtId: issue.debtId,
    billId: issue.billId,
    date: issue.date,
    amount: issue.amount,
    description: issue.description,
  });
}
export function reviewDebtIssue(
  state: DebtWorkspace,
  input: { alertId: string; reason: string; support: Support },
  actor: Actor,
): DebtWorkspace {
  const issue = getDebtModuleAlerts(state).find((row) => row.id === input.alertId);
  if (!issue) throw new Error('La novedad no está presente.');
  authorize(state, actor, issue.locationId);
  text(input.reason, 'La revisión documental', 5);
  document(input.support);
  const next = copy(state);
  const record = {
    id: uuid(),
    alertId: issue.id,
    date: todayBogota(),
    reason: input.reason,
    support: input.support,
    conditionSignature: issueSignature(issue),
    actorId: actor.id,
    createdAt: now(),
  };
  next.debtModule.reviews.push(record);
  let stored = next.debtModule.alerts.find((row) => row.id === issue.id);
  if (!stored) {
    stored = structuredClone(issue);
    next.debtModule.alerts.push(stored);
  }
  stored.history.push({
    date: now(),
    actorId: actor.id,
    action: `Revisión documentada sin ocultar la condición: ${input.reason}`,
  });
  audit(
    next,
    actor,
    'Novedad de Deudas revisada documentalmente; no valida diferencias ni crea pagos',
    record.id,
    input.reason,
    issue,
    { alertId: issue.id, conditionSignature: record.conditionSignature },
  );
  return next;
}

const TOTAL_FIELDS = [
  'openingBalance',
  'newObligations',
  'principalPaid',
  'noncashScrap',
  'acceptedReturns',
  'documentedAdjustments',
  'closingBalance',
  'interestPaid',
  'insurancePaid',
  'commissionPaid',
  'lateFeePaid',
  'cashPaid',
] as const;
function zeroTotals(): DebtReportTotals {
  return Object.fromEntries(TOTAL_FIELDS.map((field) => [field, '0.00'])) as unknown as DebtReportTotals;
}
function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
}
function reportRowStatus(
  basis: Money,
  balance: Money,
  metadata: DebtObligationMetadata | undefined,
  calendar: DebtCalendarEntry[],
): DebtReportRow['status'] {
  if (metadata?.status === 'pending_institutional') return 'pending_authorization';
  if (metadata?.originMode === 'cash_new' && basis === '0.00') return 'pending_funding';
  if (calendar.some((row) => row.status === 'overdue')) return 'overdue';
  if (calendar.some((row) => row.status === 'partially_paid')) return 'partially_paid';
  if (balance === '0.00' && calendar.every((row) => row.remaining === '0.00')) return 'paid';
  if (calendar.some((row) => row.status === 'upcoming')) return 'upcoming';
  return 'current';
}
function documentMetadata(value: Support): Support {
  return { name: value.name, type: value.type, size: value.size };
}
export function scopeDebtModuleReport(
  source: DebtModuleReport,
  input: Omit<DebtReportInput, 'startDate' | 'endDate'>,
): DebtModuleReport {
  const result = structuredClone(source);
  result.category = input.category;
  result.locationId = input.locationId;
  const match = (row: { category: DebtCategory; locationId: string; creditor?: string }) =>
    (!input.category || row.category === input.category) &&
    (!input.locationId || row.locationId === input.locationId) &&
    (!input.creditor || (!!row.creditor && sameParty(row.creditor, input.creditor)));
  result.rows = result.rows.filter(match);
  result.movements = result.movements.filter(match);
  result.calendar = result.calendar.filter(match);
  result.issues = result.issues.filter(match);
  const ids = new Set(result.rows.flatMap((row) => (row.debtId ? [row.debtId] : [])));
  const billIds = new Set(result.rows.flatMap((row) => (row.billId ? [row.billId] : [])));
  result.plans = result.plans.filter((row) => ids.has(row.debtId));
  result.reconciliations = result.reconciliations.filter((row) => ids.has(row.debtId));
  result.requests = result.requests.filter(
    (row) => (!!row.debtId && ids.has(row.debtId)) || (!!row.billId && billIds.has(row.billId)),
  );
  result.totals = zeroTotals();
  for (const field of TOTAL_FIELDS) result.totals[field] = add(...result.rows.map((row) => row[field]));
  result.reconciled = result.issues.every((row) => row.status === 'resolved');
  return result;
}

export function getDebtModuleReport(state: DebtWorkspace, input: DebtReportInput): DebtModuleReport {
  validateDate(input.startDate);
  validateDate(input.endDate);
  if (input.startDate > input.endDate) throw new Error('El inicio no puede ser posterior al corte.');
  if (input.locationId && !state.locations.some((row) => row.id === input.locationId))
    throw new Error('La sede no existe.');
  const module = getDebtModuleState(state);
  const closed = module.monthClosures.find(
    (row) => `${row.month}-01` === input.startDate && debtMonthBounds(row.month).endDate === input.endDate,
  );
  if (closed) return scopeDebtModuleReport(closed.report, input);
  const prior = previousDay(input.startDate);
  const actual = getActualDebtModulePayments(state, undefined, input.endDate);
  const calendar = getDebtCalendar(state, input.endDate);
  const report: DebtModuleReport = {
    startDate: input.startDate,
    endDate: input.endDate,
    generatedAt: now(),
    scope: 'local',
    status: 'draft',
    version: 1,
    rows: [],
    totals: zeroTotals(),
    movements: [],
    calendar,
    issues: getDebtModuleAlerts(state, input.endDate),
    plans: module.officialPlans
      .filter((row) => row.effectiveDate <= input.endDate)
      .map((row) => ({ ...row, support: documentMetadata(row.support) })),
    reconciliations: module.reconciliations
      .filter((row) => row.date <= input.endDate)
      .map((row) => ({ ...row, support: documentMetadata(row.support) })),
    requests: module.requests
      .filter((row) => row.createdAt.slice(0, 10) <= input.endDate)
      .map((row) => ({ ...row, support: documentMetadata(row.support) })),
    reconciled: false,
  };
  for (const obligation of state.debts) {
    const metadata = module.obligations.find((row) => row.debtId === obligation.id);
    const effective = metadata?.openingAsOfDate ?? metadata?.originDate ?? obligation.startDate;
    if (effective > input.endDate) continue;
    const category = categoryFor(obligation);
    const basis = getDebtCapitalBasis(state, obligation.id, input.endDate);
    const openingBalance = getDebtModulePrincipalBalance(state, obligation.id, prior);
    const newObligations = sub(basis, getDebtCapitalBasis(state, obligation.id, prior));
    const closingBalance = getDebtModulePrincipalBalance(state, obligation.id, input.endDate);
    const payments = actual.filter((row) => row.debtId === obligation.id && row.date >= input.startDate);
    const offsets = (state.inventory?.supplierOffsets ?? []).filter(
      (row) => row.debtId === obligation.id && row.date >= input.startDate && row.date <= input.endDate,
    );
    const returns = module.supplierReturns.filter(
      (row) =>
        row.debtId === obligation.id &&
        row.status === 'accepted' &&
        row.acceptedDate &&
        row.acceptedDate >= input.startDate &&
        row.acceptedDate <= input.endDate,
    );
    const entries = calendar.filter((row) => row.debtId === obligation.id);
    const row: DebtReportRow = {
      id: obligation.id,
      debtId: obligation.id,
      category,
      creditor: obligation.creditor,
      concept: metadata?.concept ?? obligation.notes ?? 'Obligación heredada por documentar',
      documentReference:
        metadata?.documentReference ?? obligation.supplierInvoice ?? 'Sin documento de ORIGEN',
      locationId: obligation.locationId,
      openingBalance,
      newObligations,
      principalPaid: add(...payments.map((row) => row.principal)),
      noncashScrap: add(...offsets.map((row) => row.amount)),
      acceptedReturns: add(...returns.map((row) => row.acceptedAmount ?? '0.00')),
      documentedAdjustments: '0.00',
      closingBalance,
      interestPaid: add(...payments.map((row) => row.interest)),
      insurancePaid: add(...payments.map((row) => row.insurance)),
      commissionPaid: add(...payments.map((row) => row.commission)),
      lateFeePaid: add(...payments.map((row) => row.lateFee)),
      cashPaid: add(...payments.map((row) => row.amount)),
      dueDate: entries.find((row) => row.remaining !== '0.00')?.dueDate,
      status: reportRowStatus(basis, closingBalance, metadata, entries),
      supportMissing: !metadata,
    };
    report.rows.push(row);
    const zero = components({});
    if (newObligations !== '0.00') {
      if (metadata?.originMode === 'cash_new') {
        const links = new Set(
          state.cash?.metadata
            .filter((row) =>
              row.externalReferences.some(
                (reference) => reference.module === 'debts' && reference.id === obligation.id,
              ),
            )
            .map((row) => row.transactionId) ?? [],
        );
        for (const cash of state.transactions.filter(
          (row) =>
            row.kind === 'loan' &&
            links.has(row.id) &&
            row.date >= input.startDate &&
            effectiveTransaction(state, row.id, input.endDate),
        ))
          report.movements.push({
            ...zero,
            id: `funding:${cash.id}`,
            date: cash.date,
            category,
            debtId: obligation.id,
            creditor: obligation.creditor,
            documentReference: row.documentReference,
            locationId: obligation.locationId,
            kind: 'new_obligation',
            principal: cash.amount,
            total: cash.amount,
            sourceReference: cash.reference,
            supportName: cash.support?.name,
          });
      } else
        report.movements.push({
          ...zero,
          id: `origin:${obligation.id}`,
          date: effective,
          category,
          debtId: obligation.id,
          creditor: obligation.creditor,
          documentReference: row.documentReference,
          locationId: obligation.locationId,
          kind: metadata?.originMode.startsWith('historical_') ? 'opening' : 'new_obligation',
          principal: newObligations,
          total: newObligations,
          sourceReference: row.documentReference,
          supportName: metadata?.support.name,
        });
    }
    for (const payment of payments) {
      const cash = state.transactions.find((tx) => tx.id === payment.transactionId)!;
      report.movements.push({
        ...components(payment),
        id: `payment:${payment.id}`,
        date: payment.date,
        category,
        debtId: obligation.id,
        creditor: obligation.creditor,
        documentReference: row.documentReference,
        locationId: obligation.locationId,
        kind: 'cash_payment',
        total: payment.amount,
        sourceReference: cash.reference,
        supportName:
          cash.support?.name ??
          state.cash?.metadata.find((entry) => entry.transactionId === cash.id)?.support?.name,
      });
    }
    for (const offset of offsets)
      report.movements.push({
        ...zero,
        id: `offset:${offset.id}`,
        date: offset.date,
        category,
        debtId: obligation.id,
        creditor: obligation.creditor,
        documentReference: row.documentReference,
        locationId: obligation.locationId,
        kind: 'scrap_offset',
        principal: offset.amount,
        total: offset.amount,
        sourceReference: offset.reference,
      });
    for (const returned of returns)
      report.movements.push({
        ...zero,
        id: `return:${returned.id}`,
        date: returned.acceptedDate!,
        category,
        debtId: obligation.id,
        creditor: obligation.creditor,
        documentReference: row.documentReference,
        locationId: obligation.locationId,
        kind: 'accepted_return',
        principal: returned.acceptedAmount!,
        total: returned.acceptedAmount!,
        sourceReference: returned.acceptanceReference ?? returned.reference,
        supportName: returned.acceptanceSupport?.name,
      });
  }
  for (const bill of module.recurringBills.filter((row) => row.invoiceDate <= input.endDate)) {
    const template = module.recurringTemplates.find((row) => row.id === bill.templateId)!;
    const payments = module.recurringPayments.filter(
      (row) =>
        row.billId === bill.id &&
        row.date >= input.startDate &&
        row.date <= input.endDate &&
        effectiveTransaction(state, row.transactionId, input.endDate),
    );
    const closingBalance = getRecurringBillBalance(state, bill.id, input.endDate);
    const entry = calendar.find((row) => row.billId === bill.id)!;
    const row: DebtReportRow = {
      id: bill.id,
      billId: bill.id,
      category: 'recurring',
      creditor: template.creditor,
      concept: `${template.name} · período ${bill.month}`,
      documentReference: bill.reference,
      locationId: template.locationId,
      openingBalance: getRecurringBillBalance(state, bill.id, prior),
      newObligations: bill.invoiceDate >= input.startDate ? bill.amount : '0.00',
      principalPaid: add(...payments.map((row) => row.amount)),
      noncashScrap: '0.00',
      acceptedReturns: '0.00',
      documentedAdjustments: '0.00',
      closingBalance,
      interestPaid: '0.00',
      insurancePaid: '0.00',
      commissionPaid: '0.00',
      lateFeePaid: '0.00',
      cashPaid: add(...payments.map((row) => row.amount)),
      dueDate: bill.dueDate,
      status: entry.status === 'future' ? 'current' : entry.status,
      supportMissing: false,
    };
    report.rows.push(row);
    if (bill.invoiceDate >= input.startDate)
      report.movements.push({
        ...components({ principal: bill.amount }),
        id: `bill-source:${bill.id}`,
        billId: bill.id,
        date: bill.invoiceDate,
        category: 'recurring',
        creditor: template.creditor,
        documentReference: bill.reference,
        locationId: template.locationId,
        kind: 'recurring_bill',
        total: bill.amount,
        sourceReference: bill.reference,
        supportName: bill.support.name,
      });
    for (const payment of payments) {
      const cash = state.transactions.find((row) => row.id === payment.transactionId)!;
      report.movements.push({
        ...components({ principal: payment.amount }),
        id: `bill-payment:${payment.id}`,
        billId: bill.id,
        date: payment.date,
        category: 'recurring',
        creditor: template.creditor,
        documentReference: bill.reference,
        locationId: template.locationId,
        kind: 'cash_payment',
        total: payment.amount,
        sourceReference: cash.reference,
        supportName: cash.support?.name,
      });
    }
  }
  report.movements.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return scopeDebtModuleReport(report, input);
}

export function getDebtMonthChecklist(
  state: DebtWorkspace,
  input: { month: string },
): {
  month: string;
  canClose: boolean;
  items: { id: string; label: string; blocking: boolean; entityId?: string }[];
  report: DebtModuleReport;
} {
  const bounds = debtMonthBounds(input.month);
  const report = getDebtModuleReport(state, bounds);
  const module = getDebtModuleState(state);
  const items: { id: string; label: string; blocking: boolean; entityId?: string }[] = [];
  if (bounds.endDate > todayBogota())
    items.push({
      id: 'month-not-ended',
      label: 'El mes calendario todavía no ha terminado.',
      blocking: true,
    });
  if (module.monthClosures.some((row) => row.month === input.month))
    items.push({
      id: 'month-closed',
      label: 'Este mes ya está cerrado; conserva su informe histórico.',
      blocking: true,
    });
  const hard = new Set([
    'origin_missing',
    'official_plan_missing',
    'statement_review_missing',
    'statement_difference',
    'payment_support_missing',
    'payment_unallocated',
    'recurring_bill_missing',
  ]);
  for (const issue of report.issues.filter((row) => row.status === 'open')) {
    const reviewed = module.reviews.some(
      (row) => row.alertId === issue.id && row.conditionSignature === issueSignature(issue),
    );
    const ordinaryPending = [
      'overdue',
      'upcoming',
      'funding_pending',
      'supplier_return_pending',
      'origin_authorization_pending',
      'authorization_pending',
    ].includes(issue.type);
    items.push({
      id: issue.id,
      label: issue.title,
      blocking: hard.has(issue.type) || (!ordinaryPending && !reviewed),
      entityId: issue.debtId ?? issue.billId,
    });
  }
  for (const row of report.rows) {
    const expected = sub(
      add(row.openingBalance, row.newObligations, row.documentedAdjustments),
      add(row.principalPaid, row.noncashScrap, row.acceptedReturns),
    );
    if (expected !== row.closingBalance || toCents(row.closingBalance) < 0n)
      items.push({
        id: `bridge:${row.id}`,
        label: 'La conciliación de movimientos y saldo no coincide.',
        blocking: true,
        entityId: row.id,
      });
  }
  return { month: input.month, canClose: items.every((row) => !row.blocking), items, report };
}
export function closeDebtMonth(
  state: DebtWorkspace,
  input: { month: string; notes?: string },
  actor: Actor,
): DebtWorkspace {
  authorize(state, actor, undefined, ['owner']);
  const checklist = getDebtMonthChecklist(state, input);
  if (!checklist.canClose)
    throw new Error(
      `No se puede cerrar Deudas: ${checklist.items
        .filter((row) => row.blocking)
        .map((row) => row.label)
        .join(' ')}`,
    );
  for (const row of checklist.report.rows) authorize(state, actor, row.locationId, ['owner']);
  const next = copy(state);
  const closedAt = now();
  const report = {
    ...structuredClone(checklist.report),
    status: 'closed' as const,
    closedAt,
    closedBy: actor.id,
  };
  const record = {
    id: uuid(),
    month: input.month,
    scope: 'local' as const,
    status: 'closed' as const,
    version: 1,
    report,
    closedBy: actor.id,
    closedAt,
    notes: input.notes?.trim() ?? '',
  };
  next.debtModule.monthClosures.push(record);
  audit(
    next,
    actor,
    'Cierre documental local de Deudas; no simula aprobación institucional',
    record.id,
    input.month,
    undefined,
    { month: input.month, version: 1, total: report.totals.closingBalance, openIssues: report.issues.length },
  );
  return next;
}
