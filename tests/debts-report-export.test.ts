import { inspectDemoState } from '../src/lib/demo-state';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDebtsWorkbook,
  debtReportBridge,
  debtReportIdentity,
  debtReportStatus,
  debtReportSummary,
  debtReportTables,
} from '../src/lib/debts-report-export';
import type { DebtModuleReport, DebtReportRow } from '../src/lib/debts/types';
import type { DebtWorkspace } from '../src/lib/debts/types';
import {
  approveTransaction,
  createAccount,
  createEmptyState,
  getCashReport,
  getDebtBalance,
  registerCashMovement,
} from '../src/lib/finance';
import {
  allocateDebtPayment,
  closeDebtMonth,
  createRecurringDebtTemplate,
  getDebtModuleReport,
  getDebtModuleState,
  getDebtMonthChecklist,
  linkRecurringDebtPayment,
  recordOfficialDebtPlan,
  registerDebtObligation,
  registerRecurringDebtBill,
  reconcileDebtStatement,
  requestDebtAuthorization,
} from '../src/lib/debts/engine';

const sourceBytes = Buffer.from('%PDF-1.4\n%%EOF');
const sourceDocument = {
  name: 'Documento aislado de prueba.pdf',
  type: 'application/pdf',
  size: sourceBytes.length,
  dataUrl: 'data:application/pdf;base64,' + sourceBytes.toString('base64'),
};
function actualReportWorkspace() {
  let state: DebtWorkspace = createEmptyState();
  const actor = state.members[0];
  state.members.push({
    id: 'debt-report-test-reviewer',
    name: 'Revisor aislado de prueba',
    role: 'admin',
    email: 'debt-reviewer@example.invalid',
    active: true,
    locationIds: [...actor.locationIds],
  });
  state = createAccount(
    state,
    {
      name: 'Banco aislado para informe',
      kind: 'bank',
      bank: 'Entidad de prueba',
      accountNumber: '000000000009',
      lastFour: '0009',
      custodian: actor.name,
      locationId: state.locations[0].id,
      active: true,
    },
    actor,
  );
  return { state, actor, reviewer: state.members[1], account: state.accounts[0] };
}

function sampleReport(): DebtModuleReport {
  const base = {
    concept: 'Obligación aislada de prueba',
    locationId: 'sede-principal',
    openingBalance: '0.00',
    newObligations: '0.00',
    principalPaid: '0.00',
    noncashScrap: '0.00',
    acceptedReturns: '0.00',
    documentedAdjustments: '0.00',
    closingBalance: '0.00',
    interestPaid: '0.00',
    insurancePaid: '0.00',
    commissionPaid: '0.00',
    lateFeePaid: '0.00',
    cashPaid: '0.00',
    status: 'current' as const,
    supportMissing: false,
  };
  const rows: DebtReportRow[] = [
    {
      ...base,
      id: 'supplier-test',
      debtId: 'supplier-test',
      category: 'supplier',
      creditor: 'Proveedor de prueba',
      documentReference: 'FACT-TEST-001',
      openingBalance: '1000.00',
      newObligations: '200.00',
      principalPaid: '100.00',
      noncashScrap: '150.00',
      acceptedReturns: '50.00',
      closingBalance: '900.00',
      cashPaid: '100.00',
    },
    {
      ...base,
      id: 'bank-test',
      debtId: 'bank-test',
      category: 'bank',
      creditor: 'Entidad de prueba',
      documentReference: 'OBL-TEST-001',
      openingBalance: '500.00',
      principalPaid: '50.00',
      interestPaid: '5.00',
      insurancePaid: '2.00',
      commissionPaid: '1.00',
      cashPaid: '58.00',
      closingBalance: '450.00',
    },
    {
      ...base,
      id: 'recurring-test',
      billId: 'recurring-test',
      category: 'recurring',
      creditor: 'Servicio de prueba',
      documentReference: 'REC-TEST-001',
      newObligations: '100.00',
      principalPaid: '20.00',
      cashPaid: '20.00',
      closingBalance: '80.00',
      status: 'partially_paid',
    },
  ];
  return {
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    generatedAt: '2026-11-10T15:00:00.000Z',
    scope: 'local',
    status: 'draft',
    version: 1,
    rows,
    totals: {
      openingBalance: '1500.00',
      newObligations: '300.00',
      principalPaid: '170.00',
      noncashScrap: '150.00',
      acceptedReturns: '50.00',
      documentedAdjustments: '0.00',
      closingBalance: '1430.00',
      interestPaid: '5.00',
      insurancePaid: '2.00',
      commissionPaid: '1.00',
      lateFeePaid: '0.00',
      cashPaid: '178.00',
    },
    movements: [],
    calendar: [
      {
        id: 'calendar-test',
        source: 'recurring_bill',
        category: 'recurring',
        billId: 'recurring-test',
        creditor: 'Servicio de prueba',
        concept: 'Recibo mensual confirmado',
        locationId: 'sede-principal',
        dueDate: '2026-10-20',
        amount: '100.00',
        paidAmount: '20.00',
        remaining: '80.00',
        status: 'partially_paid',
        official: true,
      },
    ],
    issues: [
      {
        id: 'missing-test',
        type: 'support_missing',
        title: 'Documento pendiente de revisar',
        description: 'Novedad aislada sin importe confirmado.',
        severity: 'warning',
        category: 'supplier',
        debtId: 'supplier-test',
        locationId: 'sede-principal',
        date: '2026-10-31',
        status: 'open',
        history: [],
      },
    ],
    plans: [],
    reconciliations: [],
    requests: [
      {
        id: 'request-test',
        debtId: 'supplier-test',
        kind: 'correction',
        reason: 'Solicitud aislada pendiente; no reduce el saldo.',
        effectiveDate: '2026-10-31',
        support: { name: 'Solicitud de prueba.pdf', type: 'application/pdf', size: 0 },
        before: 'Sin cambio aplicado',
        status: 'pending_institutional',
        requiredAuthority: 'not_defined',
        requestedBy: 'test-actor',
        createdAt: '2026-11-10T15:00:00.000Z',
      },
    ],
    reconciled: false,
  };
}
test('capital bridge separates true cash components from scrap and accepted returns', () => {
  const report = sampleReport();
  assert.deepEqual(debtReportBridge(report.totals), {
    calculatedClosing: '1430.00',
    difference: '0.00',
    cashComponentDifference: '0.00',
  });
  assert.deepEqual(debtReportSummary(report)[6], ['Saldo reconocido al cierre', '1430.00']);
  assert.deepEqual(debtReportSummary(report)[12], ['Total de pagos reales aplicados desde Caja', '178.00']);
  assert.equal(
    debtReportTables(report).find((table) => table.name === 'Saldos por acreedor')!.rows.length,
    3,
  );
  assert.match(debtReportStatus(report), /novedades por conciliar/);
});
test('unknown issue amount and pending correction do not become a zero or an applied adjustment', async () => {
  const report = sampleReport(),
    before = JSON.stringify(report);
  const workbook = await createDebtsWorkbook(report);
  assert.equal(workbook.getWorksheet('Novedades')!.getCell('F6').value, null);
  assert.equal(workbook.getWorksheet('Autorizaciones pendientes')!.getCell('F6').value, null);
  assert.equal(workbook.getWorksheet('Resumen')!.getCell('B11').result, 0);
  assert.equal(JSON.stringify(report), before);
});
test('Excel uses native numbers, dates, independent balance formulas and literal user text', async () => {
  const report = sampleReport();
  report.rows[0].creditor = '=HYPERLINK("https://example.invalid")';
  const workbook = await createDebtsWorkbook(report),
    summary = workbook.getWorksheet('Resumen')!;
  assert.equal(summary.getCell('B13').formula, 'ROUND(B12-(B6+B7-B8-B9-B10+B11),2)');
  assert.equal(summary.getCell('B13').result, 0);
  assert.equal(summary.getCell('B19').formula, 'ROUND(B18-(B8+B14+B15+B16+B17),2)');
  assert.equal(summary.getCell('B19').result, 0);
  assert.equal(summary.getCell('B18').formula, "ROUND(SUM('Pagos y componentes'!I6:I8),2)");
  assert.equal(summary.getCell('B18').result, 178);
  assert.equal(workbook.getWorksheet('Saldos por acreedor')!.getCell('B6').value, report.rows[0].creditor);
  assert.equal(workbook.getWorksheet('Saldos por acreedor')!.getCell('K6').value, 900);
  assert(workbook.getWorksheet('Vencimientos oficiales')!.getCell('E6').value instanceof Date);
  assert.equal(workbook.getWorksheet('Pagos y componentes')!.getCell('J7').result, 0);
  assert((await workbook.xlsx.writeBuffer()).byteLength > 1000);
});
test('the same monthly report identity is shared by both formats and category snapshots differ', () => {
  const report = sampleReport();
  assert.equal(debtReportIdentity(report), debtReportIdentity(sampleReport()));
  assert.match(debtReportIdentity(report), /^DEUDAS-2026-10-V1-/);
  assert.notEqual(debtReportIdentity(report), debtReportIdentity({ ...report, category: 'supplier' }));
  const closed = {
    ...report,
    status: 'closed' as const,
    closedAt: '2026-11-10T15:00:00.000Z',
    closedBy: 'test-actor',
  };
  assert.match(debtReportStatus(closed), /Cierre local conservado/);
  assert.equal(closed.calendar[0].remaining, '80.00');
});

test('real recurring report freezes unpaid October and later real cash pays it only in November', async () => {
  const workspace = actualReportWorkspace();
  let { state } = workspace;
  const { actor, account } = workspace;
  state = createRecurringDebtTemplate(
    state,
    {
      name: 'Arriendo de prueba',
      creditor: 'Arrendador aislado',
      concept: 'Arriendo mensual documentado',
      locationId: account.locationId,
      frequency: 'monthly',
      active: true,
    },
    actor,
  );
  const template = getDebtModuleState(state).recurringTemplates[0];
  state = registerRecurringDebtBill(
    state,
    {
      templateId: template.id,
      month: '2026-10',
      reference: 'REC-REPORT-TEST-OCT',
      invoiceDate: '2026-10-01',
      receivedDate: '2026-10-02',
      dueDate: '2026-10-20',
      amount: '100.00',
      support: sourceDocument,
      notes: 'Recibo sintético aislado para validar el cierre.',
    },
    actor,
  );
  const bill = getDebtModuleState(state).recurringBills[0];
  state = registerCashMovement(
    state,
    {
      accountId: account.id,
      kind: 'income',
      categoryId: 'ventas-regulares',
      date: '2026-10-01',
      description: 'Ingreso real de prueba',
      party: 'Cliente aislado',
      amount: '100.00',
      support: sourceDocument,
      idempotencyKey: 'debt-report-recurring-income',
    },
    actor,
  );
  state = registerCashMovement(
    state,
    {
      accountId: account.id,
      kind: 'expense',
      categoryId: 'arriendo',
      date: '2026-10-10',
      description: 'Abono parcial al recibo',
      party: template.creditor,
      amount: '20.00',
      support: sourceDocument,
      idempotencyKey: 'debt-report-recurring-oct-payment',
    },
    actor,
  );
  const octoberCash = state.transactions.find(
    (row) => row.idempotencyKey === 'debt-report-recurring-oct-payment',
  )!;
  const transactionCount = state.transactions.length;
  state = linkRecurringDebtPayment(
    state,
    {
      billId: bill.id,
      transactionId: octoberCash.id,
      amount: '20.00',
      idempotencyKey: 'debt-report-recurring-oct-link',
    },
    actor,
  );
  assert.equal(
    state.transactions.length,
    transactionCount,
    'Linking the receipt must not create a second expense.',
  );
  assert.equal(
    getDebtMonthChecklist(state, { month: '2026-10' }).canClose,
    true,
    'A recognized unpaid bill alone does not prevent closure.',
  );
  state = closeDebtMonth(
    state,
    { month: '2026-10', notes: 'Cierre aislado con saldo pendiente reconocido.' },
    actor,
  );
  assert.deepEqual(inspectDemoState(state).ok, true, 'The closed receipt must survive storage validation.');
  const october = getDebtModuleReport(state, { startDate: '2026-10-01', endDate: '2026-10-31' });
  const frozen = JSON.stringify(october);
  assert.equal(october.status, 'closed');
  assert.equal(october.totals.newObligations, '100.00');
  assert.equal(october.totals.cashPaid, '20.00');
  assert.equal(october.totals.closingBalance, '80.00');
  assert.equal(october.calendar[0].remaining, '80.00');
  assert.equal(
    october.movements.find((row) => row.kind === 'cash_payment')!.sourceReference,
    octoberCash.reference,
  );
  state = registerCashMovement(
    state,
    {
      accountId: account.id,
      kind: 'expense',
      categoryId: 'arriendo',
      date: '2026-11-05',
      description: 'Pago posterior del saldo del recibo original',
      party: template.creditor,
      amount: '80.00',
      support: sourceDocument,
      idempotencyKey: 'debt-report-recurring-nov-payment',
    },
    actor,
  );
  const novemberCash = state.transactions.find(
    (row) => row.idempotencyKey === 'debt-report-recurring-nov-payment',
  )!;
  state = linkRecurringDebtPayment(
    state,
    {
      billId: bill.id,
      transactionId: novemberCash.id,
      amount: '80.00',
      idempotencyKey: 'debt-report-recurring-nov-link',
    },
    actor,
  );
  assert.equal(
    JSON.stringify(getDebtModuleReport(state, { startDate: '2026-10-01', endDate: '2026-10-31' })),
    frozen,
  );
  assert.equal(inspectDemoState(state).ok, true, 'A later payment must coexist with the immutable closure.');
  const damaged = structuredClone(state);
  damaged.debtModule!.monthClosures[0].report.rows[0].closingBalance = '79.99';
  assert.equal(
    inspectDemoState(damaged).ok,
    false,
    'A damaged closing bridge cannot pass storage validation.',
  );

  const november = getDebtModuleReport(state, { startDate: '2026-11-01', endDate: '2026-11-10' });
  assert.equal(november.totals.openingBalance, '80.00');
  assert.equal(november.totals.newObligations, '0.00');
  assert.equal(november.totals.principalPaid, '80.00');
  assert.equal(november.totals.closingBalance, '0.00');
  assert.equal(november.calendar[0].remaining, '0.00');
  const book = await createDebtsWorkbook(october);
  assert.equal(book.getWorksheet('Resumen')!.getCell('B12').result, 80);
  assert.equal(book.getWorksheet('Resumen')!.getCell('B18').result, 20);
  assert.equal(book.getWorksheet('Resumen')!.getCell('B13').result, 0);
  assert.equal(book.getWorksheet('Vencimientos oficiales')!.getCell('H6').value, 80);
  assert(
    debtReportTables(october)
      .find((row) => row.name === 'Movimientos')!
      .rows.some((row) => row[5] === octoberCash.reference),
  );
  assert(!JSON.stringify(debtReportTables(october)).includes(novemberCash.reference));
});

test('real loan report uses the actual disbursement and all five paid components without duplicate cash', async () => {
  const workspace = actualReportWorkspace();
  let { state } = workspace;
  const { actor, account, reviewer } = workspace;
  state = registerDebtObligation(
    state,
    {
      creditor: 'Entidad aislada de prueba',
      kind: 'loan',
      principal: '1000.00',
      monthlyRate: '1',
      installments: 12,
      startDate: '2026-10-01',
      dueDay: 10,
      method: 'fixed_payment',
      locationId: account.locationId,
      originMode: 'cash_new',
      concept: 'Crédito documentado para prueba de informe',
      documentReference: 'OBL-REPORT-REAL-001',
      terminationDate: '2027-09-30',
      bankStatement: sourceDocument,
      officialPlanSupport: sourceDocument,
      support: sourceDocument,
    },
    actor,
  );
  const debt = state.debts[0];
  assert.equal(state.transactions.length, 0, 'Documenting the agreement must not create a cash inflow.');
  state = recordOfficialDebtPlan(
    state,
    {
      debtId: debt.id,
      reference: 'PLAN-REPORT-REAL-001',
      effectiveDate: '2026-10-01',
      support: sourceDocument,
      reason: 'Cuota transcrita de documento oficial de prueba.',
      installments: [
        {
          number: 1,
          dueDate: '2026-10-10',
          amount: '116.00',
          principal: '100.00',
          interest: '10.00',
          insurance: '2.00',
          commission: '1.00',
          lateFee: '3.00',
        },
      ],
    },
    actor,
  );
  state = registerCashMovement(
    state,
    {
      accountId: account.id,
      kind: 'loan',
      categoryId: 'prestamos',
      date: '2026-10-01',
      description: 'Desembolso confirmado aislado',
      party: debt.creditor,
      amount: '1000.00',
      debtId: debt.id,
      support: sourceDocument,
      idempotencyKey: 'debt-report-real-disbursement',
    },
    actor,
  );
  state = registerCashMovement(
    state,
    {
      accountId: account.id,
      kind: 'debt_payment',
      categoryId: 'cuotas-creditos-bancarios',
      date: '2026-10-10',
      description: 'Cuota real con cinco componentes',
      party: debt.creditor,
      amount: '116.00',
      principal: '100.00',
      interest: '10.00',
      insurance: '2.00',
      commission: '1.00',
      lateFee: '3.00',
      debtId: debt.id,
      support: sourceDocument,
      idempotencyKey: 'debt-report-real-payment',
    },
    actor,
  );
  const paymentTransaction = state.transactions.find(
    (row) => row.idempotencyKey === 'debt-report-real-payment',
  )!;
  state = approveTransaction(state, paymentTransaction.id, reviewer);
  const plan = getDebtModuleState(state).officialPlans[0],
    payment = state.debtPayments[0];
  state = allocateDebtPayment(
    state,
    {
      debtPaymentId: payment.id,
      planId: plan.id,
      installmentId: plan.installments[0].id,
      reference: 'APLICACION-REPORT-REAL-001',
      principal: '100.00',
      interest: '10.00',
      insurance: '2.00',
      commission: '1.00',
      lateFee: '3.00',
    },
    actor,
  );
  assert.equal(
    state.transactions.length,
    2,
    'Documenting and allocating the installment must not create more cash movements.',
  );
  assert.equal(
    inspectDemoState(state).ok,
    true,
    'The official plan and actual allocated payment must survive storage validation.',
  );
  const report = getDebtModuleReport(state, { startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.equal(report.totals.newObligations, '1000.00');
  assert.equal(report.totals.closingBalance, '900.00');
  assert.equal(report.totals.cashPaid, '116.00');
  assert.deepEqual(debtReportBridge(report.totals), {
    calculatedClosing: '900.00',
    difference: '0.00',
    cashComponentDifference: '0.00',
  });
  assert.equal(report.calendar[0].remaining, '0.00');
  const row = report.movements.find((row) => row.kind === 'cash_payment')!;
  assert.equal(row.sourceReference, paymentTransaction.reference);
  assert.deepEqual(
    [row.principal, row.interest, row.insurance, row.commission, row.lateFee, row.total],
    ['100.00', '10.00', '2.00', '1.00', '3.00', '116.00'],
  );
  assert.equal(
    getCashReport(state, { startDate: '2026-10-01', endDate: '2026-10-31' }).closingAvailable,
    '884.00',
  );
  const book = await createDebtsWorkbook(report),
    summary = book.getWorksheet('Resumen')!;
  assert.deepEqual(
    ['B8', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19'].map((address) => summary.getCell(address).result),
    [100, 10, 2, 1, 3, 116, 0],
  );
  const detail = debtReportTables(report)
    .find((table) => table.name === 'Movimientos')!
    .rows.find((row) => row[5] === paymentTransaction.reference)!;
  assert.deepEqual(detail.slice(6, 12), ['100.00', '10.00', '2.00', '1.00', '3.00', '116.00']);

  const extraExpense = registerCashMovement(
    state,
    {
      accountId: account.id,
      kind: 'debt_payment',
      categoryId: 'cuotas-creditos-bancarios',
      date: '2026-10-11',
      description: 'Pago posterior de capital de prueba',
      party: debt.creditor,
      amount: '1.00',
      principal: '1.00',
      interest: '0.00',
      debtId: debt.id,
      support: sourceDocument,
      idempotencyKey: 'debt-report-real-payment-extra',
    },
    actor,
  );
  const confirmed = approveTransaction(
    extraExpense,
    extraExpense.transactions.find((row) => row.idempotencyKey === 'debt-report-real-payment-extra')!.id,
    reviewer,
  );
  assert.throws(
    () =>
      allocateDebtPayment(
        confirmed,
        {
          debtPaymentId: confirmed.debtPayments.find((row) => row.date === '2026-10-11')!.id,
          planId: plan.id,
          installmentId: plan.installments[0].id,
          reference: 'APLICACION-SUPERA-CUOTA',
          principal: '1.00',
          interest: '0.00',
          insurance: '0.00',
          commission: '0.00',
          lateFee: '0.00',
        },
        actor,
      ),
    /supera el saldo de la cuota oficial/,
  );

  const unmatched = reconcileDebtStatement(
    state,
    {
      debtId: debt.id,
      date: '2026-10-31',
      reference: 'EXTRACTO-CON-DIFERENCIA',
      statementPrincipal: '910.00',
      support: sourceDocument,
    },
    actor,
  );
  assert.equal(getDebtMonthChecklist(unmatched, { month: '2026-10' }).canClose, false);
  assert.equal(
    getDebtModuleReport(unmatched, { startDate: '2026-10-01', endDate: '2026-10-31' }).reconciled,
    false,
  );
  assert.equal(getDebtBalance(unmatched, debt.id), '900.00');
});

test('a historical investment recognizes the documented cutoff balance without creating a new loan receipt', () => {
  const workspace = actualReportWorkspace();
  let { state } = workspace;
  const { actor, account } = workspace;
  state = registerDebtObligation(
    state,
    {
      creditor: 'Inversionista aislado de prueba',
      kind: 'investment',
      principal: '1000.00',
      monthlyRate: '1',
      installments: 24,
      startDate: '2024-01-01',
      dueDay: 1,
      method: 'interest_only',
      locationId: account.locationId,
      originMode: 'historical_investment',
      openingAsOfDate: '2026-10-01',
      openingPrincipal: '600.00',
      concept: 'Saldo histórico documentado al corte',
      documentReference: 'ORIGEN-INV-REPORT-TEST',
      interestRule: 'Regla contractual documentada del uno por ciento mensual.',
      contract: sourceDocument,
      initialReceipt: sourceDocument,
      support: sourceDocument,
    },
    actor,
  );
  const before = getDebtModuleReport(state, { startDate: '2026-09-01', endDate: '2026-09-30' });
  const october = getDebtModuleReport(state, { startDate: '2026-10-01', endDate: '2026-10-31' });
  assert.equal(before.totals.closingBalance, '0.00');
  assert.equal(october.totals.openingBalance, '0.00');
  assert.equal(october.totals.newObligations, '600.00');
  assert.equal(october.totals.closingBalance, '600.00');
  assert.equal(october.totals.cashPaid, '0.00');
  assert.equal(state.transactions.length, 0);
  assert.equal(october.movements.find((row) => row.kind === 'opening')!.date, '2026-10-01');
  assert.equal(october.movements.find((row) => row.kind === 'opening')!.total, '600.00');
  assert.equal(debtReportSummary(october)[1][0], 'Altas / ORIGEN documentado del período');

  const originalDossier = JSON.stringify(getDebtModuleState(state).obligations[0]);
  const proposed = requestDebtAuthorization(
    state,
    {
      debtId: state.debts[0].id,
      kind: 'investment_renegotiation',
      effectiveDate: '2026-11-15',
      proposedPrincipal: '500',
      proposedMonthlyRate: '0.8',
      reason: 'Propuesta documentada de renegociación para la prueba.',
      support: sourceDocument,
    },
    actor,
  );
  const request = getDebtModuleState(proposed).requests[0];
  assert.equal(request.status, 'pending_institutional');
  assert.equal(request.requiredAuthority, 'creator_or_manager');
  assert.equal(request.effectiveDate, '2026-11-15');
  assert.equal(request.proposedPrincipal, '500.00');
  assert.equal(JSON.stringify(getDebtModuleState(proposed).obligations[0]), originalDossier);
  assert.equal(getDebtBalance(proposed, state.debts[0].id), '600.00');
  assert.equal(inspectDemoState(proposed).ok, true);
});
