import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoState, createTransaction, DEMO_ACTORS, approveTransaction, reverseTransaction, recordDebtPayment, commentAlert, type State } from '../src/lib/finance';
import { decodeDemoState, inspectDemoState, holdDemoWriterLease, DEMO_WRITER_LOCK, type DemoLockManager } from '../src/lib/demo-state';

const expense = (state:State) => state.transactions.find(row=>row.kind==='expense'&&row.status==='posted')!;
const rejected = (change:(state:State)=>void) => { const state=createDemoState();change(state);assert.equal(inspectDemoState(state).ok,false); };

test('complete fictional seed roundtrips through deep validation without rewriting any value',()=>{
  const state=createDemoState();const serialized=JSON.stringify(state);const result=decodeDemoState(serialized);
  assert.equal(result.ok,true);if(result.ok)assert.deepEqual(result.state,JSON.parse(serialized));
  assert.equal(JSON.stringify(state),serialized);
});

test('recorded operations, independent approval, exact reversal and debt allocation remain valid snapshots',()=>{
  const input={kind:'expense' as const,date:'2026-11-10',description:'Operación ficticia persistente',party:'Proveedor · Demo',category:'Mantenimiento',locationId:'sede-principal',amount:'250000.50',accountId:'bancolombia',idempotencyKey:'validation-roundtrip-test'};
  let state=createTransaction(createDemoState(),input,DEMO_ACTORS.treasury);
  assert.equal(inspectDemoState(state).ok,true);
  state=reverseTransaction(state,state.transactions[0].id,'Corrección ficticia verificada',DEMO_ACTORS.treasury);
  assert.equal(inspectDemoState(state).ok,true);
  state=approveTransaction(state,state.transactions[0].id,DEMO_ACTORS.admin);
  state=recordDebtPayment(state,{debtId:'debt-b',accountId:'bancolombia',date:'2026-11-10',amount:'100000.00',principal:'50000.00',interest:'50000.00',idempotencyKey:'validation-payment-test'},DEMO_ACTORS.treasury);
  assert.equal(inspectDemoState(state).ok,true);
  state=approveTransaction(state,state.transactions[0].id,DEMO_ACTORS.admin);
  state=commentAlert(state,'backup-stale','Seguimiento ficticio sin declarar verificación',DEMO_ACTORS.treasury);
  assert.equal(inspectDemoState(state).ok,true);
});

test('invalid or truncated JSON is rejected without exposing or changing its original contents',()=>{
  const raw='{"transactions":["PRIVATE_UNTRUSTED_VALUE"';const result=decodeDemoState(raw);
  assert.equal(result.ok,false);if(!result.ok)assert(!result.error.includes('PRIVATE_UNTRUSTED_VALUE'));
  assert.equal(raw,'{"transactions":["PRIVATE_UNTRUSTED_VALUE"');
});

test('money must be canonical text with exact cents, bounded precision and no numeric values',()=>{
  for(const value of [0.1,'NaN','1e9','01.00','1.0','-0.00','1.001','10000000000000000.00'])rejected(state=>{(expense(state) as unknown as Record<string,unknown>).amount=value;});
  rejected(state=>{expense(state).entries[0].debit='NaN';});
});

test('organization, account location, valid role and active owner are required',()=>{
  rejected(state=>{state.organization.id='other-business';});
  rejected(state=>{state.accounts[0].locationId='foreign-site';});
  rejected(state=>{(state.members[0] as unknown as Record<string,unknown>).role='superuser';});
  rejected(state=>{state.members[0].active=false;});
  rejected(state=>{state.members[1].locationIds=['foreign-site'];});
  rejected(state=>{state.members[1].email='invalid-email';});
});

test('unknown account kinds, duplicate IDs, duplicate idempotency and missing arrays fail closed',()=>{
  rejected(state=>{(state.accounts[0] as unknown as Record<string,unknown>).kind='external';});
  rejected(state=>{state.accounts.push(structuredClone(state.accounts[0]));});
  rejected(state=>{state.transactions[1].idempotencyKey=state.transactions[0].idempotencyKey;});
  rejected(state=>{(state as unknown as Record<string,unknown>).debtPayments=undefined;});
});

test('impossible dates and unsafe timestamps are rejected before date formatting',()=>{
  rejected(state=>{expense(state).date='2026-02-30';});
  rejected(state=>{state.audit[0].timestamp='not-a-date';});
  rejected(state=>{state.audit[0].timestamp='2026-11-10T24:00:00Z';});
});

test('unbalanced, duplicate-account and foreign-scope entries cannot reach a financial component',()=>{
  rejected(state=>{expense(state).entries[0].debit='1.00';});
  rejected(state=>{const row=expense(state);row.entries[0].accountId=row.entries[1].accountId;});
  rejected(state=>{expense(state).entries[0].accountId='foreign-account';});
  rejected(state=>{expense(state).locationId='sede-planta';});
  rejected(state=>{expense(state).amount='0.01';});
});

test('reversedBy requires an actual posted compensating transaction',()=>{
  rejected(state=>{expense(state).reversedBy=state.transactions[0].id;});
  rejected(state=>{expense(state).reversedBy='nonexistent-reversal';});
});

test('support URLs must be bounded base64 with the declared MIME and exact byte size',()=>{
  rejected(state=>{expense(state).support!.dataUrl='javascript:alert(1)';});
  rejected(state=>{expense(state).support!.dataUrl='data:text/html;base64,PHNjcmlwdD4=';});
  rejected(state=>{expense(state).support!.size=5*1024*1024+1;});
  rejected(state=>{expense(state).support!.size+=1;});
  rejected(state=>{expense(state).support!.dataUrl+='!';});
});

test('bad debt terms and orphan, inconsistent or overpaid capital allocations are rejected',()=>{
  rejected(state=>{state.debts[0].monthlyRate='2e2';});
  rejected(state=>{state.debts[0].installments=100000;});
  rejected(state=>{state.debts[0].rateChanges=[{period:0,monthlyRate:'1'}];});
  rejected(state=>{state.debtPayments[0].principal='0.01';});
  rejected(state=>{state.debtPayments[0].status='pending';});
  rejected(state=>{state.debtPayments=[];});
  rejected(state=>{
    const payment=state.debtPayments[0];const transaction=state.transactions.find(row=>row.id===payment.transactionId)!;
    payment.amount=payment.principal=transaction.amount='100000000.00';
    for(const row of transaction.entries){if(row.debit!=='0.00')row.debit=payment.amount;if(row.credit!=='0.00')row.credit=payment.amount;}
  });
});

test('reconciliation differences, comments and backup metadata are validated as well as transactions',()=>{
  rejected(state=>{state.reconciliations[0].difference='1.00';});
  rejected(state=>{state.reconciliations[0].accountId='foreign-account';});
  let state=commentAlert(createDemoState(),'backup-stale','Comentario válido de demostración',DEMO_ACTORS.treasury);
  (state.alerts[0].comments[0] as unknown as Record<string,unknown>).text=null;
  assert.equal(inspectDemoState(state).ok,false);
  rejected(state=>{state.backups.push({id:'bad-backup',startedAt:'2026-11-10T15:00:00Z',status:'success',verified:true,destination:'Ficticio sin checksum'});});
});

test('the exact original 4m demo wallet opening is readable without inventing a missing approval',()=>{
  const state=createDemoState();const opening=state.transactions.find(row=>row.id==='demo-tx-4')!;delete opening.approvedBy;
  const before=JSON.stringify(state);assert.equal(inspectDemoState(state).ok,true);assert.equal(JSON.stringify(state),before);
  opening.amount='4000000.01';opening.entries[0].debit='4000000.01';opening.entries[1].credit='4000000.01';
  assert.equal(inspectDemoState(state).ok,false);
});

test('a structurally balanced ledger whose computed balances overflow money is rejected',()=>{
  rejected(state=>{
    const income=state.transactions.find(row=>row.kind==='income')!;income.amount='9999999999999999.99';
    for(const row of income.entries){if(row.debit!=='0.00')row.debit=income.amount;if(row.credit!=='0.00')row.credit=income.amount;}
  });
});

class SharedLocks implements DemoLockManager {
  held=false; requests:{name:string;options:{ifAvailable:true}}[]=[];
  async request(name:string,options:{ifAvailable:true},callback:(lock:object|null)=>Promise<void>):Promise<unknown>{
    this.requests.push({name,options});
    if(this.held)return callback(null);
    this.held=true;
    try{return await callback({name});}finally{this.held=false;}
  }
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('only one cooperating tab writes or audits; another immediately becomes a reader until reloaded',async()=>{
  const manager=new SharedLocks();const events:string[]=[];
  const primary=holdDemoWriterLease(manager,{onWriter:()=>events.push('primary writer and audit'),onReadOnly:reason=>events.push('primary '+reason)});
  const viewer=holdDemoWriterLease(manager,{onWriter:()=>events.push('viewer wrote unexpectedly'),onReadOnly:reason=>events.push('viewer '+reason)});
  await flush();
  assert.deepEqual(events,['primary writer and audit','viewer busy']);
  assert.equal(manager.held,true);await viewer.done;
  assert(manager.requests.every(request=>request.name===DEMO_WRITER_LOCK&&request.options.ifAvailable===true));
  primary.release();await primary.done;assert.equal(manager.held,false);
  const reloaded=holdDemoWriterLease(manager,{onWriter:()=>events.push('reloaded writer'),onReadOnly:()=>{throw new Error('Lock should be free');}});
  await flush();assert.equal(events.at(-1),'reloaded writer');reloaded.release();await reloaded.done;
});

test('cleanup before acquisition performs no boot write and does not steal the next effect lock',async()=>{
  const manager=new SharedLocks();const events:string[]=[];
  const cleaned=holdDemoWriterLease(manager,{onWriter:()=>events.push('stale write'),onReadOnly:()=>events.push('stale reader')});cleaned.release();
  const active=holdDemoWriterLease(manager,{onWriter:()=>events.push('active writer'),onReadOnly:()=>events.push('unexpected reader')});
  await flush();assert.deepEqual(events,['active writer']);assert.equal(manager.requests.length,1);
  active.release();await Promise.all([cleaned.done,active.done]);
});

test('missing or rejected Web Locks leaves writing disabled rather than simulating exclusivity',async()=>{
  const results:string[]=[];
  const unsupported=holdDemoWriterLease(undefined,{onWriter:()=>results.push('unsafe write'),onReadOnly:reason=>results.push(reason)});await unsupported.done;
  const rejectedManager:DemoLockManager={request:async()=>{throw new Error('private browser detail');}};
  const unavailable=holdDemoWriterLease(rejectedManager,{onWriter:()=>results.push('unsafe write'),onReadOnly:reason=>results.push(reason)});await unavailable.done;
  assert.deepEqual(results,['unsupported','unavailable']);
});
