import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryWorkbook, excelInventoryQuantity, formatInventoryQuantity, inventoryReportIdentity, inventoryReportStatus, inventoryReportTables } from '../src/lib/inventory-report-export';
import type { InventoryReport, InventoryType } from '../src/lib/inventory/types';
import type { InventoryWorkspace } from '../src/lib/inventory/types';
import { createAccount, createEmptyState, registerCashMovement } from '../src/lib/finance';
import { closeInventoryMonth, createInventoryItem, getInventoryReport, getInventoryState, postInventoryOrigin, recordInventoryCount, registerInventoryPrice, registerInventorySale, saveInventoryOriginDraft } from '../src/lib/inventory/engine';

const documentBytes=Buffer.from('%PDF-1.4\n%%EOF');
const document={name:'Acta aislada de prueba.pdf',type:'application/pdf',size:documentBytes.length,dataUrl:'data:application/pdf;base64,'+documentBytes.toString('base64')};
function actualWorkspace(inventoryType:'raw_material'|'finished'){
  let state:InventoryWorkspace=createEmptyState();const actor=state.members[0];
  state=createInventoryItem(state,{code:'INV-REPORT-TEST-'+inventoryType,description:'Referencia aislada de pruebas',inventoryType,unit:inventoryType==='finished'?'unit':'kg',category:'Categoría de prueba',active:true,...(inventoryType==='finished'?{unitValue:'100.00'}:{})},actor);
  const item=getInventoryState(state).items[0],warehouses=getInventoryState(state).warehouses;
  state=saveInventoryOriginDraft(state,{inventoryType,date:'2026-10-01',sourceReference:'ORIGEN-REPORT-TEST-'+inventoryType,responsible:actor.name,support:document,lines:warehouses.map((warehouse,index)=>({itemId:item.id,warehouseId:warehouse.id,quantity:index===0?(inventoryType==='finished'?'2.000000':'5.000000'):'0.000000',...(inventoryType==='finished'?{unitValue:'100.00'}:{})}))},actor);
  state=postInventoryOrigin(state,getInventoryState(state).origins[0].id,actor);
  return {state,actor,item,warehouses};
}

function sampleReport(type:InventoryType='raw_material'):InventoryReport {
  return {inventoryType:type,startDate:'2026-10-01',endDate:'2026-10-31',generatedAt:'2026-11-10T15:00:00.000Z',version:1,scope:'local',reconciled:false,totalValue:null,
    rows:[{itemId:'test-item',code:'TEST-MAT-01',description:'Material de prueba',unit:type==='finished'||type==='asset'?'unit':'kg',warehouseId:'test-warehouse',warehouseName:'Ubicación de prueba',locationId:'sede-principal',opening:'5.000000',incoming:'2.000000',outgoing:'1.000000',theoretical:'6.000000',available:'6.000000',reserved:'0.000000',quarantine:'0.000000',counted:null,difference:null,unitPrice:null,theoreticalValue:null,countedValue:null,differenceValue:null}],
    movements:[{id:'test-source-movement',date:'2026-10-03',direction:'in',kind:'purchase',inventoryType:type,itemId:'test-item',warehouseId:'test-warehouse',quantity:'2.000000',sourceKey:'test-purchase-unique',sourceReference:'CAJA-TEST-001',responsible:'Responsable de prueba',actorId:'test-actor',createdAt:'2026-10-03T15:00:00.000Z',notes:'Movimiento aislado de prueba'}],issues:[]};
}
test('quantity formatting preserves six decimal places and finished goods require integers',()=>{
  assert.equal(formatInventoryQuantity('1000.000001'),'1.000,000001');
  assert.equal(formatInventoryQuantity('-0.000001'),'-0,000001');
  assert.equal(formatInventoryQuantity('1000.000000',true),'1.000');
  assert.equal(formatInventoryQuantity(null),'-');
  assert.equal(excelInventoryQuantity('0.000001'),0.000001);
  assert.throws(()=>formatInventoryQuantity('1.500000',true),/enteras/);
  assert.throws(()=>excelInventoryQuantity('1000000000.000000'),/precisión/);
  assert.throws(()=>excelInventoryQuantity('1.0000001'),/seis decimales/);
});
test('monthly filenames distinguish all five inventories and identify the same snapshot',()=>{
  const types:InventoryType[]=['asset','raw_material','supply','scrap','finished'];
  const identifiers=types.map(type=>inventoryReportIdentity(sampleReport(type)));
  assert.equal(new Set(identifiers).size,5);
  assert(identifiers.every(value=>value.includes('2026-10-V1')));
  assert.equal(inventoryReportIdentity(sampleReport()),inventoryReportIdentity(sampleReport()));
  assert.match(inventoryReportStatus(sampleReport()),/Borrador local/);
  assert.match(inventoryReportStatus(sampleReport(),{closedSnapshot:{version:1,closedBy:'Responsable de prueba',closedAt:'2026-11-10T15:00:00.000Z'}}),/Cierre local/);
});
test('missing count, price and value remain blank in Excel and do not become zero',async()=>{
  const report=sampleReport(),before=JSON.stringify(report);
  const workbook=await createInventoryWorkbook(report);
  const stock=workbook.getWorksheet('Existencias')!;
  assert.equal(stock.getCell('I6').value,null);assert.equal(stock.getCell('J6').value,null);
  assert.equal(workbook.getWorksheet('Valoracion')!.getCell('D6').value,null);
  assert.equal(workbook.getWorksheet('Resumen')!.getCell('B14').value,null);
  assert.equal(stock.getCell('H6').formula,'ROUND(E6+F6-G6,6)');assert.equal(stock.getCell('H6').result,6);
  assert.equal(stock.getCell('H6').numFmt,'#,##0.000000');
  assert.equal(JSON.stringify(report),before);
  assert((await workbook.xlsx.writeBuffer()).byteLength>1000);
});
test('a counted discrepancy keeps its sign and source reference; user text is never an Excel formula',async()=>{
  const report=sampleReport();report.rows[0]={...report.rows[0],counted:'5.250000',difference:'-0.750000',countDate:'2026-10-31',responsible:'Responsable de conteo',unitPrice:'100.25',theoreticalValue:'601.50',countedValue:'526.31',differenceValue:'-75.19'};report.totalValue='601.50';report.movements[0].sourceReference='=HYPERLINK("https://example.invalid")';
  const tables=inventoryReportTables(report);assert.equal(tables.find(table=>table.name==='Existencias')!.rows[0][9],'-0.750000');
  const workbook=await createInventoryWorkbook(report),stock=workbook.getWorksheet('Existencias')!;
  assert.equal(stock.getCell('J6').formula,'ROUND(I6-H6,6)');assert.equal(stock.getCell('J6').result,-0.75);
  assert.equal(workbook.getWorksheet('Movimientos')!.getCell('C6').value,report.movements[0].sourceReference);
  assert.equal(workbook.getWorksheet('Resumen')!.getCell('B14').value,601.5);
  assert(workbook.getWorksheet('Existencias')!.getCell('K6').value instanceof Date);
  assert.equal(report.reconciled,false);
});
test('real engine retains unknown valuation and documents the selected period price from a real Caja reference',async()=>{
  const initial=actualWorkspace('raw_material');let {state}=initial;const {actor,item,warehouses}=initial;
  const before=getInventoryReport(state,{inventoryType:'raw_material',startDate:'2026-10-01',endDate:'2026-10-31'});
  assert.equal(before.totalValue,null);assert(before.rows.every(row=>row.counted===null&&row.unitPrice===null&&row.theoreticalValue===null));
  state=createAccount(state,{name:'Banco aislado de pruebas',kind:'bank',bank:'Entidad de prueba',accountNumber:'000000000001',lastFour:'0001',custodian:actor.name,locationId:warehouses[0].locationId,active:true},actor);
  const account=state.accounts.find(row=>row.kind==='bank')!;
  state=registerCashMovement(state,{accountId:account.id,kind:'expense',categoryId:'compra-nylon',date:'2026-10-02',description:'Compra aislada para precio documentado',party:'Proveedor de prueba',amount:'100.25',support:document,idempotencyKey:'inventory-report-cash-price'},actor);
  const cash=state.transactions[0];
  state=registerInventoryPrice(state,{itemId:item.id,month:'2026-10',unitPrice:'100.25',cashTransactionIds:[cash.id],responsible:actor.name,support:document,notes:'Precio explícito del período, sin promedio automático.'},actor);
  state=recordInventoryCount(state,{inventoryType:'raw_material',date:'2026-10-31',purpose:'monthly',sourceReference:'ACTA-REPORT-TEST',responsible:actor.name,support:document,notes:'Faltante conservado para investigación.',lines:warehouses.map((warehouse,index)=>({itemId:item.id,warehouseId:warehouse.id,quantity:index===0?'4.750000':'0.000000'}))},actor);
  const report=getInventoryReport(state,{inventoryType:'raw_material',startDate:'2026-10-01',endDate:'2026-10-31'});
  assert.equal(report.rows[0].theoretical,'5.000000');assert.equal(report.rows[0].counted,'4.750000');assert.equal(report.rows[0].difference,'-0.250000');assert.equal(report.rows[0].differenceValue,'-25.06');assert.equal(report.totalValue,'501.25');assert.equal(report.reconciled,false);
  assert.equal(report.countDocuments?.[0].sourceReference,'ACTA-REPORT-TEST');
  const movementCount=getInventoryState(state).movements.length;
  const workbook=await createInventoryWorkbook(report,{cashReferences:{[cash.id]:cash.reference}});
  assert.equal(workbook.getWorksheet('Existencias')!.getCell('J6').result,-0.25);
  assert.equal(workbook.getWorksheet('Precios del periodo')!.getCell('C6').value,100.25);
  assert.equal(workbook.getWorksheet('Precios del periodo')!.getCell('D6').value,cash.reference);
  assert.equal(workbook.getWorksheet('Actas de conteo')!.getCell('B6').value,'ACTA-REPORT-TEST');
  assert.equal(workbook.getWorksheet('Resumen')!.getCell('B14').value,501.25);
  assert.equal(getInventoryState(state).movements.length,movementCount);
});
test('a closed finished-goods monthly report stays immutable after later sales and scopes its original warehouse snapshot',async()=>{
  const initial=actualWorkspace('finished');let {state}=initial;const {actor,item,warehouses}=initial;
  state=recordInventoryCount(state,{inventoryType:'finished',date:'2026-10-31',purpose:'monthly',sourceReference:'ACTA-FINISHED-CLOSE-TEST',responsible:actor.name,support:document,lines:warehouses.map((warehouse,index)=>({itemId:item.id,warehouseId:warehouse.id,quantity:index===0?'2.000000':'0.000000'}))},actor);
  state=closeInventoryMonth(state,{inventoryType:'finished',month:'2026-10',notes:'Cierre aislado de pruebas.'},actor);
  const snapshot=structuredClone(getInventoryState(state).monthClosures[0].report),identity=inventoryReportIdentity(snapshot);
  state=registerInventorySale(state,{reference:'SALE-FINISHED-NOV-TEST',date:'2026-11-01',buyer:'Comprador de prueba',support:document,lines:[{itemId:item.id,warehouseId:warehouses[0].id,quantity:'1.000000',unitPrice:'150.00'}]},actor);
  const report=getInventoryReport(state,{inventoryType:'finished',startDate:'2026-10-01',endDate:'2026-10-31'});
  assert.deepEqual(report,snapshot);assert.equal(inventoryReportIdentity(report),identity);assert.equal(report.rows[0].theoretical,'2.000000');assert.match(inventoryReportStatus(report),/Cierre local/);
  const scoped=getInventoryReport(state,{inventoryType:'finished',startDate:'2026-10-01',endDate:'2026-10-31',warehouseId:warehouses[0].id});
  assert.equal(scoped.rows.length,1);assert.equal(scoped.rows[0].theoretical,'2.000000');assert.equal(scoped.totalValue,'200.00');assert.equal(scoped.generatedAt,snapshot.generatedAt);assert.equal(scoped.status,'closed');
  const workbook=await createInventoryWorkbook(report);assert.equal(workbook.getWorksheet('Existencias')!.getCell('H6').numFmt,'#,##0');
});
