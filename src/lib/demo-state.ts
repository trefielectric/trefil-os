import { add, buildAmortization, fromCents, getAccountBalance, getDebtBalance, getSummary, isBalanced, money, rateFraction, toCents, validateDate, type State } from './finance';

export const DEMO_STORAGE_KEY = 'trefil-os:demo:v1';
export const DEMO_WRITER_LOCK = 'trefil-os-demo-write';
type ObjectValue = Record<string, unknown>;
const roles = ['owner','admin','treasury','accounting','inventory','production','sales','hr','employee','auditor'];
const kinds = ['income','expense','transfer','opening','advance','reimbursement','salary','loan','adjustment','reversal','debt_payment','personal_expense'];
const statuses = ['pending','posted','rejected'];
const supportTypes = ['application/pdf','image/png','image/jpeg','image/webp'];

function invalid(path: string): never { throw new Error(`Datos inválidos en ${path}.`); }
function object(value: unknown, path: string): ObjectValue { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path); return value as ObjectValue; }
function list(value: unknown, path: string, maximum = 10000): unknown[] { if (!Array.isArray(value) || value.length > maximum) invalid(path); return value; }
function text(value: unknown, path: string, minimum = 1, maximum = 2000): string { if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum) invalid(path); return value; }
function identifier(value: unknown, path: string): string { const id = text(value,path,1,2000); if (!/^[A-Za-z0-9:_-]+$/.test(id) || ['__proto__','constructor','prototype'].includes(id)) invalid(path); return id; }
function optionalText(value: unknown, path: string, maximum = 2000): void { if (value !== undefined) text(value,path,0,maximum); }
function flag(value: unknown, path: string): void { if (typeof value !== 'boolean') invalid(path); }
function choice(value: unknown, options: string[], path: string): string { if (typeof value !== 'string' || !options.includes(value)) invalid(path); return value; }
function decimal(value: unknown, path: string, nonnegative = false): string {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d{0,15})\.\d{2}$/.test(value)) invalid(path);
  try { if (money(value) !== value || (nonnegative && toCents(value) < 0n)) invalid(path); } catch { invalid(path); }
  return value;
}
function date(value: unknown, path: string): string { const result = text(value,path,10,10); try { validateDate(result); } catch { invalid(path); } return result; }
function time(value: unknown, path: string): void {
  const result = text(value,path,20,30);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,3})?Z$/.test(result) || !Number.isFinite(Date.parse(result))) invalid(path);
  date(result.slice(0,10),path);
}
function optionalTime(value: unknown, path: string): void { if (value !== undefined) time(value,path); }
function integer(value: unknown, path: string, minimum: number, maximum: number): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(path); return value; }
function uniqueIds(values: unknown[], path: string): Set<string> {
  const ids = new Set<string>();
  values.forEach((value,index) => { const id = identifier(object(value,`${path}[${index}]`).id,`${path}[${index}].id`); if (ids.has(id)) invalid(`${path}.id duplicado`); ids.add(id); });
  return ids;
}
function uniqueStrings(values: unknown[], path: string): string[] {
  const items = values.map((value,index) => identifier(value,`${path}[${index}]`));
  if (new Set(items).size !== items.length) invalid(path);
  return items;
}
function support(value: unknown, path: string): void {
  if (value === undefined) return;
  const item = object(value,path); text(item.name,`${path}.name`,1,255);
  const type = choice(item.type,supportTypes,`${path}.type`);
  const size = integer(item.size,`${path}.size`,0,5 * 1024 * 1024);
  if (item.dataUrl === undefined) return;
  const url = text(item.dataUrl,`${path}.dataUrl`,1,7 * 1024 * 1024);
  const prefix = `data:${type};base64,`;
  if (!url.startsWith(prefix)) invalid(`${path}.dataUrl`);
  const encoded = url.slice(prefix.length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) invalid(`${path}.dataUrl`);
  const decodedSize = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (decodedSize !== size || decodedSize > 5 * 1024 * 1024) invalid(`${path}.size`);
}

/** Reject unsafe snapshots before any component evaluates money, dates or references. */
export function inspectDemoState(value: unknown): { ok: true; state: State } | { ok: false; error: string } {
  try {
    const root = object(value,'estado');
    if (root.version !== 1) invalid('version');
    const organization = object(root.organization,'organization');
    if (organization.id !== 'demo-trefil-electric' || organization.name !== 'Trefil Electric') invalid('organization');
    text(organization.taxId,'organization.taxId',1,255);
    const locations = list(root.locations,'locations',1000); if (!locations.length) invalid('locations');
    const locationIds = uniqueIds(locations,'locations'); locations.forEach((value,index) => text(object(value,'location').name,`locations[${index}].name`,1,255));
    const members = list(root.members,'members',1000); const memberIds = uniqueIds(members,'members');
    members.forEach((value,index) => {
      const item = object(value,'member'); const path = `members[${index}]`;
      text(item.name,`${path}.name`,1,255); choice(item.role,roles,`${path}.role`); flag(item.active,`${path}.active`);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(item.email,`${path}.email`,3,254))) invalid(`${path}.email`);
      const scopes = uniqueStrings(list(item.locationIds,`${path}.locationIds`,1000),`${path}.locationIds`);
      if (!scopes.length || scopes.some(id => !locationIds.has(id))) invalid(`${path}.locationIds`);
    });
    if (!members.some(value => { const item = object(value,'member'); return item.active && item.role === 'owner'; })) invalid('members.propietario activo');
    const accounts = list(root.accounts,'accounts',2000); const accountIds = uniqueIds(accounts,'accounts');
    accounts.forEach((value,index) => {
      const item = object(value,'account'); const path = `accounts[${index}]`;
      text(item.name,`${path}.name`,1,255); choice(item.kind,['bank','cash','wallet','personal','ledger'],`${path}.kind`); text(item.custodian,`${path}.custodian`,1,255); flag(item.active,`${path}.active`);
      if (!locationIds.has(identifier(item.locationId,`${path}.locationId`))) invalid(`${path}.locationId`);
      optionalText(item.bank,`${path}.bank`,255); optionalText(item.origin,`${path}.origin`,100); optionalTime(item.createdAt,`${path}.createdAt`);
      if (item.lastFour !== undefined && !/^\d{4}$/.test(text(item.lastFour,`${path}.lastFour`,4,4))) invalid(`${path}.lastFour`);
      if (item.businessUseAuthorizedUntil !== undefined) date(item.businessUseAuthorizedUntil,`${path}.businessUseAuthorizedUntil`);
      if (item.kind === 'personal' && !item.businessUseAuthorizedUntil) invalid(`${path}.businessUseAuthorizedUntil`);
    });
    const transactions = list(root.transactions,'transactions'); const transactionIds = uniqueIds(transactions,'transactions'); const idempotency = new Set<string>(); const references = new Set<string>();
    transactions.forEach((value,index) => {
      const item = object(value,'transaction'); const path = `transactions[${index}]`;
      const reference = text(item.reference,`${path}.reference`,1,100); if (references.has(reference)) invalid(`${path}.reference duplicada`); references.add(reference);
      choice(item.kind,kinds,`${path}.kind`); choice(item.status,statuses,`${path}.status`); date(item.date,`${path}.date`); time(item.createdAt,`${path}.createdAt`);
      text(item.description,`${path}.description`); text(item.party,`${path}.party`); text(item.category,`${path}.category`,0); text(item.origin,`${path}.origin`,1,100);
      if (!locationIds.has(identifier(item.locationId,`${path}.locationId`)) || !memberIds.has(identifier(item.requestedBy,`${path}.requestedBy`))) invalid(`${path}.ámbito`);
      const amount = decimal(item.amount,`${path}.amount`,true); if (toCents(amount) <= 0n) invalid(`${path}.amount`);
      const key = text(item.idempotencyKey,`${path}.idempotencyKey`,8,255); if (idempotency.has(key)) invalid(`${path}.idempotencyKey duplicada`); idempotency.add(key);
      if (item.approvedBy !== undefined && (!memberIds.has(identifier(item.approvedBy,`${path}.approvedBy`)) || item.approvedBy === item.requestedBy)) invalid(`${path}.approvedBy`);
      for (const field of ['reason','rejectionReason','requestFingerprint']) optionalText(item[field],`${path}.${field}`,field === 'requestFingerprint' ? 8 * 1024 * 1024 : 2000);
      if (item.reversalOf !== undefined && !transactionIds.has(identifier(item.reversalOf,`${path}.reversalOf`))) invalid(`${path}.reversalOf`);
      if (item.reversedBy !== undefined && !transactionIds.has(identifier(item.reversedBy,`${path}.reversedBy`))) invalid(`${path}.reversedBy`);
      if ((item.kind === 'reversal') !== (item.reversalOf !== undefined)) invalid(`${path}.reversalOf`);
      support(item.support,`${path}.support`);
      const entries = list(item.entries,`${path}.entries`,20); const entryAccounts = new Set<string>();
      entries.forEach((entry,index) => {
        const row = object(entry,`${path}.entries[${index}]`); const id = identifier(row.accountId,`${path}.entries[${index}].accountId`);
        if (!accountIds.has(id) || entryAccounts.has(id)) invalid(`${path}.entries.accountId`); entryAccounts.add(id);
        if (object(accounts.find(value => object(value,'account').id === id),'account').locationId !== item.locationId) invalid(`${path}.entries.sede`);
        decimal(row.debit,`${path}.entries[${index}].debit`,true); decimal(row.credit,`${path}.entries[${index}].credit`,true);
      });
      const transaction = item as unknown as State['transactions'][number];
      if (!isBalanced(transaction) || add(...transaction.entries.map(row => row.debit)) !== amount) invalid(`${path}.asiento equilibrado`);
      // Compatibility with the one immutable original fixture that omitted its
      // approver metadata. Preserve the snapshot; never invent an approval/audit.
      const legacyWalletOpening = item.origin === 'demo_fixture' && item.id === 'demo-tx-4' && item.idempotencyKey === 'seed:demo-tx-4' && item.kind === 'opening' && item.status === 'posted' && item.date === '2026-11-01' && item.amount === '4000000.00' && item.locationId === 'sede-principal' && item.requestedBy === 'demo-treasury' && item.description === 'Saldo de apertura ficticio' && transaction.entries.length === 2 && transaction.entries.some(row => row.accountId === 'nequi' && row.debit === '4000000.00' && row.credit === '0.00') && transaction.entries.some(row => row.accountId === 'ledger-equity-sede-principal' && row.credit === '4000000.00' && row.debit === '0.00');
      if (item.status === 'posted' && (toCents(amount) >= 500000000n || ['opening','adjustment','personal_expense','debt_payment','reversal'].includes(String(item.kind))) && !item.approvedBy && !legacyWalletOpening) invalid(`${path}.aprobación independiente`);
    });
    const state = root as unknown as State;
    for (const transaction of state.transactions) {
      if (transaction.reversalOf) {
        const original = state.transactions.find(row => row.id === transaction.reversalOf)!;
        if (original.kind === 'reversal' || original.status !== 'posted' || original.locationId !== transaction.locationId || original.amount !== transaction.amount || original.entries.length !== transaction.entries.length || transaction.entries.some(row => !original.entries.some(item => item.accountId === row.accountId && item.debit === row.credit && item.credit === row.debit))) invalid('transactions.reverso');
        if (transaction.status === 'posted' && original.reversedBy !== transaction.id) invalid('transactions.reversedBy');
      }
      if (transaction.reversedBy) {
        const reversal = state.transactions.find(row => row.id === transaction.reversedBy)!;
        if (reversal.status !== 'posted' || reversal.reversalOf !== transaction.id) invalid('transactions.reversedBy');
      }
    }
    const debts = list(root.debts,'debts',1000); const debtIds = uniqueIds(debts,'debts');
    debts.forEach((value,index) => {
      const item = object(value,'debt'); const path = `debts[${index}]`;
      text(item.creditor,`${path}.creditor`,1,255); choice(item.kind,['loan','investment'],`${path}.kind`); choice(item.status,['active','paid'],`${path}.status`); decimal(item.principal,`${path}.principal`,true);
      date(item.startDate,`${path}.startDate`); text(item.monthlyRate,`${path}.monthlyRate`,1,20); integer(item.installments,`${path}.installments`,1,600); integer(item.dueDay,`${path}.dueDay`,1,31); choice(item.method,['fixed_payment','fixed_principal','interest_only'],`${path}.method`);
      if (!locationIds.has(identifier(item.locationId,`${path}.locationId`))) invalid(`${path}.locationId`);
      optionalText(item.guarantee,`${path}.guarantee`); optionalText(item.notes,`${path}.notes`); optionalTime(item.createdAt,`${path}.createdAt`); support(item.contract,`${path}.contract`);
      if (item.graceMonths !== undefined) integer(item.graceMonths,`${path}.graceMonths`,0,599);
      if (item.extraPayments !== undefined) list(item.extraPayments,`${path}.extraPayments`,600).forEach((value,index) => { const extra = object(value,`${path}.extraPayments[${index}]`); integer(extra.period,`${path}.extraPayments.period`,1,600); decimal(extra.amount,`${path}.extraPayments.amount`,true); });
      if (item.rateChanges !== undefined) list(item.rateChanges,`${path}.rateChanges`,600).forEach((value,index) => { const change = object(value,`${path}.rateChanges[${index}]`); integer(change.period,`${path}.rateChanges.period`,1,600); text(change.monthlyRate,`${path}.rateChanges.monthlyRate`,1,20); });
      try { const rows = buildAmortization(item as unknown as State['debts'][number]); add(...rows.map(row => row.interest)); add(...rows.map(row => row.payment)); } catch { invalid(`${path}.amortización`); }
    });
    const payments = list(root.debtPayments,'debtPayments'); uniqueIds(payments,'debtPayments'); const paymentTransactions = new Set<string>();
    payments.forEach((value,index) => {
      const item = object(value,'debtPayment'); const path = `debtPayments[${index}]`;
      if (!debtIds.has(identifier(item.debtId,`${path}.debtId`)) || !transactionIds.has(identifier(item.transactionId,`${path}.transactionId`)) || paymentTransactions.has(String(item.transactionId))) invalid(`${path}.referencias`); paymentTransactions.add(String(item.transactionId));
      const debt = state.debts.find(row => row.id === item.debtId)!; const transaction = state.transactions.find(row => row.id === item.transactionId)!;
      const paidOn = date(item.date,`${path}.date`); choice(item.status,statuses,`${path}.status`);
      const amount = decimal(item.amount,`${path}.amount`,true); const principal = decimal(item.principal,`${path}.principal`,true); const interest = decimal(item.interest,`${path}.interest`,true);
      if (toCents(amount) <= 0n || add(principal,interest) !== amount || transaction.kind !== 'debt_payment' || transaction.status !== item.status || transaction.amount !== amount || transaction.date !== paidOn || debt.locationId !== transaction.locationId || paidOn < debt.startDate) invalid(`${path}.distribución`);
      if (item.appliedMonthlyRate !== undefined) { const rate = text(item.appliedMonthlyRate,`${path}.appliedMonthlyRate`,1,20); try { rateFraction(rate); } catch { invalid(`${path}.appliedMonthlyRate`); } }
    });
    if (state.transactions.some(transaction => transaction.kind === 'debt_payment' && !paymentTransactions.has(transaction.id))) invalid('debtPayments.pago sin distribución');
    const reconciliations = list(root.reconciliations,'reconciliations'); uniqueIds(reconciliations,'reconciliations');
    reconciliations.forEach((value,index) => {
      const item = object(value,'reconciliation'); const path = `reconciliations[${index}]`;
      if (!accountIds.has(identifier(item.accountId,`${path}.accountId`)) || !memberIds.has(identifier(item.actorId,`${path}.actorId`))) invalid(`${path}.referencias`);
      const account = state.accounts.find(row => row.id === item.accountId)!;
      if (account.kind === 'ledger' || account.locationId !== item.locationId) invalid(`${path}.locationId`);
      date(item.date,`${path}.date`); time(item.createdAt,`${path}.createdAt`); text(item.notes,`${path}.notes`,0); choice(item.status,['matched','difference'],`${path}.status`);
      const book = decimal(item.bookAmount,`${path}.bookAmount`); const bank = decimal(item.bankAmount,`${path}.bankAmount`); const difference = decimal(item.difference,`${path}.difference`);
      if (toCents(bank) - toCents(book) !== toCents(difference) || (item.status === 'matched') !== (toCents(difference) === 0n)) invalid(`${path}.difference`);
    });
    const alerts = list(root.alerts,'alerts'); uniqueIds(alerts,'alerts');
    alerts.forEach((value,index) => {
      const item = object(value,'alert'); const path = `alerts[${index}]`;
      for (const field of ['type','title','description','responsible','evidence']) text(item[field],`${path}.${field}`);
      choice(item.severity,['critical','warning','info'],`${path}.severity`); choice(item.status,['open','in_progress','resolved'],`${path}.status`); date(item.dueDate,`${path}.dueDate`); optionalText(item.resolution,`${path}.resolution`);
      const comments = list(item.comments,`${path}.comments`,1000); uniqueIds(comments,`${path}.comments`);
      comments.forEach(value => { const comment = object(value,'comment'); text(comment.actorName,`${path}.comment.actorName`,1,255); time(comment.date,`${path}.comment.date`); text(comment.text,`${path}.comment.text`); });
      list(item.history,`${path}.history`,2000).forEach(value => { const event = object(value,'history'); text(event.actorName,`${path}.history.actorName`,1,255); time(event.date,`${path}.history.date`); text(event.action,`${path}.history.action`); });
    });
    const audit = list(root.audit,'audit',30000); uniqueIds(audit,'audit');
    audit.forEach((value,index) => { const item = object(value,'auditEvent'); const path = `audit[${index}]`; for (const field of ['action','entityType','entityId','actorId','actorName']) text(item[field],`${path}.${field}`); time(item.timestamp,`${path}.timestamp`); for (const field of ['reason','before','after']) optionalText(item[field],`${path}.${field}`); if (item.locationId !== undefined && !locationIds.has(identifier(item.locationId,`${path}.locationId`))) invalid(`${path}.locationId`); });
    const backups = list(root.backups,'backups',10000); uniqueIds(backups,'backups');
    backups.forEach((value,index) => {
      const item = object(value,'backup'); const path = `backups[${index}]`; time(item.startedAt,`${path}.startedAt`); optionalTime(item.completedAt,`${path}.completedAt`); optionalTime(item.restoreVerifiedAt,`${path}.restoreVerifiedAt`); choice(item.status,['success','failed','running'],`${path}.status`); flag(item.verified,`${path}.verified`); text(item.destination,`${path}.destination`); optionalText(item.error,`${path}.error`);
      if (item.sizeBytes !== undefined) integer(item.sizeBytes,`${path}.sizeBytes`,0,Number.MAX_SAFE_INTEGER);
      if (item.checksum !== undefined && !/^[a-fA-F0-9]{64}$/.test(text(item.checksum,`${path}.checksum`,64,64))) invalid(`${path}.checksum`);
      if (item.verified && (item.status !== 'success' || !item.completedAt || !item.checksum)) invalid(`${path}.verified`);
    });
    // A structurally valid snapshot must also support every financial read without
    // overflowing canonical money or accepting an overpaid debt.
    try {
      state.accounts.forEach(account => getAccountBalance(state,account.id));
      state.debts.forEach(debt => { if (toCents(getDebtBalance(state,debt.id)) < 0n) invalid('debtPayments.capital superior al saldo'); });
      getSummary(state,'2026-11-10');
      const cashIds = new Set(state.accounts.filter(account => account.kind !== 'ledger').map(account => account.id));
      let balance = 0n;
      for (const transaction of [...state.transactions].filter(row => row.status === 'posted').sort((a,b) => a.date.localeCompare(b.date))) {
        balance += transaction.entries.reduce((total,row) => total + (cashIds.has(row.accountId) ? toCents(row.debit) - toCents(row.credit) : 0n),0n);
        fromCents(balance);
      }
    } catch { invalid('resúmenes financieros'); }
    return { ok: true, state };
  } catch (reason) {
    return { ok: false, error: reason instanceof Error && /^Datos inválidos en [A-Za-z0-9Á-ž .\[\]_-]+\.$/.test(reason.message) ? reason.message : 'La copia guardada contiene una estructura financiera inválida.' };
  }
}

export function decodeDemoState(raw: string): ReturnType<typeof inspectDemoState> {
  try { if (raw.length > 20 * 1024 * 1024) return { ok:false,error:'La copia guardada supera el tamaño admitido.' }; return inspectDemoState(JSON.parse(raw)); }
  catch { return { ok:false,error:'La copia guardada no contiene JSON válido.' }; }
}

export interface DemoLockManager {
  request(name:string,options:{ifAvailable:true},callback:(lock:object|null)=>Promise<void>):Promise<unknown>;
}
export type DemoReadOnlyReason = 'unsupported' | 'busy' | 'unavailable';

/** Cooperative single writer; readers never queue, steal a lock or write an audit. */
export function holdDemoWriterLease(manager:DemoLockManager|undefined,callbacks:{onWriter:()=>void;onReadOnly:(reason:DemoReadOnlyReason)=>void}) {
  let released = false;
  let releaseHold:()=>void = ()=>{};
  const held = new Promise<void>(resolve => { releaseHold = resolve; });
  // Defer acquisition so a React StrictMode setup immediately cleaned up does
  // not briefly claim a lock and turn the real setup into a reader.
  const done = Promise.resolve().then(async() => {
    if (released) return;
    if (!manager) { callbacks.onReadOnly('unsupported'); return; }
    await manager.request(DEMO_WRITER_LOCK,{ifAvailable:true},async lock => {
      if (released) return;
      if (!lock) { callbacks.onReadOnly('busy'); return; }
      callbacks.onWriter();
      await held;
    });
  }).catch(() => { if (!released) callbacks.onReadOnly('unavailable'); });
  return { done, release:()=>{released=true;releaseHold();} };
}
