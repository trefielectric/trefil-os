import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoState, createTransaction, createAccount, getSummary, DEMO_ACTORS, approveTransaction, reverseTransaction, recordDebtPayment, commentAlert, type State } from '../src/lib/finance';
import { createEmptyState } from '../src/lib/finance/empty';
import { decodeDemoState, inspectDemoState, holdDemoWriterLease, initializeLocalStateStorage, DEMO_STORAGE_KEY, DEMO_WRITER_LOCK, LOCAL_STORAGE_KEY, LOCAL_WRITER_LOCK, type DemoLockManager, type LocalStateStorage } from '../src/lib/demo-state';

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

class MemoryStorage implements LocalStateStorage {
  values=new Map<string,string>();
  reads:string[]=[];
  writes:{key:string;value:string}[]=[];
  getItem(key:string):string|null {this.reads.push(key);return this.values.get(key)??null;}
  setItem(key:string,value:string):void {this.writes.push({key,value});this.values.set(key,value);}
}

function recordedLocalState():State {
  let state=createEmptyState();const actor=state.members[0];
  state=createAccount(state,{name:'Caja local propia',kind:'cash',custodian:'Propietario local',locationId:'sede-principal',active:true},actor);
  const account=state.accounts.find(row=>row.kind==='cash')!;
  return createTransaction(state,{kind:'income',date:'2026-11-10',description:'Ingreso local registrado por el propietario',party:'Tercero local',category:'Ingreso',locationId:'sede-principal',amount:'123.45',accountId:account.id,idempotencyKey:'local-storage-preservation-0001'},actor);
}

test('new local workspace initializes with zero financial records and no fabricated activity',()=>{
  const storage=new MemoryStorage();const state=initializeLocalStateStorage(storage);
  assert.equal(state.organization.id,'local-trefil-electric');assert.equal(state.organization.name,'Trefil Electric');
  assert.deepEqual(state.locations,[{id:'sede-principal',name:'Sede principal'}]);
  assert.equal(state.members.length,1);assert.equal(state.members[0].id,'local-owner');
  for(const name of ['accounts','transactions','debts','debtPayments','reconciliations','alerts','audit','backups'] as const)assert.deepEqual(state[name],[],name);
  const summary=getSummary(state,'2026-11-10');
  for(const name of ['available','income','expenses','debt','interestPaid','principalPaid'] as const)assert.equal(summary[name],'0.00',name);
  assert.equal(summary.pendingApprovals,0);
  assert.equal(inspectDemoState(state).ok,true);assert.equal(decodeDemoState(JSON.stringify(state)).ok,true);
  assert.deepEqual(storage.reads,[LOCAL_STORAGE_KEY]);assert.equal(storage.writes.length,1);
  assert.equal(storage.writes[0].key,LOCAL_STORAGE_KEY);assert.deepEqual(JSON.parse(storage.writes[0].value),state);
});

test('initialization neither reads nor alters the old demonstration, even when legacy data exists',()=>{
  const storage=new MemoryStorage();const legacy=JSON.stringify(createDemoState());
  storage.values.set(DEMO_STORAGE_KEY,legacy);storage.values.set('unrelated-preserved-key','unchanged');
  const state=initializeLocalStateStorage(storage);
  assert.deepEqual(state,createEmptyState());assert.equal(storage.values.get(DEMO_STORAGE_KEY),legacy);
  assert.equal(storage.values.get('unrelated-preserved-key'),'unchanged');
  assert.deepEqual(storage.reads,[LOCAL_STORAGE_KEY]);assert.deepEqual(storage.writes.map(row=>row.key),[LOCAL_STORAGE_KEY]);
  assert.equal(decodeDemoState(legacy).ok,true,'Legacy validator compatibility is preserved without migration');
});

test('preexisting local operations are returned without rewriting, resetting or inventing audit events',()=>{
  const storage=new MemoryStorage();const state=recordedLocalState();const raw=JSON.stringify(state);
  storage.values.set(LOCAL_STORAGE_KEY,raw);storage.values.set(DEMO_STORAGE_KEY,'MALFORMED_LEGACY_MUST_NOT_BE_READ');
  const restored=initializeLocalStateStorage(storage);
  assert.deepEqual(restored,JSON.parse(raw));assert.equal(getSummary(restored,'2026-11-10').available,'123.45');
  assert.equal(storage.values.get(LOCAL_STORAGE_KEY),raw);assert.equal(storage.writes.length,0);
  assert.deepEqual(storage.reads,[LOCAL_STORAGE_KEY]);assert.equal(storage.values.get(DEMO_STORAGE_KEY),'MALFORMED_LEGACY_MUST_NOT_BE_READ');
});

test('a second initialization reuses the saved empty workspace and performs no extra write',()=>{
  const storage=new MemoryStorage();const first=initializeLocalStateStorage(storage);const second=initializeLocalStateStorage(storage);
  assert.deepEqual(second,first);assert.equal(storage.writes.length,1);assert.deepEqual(second.audit,[]);
});

test('malformed, foreign, legacy-in-local and financially invalid local snapshots remain untouched',()=>{
  const wrongOrganization=createEmptyState();wrongOrganization.organization.id='foreign-company';
  const invalidFinancial=recordedLocalState();invalidFinancial.transactions[0].entries[0].debit='NaN';
  const incomplete={...createEmptyState(),accounts:undefined};
  for(const raw of ['{"PRIVATE_MALFORMED_VALUE":',JSON.stringify(wrongOrganization),JSON.stringify(createDemoState()),JSON.stringify(invalidFinancial),JSON.stringify(incomplete)]){
    const storage=new MemoryStorage();const legacy=JSON.stringify(createDemoState());
    storage.values.set(LOCAL_STORAGE_KEY,raw);storage.values.set(DEMO_STORAGE_KEY,legacy);
    assert.throws(()=>initializeLocalStateStorage(storage),error=>error instanceof Error&&!error.message.includes('PRIVATE_MALFORMED_VALUE'));
    assert.equal(storage.values.get(LOCAL_STORAGE_KEY),raw);assert.equal(storage.values.get(DEMO_STORAGE_KEY),legacy);
    assert.equal(storage.writes.length,0);assert.deepEqual(storage.reads,[LOCAL_STORAGE_KEY]);
  }
});

test('local states receive the same deep money validation and never inherit legacy approval exceptions',()=>{
  const state=recordedLocalState();assert.equal(inspectDemoState(state).ok,true);
  state.transactions[0].amount='1e2';assert.equal(inspectDemoState(state).ok,false);
  const legacy=createDemoState();delete legacy.transactions.find(row=>row.id==='demo-tx-4')!.approvedBy;
  assert.equal(inspectDemoState(legacy).ok,true);
  legacy.organization.id='local-trefil-electric';assert.equal(inspectDemoState(legacy).ok,false);
});

test('storage failures propagate without pretending an empty state was saved or falling back to legacy',()=>{
  const readFailure=new Error('Storage is unavailable');let writes=0;
  assert.throws(()=>initializeLocalStateStorage({getItem:()=>{throw readFailure;},setItem:()=>{writes++;}}),error=>error===readFailure);
  assert.equal(writes,0);
  const storage=new MemoryStorage();const legacy=JSON.stringify(createDemoState());storage.values.set(DEMO_STORAGE_KEY,legacy);
  const writeFailure=new Error('Storage quota exceeded');
  assert.throws(()=>initializeLocalStateStorage({getItem:key=>storage.getItem(key),setItem:()=>{throw writeFailure;}}),error=>error===writeFailure);
  assert.equal(storage.values.has(LOCAL_STORAGE_KEY),false);assert.equal(storage.values.get(DEMO_STORAGE_KEY),legacy);
  assert.deepEqual(storage.reads,[LOCAL_STORAGE_KEY]);
});

test('local writer lock is distinct from legacy and still prevents another local writer',async()=>{
  const held=new Set<string>();const calls:string[]=[];const events:string[]=[];
  const manager:DemoLockManager={request:async(name,_options,callback)=>{
    calls.push(name);if(held.has(name))return callback(null);held.add(name);
    try{return await callback({name});}finally{held.delete(name);}
  }};
  const legacy=holdDemoWriterLease(manager,{onWriter:()=>events.push('legacy writer'),onReadOnly:reason=>events.push('legacy '+reason)});
  const local=holdDemoWriterLease(manager,{onWriter:()=>events.push('local writer'),onReadOnly:reason=>events.push('local '+reason)},LOCAL_WRITER_LOCK);
  const secondLocal=holdDemoWriterLease(manager,{onWriter:()=>events.push('unexpected local writer'),onReadOnly:reason=>events.push('second local '+reason)},LOCAL_WRITER_LOCK);
  try{
    await flush();assert.deepEqual(events,['legacy writer','local writer','second local busy']);
    assert.deepEqual(calls,[DEMO_WRITER_LOCK,LOCAL_WRITER_LOCK,LOCAL_WRITER_LOCK]);
    assert.notEqual(LOCAL_WRITER_LOCK,DEMO_WRITER_LOCK);assert.notEqual(LOCAL_STORAGE_KEY,DEMO_STORAGE_KEY);
  }finally{legacy.release();local.release();secondLocal.release();await Promise.all([legacy.done,local.done,secondLocal.done]);}
});
