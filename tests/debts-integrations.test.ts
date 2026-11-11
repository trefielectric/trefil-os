import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyState,
  getDebtBalance,
  getAccountBalance,
  recordDebtPayment,
  type State,
  type Support,
} from '../src/lib/finance';
import { createDebtSupplier, getDebtModuleState } from '../src/lib/debts';
import {
  acceptSupplierReturn,
  dispatchSupplierReturn,
  disputeSupplierReturn,
  receiveSupplierCreditPurchase,
} from '../src/lib/debts/inventory-integrations';
import {
  createInventoryItem,
  getInventoryState,
  getInventoryStock,
  postInventoryOrigin,
  registerInventoryPrice,
  saveInventoryOriginDraft,
} from '../src/lib/inventory';
import { createInventoryWorkbook } from '../src/lib/inventory-report-export';
import { getInventoryReport } from '../src/lib/inventory';
import { inspectDemoState } from '../src/lib/demo-state';
const proof: Support = {
  name: 'documento-integracion.pdf',
  type: 'application/pdf',
  size: 3,
  dataUrl: 'data:application/pdf;base64,AQID',
};
function base() {
  let state = createEmptyState();
  const actor = state.members[0];
  state = createDebtSupplier(
    state,
    {
      identification: 'NIT-TEST-DEUDAS',
      name: 'Proveedor integrado de prueba',
      locationId: 'sede-principal',
      active: true,
    },
    actor,
  );
  state = createInventoryItem(
    state,
    {
      code: 'MP-CREDITO-TEST',
      description: 'Material aislado de integración',
      inventoryType: 'raw_material',
      unit: 'kg',
      category: 'Material de prueba',
      active: true,
    },
    actor,
  );
  const inv = getInventoryState(state);
  const item = inv.items[0];
  state = saveInventoryOriginDraft(
    state,
    {
      inventoryType: 'raw_material',
      date: '2026-10-01',
      sourceReference: 'ORIGEN-CREDITO-TEST',
      responsible: actor.name,
      support: proof,
      lines: inv.warehouses.map((row) => ({ itemId: item.id, warehouseId: row.id, quantity: '0.000000' })),
    },
    actor,
  );
  state = postInventoryOrigin(state, state.inventory!.origins[0].id, actor);
  return state;
}
function purchaseInput(state: State) {
  const inv = state.inventory!;
  return {
    idempotencyKey: 'credit-purchase-test-unique',
    supplierId: getDebtModuleState(state).suppliers[0].id,
    date: '2026-10-10',
    dueDate: '2026-10-31',
    reference: 'FACT-CREDITO-TEST',
    support: proof,
    lines: [
      {
        itemId: inv.items[0].id,
        warehouseId: inv.warehouses[0].id,
        quantity: '10.000000',
        unitValue: '100.00',
        totalValue: '1000.00',
      },
    ],
  };
}
function purchased() {
  const state = base();
  return receiveSupplierCreditPurchase(state, purchaseInput(state), state.members[0]);
}
function returnInput(state: State) {
  const inv = state.inventory!;
  return {
    idempotencyKey: 'supplier-return-test-unique',
    purchaseId: getDebtModuleState(state).supplierPurchases[0].id,
    date: '2026-10-20',
    reference: 'DEV-CREDITO-TEST',
    reason: 'Material realmente despachado para devolución de prueba',
    support: proof,
    lines: [{ itemId: inv.items[0].id, warehouseId: inv.warehouses[0].id, quantity: '2.000000' }],
  };
}

test('credit purchase atomically increases supplier payable and correct stock without any cash entry', () => {
  const state = base();
  const before = JSON.stringify(state);
  const input = purchaseInput(state);
  const next = receiveSupplierCreditPurchase(state, input, state.members[0]);
  assert.equal(JSON.stringify(state), before);
  assert.equal(next.debts.length, 1);
  assert.equal(getDebtBalance(next, next.debts[0].id), '1000.00');
  assert.equal(next.transactions.length, 0);
  assert.equal(next.accounts.length, 0);
  assert.equal(getInventoryStock(next, next.inventory!.movements[0]).theoretical, '10.000000');
  assert.equal(
    getInventoryStock(next, { itemId: input.lines[0].itemId, warehouseId: next.inventory!.warehouses[1].id })
      .theoretical,
    '0.000000',
  );
  assert.equal(next.inventory!.movements[0].debtId, next.debts[0].id);
  assert.equal(getDebtModuleState(next).supplierInvoices[0].invoiceReference, input.reference);
  assert.equal(receiveSupplierCreditPurchase(next, input, state.members[0]), next);
  assert.throws(
    () =>
      receiveSupplierCreditPurchase(
        next,
        { ...input, idempotencyKey: 'another-credit-id' },
        state.members[0],
      ),
    /ya existe/,
  );
  assert(inspectDemoState(next).ok);
});

test('return dispatch and dispute preserve debt; acceptance reduces only the documented value once', () => {
  const state = purchased();
  const actor = state.members[0];
  const debtId = state.debts[0].id;
  const input = returnInput(state);
  let next = dispatchSupplierReturn(state, input, actor);
  assert.equal(getDebtBalance(next, debtId), '1000.00');
  assert.equal(next.transactions.length, 0);
  assert.equal(getInventoryStock(next, input.lines[0]).theoretical, '8.000000');
  assert.equal(dispatchSupplierReturn(next, input, actor), next);
  const returnId = getDebtModuleState(next).supplierReturns[0].id;
  next = disputeSupplierReturn(next, { returnId, reason: 'El proveedor revisa el valor reconocido' }, actor);
  assert.equal(getDebtBalance(next, debtId), '1000.00');
  assert.equal(getDebtModuleState(next).supplierReturns[0].status, 'disputed');
  const movements = next.inventory!.movements.length;
  next = acceptSupplierReturn(
    next,
    { returnId, date: '2026-11-05', amount: '120.00', reference: 'NOTA-CREDITO-120', support: proof },
    actor,
  );
  assert.equal(getDebtBalance(next, debtId), '880.00');
  assert.equal(getDebtBalance(next, debtId, '2026-10-31'), '1000.00');
  assert.equal(next.inventory!.movements.length, movements);
  assert.equal(next.transactions.length, 0);
  assert.equal(getDebtModuleState(next).supplierReturns[0].history.length, 3);
  assert.throws(
    () =>
      acceptSupplierReturn(
        next,
        { returnId, date: '2026-11-05', amount: '120.00', reference: 'NOTA-CREDITO-120', support: proof },
        actor,
      ),
    /ya fue aceptada/,
  );
  assert(inspectDemoState(next).ok);
});

test('a supplier credit note cannot consume principal reserved by a pending cash payment', () => {
  let state = purchased();
  const actor = state.members[0];
  state.accounts.push({
    id: 'credit-test-bank',
    name: 'Banco aislado de integración',
    kind: 'bank',
    custodian: actor.name,
    locationId: 'sede-principal',
    active: true,
  });
  state = recordDebtPayment(
    state,
    {
      debtId: state.debts[0].id,
      accountId: 'credit-test-bank',
      date: '2026-10-20',
      amount: '900.00',
      principal: '900.00',
      interest: '0.00',
      support: proof,
      idempotencyKey: 'credit-pending-payment',
    },
    actor,
  );
  state = dispatchSupplierReturn(state, returnInput(state), actor);
  const returnId = getDebtModuleState(state).supplierReturns[0].id;
  assert.throws(
    () =>
      acceptSupplierReturn(
        state,
        { returnId, date: '2026-10-21', amount: '120.00', reference: 'NOTA-SUPERA-RESERVA', support: proof },
        actor,
      ),
    /supera/,
  );
  const next = acceptSupplierReturn(
    state,
    { returnId, date: '2026-10-21', amount: '100.00', reference: 'NOTA-RESPETA-RESERVA', support: proof },
    actor,
  );
  assert.equal(getDebtBalance(next, next.debts[0].id), '900.00');
  assert.equal(getAccountBalance(next, 'credit-test-bank'), '0.00');
  assert.equal(next.transactions.length, 1);
  assert(inspectDemoState(next).ok);
});

test('credit invoices can document a manually selected period price without inventing a Caja purchase', async () => {
  const state = purchased();
  const actor = state.members[0];
  const item = state.inventory!.items[0];
  const source = getDebtModuleState(state).supplierPurchases[0];
  const next = registerInventoryPrice(
    state,
    {
      itemId: item.id,
      month: '2026-10',
      unitPrice: '100.00',
      cashTransactionIds: [],
      supplierPurchaseIds: [source.id],
      responsible: actor.name,
      support: proof,
      notes: 'Precio documental de factura a crédito, sin promedio automático.',
    },
    actor,
  );
  assert.equal(next.transactions.length, 0);
  assert.deepEqual(next.inventory!.prices[0].supplierPurchaseReferences, [source.reference]);
  const report = getInventoryReport(next, {
    inventoryType: 'raw_material',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  assert.equal(report.totalValue, '1000.00');
  const workbook = await createInventoryWorkbook(report);
  assert.match(
    String(workbook.getWorksheet('Precios del periodo')!.getCell('D6').value),
    /FACT-CREDITO-TEST/,
  );
  assert(inspectDemoState(next).ok);
});

test('credit purchase and returns reject absent origin, wrong site, excessive quantity and closed periods', () => {
  const state = base();
  const actor = state.members[0];
  const noOrigin = structuredClone(state);
  noOrigin.inventory!.origins = [];
  assert.throws(() => receiveSupplierCreditPurchase(noOrigin, purchaseInput(noOrigin), actor), /ORIGEN/);
  const purchasedState = purchased();
  const args = returnInput(purchasedState);
  assert.throws(
    () =>
      dispatchSupplierReturn(
        purchasedState,
        { ...args, lines: [{ ...args.lines[0], quantity: '11.000000' }] },
        actor,
      ),
    /supera/,
  );
  assert.throws(
    () => receiveSupplierCreditPurchase(state, { ...purchaseInput(state), dueDate: '2026-10-01' }, actor),
    /vencimiento/,
  );
  assert.throws(
    () => dispatchSupplierReturn(purchasedState, args, { ...actor, name: 'Actor suplantado' }),
    /permiso/,
  );
  const closed = structuredClone(purchasedState);
  closed.debtModule!.monthClosures.push({ month: '2026-10' } as never);
  assert.throws(() => dispatchSupplierReturn(closed, args, actor), /cerrado/);
});
