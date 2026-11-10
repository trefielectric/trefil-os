import test from 'node:test';
import assert from 'node:assert/strict';
import { add, approveTransaction, buildAmortization, calculateInterest, commentAlert, createAccount, createDebt, createDemoState, createTransaction, DEMO_ACTORS, deriveAlerts, formatCOP, getAccountBalance, getDebtBalance, getSummary, getUpcomingObligations, isBalanced, money, reconcileAccount, recordAccess, recordDebtPayment, rejectTransaction, resolveAlert, reverseTransaction, sub, toCents } from '../src/lib/finance';
import type { State, TransactionInput } from '../src/lib/finance';
import { cashSeries, periodTotals } from '../src/components/view-helpers';

const request = (overrides: Partial<TransactionInput> = {}): TransactionInput => ({ kind: 'expense', date: '2026-11-10', description: 'Gasto ficticio de prueba', party: 'Proveedor · Demo', category: 'Mantenimiento', locationId: 'sede-principal', amount: '100000.25', accountId: 'bancolombia', idempotencyKey: 'test-key-00001', ...overrides });
const latest = (state: State) => state.transactions[0];

test('money stays exact above Number.MAX_SAFE_INTEGER and rejects fractional cent input', () => {
  assert.equal(add('90071992547409.91', '0.09'), '90071992547410.00');
  assert.equal(sub('0.30', '0.20'), '0.10');
  assert.equal(money('-0.00'), '0.00');
  assert.throws(() => money('12.345'), /decimal/);
  assert.throws(() => money('NaN'), /decimal/);
  assert.throws(() => money('10000000000000000'), /numeric/);
  assert.equal(formatCOP('1234567.80'), '$ 1.234.567,80');
});

test('seed is balanced, explicitly fictional, 128m available and backups unverified', () => {
  const state = createDemoState();
  assert(state.transactions.every(isBalanced));
  assert.equal(getSummary(state, '2026-11-10').available, '128000000.00');
  assert.equal(getSummary(state, '2026-11-10').debt, '98200000.00');
  assert.equal(state.backups.length, 0);
  assert(deriveAlerts(state, '2026-11-10').some(alert => alert.type === 'backup_stale'));
});

test('posting expense changes cash by exact amount and does not mutate source state', () => {
  const before = createDemoState();
  const serialized = JSON.stringify(before);
  const after = createTransaction(before, request(), DEMO_ACTORS.treasury);
  assert.equal(getAccountBalance(after, 'bancolombia'), '83349999.75');
  assert.equal(JSON.stringify(before), serialized);
  assert.equal(latest(after).status, 'posted');
  assert(isBalanced(latest(after)));
});

test('transfer has balanced compensating movements and leaves company total unchanged', () => {
  const before = createDemoState();
  const after = createTransaction(before, request({ kind: 'transfer', destinationAccountId: 'caja' }), DEMO_ACTORS.treasury);
  assert.equal(getSummary(after).available, getSummary(before).available);
  assert.equal(getAccountBalance(after, 'caja'), '8520000.25');
  assert.equal(latest(after).entries.length, 2);
  assert.throws(() => createTransaction(before, request({ kind: 'transfer', destinationAccountId: 'bancolombia' }), DEMO_ACTORS.treasury), /diferente/);
});

test('idempotency returns same state on retry, rejects changed payload including destination', () => {
  const input = request({ kind: 'transfer', destinationAccountId: 'caja' });
  const state = createTransaction(createDemoState(), input, DEMO_ACTORS.treasury);
  assert.equal(createTransaction(state, input, DEMO_ACTORS.treasury), state);
  assert.throws(() => createTransaction(state, { ...input, destinationAccountId: 'nequi' }, DEMO_ACTORS.treasury), /idempotencia/);
  assert.throws(() => createTransaction(state, { ...input, party: 'Otro tercero' }, DEMO_ACTORS.treasury), /idempotencia/);
});

test('5m threshold requires independent approval and affects no balance until posted', () => {
  const before = createDemoState();
  const pending = createTransaction(before, request({ amount: '5000000.00' }), DEMO_ACTORS.owner);
  assert.equal(latest(pending).status, 'pending');
  assert.equal(getAccountBalance(pending, 'bancolombia'), getAccountBalance(before, 'bancolombia'));
  assert.throws(() => approveTransaction(pending, latest(pending).id, DEMO_ACTORS.owner), /otra persona/);
  assert.throws(() => approveTransaction(pending, latest(pending).id, DEMO_ACTORS.treasury), /permiso/);
  const posted = approveTransaction(pending, latest(pending).id, DEMO_ACTORS.admin);
  assert.equal(getAccountBalance(posted, 'bancolombia'), '78450000.00');
  assert.equal(latest(posted).approvedBy, DEMO_ACTORS.admin.id);
});

test('rejection retains movement, requires reason and prevents later posting', () => {
  const pending = createTransaction(createDemoState(), request({ amount: '5000000.00' }), DEMO_ACTORS.treasury);
  assert.throws(() => rejectTransaction(pending, latest(pending).id, DEMO_ACTORS.owner, ''), /motivo/);
  const rejected = rejectTransaction(pending, latest(pending).id, DEMO_ACTORS.owner, 'No tiene autorización');
  assert.equal(latest(rejected).status, 'rejected');
  assert.equal(rejected.transactions.length, pending.transactions.length);
  assert.throws(() => approveTransaction(rejected, latest(rejected).id, DEMO_ACTORS.owner), /pendiente/);
});

test('reversal preserves original, needs approval, offsets exactly and prevents double reversal', () => {
  const before = createDemoState();
  const expense = before.transactions.find(transaction => transaction.kind === 'expense' && transaction.status === 'posted')!;
  const pending = reverseTransaction(before, expense.id, 'Corrección documentada', DEMO_ACTORS.treasury);
  assert.equal(latest(pending).status, 'pending');
  assert.equal(getSummary(pending).available, getSummary(before).available);
  assert.throws(() => reverseTransaction(pending, expense.id, 'Otro reverso duplicado', DEMO_ACTORS.treasury), /reverso/);
  const after = approveTransaction(pending, latest(pending).id, DEMO_ACTORS.admin);
  assert.equal(getSummary(after).available, add(getSummary(before).available, expense.amount));
  assert.deepEqual(after.transactions.find(row => row.id === expense.id)!.entries, expense.entries);
  assert.equal(after.transactions.find(row => row.id === expense.id)!.status, 'posted');
  assert.equal(after.transactions.find(row => row.id === expense.id)!.reversedBy, latest(after).id);
});

test('auditors, inactive members, forged roles and users without site permission cannot write', () => {
  const state = createDemoState();
  assert.throws(() => createTransaction(state, request(), DEMO_ACTORS.auditor), /permiso/);
  assert.throws(() => createTransaction(state, request(), { ...DEMO_ACTORS.auditor, role: 'owner' }), /permiso/);
  assert.throws(() => createTransaction(state, request(), { id: 'demo-employee', name: 'Demo', role: 'employee' }), /permiso/);
  assert.throws(() => createTransaction(state, request({ locationId: 'sede-planta' }), DEMO_ACTORS.treasury), /sede/);
});

test('invalid date, negative amount, inactive account and cross-site account are rejected', () => {
  const state = createDemoState();
  assert.throws(() => createTransaction(state, request({ date: '2026-02-30' }), DEMO_ACTORS.owner), /fecha/);
  assert.throws(() => createTransaction(state, request({ amount: '-1.00' }), DEMO_ACTORS.owner), /mayor/);
  state.accounts.find(account => account.id === 'bancolombia')!.active = false;
  assert.throws(() => createTransaction(state, request(), DEMO_ACTORS.owner), /activa/);
  assert.throws(() => createTransaction(createDemoState(), request({ locationId: 'sede-planta' }), DEMO_ACTORS.owner), /sede/);
});

test('all personal expenses and adjustments require approval below threshold', () => {
  assert.equal(latest(createTransaction(createDemoState(), request({ kind: 'personal_expense' }), DEMO_ACTORS.treasury)).status, 'pending');
  assert.equal(latest(createTransaction(createDemoState(), request({ kind: 'adjustment' }), DEMO_ACTORS.treasury)).status, 'pending');
});

test('downward adjustments require approval and debit the balancing control account', () => {
  const state = createDemoState();
  const pending = createTransaction(state, request({ kind: 'adjustment', direction: 'out' }), DEMO_ACTORS.treasury);
  assert.equal(latest(pending).status, 'pending');
  const posted = approveTransaction(pending, latest(pending).id, DEMO_ACTORS.owner);
  assert.equal(getAccountBalance(posted, 'bancolombia'), sub(getAccountBalance(state, 'bancolombia'), '100000.25'));
  assert(isBalanced(latest(posted)));
});

test('an approved expense that exceeds cash produces a negative balance alarm', () => {
  const state = createDemoState();
  const pending = createTransaction(state, request({ accountId: 'caja', amount: '9000000.00' }), DEMO_ACTORS.treasury);
  const posted = approveTransaction(pending, latest(pending).id, DEMO_ACTORS.owner);
  assert.equal(getAccountBalance(posted, 'caja'), '-580000.00');
  assert(deriveAlerts(posted, '2026-11-10').some(alert => alert.type === 'negative_balance'));
});

test('debt payment allocation is exact, atomic, idempotent and reverses liability totals', () => {
  const state = createDemoState();
  const input = { debtId: 'debt-a', accountId: 'bancolombia', date: '2026-11-10', amount: '1000000.00', principal: '800000.00', interest: '200000.00', idempotencyKey: 'payment-test-0001' };
  const requested = recordDebtPayment(state, input, DEMO_ACTORS.treasury);
  assert.equal(latest(requested).status, 'pending');
  assert.equal(getDebtBalance(requested, 'debt-a'), '48200000.00');
  const after = approveTransaction(requested, latest(requested).id, DEMO_ACTORS.admin);
  assert.equal(getDebtBalance(after, 'debt-a'), '47400000.00');
  assert.equal(getAccountBalance(after, 'bancolombia'), '82450000.00');
  assert.equal(recordDebtPayment(after, input, DEMO_ACTORS.treasury), after);
  assert(isBalanced(latest(after)));
  const reversed = reverseTransaction(after, latest(after).id, 'Pago registrado por error', DEMO_ACTORS.treasury);
  const approved = approveTransaction(reversed, latest(reversed).id, DEMO_ACTORS.admin);
  assert.equal(getDebtBalance(approved, 'debt-a'), getDebtBalance(state, 'debt-a'));
  assert.throws(() => recordDebtPayment(state, { ...input, interest: '200000.01' }, DEMO_ACTORS.treasury), /capital más el interés/);
  assert.throws(() => recordDebtPayment(state, { ...input, date: '2026-01-01' }, DEMO_ACTORS.treasury), /anterior al desembolso/);
});

test('pending debt payments reserve principal and never count as paid', () => {
  const state = createDemoState();
  const input = { debtId: 'debt-c', accountId: 'bancolombia', date: '2026-11-10', amount: '15000000.00', principal: '15000000.00', interest: '0.00', idempotencyKey: 'payment-test-0002' };
  const pending = recordDebtPayment(state, input, DEMO_ACTORS.treasury);
  assert.equal(getDebtBalance(pending, 'debt-c'), '15000000.00');
  assert.throws(() => recordDebtPayment(pending, { ...input, idempotencyKey: 'payment-test-0003', amount: '1.00', principal: '1.00' }, DEMO_ACTORS.treasury), /saldo disponible/);
  const approved = approveTransaction(pending, latest(pending).id, DEMO_ACTORS.owner);
  assert.equal(getDebtBalance(approved, 'debt-c'), '0.00');
});

test('reconciliation uses ledger at cutoff date, records difference and creates no money', () => {
  const state = createDemoState();
  const before = getSummary(state).available;
  const after = reconcileAccount(state, { accountId: 'bancolombia', date: '2026-11-01', bankAmount: '64900000.00', notes: 'Diferencia simulada' }, DEMO_ACTORS.treasury);
  assert.equal(after.reconciliations[0].bookAmount, '65000000.00');
  assert.equal(after.reconciliations[0].difference, '-100000.00');
  assert.equal(after.reconciliations[0].status, 'difference');
  assert.equal(getSummary(after).available, before);
});

test('French amortization reconciles every cent and closes balance without posting projected rows', () => {
  const state = createDemoState();
  const snapshot = JSON.stringify(state);
  const schedule = buildAmortization({ principal: '10000000.00', monthlyRate: '1.5', installments: 12, startDate: '2026-11-10', dueDay: 31, method: 'fixed_payment' });
  assert.equal(schedule.length, 12);
  assert.equal(schedule[0].date, '2026-12-31');
  assert.equal(schedule[2].date, '2027-02-28');
  assert.equal(schedule.at(-1)!.balance, '0.00');
  assert.equal(add(...schedule.map(row => row.principal)), '10000000.00');
  for (const row of schedule) {
    assert.equal(add(row.principal, row.interest), row.payment);
    assert.equal(sub(row.openingBalance, row.principal), row.balance);
    assert.equal(row.projected, true);
  }
  assert.equal(JSON.stringify(state), snapshot);
});

test('zero interest and integer rounding preserve full principal', () => {
  const schedule = buildAmortization({ principal: '100.00', monthlyRate: '0', installments: 3, startDate: '2026-11-10', method: 'fixed_payment' });
  assert.deepEqual(schedule.map(row => row.payment), ['33.33', '33.33', '33.34']);
  assert.equal(calculateInterest('90071992547409.91', '0.01'), '9007199254.74');
});

test('grace, extra principal and changing rate are reflected without negative balance', () => {
  const schedule = buildAmortization({ principal: '10000.00', monthlyRate: '2', installments: 12, startDate: '2026-11-10', method: 'fixed_payment', graceMonths: 2, extraPayments: [{ period: 4, amount: '500.00' }], rateChanges: [{ period: 6, monthlyRate: '1' }] });
  assert.equal(schedule[0].principal, '0.00');
  assert.equal(schedule[1].principal, '0.00');
  assert.equal(schedule[3].extraPayment, '500.00');
  assert.equal(schedule[5].monthlyRate, '1');
  assert.equal(schedule.at(-1)!.balance, '0.00');
  assert.equal(add(...schedule.map(row => row.principal)), '10000.00');
  assert(schedule.every(row => toCents(row.balance) >= 0n));
  assert.throws(() => buildAmortization({ principal: '10000.00', monthlyRate: '2', installments: 2, startDate: '2026-11-10', method: 'fixed_payment', graceMonths: 2 }), /gracia/);
});

test('interest-only amortization pays capital only at maturity', () => {
  const schedule = buildAmortization({ principal: '15000000.00', monthlyRate: '1.8', installments: 6, startDate: '2026-10-20', method: 'interest_only' });
  assert.equal(schedule[0].payment, '270000.00');
  assert.equal(schedule[0].principal, '0.00');
  assert.equal(schedule[5].principal, '15000000.00');
  assert.equal(schedule[5].payment, '15270000.00');
});

test('account creation requires personal authorization and generates no opening money', () => {
  const state = createDemoState();
  const input = { name: 'Nueva caja ficticia', kind: 'cash' as const, custodian: 'Responsable · Demo', locationId: 'sede-principal', active: true };
  const after = createAccount(state, input, DEMO_ACTORS.treasury);
  assert.equal(getAccountBalance(after, after.accounts.at(-1)!.id), '0.00');
  assert.throws(() => createAccount(state, { ...input, kind: 'personal' }, DEMO_ACTORS.treasury), /autorización/);
});

test('debt creation validates terms and never registers a projected disbursement', () => {
  const state = createDemoState();
  const after = createDebt(state, { creditor: 'Acreedor ficticio', kind: 'loan', principal: '1000000.00', monthlyRate: '1', installments: 6, startDate: '2026-11-10', dueDay: 10, method: 'fixed_payment', locationId: 'sede-principal' }, DEMO_ACTORS.treasury);
  assert.equal(after.transactions.length, state.transactions.length);
  assert.equal(getSummary(after).available, getSummary(state).available);
  assert.equal(getSummary(after).debt, add(getSummary(state).debt, '1000000.00'));
});

test('alerts detect missing support, personal funds, discrepancies, overdue and upcoming debt', () => {
  const alerts = deriveAlerts(createDemoState(), '2026-11-10');
  for (const type of ['missing_support', 'personal_account', 'balance_difference', 'overdue_debt', 'upcoming_installment', 'backup_stale', 'restore_unverified']) assert(alerts.some(alert => alert.type === type), `Missing ${type}`);
});

test('duplicate, negative, broken transfer and rate drift alarms retain evidence', () => {
  const state = createDemoState();
  const expense = state.transactions.find(transaction => transaction.kind === 'expense' && transaction.status === 'posted')!;
  state.transactions.push({ ...structuredClone(expense), id: 'duplicate-demo', reference: 'DUP-DEMO', idempotencyKey: 'different-key' });
  const transfer = state.transactions.find(transaction => transaction.kind === 'transfer')!;
  transfer.entries.pop();
  const debtPayment = state.debtPayments[0]; debtPayment.appliedMonthlyRate = '3';
  const alerts = deriveAlerts(state, '2026-11-10');
  assert(alerts.some(alert => alert.type === 'possible_duplicate'));
  assert(alerts.some(alert => alert.title === 'Traslado sin contrapartida'));
  assert(alerts.some(alert => alert.type === 'rate_difference'));
});

test('alerts preserve comments, evidence of resolution and audit history', () => {
  const state = createDemoState();
  const id = 'difference:demo-reconciliation-3';
  const comment = commentAlert(state, id, 'Revisión en proceso con soporte ficticio', DEMO_ACTORS.treasury);
  assert.throws(() => resolveAlert(comment, id, 'Solo un comentario no cambia la causa', DEMO_ACTORS.owner), /condición sigue presente/);
  const matched = reconcileAccount(comment, { accountId: 'caja', date: '2026-11-10', bankAmount: getAccountBalance(comment, 'caja'), notes: 'Arqueo ficticio revisado y verificado' }, DEMO_ACTORS.treasury);
  const resolved = resolveAlert(matched, id, 'Corrección ficticia revisada y documentada', DEMO_ACTORS.owner);
  const alert = deriveAlerts(resolved, '2026-11-10').find(row => row.id === id)!;
  assert.equal(alert.status, 'resolved');
  assert.equal(alert.comments.length, 2);
  assert(alert.history.length >= 3);
  assert(resolved.audit.some(event => event.action === 'Alerta resuelta'));
  assert.throws(() => resolveAlert(state, id, 'Cambio del auditor', DEMO_ACTORS.auditor), /permiso/);
});

test('upcoming obligations label projections and leave actual payments and ledger untouched', () => {
  const state = createDemoState();
  const before = JSON.stringify(state);
  const obligations = getUpcomingObligations(state, '2026-11-10');
  assert(obligations.length > 0);
  assert(obligations.every(row => row.projected));
  assert.equal(obligations[0].status, 'overdue');
  assert.equal(JSON.stringify(state), before);
});

test('a valid renegotiated rate does not create a false drift alert', () => {
  const state = createDemoState();
  const debt = state.debts.find(row => row.id === 'debt-a')!;
  debt.rateChanges = [{ period: 2, monthlyRate: '1' }];
  state.debtPayments[0].appliedMonthlyRate = '1.00';
  assert(!deriveAlerts(state, '2026-11-10').some(alert => alert.type === 'rate_difference'));
});

test('extraordinary principal does not falsely satisfy projected interest', () => {
  const state = createDemoState();
  const debt = state.debts.find(row => row.id === 'debt-c')!;
  const pending = recordDebtPayment(state, { debtId: debt.id, accountId: 'bancolombia', date: '2026-11-10', amount: '1000000.00', principal: '1000000.00', interest: '0.00', idempotencyKey: 'payment-extra-principal' }, DEMO_ACTORS.treasury);
  const after = approveTransaction(pending, latest(pending).id, DEMO_ACTORS.admin);
  const installment = getUpcomingObligations(after, '2026-11-10').find(row => row.debtId === debt.id)!;
  assert.equal(installment.interest, '270000.00');
  assert.equal(installment.amount, '270000.00');
});

test('missing verified backup cannot be dismissed as completed by a comment', () => {
  const state = createDemoState();
  assert.throws(() => resolveAlert(state, 'backup-stale', 'Se revisará más tarde', DEMO_ACTORS.owner), /condición sigue presente/);
});

test('dashboard operational expenses exclude advances and financing', () => {
  const state = createDemoState();
  const totals = periodTotals(state, 'all', '2026-11');
  assert.equal(totals.available, '128000000.00');
  assert.equal(totals.income, '44880000.00');
  assert.equal(totals.expenses, '15080000.00');
});

test('cash chart starts from opening balance and flow excludes opening equity', () => {
  const state = createDemoState();
  const series = cashSeries(state, 'all', '2026-11');
  assert.equal(series.balances[0], '100000000.00');
  assert.equal(series.balances[10], '128000000.00');
  assert.equal(series.net[0], '0.00');
  assert.equal(series.net[1], '0.00');
  assert.equal(series.net[10], '28000000.00');
  assert.equal(sub(series.balances[30], series.balances[10]), sub(series.net[30], series.net[10]));
});

test('pending debt payments do not reduce cash projection or imply a paid installment', () => {
  const state = createDemoState();
  const before = cashSeries(state, 'all', '2026-11');
  const pending = recordDebtPayment(state, { debtId: 'debt-b', accountId: 'bancolombia', date: '2026-11-10', amount: '100000.00', principal: '100000.00', interest: '0.00', idempotencyKey: 'pending-projection-test' }, DEMO_ACTORS.treasury);
  assert.equal(latest(pending).status, 'pending');
  assert.deepEqual(cashSeries(pending, 'all', '2026-11'), before);
  assert.deepEqual(getUpcomingObligations(pending, '2026-11-10'), getUpcomingObligations(state, '2026-11-10'));
});

test('audited demo access requires an active membership even for a read-only profile', () => {
  const state = createDemoState();
  const entered = recordAccess(state, DEMO_ACTORS.auditor, 'Inicio de sesión');
  const exited = recordAccess(entered, DEMO_ACTORS.auditor, 'Cierre de sesión');
  assert.equal(exited.audit[0].action, 'Cierre de sesión');
  assert.equal(exited.audit[1].action, 'Inicio de sesión');
  assert.equal(exited.audit[0].actorId, DEMO_ACTORS.auditor.id);
  assert.throws(() => recordAccess(state, { id: 'demo-employee', name: 'Inactivo', role: 'employee' }, 'Inicio de sesión'), /permiso/);
});

test('future disbursements remain simulations and cannot become actual debt', () => {
  const input = { creditor: 'Acreedor ficticio', kind: 'loan' as const, principal: '1000000.00', monthlyRate: '1', installments: 6, startDate: '2099-01-10', dueDay: 10, method: 'fixed_payment' as const, locationId: 'sede-principal' };
  assert(buildAmortization(input).length === 6);
  assert.throws(() => createDebt(createDemoState(), input, DEMO_ACTORS.treasury), /fecha futura/);
});

test('a still-detected condition reopens instead of hiding behind a saved resolution', () => {
  const state = createDemoState();
  const alert = deriveAlerts(state, '2026-11-10').find(row => row.id === 'backup-stale')!;
  state.alerts.push({ ...alert, status: 'resolved', resolution: 'No constituye verificación real' });
  assert.equal(deriveAlerts(state, '2026-11-10').find(row => row.id === alert.id)!.status, 'open');
});
