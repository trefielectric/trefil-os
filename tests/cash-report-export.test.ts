import test from 'node:test';
import assert from 'node:assert/strict';
import { cashReportBridge, cashReportIdentity, cashReportSummary, cashReportTables, createCashWorkbook, excelMoney } from '../src/lib/cash-report-export';
import type { CashPeriodReport } from '../src/lib/finance/cash-types';
import type { State } from '../src/lib/finance/types';
import { approveTransaction, createAccount, createDebt, createEmptyState, createTransaction, reverseTransaction } from '../src/lib/finance';
import { getCashReport, registerCashMovement } from '../src/lib/finance/cash';

function bankWorkspace(){
  let state=createEmptyState();const actor=state.members[0];
  state.members.push({id:'report-test-reviewer',name:'Revisor de prueba',role:'admin',email:'reviewer@example.invalid',active:true,locationIds:[...actor.locationIds]});
  for(const [index,name] of ['Banco de pruebas A','Banco de pruebas B'].entries())state=createAccount(state,{name,kind:'bank',bank:'Entidad de prueba',accountNumber:'00000000000'+String(index+1),lastFour:'000'+String(index+1),custodian:actor.name,locationId:state.locations[0].id,active:true},actor);
  return {state,actor,reviewer:state.members[1],first:state.accounts[0],second:state.accounts[1]};
}

function fixture():CashPeriodReport {
  return {
    startDate:'2026-10-01',endDate:'2026-10-31',generatedAt:'2026-11-10T15:00:00.000Z',version:1,scope:'local',
    openingAvailable:'100.00',closingAvailable:'125.25',externalInflows:'50.25',transferInflows:'20.00',operatingExpenses:'25.00',financingInflows:'0.00',financingOutflows:'0.00',otherAssetInflows:'0.00',otherAssetOutflows:'0.00',internalTransfers:'20.00',excludedInflows:'0.00',excludedOutflows:'0.00',
    accounts:[{accountId:'bank',name:'Banco de operación',kind:'bank',opening:'100.00',inflows:'50.25',outflows:'45.00',closing:'105.25'},{accountId:'cash',name:'Caja',kind:'cash',opening:'0.00',inflows:'20.00',outflows:'0.00',closing:'20.00'}],
    categories:[{groupId:'production',groupName:'Producción',categoryId:'nylon',categoryName:'Compra de nylon',amount:'25.00',transactionIds:['expense']}],
    movements:[
      {transactionId:'sale',reference:'TF-00001',date:'2026-10-02',description:'Venta',party:'Cliente de prueba',categoryId:'sale',categoryName:'Ventas',groupId:'in',groupName:'Entradas',amount:'50.25',direction:'in',nature:'operating',accountIds:['bank'],supportMissing:false},
      {transactionId:'transfer',reference:'TF-00002',date:'2026-10-03',description:'Retiro para caja',party:'Tesorería',categoryId:'transfer',categoryName:'Traslado',groupId:'internal',groupName:'Internos',amount:'20.00',direction:'transfer',nature:'internal',accountIds:['bank','cash'],supportMissing:false},
      {transactionId:'expense',reference:'TF-00003',date:'2026-10-04',description:'Material',party:'Proveedor de prueba',categoryId:'nylon',categoryName:'Compra de nylon',groupId:'production',groupName:'Producción',amount:'25.00',direction:'out',nature:'operating',accountIds:['bank'],supportMissing:true},
    ],alerts:[],
  };
}
test('PDF and Excel presentation preserve canonical money and one row per operation',()=>{
  const report=fixture(),tables=cashReportTables(report);
  const detail=tables.find(row=>row.name==='Detalle')!;
  assert.equal(detail.rows.length,3);
  assert.equal(detail.rows.filter(row=>row[0]==='TF-00002').length,1);
  assert.equal(detail.rows[0][8],'50.25');
  assert.equal(tables.find(row=>row.name==='Traslados')!.rows.length,1);
  assert.deepEqual(cashReportSummary(report).at(-2),['Disponible al cierre','125.25']);
  assert.equal(tables.find(row=>row.name==='Resumen')!.rows.at(-2)?.[1],'125.25');
});
test('report identity is shared and changes when included financial data changes',()=>{
  const first=fixture(),second=fixture();
  assert.equal(cashReportIdentity(first),cashReportIdentity(second));
  second.closingAvailable='125.26';assert.notEqual(cashReportIdentity(first),cashReportIdentity(second));
});
test('presentation omits private movement detail and rejects Excel precision loss',()=>{
  const report=fixture();report.movements.push({...report.movements[0],transactionId:'private',reference:'PRIVATE',nature:'excluded',party:'PRIVATE PERSON'});
  assert(!JSON.stringify(cashReportTables(report)).includes('PRIVATE PERSON'));
  assert.equal(excelMoney('0.01'),0.01);
  assert.equal(excelMoney('9999999999999.99'),9999999999999.99);
  assert.throws(()=>excelMoney('10000000000000.00'),/precisión/);
  assert.throws(()=>excelMoney('-10000000000000.00'),/precisión/);
});
test('Excel keeps cash account totals reconcilable and treats user text as text',async()=>{
  const report=fixture();report.movements[0].party='=HYPERLINK("https://example.invalid")';
  const book=await createCashWorkbook(report);
  const sheet=book.getWorksheet('Saldos')!;
  assert.deepEqual(sheet.getCell('F8').value,{formula:'ROUND(SUM(F6:F7),2)',result:125.25});
  assert.equal(sheet.getCell('F6').numFmt,'"$" #,##0.00;[Red]("$" #,##0.00);"$" 0.00');
  assert.equal(book.getWorksheet('Detalle')!.getCell('E6').value,report.movements[0].party);
  assert(book.getWorksheet('Detalle')!.getCell('B6').value instanceof Date);
  assert.equal(book.getWorksheet('Detalle')!.getCell('M6').value,'');
  assert.equal(book.getWorksheet('Resumen')!.rowCount,20);
  assert.equal(book.worksheets.length,8);
  const binary=await book.xlsx.writeBuffer();
  assert(binary.byteLength>1000);
});
test('real Caja report preserves cutoff and does not count an internal transfer or its reversal as income',async()=>{
  const initial=bankWorkspace();let {state}=initial;const {actor,reviewer,first,second}=initial;
  const common={accountId:first.id,party:'Tercero de prueba',supportUrl:'https://example.invalid/document.pdf'};
  state=registerCashMovement(state,{...common,kind:'income',categoryId:'ventas-regulares',date:'2026-10-02',description:'Recaudo de octubre',amount:'1000.25',idempotencyKey:'report-real-income-oct'},actor);
  state=registerCashMovement(state,{...common,kind:'expense',categoryId:'compra-nylon',date:'2026-10-03',description:'Compra de octubre',amount:'100.00',idempotencyKey:'report-real-expense-oct'},actor);
  state=registerCashMovement(state,{...common,kind:'transfer',categoryId:'retiro-entre-cuentas',date:'2026-10-04',description:'Traslado a otra cuenta',notes:'Traslado de tesorería justificado',destinationAccountId:second.id,amount:'50.00',idempotencyKey:'report-real-transfer-oct'},actor);
  const transfer=state.transactions.find(row=>row.idempotencyKey==='report-real-transfer-oct')!;
  state=registerCashMovement(state,{...common,kind:'income',categoryId:'ventas-regulares',date:'2026-11-01',description:'Recaudo posterior',amount:'200.00',idempotencyKey:'report-real-income-nov'},actor);
  const october=getCashReport(state,{startDate:'2026-10-01',endDate:'2026-10-31'});
  assert.equal(october.closingAvailable,'900.25');assert.equal(october.externalInflows,'1000.25');assert.equal(october.operatingExpenses,'100.00');assert.equal(october.internalTransfers,'50.00');
  assert.equal(october.movements.length,3);
  const book=await createCashWorkbook(october);assert.deepEqual(book.getWorksheet('Saldos')!.getCell('F8').value,{formula:'ROUND(SUM(F6:F7),2)',result:900.25});
  assert.throws(()=>reverseTransaction(state,transfer.id,'Reverso de prueba',actor),/autorización institucional/);
  // Exercise the report against an already approved legacy reversal fixture.
  // Caja itself correctly refuses to authorize that operation locally.
  const cashMetadata=state.cash,organization=state.organization;state={...state,organization:{...organization,id:'demo-trefil-electric'},cash:undefined};
  state=reverseTransaction(state,transfer.id,'Reverso aprobado de prueba',actor);
  state=approveTransaction(state,state.transactions[0].id,reviewer);
  state={...state,organization,cash:cashMetadata};
  const throughToday=getCashReport(state,{startDate:'2026-10-01',endDate:state.transactions[0].date});
  assert.equal(throughToday.internalTransfers,'0.00');assert.equal(throughToday.transferInflows,'0.00');assert.equal(throughToday.externalInflows,'1200.25');assert.equal(throughToday.closingAvailable,'1100.25');
});
test('real financed payment exports all five components without turning principal into operating expense',async()=>{
  const initial=bankWorkspace();let {state}=initial;const {actor,reviewer,first}=initial;
  state=createDebt(state,{creditor:'Acreedor de prueba',kind:'loan',principal:'1000.00',monthlyRate:'1',installments:12,startDate:'2026-10-01',dueDay:1,method:'fixed_payment',locationId:first.locationId},actor);
  const debt=state.debts[0];
  state=registerCashMovement(state,{accountId:first.id,kind:'loan',categoryId:'prestamos',date:'2026-10-01',description:'Desembolso de prueba',party:debt.creditor,amount:'1000.00',debtId:debt.id,supportUrl:'https://example.invalid/agreement.pdf',idempotencyKey:'report-real-disbursement'},actor);
  state=registerCashMovement(state,{accountId:first.id,kind:'debt_payment',categoryId:'cuotas-creditos-bancarios',date:'2026-10-10',description:'Cuota con costos separados',party:debt.creditor,amount:'116.00',principal:'100.00',interest:'10.00',insurance:'2.00',commission:'1.00',lateFee:'3.00',debtId:debt.id,supportUrl:'https://example.invalid/payment.pdf',idempotencyKey:'report-real-payment'},actor);
  assert.equal(state.transactions[0].status,'pending');state=approveTransaction(state,state.transactions[0].id,reviewer);
  const report=getCashReport(state,{startDate:'2026-10-01',endDate:'2026-10-31'});
  assert.equal(report.financingInflows,'1000.00');assert.equal(report.financingOutflows,'116.00');assert.equal(report.operatingExpenses,'0.00');assert.equal(report.externalInflows,'0.00');assert.equal(report.closingAvailable,'884.00');
  const row=cashReportTables(report).find(table=>table.name==='Financiacion y activos')!.rows.find(row=>row[1]==='2026-10-10')!;
  assert.deepEqual(row.slice(12),['100.00','10.00','2.00','1.00','3.00']);
  const book=await createCashWorkbook(report);const sheet=book.getWorksheet('Financiacion y activos')!;
  assert.deepEqual(['M7','N7','O7','P7','Q7'].map(address=>sheet.getCell(address).value),[100,10,2,1,3]);
});
test('real report omits excluded parties and notices belonging to another location',()=>{
  const initial=bankWorkspace();let {state}=initial;const {actor,first}=initial;
  state=registerCashMovement(state,{accountId:first.id,kind:'expense',categoryId:'salidas-varias',date:'2026-10-02',description:'PRIVATE TEST EXPENSE',party:'PRIVATE TEST PARTY',amount:'25.00',businessStatus:'personal',idempotencyKey:'report-private-movement'},actor);
  state.locations.push({id:'report-test-other-location',name:'Otra sede de prueba'});state.members[0].locationIds.push('report-test-other-location');
  state=createAccount(state,{name:'Cuenta de otra sede',kind:'bank',bank:'Banco de prueba',accountNumber:'000000000003',lastFour:'0003',custodian:actor.name,locationId:'report-test-other-location',active:true},actor);
  const other=state.accounts.find(row=>row.locationId==='report-test-other-location')!;
  state=registerCashMovement(state,{accountId:other.id,kind:'expense',categoryId:'salidas-varias',date:'2026-10-03',description:'OTHER LOCATION NOTICE',party:'OTHER LOCATION PARTY',amount:'20.00',idempotencyKey:'report-other-location'},actor);
  const report=getCashReport(state,{startDate:'2026-10-01',endDate:'2026-10-31',locationId:first.locationId});
  assert.equal(report.excludedOutflows,'25.00');assert.equal(report.closingAvailable,'-25.00');
  assert.equal(report.movements.length,0);
  assert(!JSON.stringify(report).includes('PRIVATE TEST PARTY'));
  assert(!JSON.stringify(report).includes('PRIVATE TEST EXPENSE'));
  assert(!JSON.stringify(report).includes('OTHER LOCATION NOTICE'));
});
test('opening and adjustment bridge reconciles a real legacy ledger and an approved historical reversal',async()=>{
  const initial=bankWorkspace();const {actor,reviewer,first}=initial;
  // An isolated historical fixture uses the preserved legacy approval contract.
  let state:State={...initial.state,organization:{...initial.state.organization,id:'demo-trefil-electric'},cash:undefined};
  const common={accountId:first.id,locationId:first.locationId,party:'Tercero de prueba',category:'Patrimonio inicial'};
  state=createTransaction(state,{...common,kind:'opening',date:'2026-10-01',description:'Apertura histórica documentada',amount:'500.00',idempotencyKey:'bridge-historical-opening'},actor);
  state=approveTransaction(state,state.transactions[0].id,reviewer);
  state=createTransaction(state,{...common,kind:'adjustment',direction:'out',date:'2026-10-05',description:'Ajuste histórico documentado',amount:'40.00',idempotencyKey:'bridge-historical-adjustment'},actor);
  const adjustment=state.transactions[0];state=approveTransaction(state,adjustment.id,reviewer);
  const october=getCashReport(state,{startDate:'2026-10-01',endDate:'2026-10-31'});
  assert.deepEqual(cashReportBridge(october),{registeredOpenings:'500.00',netAdjustments:'-40.00',calculatedClosing:'460.00',difference:'0.00'});
  state=reverseTransaction(state,adjustment.id,'Corrección histórica aprobada de prueba',actor);state=approveTransaction(state,state.transactions[0].id,reviewer);
  const report=getCashReport(state,{startDate:'2026-10-01',endDate:state.transactions[0].date});
  assert.deepEqual(cashReportBridge(report),{registeredOpenings:'500.00',netAdjustments:'0.00',calculatedClosing:'500.00',difference:'0.00'});
  const book=await createCashWorkbook(report);
  assert.equal(book.getWorksheet('Resumen')!.getCell('B20').formula,'ROUND(B19-(B6+B7+B8+B9-B11+B12-B13+B14-B15+B17-B18),2)');
  assert.equal(book.getWorksheet('Resumen')!.getCell('B20').result,0);
  assert.equal(book.getWorksheet('Saldos')!.getCell('G6').formula,'ROUND(F6-(C6+D6-E6),2)');
  assert.equal(book.getWorksheet('Saldos')!.getCell('G6').result,0);
});
