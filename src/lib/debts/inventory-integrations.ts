import type { Actor, Money, State, Support } from '../finance/types';
import { createDebt, getDebtBalance, todayBogota } from '../finance/engine';
import { money, add, toCents } from '../finance/money';
import { validateDate } from '../finance/amortization';
import { validateCashSupport } from '../finance/cash';
import { getInventoryState, getInventoryStock } from '../inventory/engine';
import { quantity, validateItemQuantity, toMicros } from '../inventory/quantity';
import { getDebtModuleState, registerSupplierInvoice } from './engine';
import type { DebtSupplierPurchase, DebtSupplierReturn, SupplierDocumentLine } from './types';
import type { InventoryLine, InventoryMovement } from '../inventory/types';

function auth(state: State, actor: Actor, locationId: string) {
  const member = state.members.find(
    (row) => row.id === actor.id && row.role === actor.role && row.name === actor.name && row.active,
  );
  if (
    !member ||
    !['owner', 'admin', 'accounting', 'treasury'].includes(member.role) ||
    !member.locationIds.includes(locationId)
  )
    throw new Error('No tienes permiso de registro financiero en esta sede.');
}
function actualDate(value: string) {
  validateDate(value);
  if (value > todayBogota()) throw new Error('La fecha efectiva no puede ser futura.');
}
function text(value: string, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000)
    throw new Error(`${label} es obligatorio y admite hasta 2000 caracteres.`);
  return value.trim();
}
function proof(support: Support) {
  validateCashSupport(support);
  if (!support?.dataUrl) throw new Error('Adjunta el documento de compra, devolución o aceptación.');
}
function open(state: State, date: string, inventoryType?: string) {
  actualDate(date);
  if (
    getDebtModuleState(state).monthClosures.some((row) => row.month >= date.slice(0, 7)) ||
    (inventoryType &&
      getInventoryState(state).monthClosures.some(
        (row) => row.inventoryType === inventoryType && row.month >= date.slice(0, 7),
      ))
  )
    throw new Error('El período está cerrado; solicita una corrección institucional.');
}
function audit(state: State, actor: Actor, entityId: string, action: string, reason: string) {
  state.audit.unshift({
    id: crypto.randomUUID(),
    action,
    entityType: 'supplier_inventory',
    entityId,
    actorId: actor.id,
    actorName: actor.name,
    timestamp: new Date().toISOString(),
    reason: reason.slice(0, 2000),
  });
}
function normalizeLines(
  state: State,
  rows: (InventoryLine & { totalValue?: Money })[],
  date: string,
  actor: Actor,
  locationId: string,
  allowZeroValue = false,
) {
  const inventory = getInventoryState(state);
  if (!rows.length || rows.length > 1000) throw new Error('Incluye entre 1 y 1000 renglones.');
  const seen = new Set<string>();
  return rows.map((row) => {
    const item = inventory.items.find((item) => item.id === row.itemId && item.active);
    const warehouse = inventory.warehouses.find(
      (warehouse) =>
        warehouse.id === row.warehouseId && warehouse.active && warehouse.locationId === locationId,
    );
    if (!item || !warehouse || !['raw_material', 'supply'].includes(item.inventoryType))
      throw new Error('Selecciona materia prima o insumos y una bodega de la sede del proveedor.');
    auth(state, actor, warehouse.locationId);
    open(state, date, item.inventoryType);
    if (
      !inventory.origins.some(
        (origin) =>
          origin.inventoryType === item.inventoryType && origin.status === 'posted' && origin.date <= date,
      )
    )
      throw new Error('Sella primero el ORIGEN documentado de este inventario, incluso cuando sea cero.');
    const key = `${row.itemId}:${row.warehouseId}`;
    if (seen.has(key)) throw new Error('El documento repite una referencia en la misma bodega.');
    seen.add(key);
    const amount = row.totalValue === undefined ? undefined : money(row.totalValue);
    if (amount !== undefined && (allowZeroValue ? toCents(amount) < 0n : toCents(amount) <= 0n))
      throw new Error('El valor del renglón debe ser positivo.');
    return {
      ...row,
      quantity: validateItemQuantity(item, row.quantity),
      ...(amount === undefined ? {} : { totalValue: amount }),
      ...(row.unitValue === undefined ? {} : { unitValue: money(row.unitValue) }),
    };
  });
}
function movement(
  state: State,
  line: InventoryLine,
  actor: Actor,
  data: Pick<
    InventoryMovement,
    | 'date'
    | 'direction'
    | 'kind'
    | 'sourceKey'
    | 'sourceReference'
    | 'responsible'
    | 'support'
    | 'notes'
    | 'debtId'
    | 'supplierReturnId'
    | 'totalValue'
  >,
) {
  const inv = state.inventory!;
  if (inv.movements.some((row) => row.sourceKey === data.sourceKey))
    throw new Error('Este renglón ya fue incorporado al inventario.');
  inv.movements.push({
    ...line,
    ...data,
    id: crypto.randomUUID(),
    inventoryType: inv.items.find((row) => row.id === line.itemId)!.inventoryType,
    actorId: actor.id,
    createdAt: new Date().toISOString(),
  });
}

export interface SupplierCreditPurchaseInput {
  idempotencyKey: string;
  supplierId: string;
  date: string;
  dueDate: string;
  reference: string;
  support: Support;
  lines: (InventoryLine & { totalValue: Money })[];
  notes?: string;
}
/** Create one documented payable and its linked receipt, without a cash entry. */
export function receiveSupplierCreditPurchase(
  state: State,
  input: SupplierCreditPurchaseInput,
  actor: Actor,
): State {
  const module = getDebtModuleState(state);
  const supplier = module.suppliers.find((row) => row.id === input.supplierId && row.active);
  if (!supplier) throw new Error('Selecciona un proveedor activo del directorio único.');
  auth(state, actor, supplier.locationId);
  open(state, input.date);
  validateDate(input.dueDate);
  if (input.dueDate < input.date) throw new Error('El vencimiento no puede ser anterior a la factura.');
  proof(input.support);
  const reference = text(input.reference, 'La factura');
  const id = text(input.idempotencyKey, 'La clave del documento');
  const previous = module.supplierPurchases.find((row) => row.id === id);
  if (previous) {
    if (
      previous.supplierId === supplier.id &&
      previous.reference === reference &&
      previous.date === input.date &&
      state.debts.find((debt) => debt.id === previous.debtId)?.supplierDueDate === input.dueDate &&
      JSON.stringify(previous.support) === JSON.stringify(input.support) &&
      JSON.stringify(previous.lines) ===
        JSON.stringify(
          input.lines.map((line) => ({
            ...line,
            quantity: quantity(line.quantity),
            totalValue: money(line.totalValue),
            ...(line.unitValue === undefined ? {} : { unitValue: money(line.unitValue) }),
          })),
        )
    )
      return state;
    throw new Error('La clave ya fue utilizada para otra compra.');
  }
  const lines = normalizeLines(
    state,
    input.lines,
    input.date,
    actor,
    supplier.locationId,
  ) as (InventoryLine & { totalValue: Money })[];
  const totalValue = add(...lines.map((row) => row.totalValue));
  const beforeIds = new Set(state.debts.map((row) => row.id));
  let next = createDebt(
    state,
    {
      creditor: supplier.name,
      kind: 'supplier',
      supplierInvoice: reference,
      supplierDueDate: input.dueDate,
      principal: totalValue,
      monthlyRate: '0.00',
      installments: 1,
      startDate: input.date,
      dueDay: Number(input.dueDate.slice(8)),
      method: 'fixed_principal',
      locationId: supplier.locationId,
      contract: input.support,
      notes: input.notes?.trim() ?? 'Compra a crédito documentada; sin egreso de Caja.',
    },
    actor,
  );
  const debt = next.debts.find((row) => !beforeIds.has(row.id))!;
  next.debtModule = structuredClone(module);
  next.inventory = structuredClone(getInventoryState(state));
  const createdAt = new Date().toISOString();
  const purchase: DebtSupplierPurchase = {
    id,
    debtId: debt.id,
    supplierId: supplier.id,
    date: input.date,
    reference,
    lines,
    totalValue,
    support: input.support,
    actorId: actor.id,
    createdAt,
  };
  next.debtModule.supplierPurchases.push(purchase);
  lines.forEach((line, index) =>
    movement(next, line, actor, {
      date: input.date,
      direction: 'in',
      kind: 'credit_purchase',
      sourceKey: `supplier-credit:${id}:${index}`,
      sourceReference: reference,
      responsible: supplier.name,
      support: input.support,
      notes: input.notes ?? '',
      debtId: debt.id,
      totalValue: line.totalValue,
    }),
  );
  const documentLines: SupplierDocumentLine[] = lines.map((line) => {
    const item = next.inventory!.items.find((row) => row.id === line.itemId)!;
    return {
      itemId: line.itemId,
      warehouseId: line.warehouseId,
      description: item.description,
      category: item.category,
      quantity: line.quantity,
      unit: item.unit,
      unitPrice: line.unitValue ?? '0.00',
      totalValue: line.totalValue,
    };
  });
  next = registerSupplierInvoice(
    next,
    {
      debtId: debt.id,
      supplierId: supplier.id,
      invoiceReference: reference,
      date: input.date,
      dueDate: input.dueDate,
      source: 'credit_purchase',
      support: input.support,
      lines: documentLines,
      inventoryMovementIds: next
        .inventory!.movements.filter((row) => row.sourceKey.startsWith(`supplier-credit:${id}:`))
        .map((row) => row.id),
    },
    actor,
  );
  audit(
    next,
    actor,
    id,
    'Compra a crédito recibida en Inventarios',
    `${reference}; obligación ${debt.id}; ${totalValue} COP; sin ingreso ni egreso de Caja.`,
  );
  return next;
}

export interface SupplierReturnInput {
  idempotencyKey: string;
  purchaseId: string;
  date: string;
  reference: string;
  lines: InventoryLine[];
  reason: string;
  support: Support;
}
/** A physical dispatch preserves the pending claim; it does not grant supplier credit. */
export function dispatchSupplierReturn(state: State, input: SupplierReturnInput, actor: Actor): State {
  const module = getDebtModuleState(state);
  const purchase = module.supplierPurchases.find((row) => row.id === input.purchaseId);
  if (!purchase) throw new Error('Selecciona la compra a crédito original.');
  const supplier = module.suppliers.find((row) => row.id === purchase.supplierId)!;
  auth(state, actor, supplier.locationId);
  open(state, input.date);
  proof(input.support);
  if (input.date < purchase.date) throw new Error('La devolución no puede ser anterior a la compra.');
  const reference = text(input.reference, 'El documento de devolución');
  const reason = text(input.reason, 'El motivo');
  const id = text(input.idempotencyKey, 'La clave de devolución');
  const previous = module.supplierReturns.find((row) => row.id === id);
  if (previous) {
    if (
      JSON.stringify(previous.support) === JSON.stringify(input.support) &&
      previous.purchaseId === purchase.id &&
      previous.reference === reference &&
      previous.date === input.date &&
      previous.reason === reason &&
      JSON.stringify(previous.lines) ===
        JSON.stringify(input.lines.map((row) => ({ ...row, quantity: quantity(row.quantity) })))
    )
      return state;
    throw new Error('La clave ya se utilizó en otra devolución.');
  }
  if (module.supplierReturns.some((row) => row.supplierId === supplier.id && row.reference === reference))
    throw new Error('El documento de devolución ya existe.');
  const lines = normalizeLines(state, input.lines, input.date, actor, supplier.locationId);
  for (const line of lines) {
    const source = purchase.lines.find(
      (row) => row.itemId === line.itemId && row.warehouseId === line.warehouseId,
    );
    const returned = module.supplierReturns
      .filter((row) => row.purchaseId === purchase.id)
      .flatMap((row) => row.lines)
      .filter((row) => row.itemId === line.itemId && row.warehouseId === line.warehouseId)
      .reduce((sum, row) => sum + toMicros(row.quantity), 0n);
    if (!source || returned + toMicros(line.quantity) > toMicros(source.quantity))
      throw new Error('La devolución supera lo recibido en esa factura y bodega.');
    if (toMicros(getInventoryStock(state, line).available) < toMicros(line.quantity))
      throw new Error('No hay existencias disponibles para devolver esa cantidad.');
    if (
      getInventoryState(state).movements.some(
        (row) => row.itemId === line.itemId && row.warehouseId === line.warehouseId && row.date > input.date,
      )
    )
      throw new Error('No se puede retroceder la salida antes de movimientos posteriores.');
  }
  const next = structuredClone(state);
  next.debtModule = structuredClone(module);
  next.inventory = structuredClone(getInventoryState(state));
  const record: DebtSupplierReturn = {
    id,
    purchaseId: purchase.id,
    debtId: purchase.debtId,
    supplierId: supplier.id,
    date: input.date,
    reference,
    lines,
    reason,
    support: input.support,
    status: 'pending',
    actorId: actor.id,
    createdAt: new Date().toISOString(),
    history: [
      {
        date: input.date,
        actorId: actor.id,
        action: 'Material despachado; crédito de proveedor pendiente',
        notes: reason,
      },
    ],
  };
  next.debtModule.supplierReturns.push(record);
  lines.forEach((line, index) =>
    movement(next, line, actor, {
      date: input.date,
      direction: 'out',
      kind: 'supplier_return',
      sourceKey: `supplier-return:${id}:${index}`,
      sourceReference: reference,
      responsible: supplier.name,
      support: input.support,
      notes: reason,
      debtId: purchase.debtId,
      supplierReturnId: id,
    }),
  );
  audit(
    next,
    actor,
    id,
    'Devolución a proveedor despachada sin reducir deuda',
    `${reference}; factura ${purchase.reference}; pendiente de aceptación documentada.`,
  );
  return next;
}

export function disputeSupplierReturn(
  state: State,
  input: { returnId: string; reason: string },
  actor: Actor,
): State {
  const module = getDebtModuleState(state);
  const record = module.supplierReturns.find((row) => row.id === input.returnId);
  if (!record || record.status === 'accepted') throw new Error('La devolución no está pendiente.');
  const supplier = module.suppliers.find((row) => row.id === record.supplierId)!;
  auth(state, actor, supplier.locationId);
  open(state, todayBogota());
  const reason = text(input.reason, 'El motivo de disputa');
  const next = structuredClone(state);
  next.debtModule = structuredClone(module);
  const target = next.debtModule.supplierReturns.find((row) => row.id === record.id)!;
  target.status = 'disputed';
  target.history.push({
    date: todayBogota(),
    actorId: actor.id,
    action: 'Devolución en disputa; deuda sin reducción',
    notes: reason,
  });
  audit(next, actor, target.id, 'Disputa de devolución documentada', reason);
  return next;
}

export function acceptSupplierReturn(
  state: State,
  input: { returnId: string; date: string; amount: Money; reference: string; support: Support },
  actor: Actor,
): State {
  const module = getDebtModuleState(state);
  const record = module.supplierReturns.find((row) => row.id === input.returnId);
  if (!record || record.status === 'accepted')
    throw new Error(
      'La devolución no existe o ya fue aceptada; una corrección requiere autorización institucional.',
    );
  const supplier = module.suppliers.find((row) => row.id === record.supplierId)!;
  auth(state, actor, supplier.locationId);
  open(state, input.date);
  if (input.date < record.date) throw new Error('La aceptación no puede ser anterior al despacho.');
  proof(input.support);
  const reference = text(input.reference, 'La aceptación o nota crédito');
  const amount = money(input.amount);
  const reserved = state.debtPayments
    .filter((row) => row.debtId === record.debtId && row.status === 'pending')
    .reduce((sum, row) => sum + toCents(row.principal), 0n);
  if (toCents(amount) < 0n || toCents(amount) > toCents(getDebtBalance(state, record.debtId)) - reserved)
    throw new Error('El valor reconocido supera el saldo de proveedor disponible tras pagos por aprobar.');
  if (
    module.supplierReturns.some(
      (row) =>
        row.id !== record.id && row.supplierId === record.supplierId && row.acceptanceReference === reference,
    )
  )
    throw new Error('La nota crédito ya fue aplicada a otra devolución.');
  const next = structuredClone(state);
  next.debtModule = structuredClone(module);
  const target = next.debtModule.supplierReturns.find((row) => row.id === record.id)!;
  Object.assign(target, {
    status: 'accepted',
    acceptedDate: input.date,
    acceptedAmount: amount,
    acceptanceReference: reference,
    acceptanceSupport: input.support,
    acceptedBy: actor.id,
  });
  target.history.push({
    date: input.date,
    actorId: actor.id,
    action: 'Aceptación documentada; reduce únicamente el importe reconocido',
    notes: `${reference}; ${amount} COP`,
  });
  audit(
    next,
    actor,
    target.id,
    'Devolución aceptada por proveedor aplicada a su deuda',
    `${record.reference} → ${reference}; ${amount} COP; no modifica Caja ni duplica la salida de Inventarios.`,
  );
  return next;
}
