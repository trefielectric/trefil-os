import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, createEmptyState, createTransaction, getAccountBalance } from '../src/lib/finance';
import { importCashStatement, matchCashStatementLine, parseCashStatementCSV, statementCandidates, registerStatementCharge, approveCashStatement } from '../src/lib/finance/cash-statements';
import { getCashState } from '../src/lib/finance/cash';
import { inspectDemoState } from '../src/lib/demo-state';

const date='2026-11-01';
function workspace(){let state=createEmptyState();const actor=state.members[0];state=createAccount(state,{name:'Banco de pruebas',kind:'bank',bank:'Banco',accountNumber:'000000000001',custodian:actor.name,locationId:state.locations[0].id,active:true},actor);const account=state.accounts.find(x=>x.kind==='bank')!;return {state,actor,account};}
const row={externalId:'BANK-001',date,description:'Recaudo documentado',direction:'in' as const,amount:'300.25',nature:'ordinary' as const};
test('CSV quoted concepts, decimal comma and empty values remain unambiguous',()=>{
  const result=parseCashStatementCSV('id;fecha;descripcion;direccion;valor;naturaleza\r\nA;2026-11-01;"Concepto; con separador";entrada;300,25;ordinario');
  assert.equal(result[0].amount,'300.25');assert.equal(result[0].description,'Concepto; con separador');
  assert.throws(()=>parseCashStatementCSV('id;fecha;descripcion;direccion;valor;naturaleza\nA;2026-11-01;Concepto;entrada;;ordinario'));
  assert.throws(()=>parseCashStatementCSV('id;fecha;descripcion;direccion;valor;naturaleza\nA;2026-11-01;Concepto;entrada;1;ordinario\nA;2026-11-01;Otro;entrada;1;ordinario'),/repetido/);
  assert.throws(()=>parseCashStatementCSV('id;fecha;descripcion;direccion;valor;naturaleza\n"A"X;2026-11-01;Concepto;entrada;1;ordinario'),/comilla de cierre/);
});
test('importing and linking never posts another bank receipt; overlapping imports deduplicate IDs',()=>{
  const {actor,account,...initial}=workspace();let state=initial.state;
  state=createTransaction(state,{kind:'income',date,description:'Recaudo documentado',party:'Cliente prueba',category:'Ventas',amount:row.amount,accountId:account.id,locationId:account.locationId,idempotencyKey:'receipt-one'},actor);
  const before=getAccountBalance(state,account.id);
  state=importCashStatement(state,{accountId:account.id,startDate:date,endDate:date,source:'Banco',sourceKey:'monthly-file',lines:[row]},actor);
  assert.equal(getAccountBalance(state,account.id),before);
  const statement=getCashState(state).statementImports[0],line=statement.lines[0];
  assert.equal(statementCandidates(state,statement,line).length,1);
  state=matchCashStatementLine(state,statement.id,line.id,state.transactions[0].id,actor);
  assert.equal(state.transactions.length,1);assert.equal(getAccountBalance(state,account.id),before);
  const repeated=importCashStatement(state,{accountId:account.id,startDate:date,endDate:date,source:'Otro rótulo de archivo',sourceKey:'quarter-file',lines:[row]},actor);
  assert.equal(repeated,state);
  assert.equal(importCashStatement(state,{accountId:account.id,startDate:date,endDate:date,source:'Banco',sourceKey:'spaces-file',lines:[{...row,externalId:' BANK-001 '}]},actor),state);
  assert.throws(()=>importCashStatement(state,{accountId:account.id,startDate:date,endDate:date,source:'Banco',sourceKey:'changed-file',lines:[{...row,amount:'300.26'}]},actor),/otros datos/);
  state=approveCashStatement(state,statement.id,actor);assert.equal(getCashState(state).statementImports[0].status,'approved');
  assert.deepEqual(inspectDemoState(state).ok,true);
  assert.throws(()=>approveCashStatement(state,statement.id,{...actor,name:'Identidad inventada'}),/permiso/);
});
test('matching requires exact account, date, direction and cents; a pending extract remains open',()=>{
  const {actor,account,...initial}=workspace();let state=initial.state;
  state=createTransaction(state,{kind:'income',date,description:'Valor diferente',party:'Cliente prueba',category:'Ventas',amount:'300.24',accountId:account.id,locationId:account.locationId,idempotencyKey:'receipt-mismatch'},actor);
  state=importCashStatement(state,{accountId:account.id,startDate:date,endDate:date,source:'Banco',sourceKey:'mismatch-file',lines:[row]},actor);const statement=getCashState(state).statementImports[0];
  assert.equal(statementCandidates(state,statement,statement.lines[0]).length,0);
  assert.throws(()=>matchCashStatementLine(state,statement.id,statement.lines[0].id,state.transactions[0].id,actor),/coincidir/);
  assert.throws(()=>approveCashStatement(state,statement.id,actor),/todas las líneas/);
});
test('a confirmed commission creates exactly one outflow, and ordinary receipts cannot be fabricated by import',()=>{
  const {actor,account,...initial}=workspace();let state=initial.state;
  const fee={...row,externalId:'FEE-01',description:'Comisión banco',amount:'25.00',direction:'out' as const,nature:'fee' as const};
  state=importCashStatement(state,{accountId:account.id,startDate:date,endDate:date,source:'Banco',sourceKey:'fee-file',lines:[fee,row]},actor);const statement=getCashState(state).statementImports[0];
  state=registerStatementCharge(state,statement.id,statement.lines[0].id,{party:'Banco',supportUrl:'https://example.com/receipt.pdf'},actor);
  assert.equal(state.transactions.length,1);assert.equal(getAccountBalance(state,account.id),'-25.00');
  assert.equal(inspectDemoState(state).ok,true);
  assert.throws(()=>registerStatementCharge(state,statement.id,statement.lines[0].id,{party:'Banco'},actor));
  assert.throws(()=>registerStatementCharge(state,statement.id,statement.lines[1].id,{party:'Banco'},actor));
});
