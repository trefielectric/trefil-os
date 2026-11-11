import { validateDate } from '../finance/amortization';
import { todayBogota } from '../finance/engine';
import { validateCashSupport, hasCashSupport, getCashTransactionMetadata } from '../finance/cash';
import { add, fromCents, money, rateFraction, toCents } from '../finance/money';
import { quantity, toMicros, validateItemQuantity } from '../inventory/quantity';
import { getActualDebtModulePayments, getDebtCapitalBasis, getDebtModulePrincipalBalance } from './engine';
import type {
  DebtCategory,
  DebtComponentAmounts,
  DebtModuleState,
  DebtWorkspace,
  OfficialDebtPlan,
} from './types';
import type { Support } from '../finance/types';

type Row = Record<string, unknown>;
const COMPONENTS = ['principal', 'interest', 'insurance', 'commission', 'lateFee'] as const;
const CATEGORIES: DebtCategory[] = ['bank', 'investment', 'supplier', 'recurring'];
const WRITERS = ['owner', 'admin', 'treasury', 'accounting'];
function fail(path: string): never {
  throw new Error(`Datos inválidos en debtModule.${path}.`);
}
function object(value: unknown, path: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  return value as Row;
}
function array(value: unknown, path: string, max = 10000): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path);
  return value;
}
function text(value: unknown, path: string, min = 1, max = 2000): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(path);
  return value;
}
function id(value: unknown, path: string): string {
  const result = text(value, path, 1, 200);
  if (!/^[A-Za-z0-9:_-]+$/.test(result)) fail(path);
  return result;
}
function choose(value: unknown, values: readonly string[], path: string): string {
  if (typeof value !== 'string' || !values.includes(value)) fail(path);
  return value;
}
function bool(value: unknown, path: string): void {
  if (typeof value !== 'boolean') fail(path);
}
function date(value: unknown, path: string, actual = false): string {
  const result = text(value, path, 10, 10);
  try {
    validateDate(result);
  } catch {
    fail(path);
  }
  if (actual && result > todayBogota()) fail(path);
  return result;
}
function time(value: unknown, path: string): string {
  const result = text(value, path, 20, 30);
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(result) ||
    !Number.isFinite(Date.parse(result))
  )
    fail(path);
  date(result.slice(0, 10), path);
  return result;
}
function month(value: unknown, path: string): string {
  const result = text(value, path, 7, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result)) fail(path);
  return result;
}
function decimal(value: unknown, path: string, nonnegative = true): string {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d{0,15})\.\d{2}$/.test(value)) fail(path);
  try {
    if (money(value) !== value || (nonnegative && toCents(value) < 0n)) fail(path);
  } catch {
    fail(path);
  }
  return value;
}
function qty(value: unknown, path: string, positive = true): string {
  if (typeof value !== 'string') fail(path);
  try {
    if (quantity(value) !== value || (positive ? toMicros(value) <= 0n : toMicros(value) < 0n)) fail(path);
  } catch {
    fail(path);
  }
  return value;
}
function integer(value: unknown, path: string, min = 1, max = 600): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) fail(path);
  return Number(value);
}
function unique(rows: unknown[], path: string, key = 'id'): void {
  const seen = new Set<string>();
  for (const value of rows) {
    const current = id(object(value, path)[key], `${path}.${key}`);
    if (seen.has(current)) fail(`${path}.duplicate`);
    seen.add(current);
  }
}
function evidence(value: unknown, path: string, summary = false): void {
  const row = object(value, path);
  text(row.name, `${path}.name`, 1, 255);
  choose(row.type, ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], `${path}.type`);
  integer(row.size, `${path}.size`, 1, 5 * 1024 * 1024);
  if (summary && row.dataUrl === undefined) return;
  try {
    validateCashSupport(row as unknown as Support);
  } catch {
    fail(path);
  }
  if (typeof row.dataUrl !== 'string' || !row.dataUrl.startsWith(`data:${row.type};base64,`)) fail(path);
}
function componentAmounts(value: unknown, path: string): DebtComponentAmounts {
  const row = object(value, path);
  for (const key of COMPONENTS) decimal(row[key], `${path}.${key}`);
  return row as unknown as DebtComponentAmounts;
}
function total(value: DebtComponentAmounts): string {
  return add(...COMPONENTS.map((key) => value[key]));
}
function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('es-CO');
}

/** Validate the optional persisted extension without writing, hydrating or repairing it. */
export function validateDebtModuleState(state: DebtWorkspace): void {
  if (state.debtModule === undefined) return;
  const root = object(state.debtModule, 'state');
  if (root.version !== 1) fail('version');
  const keys = [
    'obligations',
    'officialPlans',
    'installmentAllocations',
    'extraordinaryPayments',
    'reconciliations',
    'requests',
    'suppliers',
    'supplierInvoices',
    'supplierPurchases',
    'supplierReturns',
    'cashPaymentLinks',
    'recurringTemplates',
    'recurringBills',
    'recurringPayments',
    'alerts',
    'reviews',
    'monthClosures',
  ] as const;
  for (const key of keys)
    unique(array(root[key], key), key, key === 'obligations' || key === 'supplierInvoices' ? 'debtId' : 'id');
  const module = root as unknown as DebtModuleState;
  const debts = new Map(state.debts.map((row) => [row.id, row]));
  const members = new Map(state.members.map((row) => [row.id, row]));
  const locations = new Set(state.locations.map((row) => row.id));
  const suppliers = new Map(module.suppliers.map((row) => [row.id, row]));
  const templates = new Map(module.recurringTemplates.map((row) => [row.id, row]));
  const bills = new Map(module.recurringBills.map((row) => [row.id, row]));
  const plans = new Map(module.officialPlans.map((row) => [row.id, row]));
  const purchases = new Map(module.supplierPurchases.map((row) => [row.id, row]));
  const inventory = state.inventory;
  const items = new Map(inventory?.items.map((row) => [row.id, row]) ?? []);
  const warehouses = new Map(inventory?.warehouses.map((row) => [row.id, row]) ?? []);
  const site = (value: unknown, path: string) => {
    const result = id(value, path);
    if (!locations.has(result)) fail(path);
    return result;
  };
  // Inactive authors remain attributable: revocation must not erase their history.
  const member = (value: unknown, path: string, locationId?: string, roles: readonly string[] = WRITERS) => {
    const result = members.get(id(value, path));
    if (!result || !roles.includes(result.role) || (locationId && !result.locationIds.includes(locationId)))
      fail(path);
    return result;
  };
  const debt = (value: unknown, path: string) => {
    const result = debts.get(id(value, path));
    if (!result) fail(path);
    return result;
  };
  const supplier = (value: unknown, path: string) => {
    const result = suppliers.get(id(value, path));
    if (!result) fail(path);
    return result;
  };
  const source = (value: unknown, path: string) => {
    const result = state.transactions.find((row) => row.id === id(value, path));
    if (
      !result ||
      result.kind !== 'expense' ||
      result.status !== 'posted' ||
      result.reversedBy ||
      state.transactions.some((row) => row.reversalOf === result.id && row.status === 'posted')
    )
      fail(path);
    return result;
  };
  const sourceProof = (transaction: ReturnType<typeof source>, path: string) => {
    if (
      !hasCashSupport(state, transaction) ||
      getCashTransactionMetadata(state, transaction.id).businessStatus !== 'business'
    )
      fail(path);
  };
  const actorRecord = (
    row: {
      createdBy?: string;
      createdAt?: string;
      recordedBy?: string;
      recordedAt?: string;
      actorId?: string;
    },
    path: string,
    locationId?: string,
    roles?: readonly string[],
  ) => {
    member(row.createdBy ?? row.recordedBy ?? row.actorId, `${path}.actor`, locationId, roles);
    time(row.createdAt ?? row.recordedAt, `${path}.timestamp`);
  };
  const categoryFor = (kind: string) => (kind === 'loan' ? 'bank' : kind);
  for (const row of module.obligations) {
    const obligation = debt(row.debtId, 'obligations.debt');
    if (row.category !== categoryFor(obligation.kind)) fail('obligations.category');
    const modes =
      obligation.kind === 'loan'
        ? ['cash_new', 'historical_bank_request']
        : obligation.kind === 'investment'
          ? ['cash_new', 'historical_investment']
          : ['historical_supplier', 'credit_purchase'];
    choose(row.originMode, modes, 'obligations.mode');
    if (
      row.status !==
      (row.originMode === 'historical_bank_request'
        ? 'pending_institutional'
        : row.originMode === 'cash_new'
          ? 'draft_funding'
          : 'documented')
    )
      fail('obligations.status');
    text(row.concept, 'obligations.concept');
    text(row.documentReference, 'obligations.reference');
    date(row.originDate, 'obligations.date', true);
    if (row.originDate !== obligation.startDate) fail('obligations.date');
    decimal(row.openingPrincipal, 'obligations.principal');
    if (toCents(row.openingPrincipal) > toCents(obligation.principal)) fail('obligations.principal');
    if (row.originMode.startsWith('historical_')) {
      date(row.openingAsOfDate, 'obligations.cutoff', true);
      if (row.openingAsOfDate! < row.originDate) fail('obligations.cutoff');
      if (
        state.debtPayments.some(
          (payment) =>
            payment.debtId === row.debtId &&
            payment.status !== 'rejected' &&
            payment.date < row.openingAsOfDate!,
        )
      )
        fail('obligations.preOriginPayment');
    } else if (row.openingAsOfDate !== undefined) date(row.openingAsOfDate, 'obligations.cutoff', true);
    if (
      row.terminationDate !== undefined &&
      date(row.terminationDate, 'obligations.termination') < row.originDate
    )
      fail('obligations.termination');
    if (row.statedInterest !== undefined) decimal(row.statedInterest, 'obligations.interest');
    evidence(row.support, 'obligations.support');
    if (obligation.kind === 'loan') {
      evidence(row.bankStatement, 'obligations.statement');
      evidence(row.officialPlanSupport, 'obligations.plan');
      if (!row.terminationDate) fail('obligations.termination');
    }
    if (obligation.kind === 'investment') {
      evidence(row.contract ?? obligation.contract, 'obligations.contract');
      text(row.interestRule, 'obligations.interestRule');
      if (row.originMode === 'historical_investment') evidence(row.initialReceipt, 'obligations.receipt');
    }
    for (const key of ['contract', 'bankStatement', 'officialPlanSupport', 'initialReceipt'] as const)
      if (row[key] !== undefined) evidence(row[key], `obligations.${key}`);
    if (row.supplierId !== undefined) {
      const party = supplier(row.supplierId, 'obligations.supplier');
      if (
        obligation.kind !== 'supplier' ||
        party.locationId !== obligation.locationId ||
        normalized(party.name) !== normalized(obligation.creditor)
      )
        fail('obligations.supplier');
    }
    actorRecord(row, 'obligations', obligation.locationId);
  }
  const identity = new Set<string>();
  const supplierNames = new Set<string>();
  for (const row of module.suppliers) {
    const identification = text(row.identification, 'suppliers.identification')
      .replace(/\s/g, '')
      .toLocaleUpperCase('es-CO');
    const name = normalized(text(row.name, 'suppliers.name'));
    if (identification !== row.identification || identity.has(identification) || supplierNames.has(name))
      fail('suppliers.duplicate');
    identity.add(identification);
    supplierNames.add(name);
    site(row.locationId, 'suppliers.site');
    bool(row.active, 'suppliers.active');
    for (const key of ['contactName', 'phone', 'address'] as const)
      if (row[key] !== undefined) text(row[key], `suppliers.${key}`);
    if (row.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(row.email, 'suppliers.email')))
      fail('suppliers.email');
    actorRecord(row, 'suppliers', row.locationId);
  }
  const installmentIds = new Set<string>();
  const planReferences = new Set<string>();
  for (const row of module.officialPlans) {
    validatePlan(row, false);
    const obligation = debt(row.debtId, 'plans.debt');
    if (obligation.kind === 'supplier' || row.effectiveDate < obligation.startDate) fail('plans.debt');
    actorRecord(row, 'plans', obligation.locationId);
    const previous = module.officialPlans
      .filter((plan) => plan.debtId === row.debtId && plan.version < row.version)
      .sort((a, b) => a.version - b.version)
      .at(-1);
    if (
      row.version === 1
        ? row.replacesPlanId !== undefined
        : !previous ||
          previous.version !== row.version - 1 ||
          row.replacesPlanId !== previous.id ||
          previous.effectiveDate > row.effectiveDate
    )
      fail('plans.versions');
    if (obligation.kind === 'investment' && row.version > 1) fail('plans.investorAuthorization');
    const reference = `${row.debtId}:${row.reference}`;
    if (planReferences.has(reference)) fail('plans.reference');
    planReferences.add(reference);
    let principal = 0n;
    for (const installment of row.installments) {
      if (installmentIds.has(installment.id)) fail('plans.installments.id');
      installmentIds.add(installment.id);
      if (installment.dueDate < obligation.startDate) fail('plans.installments.date');
      principal += toCents(installment.principal);
    }
    if (principal > toCents(obligation.principal)) fail('plans.principal');
  }
  function validatePlan(value: unknown, summary: boolean): void {
    const row = object(value, 'plans');
    id(row.id, 'plans.id');
    debt(row.debtId, 'plans.debt');
    text(row.reference, 'plans.reference');
    date(row.effectiveDate, 'plans.effectiveDate', true);
    evidence(row.support, 'plans.support', summary);
    integer(row.version, 'plans.version', 1, 10000);
    if (row.replacesPlanId !== undefined) id(row.replacesPlanId, 'plans.previous');
    text(row.reason, 'plans.reason', 5);
    member(row.recordedBy, 'plans.actor');
    time(row.recordedAt, 'plans.recordedAt');
    const rows = array(row.installments, 'plans.installments', 600);
    if (!rows.length) fail('plans.installments');
    unique(rows, 'plans.installments');
    const numbers = new Set<number>();
    for (const value of rows) {
      const installment = object(value, 'plans.installment');
      const number = integer(installment.number, 'plans.installment.number', 1, 10000);
      if (numbers.has(number)) fail('plans.installment.number');
      numbers.add(number);
      date(installment.dueDate, 'plans.installment.date');
      const parts = componentAmounts(installment, 'plans.installment');
      if (
        decimal(installment.amount, 'plans.installment.amount') !== total(parts) ||
        toCents(String(installment.amount)) <= 0n
      )
        fail('plans.installment.amount');
      text(installment.notes, 'plans.installment.notes', 0);
    }
  }
  for (const row of module.supplierInvoices) {
    const obligation = debt(row.debtId, 'invoices.debt');
    const party = supplier(row.supplierId, 'invoices.supplier');
    if (
      obligation.kind !== 'supplier' ||
      obligation.locationId !== party.locationId ||
      normalized(obligation.creditor) !== normalized(party.name) ||
      row.invoiceReference !== obligation.supplierInvoice ||
      row.amount !== obligation.principal ||
      row.date !== obligation.startDate ||
      row.dueDate !== obligation.supplierDueDate
    )
      fail('invoices.source');
    text(row.invoiceReference, 'invoices.reference');
    date(row.date, 'invoices.date', true);
    date(row.dueDate, 'invoices.due');
    if (row.dueDate < row.date) fail('invoices.due');
    decimal(row.amount, 'invoices.amount');
    choose(row.source, ['historical', 'credit_purchase'], 'invoices.source');
    evidence(row.support, 'invoices.support');
    actorRecord(row, 'invoices', party.locationId);
    const lines = array(row.lines, 'invoices.lines', 1000);
    const movementIds = array(row.inventoryMovementIds, 'invoices.movements', 1000);
    if (new Set(movementIds).size !== movementIds.length) fail('invoices.movements');
    for (const value of lines) {
      const line = object(value, 'invoices.line');
      text(line.description, 'invoices.line.description');
      text(line.category, 'invoices.line.category');
      qty(line.quantity, 'invoices.line.quantity');
      choose(line.unit, ['unit', 'kg', 'm', 'l'], 'invoices.line.unit');
      decimal(line.unitPrice, 'invoices.line.unitPrice');
      decimal(line.totalValue, 'invoices.line.value');
      if (line.itemId !== undefined && !items.has(id(line.itemId, 'invoices.line.item')))
        fail('invoices.line.item');
      if (
        line.warehouseId !== undefined &&
        warehouses.get(id(line.warehouseId, 'invoices.line.warehouse'))?.locationId !== party.locationId
      )
        fail('invoices.line.warehouse');
    }
    for (const movementId of movementIds)
      if (
        !inventory?.movements.some(
          (movement) =>
            movement.id === movementId &&
            movement.debtId === obligation.id &&
            movement.kind === 'credit_purchase',
        )
      )
        fail('invoices.movements');
    if (
      row.source === 'credit_purchase' &&
      !module.supplierPurchases.some((purchase) => purchase.debtId === row.debtId)
    )
      fail('invoices.purchase');
  }
  function inventoryLines(value: unknown, path: string, locationId: string, withValues = false): Row[] {
    const lines = array(value, path, 1000);
    if (!lines.length) fail(path);
    const pairs = new Set<string>();
    return lines.map((value) => {
      const line = object(value, path);
      const product = items.get(id(line.itemId, `${path}.item`));
      const warehouse = warehouses.get(id(line.warehouseId, `${path}.warehouse`));
      if (
        !product ||
        !warehouse ||
        warehouse.locationId !== locationId ||
        !['raw_material', 'supply'].includes(product.inventoryType)
      )
        fail(path);
      qty(line.quantity, `${path}.quantity`);
      try {
        validateItemQuantity(product, String(line.quantity));
      } catch {
        fail(path);
      }
      const pair = `${line.itemId}:${line.warehouseId}`;
      if (pairs.has(pair)) fail(`${path}.duplicate`);
      pairs.add(pair);
      if (line.unitValue !== undefined) decimal(line.unitValue, `${path}.unitValue`);
      if (withValues && toCents(decimal(line.totalValue, `${path}.value`)) <= 0n) fail(`${path}.value`);
      return line;
    });
  }
  for (const row of module.supplierPurchases) {
    const obligation = debt(row.debtId, 'purchases.debt');
    const party = supplier(row.supplierId, 'purchases.supplier');
    if (
      obligation.kind !== 'supplier' ||
      party.locationId !== obligation.locationId ||
      normalized(party.name) !== normalized(obligation.creditor) ||
      row.reference !== obligation.supplierInvoice ||
      row.date !== obligation.startDate
    )
      fail('purchases.source');
    date(row.date, 'purchases.date', true);
    text(row.reference, 'purchases.reference');
    decimal(row.totalValue, 'purchases.total');
    evidence(row.support, 'purchases.support');
    actorRecord(row, 'purchases', party.locationId);
    const lines = inventoryLines(row.lines, 'purchases.lines', party.locationId, true);
    if (
      add(...lines.map((line) => String(line.totalValue))) !== row.totalValue ||
      row.totalValue !== obligation.principal
    )
      fail('purchases.total');
    if (module.supplierPurchases.some((other) => other.id !== row.id && other.debtId === row.debtId))
      fail('purchases.duplicateDebt');
    const invoice = module.supplierInvoices.find(
      (invoice) => invoice.debtId === row.debtId && invoice.source === 'credit_purchase',
    );
    if (
      !invoice ||
      invoice.lines.length !== lines.length ||
      invoice.inventoryMovementIds.length !== lines.length
    )
      fail('purchases.invoice');
    lines.forEach((line, index) => {
      const matches =
        inventory?.movements.filter(
          (movement) => movement.sourceKey === `supplier-credit:${row.id}:${index}`,
        ) ?? [];
      const movement = matches[0];
      if (
        matches.length !== 1 ||
        movement.kind !== 'credit_purchase' ||
        movement.direction !== 'in' ||
        movement.debtId !== row.debtId ||
        movement.cashTransactionId !== undefined ||
        movement.sourceReference !== row.reference ||
        movement.date !== row.date ||
        movement.itemId !== line.itemId ||
        movement.warehouseId !== line.warehouseId ||
        movement.quantity !== line.quantity ||
        movement.totalValue !== line.totalValue ||
        movement.unitValue !== line.unitValue ||
        !invoice.inventoryMovementIds.includes(movement.id)
      )
        fail('purchases.journal');
    });
  }
  for (const row of module.supplierReturns) {
    const purchase = purchases.get(row.purchaseId);
    const party = supplier(row.supplierId, 'returns.supplier');
    if (!purchase || purchase.debtId !== row.debtId || purchase.supplierId !== row.supplierId)
      fail('returns.purchase');
    date(row.date, 'returns.date', true);
    if (row.date < purchase.date) fail('returns.date');
    text(row.reference, 'returns.reference');
    text(row.reason, 'returns.reason');
    evidence(row.support, 'returns.support');
    actorRecord(row, 'returns', party.locationId);
    choose(row.status, ['pending', 'disputed', 'accepted'], 'returns.status');
    const lines = inventoryLines(row.lines, 'returns.lines', party.locationId);
    for (const [index, line] of lines.entries()) {
      const original = purchase.lines.find(
        (value) => value.itemId === line.itemId && value.warehouseId === line.warehouseId,
      );
      if (!original) fail('returns.line.source');
      const returned = module.supplierReturns
        .filter((value) => value.purchaseId === purchase.id)
        .flatMap((value) => value.lines)
        .filter((value) => value.itemId === line.itemId && value.warehouseId === line.warehouseId)
        .reduce((sum, value) => sum + toMicros(value.quantity), 0n);
      if (returned > toMicros(original.quantity)) fail('returns.overreturned');
      const matches =
        inventory?.movements.filter(
          (movement) => movement.sourceKey === `supplier-return:${row.id}:${index}`,
        ) ?? [];
      const movement = matches[0];
      if (
        matches.length !== 1 ||
        movement.kind !== 'supplier_return' ||
        movement.direction !== 'out' ||
        movement.debtId !== row.debtId ||
        movement.supplierReturnId !== row.id ||
        movement.itemId !== line.itemId ||
        movement.warehouseId !== line.warehouseId ||
        movement.quantity !== line.quantity ||
        movement.date !== row.date ||
        movement.cashTransactionId !== undefined
      )
        fail('returns.journal');
    }
    if (
      module.supplierReturns.some(
        (other) =>
          other.id !== row.id && other.supplierId === row.supplierId && other.reference === row.reference,
      )
    )
      fail('returns.reference');
    for (const value of array(row.history, 'returns.history', 1000)) {
      const entry = object(value, 'returns.history');
      date(entry.date, 'returns.history.date', true);
      member(entry.actorId, 'returns.history.actor', party.locationId);
      text(entry.action, 'returns.history.action');
      text(entry.notes, 'returns.history.notes', 0);
    }
    if (row.status === 'accepted') {
      decimal(row.acceptedAmount, 'returns.acceptance.amount');
      date(row.acceptedDate, 'returns.acceptance.date', true);
      if (row.acceptedDate! < row.date) fail('returns.acceptance.date');
      text(row.acceptanceReference, 'returns.acceptance.reference');
      evidence(row.acceptanceSupport, 'returns.acceptance.support');
      member(row.acceptedBy, 'returns.acceptance.actor', party.locationId);
    } else if (
      ['acceptedAmount', 'acceptedDate', 'acceptanceReference', 'acceptanceSupport', 'acceptedBy'].some(
        (key) => (row as unknown as Row)[key] !== undefined,
      )
    )
      fail('returns.unacceptedCredit');
  }
  const templateKeys = new Set<string>();
  for (const row of module.recurringTemplates) {
    site(row.locationId, 'templates.location');
    text(row.name, 'templates.name');
    text(row.creditor, 'templates.creditor');
    text(row.concept, 'templates.concept');
    if (row.frequency !== 'monthly' || (row as unknown as Row).debtId !== undefined)
      fail('templates.frequency');
    bool(row.active, 'templates.active');
    if (row.dueDay !== undefined) integer(row.dueDay, 'templates.dueDay', 1, 31);
    if (row.consumptionUnit !== undefined) text(row.consumptionUnit, 'templates.unit');
    actorRecord(row, 'templates', row.locationId, ['owner', 'admin']);
    const key = `${row.locationId}:${normalized(row.creditor)}:${normalized(row.name)}`;
    if (templateKeys.has(key)) fail('templates.duplicate');
    templateKeys.add(key);
  }
  const billKeys = new Set<string>();
  const billReferences = new Set<string>();
  for (const row of module.recurringBills) {
    const template = templates.get(row.templateId);
    if (!template) fail('bills.template');
    month(row.month, 'bills.month');
    text(row.reference, 'bills.reference');
    date(row.invoiceDate, 'bills.date', true);
    date(row.receivedDate, 'bills.received', true);
    date(row.dueDate, 'bills.due');
    if (row.receivedDate < row.invoiceDate || row.dueDate < row.invoiceDate) fail('bills.dates');
    if (toCents(decimal(row.amount, 'bills.amount')) <= 0n) fail('bills.amount');
    evidence(row.support, 'bills.support');
    text(row.notes, 'bills.notes', 0);
    member(row.receivedBy, 'bills.actor', template.locationId, ['owner', 'admin']);
    time(row.createdAt, 'bills.createdAt');
    if (row.consumption !== undefined) {
      qty(row.consumption, 'bills.consumption', false);
      text(row.consumptionUnit, 'bills.unit');
    } else if (row.consumptionUnit !== undefined) fail('bills.absentConsumption');
    const key = `${row.templateId}:${row.month}`;
    const reference = `${normalized(template.creditor)}:${row.reference}`;
    if (billKeys.has(key) || billReferences.has(reference)) fail('bills.duplicate');
    billKeys.add(key);
    billReferences.add(reference);
    if (
      state.debts.some(
        (debt) =>
          normalized(debt.creditor) === normalized(template.creditor) &&
          (debt.supplierInvoice === row.reference ||
            module.obligations.some(
              (meta) => meta.debtId === debt.id && meta.documentReference === row.reference,
            )),
      )
    )
      fail('bills.duplicateObligation');
  }
  const paidByTransaction = new Map<string, bigint>();
  const paymentIds = new Set(state.debtPayments.map((row) => row.id));
  for (const row of module.cashPaymentLinks) {
    const obligation = debt(row.debtId, 'cashLinks.debt');
    const transaction = source(row.transactionId, 'cashLinks.transaction');
    if (
      paymentIds.has(row.id) ||
      state.debtPayments.some(
        (payment) => payment.transactionId === transaction.id && payment.status !== 'rejected',
      )
    )
      fail('cashLinks.duplicatePayment');
    paymentIds.add(row.id);
    const amounts = componentAmounts(row, 'cashLinks');
    if (decimal(row.amount, 'cashLinks.amount') !== total(amounts) || toCents(row.amount) <= 0n)
      fail('cashLinks.amount');
    date(row.date, 'cashLinks.date', true);
    if (
      row.date !== transaction.date ||
      row.date < obligation.startDate ||
      transaction.locationId !== obligation.locationId ||
      normalized(transaction.party) !== normalized(obligation.creditor)
    )
      fail('cashLinks.source');
    sourceProof(transaction, 'cashLinks.support');
    text(row.reference, 'cashLinks.reference');
    actorRecord(row, 'cashLinks', obligation.locationId);
    paidByTransaction.set(
      transaction.id,
      (paidByTransaction.get(transaction.id) ?? 0n) + toCents(row.amount),
    );
  }
  for (const row of module.recurringPayments) {
    const bill = bills.get(row.billId);
    const template = templates.get(bill?.templateId ?? '');
    if (!bill || !template) fail('recurringPayments.bill');
    const transaction = source(row.transactionId, 'recurringPayments.transaction');
    date(row.date, 'recurringPayments.date', true);
    if (
      row.date !== transaction.date ||
      row.date < bill.invoiceDate ||
      transaction.locationId !== template.locationId ||
      normalized(transaction.party) !== normalized(template.creditor)
    )
      fail('recurringPayments.source');
    if (
      paymentIds.has(row.id) ||
      state.debtPayments.some(
        (payment) => payment.transactionId === transaction.id && payment.status !== 'rejected',
      )
    )
      fail('recurringPayments.duplicate');
    paymentIds.add(row.id);
    if (toCents(decimal(row.amount, 'recurringPayments.amount')) <= 0n) fail('recurringPayments.amount');
    sourceProof(transaction, 'recurringPayments.support');
    actorRecord(row, 'recurringPayments', template.locationId);
    paidByTransaction.set(
      transaction.id,
      (paidByTransaction.get(transaction.id) ?? 0n) + toCents(row.amount),
    );
    const totalPaid = module.recurringPayments
      .filter((payment) => payment.billId === bill.id)
      .reduce((sum, payment) => sum + toCents(payment.amount), 0n);
    if (totalPaid > toCents(bill.amount)) fail('recurringPayments.overpaid');
  }
  for (const [transactionId, paid] of paidByTransaction)
    if (paid > toCents(source(transactionId, 'payments.transaction').amount)) fail('payments.overspent');
  const actual = new Map(getActualDebtModulePayments(state).map((row) => [row.id, row]));
  const allocationRefs = new Set<string>();
  for (const row of module.installmentAllocations) {
    const plan = plans.get(row.planId);
    const installment = plan?.installments.find((value) => value.id === row.installmentId);
    const payment = actual.get(row.debtPaymentId);
    if (!plan || !installment || !payment || payment.debtId !== plan.debtId || payment.date !== row.date)
      fail('allocations.source');
    const amounts = componentAmounts(row, 'allocations');
    if (toCents(total(amounts)) <= 0n) fail('allocations.amount');
    text(row.reference, 'allocations.reference');
    date(row.date, 'allocations.date', true);
    actorRecord(row, 'allocations', debt(plan.debtId, 'allocations.debt').locationId);
    const key = `${row.debtPaymentId}:${row.reference}`;
    if (allocationRefs.has(key)) fail('allocations.duplicate');
    allocationRefs.add(key);
    for (const field of COMPONENTS) {
      const paid = module.installmentAllocations
        .filter((value) => value.debtPaymentId === row.debtPaymentId)
        .reduce((sum, value) => sum + toCents(value[field]), 0n);
      const applied = module.installmentAllocations
        .filter((value) => value.planId === row.planId && value.installmentId === row.installmentId)
        .reduce((sum, value) => sum + toCents(value[field]), 0n);
      if (paid > toCents(payment[field]) || applied > toCents(installment[field]))
        fail(`allocations.${field}.overapplied`);
    }
  }
  const extraordinarySources = new Set<string>();
  for (const row of module.extraordinaryPayments) {
    const payment = actual.get(row.debtPaymentId);
    if (
      !payment ||
      payment.principal !== payment.amount ||
      COMPONENTS.some((key) => key !== 'principal' && payment[key] !== '0.00') ||
      module.installmentAllocations.some((value) => value.debtPaymentId === payment.id) ||
      extraordinarySources.has(payment.id)
    )
      fail('extraordinaryPayments.source');
    extraordinarySources.add(payment.id);
    date(row.date, 'extraordinaryPayments.date', true);
    if (row.date !== payment.date) fail('extraordinaryPayments.date');
    text(row.reference, 'extraordinaryPayments.reference');
    text(row.notes, 'extraordinaryPayments.notes', 5);
    evidence(row.support, 'extraordinaryPayments.support');
    actorRecord(row, 'extraordinaryPayments', debt(payment.debtId, 'extraordinaryPayments.debt').locationId);
  }

  function validateReconciliation(row: DebtModuleState['reconciliations'][number], summary = false) {
    const obligation = debt(row.debtId, 'reconciliation.debt');
    date(row.date, 'reconciliation.date', true);
    text(row.reference, 'reconciliation.reference');
    text(row.notes, 'reconciliation.notes', 0);
    const statement = decimal(row.statementPrincipal, 'reconciliation.statement');
    const book = decimal(row.bookPrincipal, 'reconciliation.book');
    const difference = decimal(row.difference, 'reconciliation.difference', false);
    if (
      toCents(statement) - toCents(book) !== toCents(difference) ||
      row.status !== (difference === '0.00' ? 'matched' : 'difference')
    )
      fail('reconciliation.bridge');
    evidence(row.support, 'reconciliation.support', summary);
    actorRecord(row, 'reconciliation', obligation.locationId);
  }

  function validateRequest(row: DebtModuleState['requests'][number], summary = false) {
    const obligation = row.debtId ? debt(row.debtId, 'requests.debt') : undefined;
    const bill = row.billId ? bills.get(row.billId) : undefined;
    if ((row.billId && !bill) || Boolean(obligation) === Boolean(bill)) fail('requests.source');
    choose(
      row.kind,
      [
        'bank_origin',
        'investment_renegotiation',
        'correction',
        'exceptional_adjustment',
        'closed_period_change',
      ],
      'requests.kind',
    );
    const reserved = row.kind === 'bank_origin' || row.kind === 'investment_renegotiation';
    if (
      row.status !== 'pending_institutional' ||
      row.requiredAuthority !== (reserved ? 'creator_or_manager' : 'not_defined') ||
      (row.kind === 'bank_origin' && obligation?.kind !== 'loan') ||
      (row.kind === 'investment_renegotiation' && obligation?.kind !== 'investment')
    )
      fail('requests.authority');
    date(row.effectiveDate, 'requests.date');
    text(row.reason, 'requests.reason', 5);
    if (text(row.before, 'requests.before').includes(';base64,')) fail('requests.before');
    if (row.proposedPrincipal !== undefined) decimal(row.proposedPrincipal, 'requests.principal');
    if (row.proposedMonthlyRate !== undefined) rateFraction(row.proposedMonthlyRate);
    if (row.proposedTerminationDate !== undefined) date(row.proposedTerminationDate, 'requests.termination');
    if (row.proposedConditions !== undefined) text(row.proposedConditions, 'requests.conditions', 0);
    evidence(row.support, 'requests.support', summary);
    member(
      row.requestedBy,
      'requests.actor',
      obligation?.locationId ?? templates.get(bill!.templateId)?.locationId,
    );
    time(row.createdAt, 'requests.timestamp');
  }

  function validateIssue(row: DebtModuleState['alerts'][number]) {
    id(row.id, 'alerts.id');
    text(row.type, 'alerts.type');
    text(row.title, 'alerts.title');
    text(row.description, 'alerts.description', 0);
    choose(row.category, CATEGORIES, 'alerts.category');
    choose(row.severity, ['critical', 'warning', 'info'], 'alerts.severity');
    choose(row.status, ['open', 'resolved'], 'alerts.status');
    const location = site(row.locationId, 'alerts.site');
    date(row.date, 'alerts.date');
    if (row.amount !== undefined) decimal(row.amount, 'alerts.amount', false);
    if (row.debtId !== undefined && debt(row.debtId, 'alerts.debt').locationId !== location)
      fail('alerts.debtSite');
    if (
      row.billId !== undefined &&
      templates.get(bills.get(row.billId)?.templateId ?? '')?.locationId !== location
    )
      fail('alerts.billSite');
    if (row.templateId !== undefined && templates.get(row.templateId)?.locationId !== location)
      fail('alerts.templateSite');
    if (row.creditor !== undefined) text(row.creditor, 'alerts.creditor');
    for (const value of array(row.history, 'alerts.history', 1000)) {
      const event = object(value, 'alerts.history');
      date(text(event.date, 'alerts.history.date').slice(0, 10), 'alerts.history.date');
      member(event.actorId, 'alerts.history.actor', location);
      text(event.action, 'alerts.history.action');
    }
  }

  module.reconciliations.forEach((row) => validateReconciliation(row));
  module.requests.forEach((row) => validateRequest(row));
  module.alerts.forEach(validateIssue);
  for (const review of module.reviews) {
    const issue = module.alerts.find((row) => row.id === review.alertId);
    if (!issue) fail('reviews.alert');
    date(review.date, 'reviews.date', true);
    text(review.reason, 'reviews.reason', 5);
    if (review.conditionSignature !== undefined)
      text(review.conditionSignature, 'reviews.signature', 1, 5000);
    evidence(review.support, 'reviews.support');
    actorRecord(review, 'reviews', issue.locationId);
  }

  for (const obligation of state.debts) {
    const balance = getDebtModulePrincipalBalance(state, obligation.id);
    const reserved = state.debtPayments
      .filter((payment) => payment.debtId === obligation.id && payment.status === 'pending')
      .reduce((sum, payment) => sum + toCents(payment.principal), 0n);
    if (toCents(balance) < reserved) fail('obligations.reservedPrincipal');
    for (const payment of getActualDebtModulePayments(state, obligation.id)) {
      if (
        module.obligations.some((row) => row.debtId === obligation.id) &&
        getDebtCapitalBasis(state, obligation.id, payment.date) === '0.00'
      )
        fail('payments.unconfirmedOrigin');
    }
  }

  const months = new Set<string>();
  const reportFields = [
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
  for (const closure of module.monthClosures) {
    const period = month(closure.month, 'closures.month');
    if (
      months.has(period) ||
      closure.scope !== 'local' ||
      closure.status !== 'closed' ||
      closure.version !== 1
    )
      fail('closures.duplicate');
    months.add(period);
    const closedAt = time(closure.closedAt, 'closures.timestamp');
    member(closure.closedBy, 'closures.actor', undefined, ['owner']);
    text(closure.notes, 'closures.notes', 0);
    const report = closure.report;
    object(report, 'closures.report');
    const lastDate = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10);
    if (
      report.startDate !== period + '-01' ||
      report.endDate !== lastDate ||
      report.endDate > todayBogota() ||
      report.scope !== 'local' ||
      report.status !== 'closed' ||
      report.closedAt !== closedAt ||
      report.closedBy !== closure.closedBy ||
      report.version !== closure.version
    )
      fail('closures.report');
    time(report.generatedAt, 'closures.report.timestamp');
    bool(report.reconciled, 'closures.reconciled');
    if (report.category !== undefined || report.locationId !== undefined) fail('closures.scope');
    unique(array(report.rows, 'closures.rows'), 'closures.rows');
    object(report.totals, 'closures.totals');
    for (const row of report.rows) {
      choose(row.category, CATEGORIES, 'closures.row.category');
      const location = site(row.locationId, 'closures.row.site');
      const obligation = row.debtId ? debt(row.debtId, 'closures.row.debt') : undefined;
      const bill = row.billId ? bills.get(row.billId) : undefined;
      if (
        row.category === 'recurring'
          ? !bill || row.debtId || templates.get(bill.templateId)?.locationId !== location
          : !obligation ||
            row.billId ||
            obligation.locationId !== location ||
            categoryFor(obligation.kind) !== row.category
      )
        fail('closures.row.source');
      text(row.creditor, 'closures.row.creditor');
      text(row.concept, 'closures.row.concept');
      text(row.documentReference, 'closures.row.reference');
      bool(row.supportMissing, 'closures.row.support');
      choose(
        row.status,
        [
          'pending_funding',
          'pending_authorization',
          'current',
          'upcoming',
          'overdue',
          'partially_paid',
          'paid',
        ],
        'closures.row.status',
      );
      if (row.dueDate !== undefined) date(row.dueDate, 'closures.row.due');
      for (const field of reportFields)
        decimal(
          row[field],
          'closures.row.' + field,
          !['newObligations', 'documentedAdjustments'].includes(field),
        );
      const bridge =
        toCents(row.openingBalance) +
        toCents(row.newObligations) +
        toCents(row.documentedAdjustments) -
        toCents(row.principalPaid) -
        toCents(row.noncashScrap) -
        toCents(row.acceptedReturns);
      if (
        bridge !== toCents(row.closingBalance) ||
        add(row.principalPaid, row.interestPaid, row.insurancePaid, row.commissionPaid, row.lateFeePaid) !==
          row.cashPaid
      )
        fail('closures.row.bridge');
    }
    for (const field of reportFields) {
      if (
        decimal(report.totals[field], 'closures.totals.' + field, false) !==
        add(...report.rows.map((row) => row[field]))
      )
        fail('closures.totals.bridge');
    }
    unique(array(report.movements, 'closures.movements'), 'closures.movements');
    for (const movement of report.movements) {
      const effective = date(movement.date, 'closures.movement.date');
      if (effective < report.startDate || effective > report.endDate) fail('closures.movement.date');
      choose(
        movement.kind,
        ['cash_payment', 'scrap_offset', 'accepted_return', 'new_obligation', 'opening', 'recurring_bill'],
        'closures.movement.kind',
      );
      choose(movement.category, CATEGORIES, 'closures.movement.category');
      site(movement.locationId, 'closures.movement.site');
      text(movement.creditor, 'closures.movement.creditor');
      text(movement.documentReference, 'closures.movement.document');
      text(movement.sourceReference, 'closures.movement.source');
      if (movement.supportName !== undefined) text(movement.supportName, 'closures.movement.support');
      const amounts = componentAmounts(movement, 'closures.movement');
      const amount = decimal(movement.total, 'closures.movement.total', false);
      if (movement.kind === 'cash_payment' && amount !== total(amounts)) fail('closures.movement.components');
    }
    unique(array(report.calendar, 'closures.calendar'), 'closures.calendar');
    for (const entry of report.calendar) {
      choose(
        entry.source,
        ['official_installment', 'supplier_invoice', 'recurring_bill'],
        'closures.calendar.source',
      );
      choose(entry.category, CATEGORIES, 'closures.calendar.category');
      choose(
        entry.status,
        ['upcoming', 'overdue', 'partially_paid', 'paid', 'future'],
        'closures.calendar.status',
      );
      site(entry.locationId, 'closures.calendar.site');
      date(entry.dueDate, 'closures.calendar.due');
      text(entry.creditor, 'closures.calendar.creditor');
      text(entry.concept, 'closures.calendar.concept');
      decimal(entry.amount, 'closures.calendar.amount');
      decimal(entry.paidAmount, 'closures.calendar.paid');
      decimal(entry.remaining, 'closures.calendar.remaining');
      if (entry.official !== true || add(entry.paidAmount, entry.remaining) !== entry.amount)
        fail('closures.calendar.bridge');
    }
    unique(array(report.issues, 'closures.issues'), 'closures.issues');
    report.issues.forEach(validateIssue);
    unique(array(report.plans, 'closures.plans'), 'closures.plans');
    report.plans.forEach((row) => validatePlan(row, true));
    unique(array(report.reconciliations, 'closures.reconciliations'), 'closures.reconciliations');
    report.reconciliations.forEach((row) => validateReconciliation(row, true));
    unique(array(report.requests, 'closures.requests'), 'closures.requests');
    report.requests.forEach((row) => validateRequest(row, true));
  }
}
