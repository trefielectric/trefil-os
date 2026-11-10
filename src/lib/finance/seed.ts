import { fromCents, toCents } from './money';
import type { Actor, State, Support, Transaction, TransactionKind } from './types';

export const DEMO_ACTORS: Record<'owner' | 'admin' | 'treasury' | 'auditor', Actor> = {
  owner: { id: 'demo-owner', name: 'Propietario · Demo', role: 'owner' },
  admin: { id: 'demo-admin', name: 'Administración · Demo', role: 'admin' },
  treasury: { id: 'demo-treasury', name: 'Tesorería · Demo', role: 'treasury' },
  auditor: { id: 'demo-auditor', name: 'Auditoría · Demo', role: 'auditor' },
};

function demoSupport(reference: string): Support {
  const stream = `BT /F1 16 Tf 40 790 Td (TREFIL OS - DOCUMENTO DE DEMOSTRACION) Tj 0 -35 Td /F1 12 Tf (SIN VALIDEZ CONTABLE - DATOS FICTICIOS) Tj 0 -25 Td (${reference}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name: `DEMO-${reference}.pdf`, type: 'application/pdf', size: pdf.length, dataUrl: `data:application/pdf;base64,${btoa(pdf)}` };
}

/** All people, amounts, account suffixes and documents in this fixture are fictional. */
export function createDemoState(): State {
  const locationId = 'sede-principal';
  const state: State = {
    version: 1,
    organization: { id: 'demo-trefil-electric', name: 'Trefil Electric', taxId: 'DEMOSTRACIÓN · Sin datos empresariales' },
    locations: [{ id: locationId, name: 'Sede principal' }, { id: 'sede-planta', name: 'Planta de producción' }],
    accounts: [
      { id: 'bancolombia', name: 'Cuenta operativa', kind: 'bank', bank: 'Bancolombia', lastFour: '4820', custodian: 'Tesorería · Demo', locationId, active: true },
      { id: 'davivienda', name: 'Nómina y obligaciones', kind: 'bank', bank: 'Davivienda', lastFour: '9031', custodian: 'Administración · Demo', locationId, active: true },
      { id: 'caja', name: 'Caja principal', kind: 'cash', custodian: 'Tesorería · Demo', locationId, active: true },
      { id: 'nequi', name: 'Billetera empresarial', kind: 'wallet', bank: 'Nequi', lastFour: '0156', custodian: 'Tesorería · Demo', locationId, active: true },
      { id: 'personal', name: 'Cuenta personal autorizada', kind: 'personal', bank: 'Cuenta temporal', lastFour: '7203', custodian: 'Responsable temporal · Demo', locationId, active: true, businessUseAuthorizedUntil: '2026-12-31' },
    ],
    transactions: [], debts: [], debtPayments: [], reconciliations: [], alerts: [], audit: [],
    members: [
      { ...DEMO_ACTORS.owner, email: 'propietario@demo.invalid', active: true, locationIds: [locationId, 'sede-planta'] },
      { ...DEMO_ACTORS.admin, email: 'administracion@demo.invalid', active: true, locationIds: [locationId, 'sede-planta'] },
      { ...DEMO_ACTORS.treasury, email: 'tesoreria@demo.invalid', active: true, locationIds: [locationId] },
      { ...DEMO_ACTORS.auditor, email: 'auditoria@demo.invalid', active: true, locationIds: [locationId, 'sede-planta'] },
      { id: 'demo-accounting', name: 'Contabilidad · Demo', role: 'accounting', email: 'contabilidad@demo.invalid', active: true, locationIds: [locationId, 'sede-planta'] },
      { id: 'demo-employee', name: 'Empleado inactivo · Demo', role: 'employee', email: 'empleado@demo.invalid', active: false, locationIds: [locationId] },
    ],
    backups: [],
  };
  let count = 0;
  function control(name: string): string {
    const id = `ledger-${name}-${locationId}`;
    if (!state.accounts.some(account => account.id === id)) state.accounts.push({ id, name: `Control ${name}`, kind: 'ledger', custodian: 'Contabilidad', locationId, active: true, origin: 'system' });
    return id;
  }
  function posting(kind: TransactionKind, date: string, description: string, party: string, category: string, amount: string, accountId: string, other: string, incoming = false, support = true, status: Transaction['status'] = 'posted'): Transaction {
    const id = `demo-tx-${++count}`;
    const value = fromCents(toCents(amount));
    const tx: Transaction = { id, reference: `TF-${String(count).padStart(5, '0')}`, kind, date, description, party, category, locationId, amount: value, entries: incoming ? [{ accountId, debit: value, credit: '0.00' }, { accountId: other, debit: '0.00', credit: value }] : [{ accountId: other, debit: value, credit: '0.00' }, { accountId, debit: '0.00', credit: value }], status, idempotencyKey: `seed:${id}`, requestedBy: DEMO_ACTORS.treasury.id, approvedBy: status === 'posted' && (toCents(value) >= 500000000n || kind === 'opening' || kind === 'debt_payment') ? DEMO_ACTORS.admin.id : undefined, createdAt: `${date}T15:00:00Z`, support: support ? demoSupport(`TF-${String(count).padStart(5, '0')}`) : undefined, origin: 'demo_fixture' };
    state.transactions.unshift(tx);
    return tx;
  }
  const equity = control('equity');
  const income = control('income');
  const expenses = control('expense');
  const salary = control('salaries');
  const advances = control('advances');
  const loans = control('loans');
  for (const [account, amount] of [['bancolombia', '65000000.00'], ['davivienda', '20000000.00'], ['caja', '6000000.00'], ['nequi', '4000000.00'], ['personal', '5000000.00']]) posting('opening', '2026-11-01', 'Saldo de apertura ficticio', 'Apertura · Demo', 'Patrimonio inicial', amount, account, equity, true);
  posting('income', '2026-11-02', 'Venta de alambre galvanizado · Demo', 'Cliente industrial A · Demo', 'Venta de producto terminado', '36500000.00', 'bancolombia', income, true);
  posting('transfer', '2026-11-03', 'Provisión para nómina', 'Traslado interno · Demo', 'Traslado entre cuentas', '12000000.00', 'bancolombia', 'davivienda');
  posting('salary', '2026-11-04', 'Nómina primera semana · Demo', 'Equipo de planta · Demo', 'Salarios', '4200000.00', 'davivienda', salary);
  posting('income', '2026-11-05', 'Recaudo de cartera · Demo', 'Cliente industrial B · Demo', 'Recaudo de cartera', '8000000.00', 'bancolombia', income, true);
  posting('expense', '2026-11-06', 'Compra de materia prima · Demo', 'Proveedor de acero A · Demo', 'Materias primas', '9250000.00', 'bancolombia', expenses);
  posting('expense', '2026-11-06', 'Transporte local · Demo', 'Transportador A · Demo', 'Logística y transporte', '580000.00', 'caja', expenses, false, false);
  posting('transfer', '2026-11-07', 'Reposición de caja principal', 'Traslado interno · Demo', 'Traslado entre cuentas', '3000000.00', 'bancolombia', 'caja');
  posting('expense', '2026-11-08', 'Mantenimiento de trefiladora · Demo', 'Taller de mantenimiento · Demo', 'Mantenimiento', '1050000.00', 'nequi', expenses);
  posting('income', '2026-11-09', 'Recaudo temporal autorizado · Demo', 'Cliente industrial C · Demo', 'Ventas', '380000.00', 'personal', income, true, false);
  posting('advance', '2026-11-09', 'Anticipo para insumos · Demo', 'Responsable de compras · Demo', 'Anticipos por legalizar', '500000.00', 'bancolombia', advances);
  posting('loan', '2026-11-09', 'Desembolso de préstamo puente · Demo', 'Financiador C · Demo', 'Préstamos recibidos', '500000.00', 'bancolombia', loans, true);
  posting('expense', '2026-11-10', 'Compra de repuestos pendiente', 'Proveedor de repuestos · Demo', 'Mantenimiento', '6200000.00', 'bancolombia', expenses, false, true, 'pending');
  state.debts = [
    { id: 'debt-a', creditor: 'Financiador A · Demo', kind: 'loan', principal: '50000000.00', monthlyRate: '1.5', installments: 12, startDate: '2026-10-05', dueDay: 5, method: 'fixed_payment', locationId, status: 'active', guarantee: 'Garantía simulada', notes: 'Obligación ficticia para probar cuotas vencidas. No representa una deuda real.' },
    { id: 'debt-b', creditor: 'Inversionista B · Demo', kind: 'investment', principal: '35000000.00', monthlyRate: '1.2', installments: 18, startDate: '2026-10-15', dueDay: 15, method: 'fixed_principal', locationId, status: 'active', guarantee: 'Contrato de demostración', notes: 'Capital ficticio; la tabla es una proyección.' },
    { id: 'debt-c', creditor: 'Financiador C · Demo', kind: 'loan', principal: '15000000.00', monthlyRate: '1.8', installments: 6, startDate: '2026-10-20', dueDay: 20, method: 'interest_only', locationId, status: 'active', notes: 'Obligación de prueba con capital al vencimiento.' },
  ];
  // A real payment is a ledger posting, never an amortization row.
  const debtTx = posting('debt_payment', '2026-11-08', 'Abono extraordinario de capital · Demo', 'Financiador A · Demo', 'Deudas e inversionistas', '1800000.00', 'bancolombia', control('debt-principal'));
  debtTx.approvedBy = DEMO_ACTORS.admin.id;
  state.debtPayments = [{ id: 'demo-payment-1', debtId: 'debt-a', transactionId: debtTx.id, date: '2026-11-08', amount: '1800000.00', interest: '0.00', principal: '1800000.00', status: 'posted' }];
  const currentCash = state.transactions.filter(tx => tx.status === 'posted').flatMap(tx => tx.entries).filter(row => row.accountId === 'bancolombia').reduce((sum, row) => sum + toCents(row.debit) - toCents(row.credit), 0n);
  // 83.45m operating, 27.8m payroll, 8.42m cash, 2.95m wallet, 5.38m temporary = 128m COP.
  if (currentCash !== 8345000000n) throw new Error('La semilla financiera no cuadra.');
  state.reconciliations = [
    { id: 'demo-reconciliation-1', accountId: 'bancolombia', locationId, date: '2026-11-09', bookAmount: '83450000.00', bankAmount: '83450000.00', difference: '0.00', status: 'matched', notes: 'Conciliación ficticia de demostración', actorId: DEMO_ACTORS.admin.id, createdAt: '2026-11-09T21:00:00Z' },
    { id: 'demo-reconciliation-2', accountId: 'davivienda', locationId, date: '2026-11-09', bookAmount: '27800000.00', bankAmount: '27800000.00', difference: '0.00', status: 'matched', notes: 'Conciliación ficticia de demostración', actorId: DEMO_ACTORS.admin.id, createdAt: '2026-11-09T21:10:00Z' },
    { id: 'demo-reconciliation-3', accountId: 'caja', locationId, date: '2026-11-09', bookAmount: '8420000.00', bankAmount: '8390000.00', difference: '-30000.00', status: 'difference', notes: 'Diferencia ficticia para comprobar alertas', actorId: DEMO_ACTORS.treasury.id, createdAt: '2026-11-09T21:20:00Z' },
  ];
  state.audit = [
    { id: 'audit-demo-1', action: 'Datos ficticios inicializados', entityType: 'demo', entityId: state.organization.id, actorId: 'system', actorName: 'Sistema de demostración', timestamp: '2026-11-10T12:00:00Z', reason: 'Sin conexiones institucionales ni datos empresariales reales.' },
    { id: 'audit-demo-2', action: 'Solicitud de aprobación', entityType: 'financial_transaction', entityId: 'demo-tx-17', actorId: DEMO_ACTORS.treasury.id, actorName: DEMO_ACTORS.treasury.name, timestamp: '2026-11-10T15:00:00Z', reason: 'Compra de repuestos por COP 6.200.000' },
    { id: 'audit-demo-3', action: 'Conciliación registrada', entityType: 'reconciliation', entityId: 'demo-reconciliation-3', actorId: DEMO_ACTORS.treasury.id, actorName: DEMO_ACTORS.treasury.name, timestamp: '2026-11-09T21:20:00Z', reason: 'Diferencia ficticia de COP -30.000' },
  ];
  return state;
}
