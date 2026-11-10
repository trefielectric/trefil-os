import test from 'node:test';
import assert from 'node:assert/strict';
import { CASH_CATALOG, CASH_DENOMINATIONS, CASH_INCOME_CATALOG, approveTransaction, attachCashSupport, cashMonthChecklist, closeCashMonth, closeCashSession, countCashDenominations, createDebt, createDemoState, createEmptyState, createTransaction, deriveAlerts, getAccountBalance, getCashAlerts, getCashReport, getCashSessionSummary, getCashState, getCashTransactionMetadata, getDebtBalance, getSummary, isBalanced, legalizeAdvance, openCashSession, recordCashCount, recordCashTransferReceipt, recordDebtPayment, reconcileAccount, registerCashMovement, requestCashAmendment, reverseTransaction, suggestCashCategory, validateCashState, DEMO_ACTORS } from '../src/lib/finance';
import { inspectDemoState } from '../src/lib/demo-state';
import type { Actor, CashCountDenomination, CashMovementInput, State, Support } from '../src/lib/finance';

const day='2026-10-31';
const owner:Actor={id:'local-owner',name:'Propietario local',role:'owner'};
const admin:Actor={id:'test-admin',name:'Segundo aprobador de prueba',role:'admin'};
const proof:Support={name:'comprobante-prueba.png',type:'image/png',size:3,dataUrl:'data:image/png;base64,AQID'};
const pdf:Support={name:'comprobante-prueba.pdf',type:'application/pdf',size:3,dataUrl:'data:application/pdf;base64,AQID'};
const url='https://example.invalid/comprobante';
let key=0;
function counts(bills1000=0,coins1000=0):CashCountDenomination[]{return CASH_DENOMINATIONS.map(row=>({kind:row.kind,value:row.value,quantity:row.value==='1000.00'?(row.kind==='bill'?bills1000:coins1000):0}));}
function base():State{
  const state=createEmptyState();state.members.push({...admin,email:'admin@test.invalid',active:true,locationIds:['sede-principal']});
  state.accounts=[{id:'cash-a',name:'Caja de prueba A',kind:'cash',custodian:owner.name,locationId:'sede-principal',active:true},{id:'cash-b',name:'Caja de prueba B',kind:'cash',custodian:owner.name,locationId:'sede-principal',active:true},{id:'bank',name:'Banco de prueba',kind:'bank',custodian:owner.name,locationId:'sede-principal',active:true,accountNumber:'1234567890',lastFour:'7890'},{id:'gateway',name:'Pasarela de prueba',kind:'wallet',custodian:owner.name,locationId:'sede-principal',active:true}];return state;
}
function opened(state=base(),accountId='cash-a',date=day):State{return openCashSession(state,{accountId,date,openingCount:counts()},owner);}
function movement(state:State,overrides:Partial<CashMovementInput>={}):State{return registerCashMovement(state,{sessionId:getCashState(state).sessions.find(row=>row.accountId==='cash-a'&&row.status==='open')?.id,kind:'income',categoryId:'entradas-devoluciones',amount:'1000.00',description:'Reintegro de proveedor de prueba',party:'Proveedor de prueba',supportUrl:url,idempotencyKey:`cash-test-${++key}`, ...overrides},owner);}
function bankMovement(state:State,overrides:Partial<CashMovementInput>={}):State{return movement(state,{sessionId:undefined,accountId:'bank',date:day,...overrides});}
function sessionId(state:State,accountId='cash-a'):string{return getCashState(state).sessions.find(row=>row.accountId===accountId&&row.status==='open')!.id;}

test('a new workspace and a legacy state receive no fabricated Caja records',()=>{
  const empty=createEmptyState();assert.equal(empty.transactions.length,0);assert.deepEqual(getCashState(empty).sessions,[]);validateCashState(empty);
  const legacy=createDemoState();const before=JSON.stringify(legacy);assert.equal(getCashState(legacy).version,1);assert.deepEqual(getCashState(legacy).metadata,[]);validateCashState(legacy);assert.equal(JSON.stringify(legacy),before);
});

test('approved catalogue has exactly 11 groups, 67 outflows and 9 inflows with the bank-charge exception',()=>{
  assert.equal(CASH_CATALOG.length,11);assert.equal(CASH_CATALOG.flatMap(row=>row.categories).length,67);assert.equal(CASH_INCOME_CATALOG.length,9);
  assert.equal(suggestCashCategory('','Gastos bancarios')?.id,'gastos-bancarios');assert.equal(suggestCashCategory('gmf-cargos-nequi','Gastos bancarios')?.id,'gmf-cargos-nequi');
  assert.equal(CASH_INCOME_CATALOG.find(row=>row.id==='pago-deudas')?.semantic,'receivable_collection');
});

test('physical counts distinguish the $1,000 bill from the $1,000 coin using exact cents',()=>{
  assert.equal(countCashDenominations(counts(2,3)),'5000.00');
  assert.equal(countCashDenominations(CASH_DENOMINATIONS.map(row=>({...row,quantity:1}))),'189850.00');
  assert.throws(()=>countCashDenominations([]),/12 denominaciones/);
  assert.throws(()=>countCashDenominations(counts().slice(1)),/12 denominaciones/);
  const duplicate=counts();duplicate[0]={...duplicate[1]};assert.throws(()=>countCashDenominations(duplicate),/repetida/);
  const fractional=counts();fractional[0].quantity=0.5;assert.throws(()=>countCashDenominations(fractional),/entero/);
  const negative=counts();negative[0].quantity=-1;assert.throws(()=>countCashDenominations(negative),/entero/);
});

test('opening is scoped, dated in the past or present and restricted to physical cash',()=>{
  const state=base();const before=JSON.stringify(state);
  assert.throws(()=>openCashSession(state,{accountId:'bank',date:day},owner),/únicamente/);
  assert.throws(()=>openCashSession(state,{accountId:'cash-a',date:'2099-01-01'},owner),/futura/);
  assert.throws(()=>openCashSession(state,{accountId:'cash-a',date:day},{...owner,role:'auditor'}),/permiso/);
  assert.equal(JSON.stringify(state),before);
  const result=opened(state);assert.equal(getCashSessionSummary(result,sessionId(result)).openingBalance,'0.00');assert(result.audit.some(row=>row.action==='Turno de efectivo abierto'));validateCashState(result);
});

test('the previous shift must be closed and an earlier opening cannot rewrite later shifts',()=>{
  const state=opened();assert.throws(()=>openCashSession(state,{accountId:'cash-a',date:day},owner),/previo sigue abierto/);
  const closed=closeCashSession(state,{sessionId:sessionId(state),denominations:counts()},owner);const next=openCashSession(closed,{accountId:'cash-a',date:'2026-11-01'},owner);assert.equal(getCashState(next).sessions.length,2);
  const laterClosed=closeCashSession(next,{sessionId:sessionId(next),denominations:counts()},owner);assert.throws(()=>openCashSession(laterClosed,{accountId:'cash-a',date:day},owner),/retroceder/);
});

test('direct engine cash writes cannot bypass an open shift and link both ends of a cash transfer',()=>{
  const state=base();const input={kind:'income' as const,date:day,description:'Entrada de prueba',party:'Proveedor de prueba',category:'Devoluciones',locationId:'sede-principal',accountId:'cash-a',amount:'1000.00',idempotencyKey:'bypass-open-test'};
  assert.throws(()=>createTransaction(state,input,owner),/Abre un turno/);
  const next=createTransaction(opened(state),input,owner);assert.deepEqual(next.transactions[0].cashSessionIds,[sessionId(next)]);assert(isBalanced(next.transactions[0]));
  assert.throws(()=>createTransaction(next,{...input,kind:'transfer',destinationAccountId:'cash-b',idempotencyKey:'bypass-transfer-test'},owner),/Abre un turno/);
});

test('each posted cash entry affects its own shift; pending approval does not change theoretical cash',()=>{
  let state=movement(opened());const before=JSON.stringify(state);const shift=sessionId(state);
  state=movement(state,{amount:'5000000.00',idempotencyKey:'pending-large-cash'});assert.equal(state.transactions[0].status,'pending');assert.equal(getCashSessionSummary(state,shift).theoreticalBalance,'1000.00');assert.equal(getCashSessionSummary(state,shift).pendingTransactionIds.length,1);
  assert.throws(()=>closeCashSession(state,{sessionId:shift,denominations:counts(1)},owner),/pendientes de aprobación/);
  assert.throws(()=>approveTransaction(state,state.transactions[0].id,owner),/otra persona/);
  const approved=approveTransaction(state,state.transactions[0].id,admin);assert.equal(getCashSessionSummary(approved,shift).theoreticalBalance,'5001000.00');assert.equal(JSON.parse(before).transactions.length,1);validateCashState(approved);
});

test('balanced net-zero operations still invalidate a count made before those operations',()=>{
  let state=opened();const shift=sessionId(state);state=movement(state);state=movement(state,{kind:'expense',categoryId:'agua',amount:'1000.00',description:'Pago de agua de prueba'});
  assert.equal(getCashSessionSummary(state,shift).theoreticalBalance,'0.00');assert.throws(()=>closeCashSession(state,{sessionId:shift},owner),/obsoleto/);
  const closed=closeCashSession(state,{sessionId:shift,denominations:counts()},owner);assert.equal(getCashState(closed).sessions[0].status,'closed');validateCashState(closed);
});

test('shortages and surpluses remain exact findings and never create balancing transactions',()=>{
  const state=movement(opened());const shift=sessionId(state);const shortage=recordCashCount(state,{sessionId:shift,denominations:counts()},owner);const surplus=recordCashCount(state,{sessionId:shift,denominations:counts(2)},owner);
  assert.equal(getCashAlerts(shortage,day).find(row=>row.type==='cash_count_difference')?.severity,'critical');assert.equal(getCashSessionSummary(shortage,shift).difference,'-1000.00');assert.throws(()=>closeCashSession(shortage,{sessionId:shift},owner),/faltante/);
  assert.equal(getCashSessionSummary(surplus,shift).difference,'1000.00');assert.throws(()=>closeCashSession(surplus,{sessionId:shift},owner),/sobrante/);
  assert.equal(shortage.transactions.length,state.transactions.length);assert.equal(getAccountBalance(shortage,'cash-a'),'1000.00');validateCashState(shortage);
});

test('a late support attachment preserves original evidence, amount and audit and resolves only the support cause',()=>{
  let state=movement(opened(),{supportUrl:undefined,support:undefined});const tx=state.transactions[0];const alert=deriveAlerts(state,day).find(row=>row.id===`support:${tx.id}`)!;state.alerts.push({...alert,comments:[{id:'test-comment',actorName:owner.name,date:new Date().toISOString(),text:'Comprobante solicitado'}]});
  const original=JSON.stringify(tx);state=attachCashSupport(state,{transactionId:tx.id,support:proof,notes:'Foto recibida posteriormente'},owner);state=attachCashSupport(state,{transactionId:tx.id,support:pdf,notes:'Factura complementaria'},owner);
  assert.equal(JSON.stringify(state.transactions.find(row=>row.id===tx.id)),original);assert.equal(getCashTransactionMetadata(state,tx.id).attachments?.length,2);assert.equal(getCashTransactionMetadata(state,tx.id).attachments?.[0].support?.dataUrl,proof.dataUrl);
  const resolved=deriveAlerts(state,day).find(row=>row.id===`support:${tx.id}`)!;assert.equal(resolved.status,'resolved');assert.equal(resolved.comments.length,1);assert(resolved.history.length>0);
  assert(!JSON.stringify(state.audit).includes('base64'));assert(!JSON.stringify(getCashTransactionMetadata(state,tx.id).history).includes('base64'));assert(inspectDemoState(state).ok);validateCashState(state);
});

test('classification and exceptional-close requests remain pending without applying a fake local authorization',()=>{
  let state=movement(opened());state=movement(state,{kind:'advance',categoryId:'por-legalizar',amount:'1000.00',description:'Compra pendiente de legalizar'});const transaction=state.transactions[0];const before=JSON.stringify(transaction);
  state=legalizeAdvance(state,{transactionId:transaction.id,categoryId:'agua',reason:'Factura recibida para revisión',support:pdf},owner);assert.equal(JSON.stringify(state.transactions.find(row=>row.id===transaction.id)),before);assert.equal(getCashTransactionMetadata(state,transaction.id).categoryId,'por-legalizar');assert.equal(getCashState(state).amendmentRequests[0].status,'pending_institutional');
  state=requestCashAmendment(state,{sessionId:sessionId(state),kind:'exceptional_close',reason:'Solicitar revisión de la diferencia'},owner);assert.equal(getCashState(state).sessions[0].status,'open');assert.throws(()=>closeCashSession(state,{sessionId:sessionId(state),denominations:counts()},owner),/legalizar|institucionales/);assert(!cashMonthChecklist(state,'2026-10').canClose);validateCashState(state);
});

test('closed shifts cannot receive new engine postings or approvals with their old binding',()=>{
  const openedState=opened();const shift=sessionId(openedState);const closed=closeCashSession(openedState,{sessionId:shift,denominations:counts()},owner);
  assert.throws(()=>createTransaction(closed,{kind:'income',date:day,description:'Intento posterior al cierre',party:'Proveedor de prueba',category:'Devoluciones',locationId:'sede-principal',accountId:'cash-a',amount:'1000.00',idempotencyKey:'closed-shift-write',cashSessionIds:[shift]},owner),/turno está cerrado/);
  const pending=createTransaction(openedState,{kind:'income',date:day,description:'Solicitud fuera de instantánea',party:'Proveedor de prueba',category:'Devoluciones',locationId:'sede-principal',accountId:'cash-a',amount:'5000000.00',idempotencyKey:'closed-shift-pending'},owner).transactions[0];
  assert.throws(()=>approveTransaction({...closed,transactions:[pending]},pending.id,admin),/turno está cerrado/);
});

test('withdrawal has linked equal entries and receipt comparison never changes ledger cash',()=>{
  let state=bankMovement(opened(),{amount:'10000.00'});const total=getCashReport(state,{startDate:day,endDate:day}).closingAvailable;
  state=bankMovement(state,{kind:'transfer',categoryId:'retiro-entre-cuentas',destinationAccountId:'cash-a',amount:'2000.00',support:proof,supportUrl:undefined});const tx=state.transactions[0];assert(isBalanced(tx));assert.equal(tx.entries.length,2);assert.equal(getCashReport(state,{startDate:day,endDate:day}).closingAvailable,total);
  const before=getAccountBalance(state,'cash-a');const received=recordCashTransferReceipt(state,{transactionId:tx.id,date:day,receivedAmount:'1900.00',support:proof,notes:'Diferencia física observada'},owner);
  assert.equal(getCashState(received).transferReceipts[0].difference,'-100.00');assert.equal(getAccountBalance(received,'cash-a'),before);assert.throws(()=>closeCashSession(received,{sessionId:sessionId(received),denominations:counts(2)},owner),/diferencia de traslado/);
  const continuing=bankMovement(received,{kind:'expense',categoryId:'agua',amount:'100.00'});assert.equal(getAccountBalance(continuing,'bank'),'7900.00');assert(cashMonthChecklist(continuing,'2026-10').items.some(row=>row.id.startsWith('transfer:')));validateCashState(continuing);
});

test('withdrawal photography remains recognized after later PDF evidence and receipts are append-only',()=>{
  let state=bankMovement(opened(),{amount:'10000.00'});state=bankMovement(state,{kind:'transfer',categoryId:'retiro-entre-cuentas',destinationAccountId:'cash-a',amount:'2000.00'});const tx=state.transactions[0];assert(getCashAlerts(state,day).some(row=>row.id===`cash-photo:${tx.id}`));
  state=attachCashSupport(state,{transactionId:tx.id,support:proof},owner);state=attachCashSupport(state,{transactionId:tx.id,support:pdf},owner);assert(!getCashAlerts(state,day).some(row=>row.id===`cash-photo:${tx.id}`));
  assert.throws(()=>recordCashTransferReceipt(state,{transactionId:tx.id,date:'2026-11-01',receivedAmount:'2000.00',support:proof},owner),/misma fecha/);
  state=recordCashTransferReceipt(state,{transactionId:tx.id,date:day,receivedAmount:'2000.00',support:proof},owner);assert.throws(()=>recordCashTransferReceipt(state,{transactionId:tx.id,date:day,receivedAmount:'2000.00',support:proof},owner),/ya fue registrada/);validateCashState(state);
});

test('gateway supplier payment debits the expense and credits the gateway without a fictitious bank or cash hop',()=>{
  const state=bankMovement(base(),{accountId:'gateway',amount:'10000.00'});const paid=bankMovement(state,{accountId:'gateway',kind:'expense',categoryId:'compra-nylon',amount:'1234.56',description:'Pago directo al proveedor desde pasarela'});
  assert.equal(getAccountBalance(paid,'gateway'),'8765.44');assert.equal(getAccountBalance(paid,'cash-a'),'0.00');assert.equal(getAccountBalance(paid,'bank'),'0.00');assert.equal(paid.transactions[0].entries.length,2);assert(isBalanced(paid.transactions[0]));validateCashState(paid);
});

test('financing receipts require an existing obligation and cannot duplicate its principal',()=>{
  let state=base();const input={accountId:'bank',kind:'loan' as const,categoryId:'prestamos',amount:'10000.00'};assert.throws(()=>bankMovement(state,input),/obligación/);
  state=createDebt(state,{creditor:'Acreedor de prueba',kind:'loan',principal:'10000.00',monthlyRate:'1',installments:3,startDate:day,dueDay:31,method:'fixed_principal',locationId:'sede-principal'},owner);const debt=state.debts[0];state=bankMovement(state,{...input,debtId:debt.id});assert.equal(getCashReport(state,{startDate:day,endDate:day}).financingInflows,'10000.00');assert.equal(getCashReport(state,{startDate:day,endDate:day}).externalInflows,'0.00');assert.throws(()=>bankMovement(state,{...input,debtId:debt.id}),/duplicar/);validateCashState(state);
});

test('incoming Pago de deudas is a documented receivable collection, distinct from debt-payment expense',()=>{
  assert.throws(()=>bankMovement(base(),{categoryId:'pago-deudas'}),/préstamo otorgado/);
  const state=bankMovement(base(),{categoryId:'pago-deudas',externalReferences:[{module:'assets',id:'receivable-test',label:'Préstamo otorgado de prueba'}]});const report=getCashReport(state,{startDate:day,endDate:day});assert.equal(report.otherAssetInflows,'1000.00');assert.equal(report.externalInflows,'0.00');
});

test('debt payments split principal, interest, insurance, commission and late fees exactly and reserve no paid capital until approval',()=>{
  let state=bankMovement(base(),{amount:'10000.00'});state=createDebt(state,{creditor:'Acreedor de prueba',kind:'loan',principal:'10000.00',monthlyRate:'1',installments:3,startDate:day,dueDay:31,method:'fixed_principal',locationId:'sede-principal'},owner);const debt=state.debts[0];
  const input={debtId:debt.id,accountId:'bank',date:day,amount:'2000.00',principal:'1000.00',interest:'300.00',insurance:'100.00',commission:'100.00',lateFee:'500.00',support:pdf,idempotencyKey:'cash-fees-payment'};const requested=recordDebtPayment(state,input,owner);assert.equal(getDebtBalance(requested,debt.id),'10000.00');assert.equal(getAccountBalance(requested,'bank'),'10000.00');assert.equal(requested.transactions[0].entries.length,6);assert(isBalanced(requested.transactions[0]));
  const paid=approveTransaction(requested,requested.transactions[0].id,admin);assert.equal(getDebtBalance(paid,debt.id),'9000.00');assert.equal(getAccountBalance(paid,'bank'),'8000.00');assert(!deriveAlerts(paid,day).some(row=>row.type==='payment_allocation'));assert(inspectDemoState(paid).ok);
  assert.throws(()=>recordDebtPayment(state,{...input,support:undefined,idempotencyKey:'cash-late-no-proof'},owner),/mora requieren/);assert.throws(()=>recordDebtPayment(state,{...input,commission:'100.01',idempotencyKey:'cash-fees-imbalance'},owner),/igual al pago/);
});

test('closed calendar months block bank writes, cash openings, debt payments and attempts backdating into prior months',()=>{
  let state=closeCashMonth(base(),{month:'2026-10',notes:'Cierre local sin actividad'},owner);assert.equal(getCashState(state).monthClosures[0].scope,'local');assert.throws(()=>bankMovement(state),/período está cerrado/);assert.throws(()=>bankMovement(state,{date:'2026-09-30'}),/período está cerrado/);assert.throws(()=>openCashSession(state,{accountId:'cash-a',date:day},owner),/período está cerrado/);
  state=createDebt(state,{creditor:'Acreedor de prueba',kind:'loan',principal:'1000.00',monthlyRate:'1',installments:3,startDate:day,dueDay:31,method:'fixed_principal',locationId:'sede-principal'},owner);assert.throws(()=>recordDebtPayment(state,{debtId:state.debts[0].id,accountId:'bank',date:day,amount:'100.00',principal:'100.00',interest:'0.00',idempotencyKey:'closed-debt-write'},owner),/período está cerrado/);
  assert.throws(()=>closeCashMonth(base(),{month:'2099-01'},owner),/no ha terminado/);assert.throws(()=>closeCashMonth(base(),{month:'2026-10'},{...owner,role:'treasury'}),/permiso/);validateCashState(state);
});

test('monthly closing requires bank cutoff reconciliation and preserves an immutable report when later evidence arrives',()=>{
  let state=bankMovement(base(),{support:proof,supportUrl:undefined});assert(cashMonthChecklist(state,'2026-10').items.some(row=>row.id==='reconciliation:bank'));
  state=reconcileAccount(state,{accountId:'bank',date:day,bankAmount:'1000.00',notes:'Saldo de corte verificado en prueba'},owner);assert.equal(cashMonthChecklist(state,'2026-10').canClose,true);state=closeCashMonth(state,{month:'2026-10'},owner);const snapshot=JSON.stringify(getCashState(state).monthClosures[0]);const original=JSON.stringify(state.transactions[0]);
  const next=attachCashSupport(state,{transactionId:state.transactions[0].id,support:pdf,notes:'Documento adicional de período cerrado'},owner);assert.equal(JSON.stringify(getCashState(next).monthClosures[0]),snapshot);assert.equal(JSON.stringify(next.transactions[0]),original);assert.equal(getCashReport(next,{startDate:'2026-10-01',endDate:day}).version,2);validateCashState(next);assert(inspectDemoState(next).ok);
});

test('reports keep internal transfers, financing, assets and operating expenses separate and omit excluded detail',()=>{
  let state=bankMovement(base(),{amount:'10000.00'});state=bankMovement(state,{kind:'expense',categoryId:'agua',amount:'1000.00'});state=bankMovement(state,{kind:'expense',categoryId:'ahorro-fondetrefil',amount:'2000.00'});state=bankMovement(state,{kind:'transfer',categoryId:'retiro-entre-cuentas',amount:'3000.00',destinationAccountId:'gateway',notes:'Traslado empresarial documentado'});state=bankMovement(state,{kind:'expense',categoryId:'salidas-varias',amount:'500.00',description:'DETALLE PRIVADO DE PRUEBA',businessStatus:'excluded',support:undefined,supportUrl:undefined});
  const report=getCashReport(state,{startDate:'2026-10-01',endDate:day});assert.equal(report.externalInflows,'10000.00');assert.equal(report.operatingExpenses,'1000.00');assert.equal(report.otherAssetOutflows,'2000.00');assert.equal(report.internalTransfers,'3000.00');assert.equal(report.closingAvailable,'6500.00');assert.equal(report.excludedOutflows,'500.00');assert(!JSON.stringify(report).includes('DETALLE PRIVADO'));assert.equal(report.accounts.reduce((sum,row)=>sum+BigInt(row.closing.replace('.','')),0n),650000n);assert(!JSON.stringify(report).includes('1234567890'));
});

test('legacy compensating reversals net report expenses without deleting the original posting',()=>{
  const state=createDemoState();const expense=state.transactions.find(row=>row.kind==='expense'&&row.status==='posted')!;const before=getCashReport(state,{startDate:'2026-11-01',endDate:'2026-11-30'});const pending=reverseTransaction(state,expense.id,'Corrección de prueba documentada',DEMO_ACTORS.treasury);const after=approveTransaction(pending,pending.transactions[0].id,DEMO_ACTORS.admin);const report=getCashReport(after,{startDate:'2026-11-01',endDate:'2026-11-30'});assert.equal(BigInt(before.operatingExpenses.replace('.',''))-BigInt(report.operatingExpenses.replace('.','')),BigInt(expense.amount.replace('.','')));assert(report.movements.some(row=>row.reversalOf===expense.id));
  const local=bankMovement(base());assert.throws(()=>reverseTransaction(local,local.transactions[0].id,'Corrección requiere identidad',owner),/autorización institucional/);
});

test('deep Caja validation rejects corrupt count arithmetic, orphan bindings and fake institutional approval',()=>{
  const state=movement(opened());validateCashState(state);assert(inspectDemoState(state).ok);
  const corrupted=structuredClone(state);corrupted.cash!.counts[0].countedAmount='999.00';assert.throws(()=>validateCashState(corrupted),/totales/);assert.equal(inspectDemoState(corrupted).ok,false);
  const orphan=structuredClone(state);orphan.transactions[0].cashSessionIds=['missing-session'];assert.throws(()=>validateCashState(orphan),/cashSessionIds/);
  const pending=requestCashAmendment(state,{transactionId:state.transactions[0].id,kind:'correction',reason:'Solicitud documentada de prueba'},owner);validateCashState(pending);const forged=structuredClone(pending);(forged.cash!.amendmentRequests[0] as unknown as {status:string}).status='approved';assert.throws(()=>validateCashState(forged),/amendmentRequests/);
  const noArray=structuredClone(state);(noArray.cash as unknown as {counts:unknown}).counts=null;assert.throws(()=>validateCashState(noArray),/counts/);
});

test('support validation fails closed for unsafe URLs, MIME and declared byte counts without mutating money',()=>{
  const state=movement(opened());const id=state.transactions[0].id;const original=JSON.stringify(state);
  assert.throws(()=>attachCashSupport(state,{transactionId:id,supportUrl:'javascript:alert(1)'},owner),/HTTPS/);assert.throws(()=>attachCashSupport(state,{transactionId:id,supportUrl:'https://user:secret@example.invalid/file'},owner),/credenciales/);assert.throws(()=>attachCashSupport(state,{transactionId:id,support:{...proof,size:4}},owner),/tamaño declarado/);assert.throws(()=>attachCashSupport(state,{transactionId:id,support:{...proof,type:'text/html'}},owner),/Comprobante inválido/);assert.equal(JSON.stringify(state),original);
  assert.throws(()=>attachCashSupport(state,{transactionId:id,support:{...proof,size:0,dataUrl:'data:image/png;base64,'}},owner),/vacío/);
});

test('a report scoped to one site cannot expose another site cash findings, evidence or account names',()=>{
  let state=base();state.locations.push({id:'other-site',name:'Otra sede de prueba'});state.members[0].locationIds.push('other-site');state.accounts.push({id:'private-other-cash',name:'CAJA OTRA SEDE CONFIDENCIAL',kind:'cash',custodian:owner.name,locationId:'other-site',active:true});state=openCashSession(state,{accountId:'private-other-cash',date:day,openingCount:counts()},owner);state=registerCashMovement(state,{sessionId:sessionId(state,'private-other-cash'),kind:'income',categoryId:'entradas-devoluciones',amount:'1000.00',description:'OPERACIÓN OTRA SEDE CONFIDENCIAL',party:'Proveedor otra sede',idempotencyKey:'other-site-confidential'},owner);state=recordCashCount(state,{sessionId:sessionId(state,'private-other-cash'),denominations:counts()},owner);
  assert(getCashAlerts(state,day).some(row=>row.locationId==='other-site'));const report=getCashReport(state,{startDate:'2026-10-01',endDate:day,locationId:'sede-principal'});assert.equal(report.closingAvailable,'0.00');assert.equal(report.alerts.length,0);assert(!JSON.stringify(report).includes('CONFIDENCIAL'));
});

test('an older local snapshot without cash cannot bypass shifts by omitting the optional extension',()=>{
  const state=base();delete state.cash;const before=JSON.stringify(state);assert.throws(()=>createTransaction(state,{kind:'income',date:day,description:'Intento por versión anterior',party:'Proveedor de prueba',category:'Devoluciones',locationId:'sede-principal',accountId:'cash-a',amount:'1000.00',idempotencyKey:'local-without-extension'},owner),/Abre un turno/);assert.equal(JSON.stringify(state),before);const migrated=movement(opened(state));assert.equal(getAccountBalance(migrated,'cash-a'),'1000.00');validateCashState(migrated);
});

test('summary KPIs use the same cutoff and operational classification as the canonical Caja report',()=>{
  let state=bankMovement(base(),{amount:'10000.00'});state=bankMovement(state,{kind:'expense',categoryId:'agua',amount:'1000.00'});state=bankMovement(state,{kind:'expense',categoryId:'ahorro-fondetrefil',amount:'2000.00'});state=bankMovement(state,{kind:'advance',categoryId:'por-legalizar',amount:'500.00'});const summary=getSummary(state,day);assert.equal(summary.income,'10000.00');assert.equal(summary.expenses,'1000.00');assert.equal(summary.available,'6500.00');assert.equal(getSummary(state,'2026-10-30').available,'0.00');
});

test('identified bank interest, refunds and reversals keep review open without a missing-receipt alarm',()=>{
  const state=base();state.cash!.statementImports.push({id:'statement-test',accountId:'bank',startDate:'2026-10-01',endDate:day,source:'Extracto de prueba',sourceKey:'statement-exemptions',importedBy:owner.id,importedAt:new Date().toISOString(),status:'open',lines:['ordinary','interest','refund','reversal'].map((nature,index)=>({id:`statement-line-${index}`,externalId:`bank-line-${index}`,date:day,description:`Línea ${nature}`,direction:'in' as const,amount:'100.00',nature:nature as 'ordinary'|'interest'|'refund'|'reversal',status:'unmatched' as const}))});const alerts=getCashAlerts(state,day);assert.equal(alerts.filter(row=>row.type==='cash_statement_unmatched').length,1);assert(alerts.some(row=>row.type==='cash_statement_review'));assert(!cashMonthChecklist(state,'2026-10').canClose);validateCashState(state);
});
