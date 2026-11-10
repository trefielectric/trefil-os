import test from 'node:test';
import assert from 'node:assert/strict';
import { approveTransaction, createDebt, createEmptyState, getAccountBalance, getDebtBalance, getUpcomingObligations, getSummary, recordDebtPayment, registerCashMovement, type Actor, type State, type Support } from '../src/lib/finance';
import { createInventoryItem, generateInventoryScrap, getInventoryState, prepareScrapSale, dispatchScrapSale, recognizeScrapDispatch, receiveInventoryPurchase, saveInventoryOriginDraft, postInventoryOrigin } from '../src/lib/inventory';
import { getInventorySaleOutstanding, linkInventoryCashCollection, offsetInventorySupplierDebt } from '../src/lib/inventory/integrations';
import { inspectDemoState } from '../src/lib/demo-state';
const actor:Actor={id:'local-owner',name:'Propietario local',role:'owner'};
const day='2026-10-20';
const proof:Support={name:'factura.pdf',type:'application/pdf',size:3,dataUrl:'data:application/pdf;base64,AQID'};
let sequence=0;
function base(){const state=createEmptyState();state.accounts.push({id:'bank-test',name:'Banco pruebas',kind:'bank',locationId:'sede-principal',custodian:actor.name,active:true});return state;}
function zeroOrigin(state:State,type:'scrap'|'raw_material'){const inv=getInventoryState(state);const next=saveInventoryOriginDraft(state,{inventoryType:type,date:day,sourceReference:`ORIGEN-${type}-TEST`,responsible:'Verificador de pruebas',support:proof,lines:inv.items.filter(item=>item.inventoryType===type).flatMap(item=>inv.warehouses.map(w=>({itemId:item.id,warehouseId:w.id,quantity:'0.000000'})))},actor);return postInventoryOrigin(next,next.inventory!.origins.find(row=>row.inventoryType===type)!.id,actor);}
function scrapSale(){let state=createInventoryItem(base(),{code:'CHAT-TEST',description:'Chatarra para probar integración',inventoryType:'scrap',unit:'kg',category:'Cobre',active:true},actor);state=zeroOrigin(state,'scrap');const inv=getInventoryState(state);const line={itemId:inv.items[0].id,warehouseId:inv.warehouses[0].id,quantity:'10.000000'};state=generateInventoryScrap(state,{date:day,sourceReference:'OP-SCRAP-TEST',responsible:'Responsable de prueba',support:proof,lines:[line]},actor);state=prepareScrapSale(state,{...line,date:day,sourceReference:'PREP-TEST',responsible:'Responsable de prueba',support:proof},actor);state=dispatchScrapSale(state,{preparationId:state.inventory!.scrapPreparations[0].id,date:day,quantity:'10',unitPrice:'100.00',buyer:'Proveedor prueba',reference:'FACT-SCRAP-TEST',support:proof},actor);return recognizeScrapDispatch(state,{dispatchId:state.inventory!.scrapDispatches[0].id,date:day,quantity:'10',reference:'FACT-SCRAP-FINAL',support:proof},actor);}
function supplier(state:State,principal='800.00'){return createDebt(state,{creditor:'Proveedor prueba',kind:'supplier',supplierInvoice:'FAC-PROV-TEST',supplierDueDate:'2026-10-25',principal,monthlyRate:'0.00',installments:1,startDate:day,dueDay:25,method:'fixed_principal',locationId:'sede-principal',contract:proof},actor);}
function income(state:State,amount='600.00',party='Proveedor prueba'){return registerCashMovement(state,{kind:'income',categoryId:'ventas-regulares',accountId:'bank-test',date:day,locationId:'sede-principal',description:'Recaudo venta de chatarra de prueba',party,amount,support:proof,idempotencyKey:`integration-income-${++sequence}`},actor);}

test('supplier compensation reduces both real obligations without a cash or stock transaction',()=>{
 let state=supplier(scrapSale());const sale=state.inventory!.sales[0];const debt=state.debts[0];const before=JSON.stringify(state);const txCount=state.transactions.length,movementCount=state.inventory!.movements.length;
 const input={saleId:sale.id,debtId:debt.id,date:day,amount:'600.00',reference:'ACUERDO-PROV-1',idempotencyKey:'offset-test-one'};
 const result=offsetInventorySupplierDebt(state,input,actor);assert.equal(JSON.stringify(state),before);assert.equal(getDebtBalance(result,debt.id),'200.00');assert.equal(getInventorySaleOutstanding(result,sale.id),'400.00');assert.equal(result.transactions.length,txCount);assert.equal(result.inventory!.movements.length,movementCount);assert.equal(getAccountBalance(result,'bank-test'),'0.00');assert.equal(getSummary(result,day).income,'0.00');assert.equal(getUpcomingObligations(result,day)[0].date,'2026-10-25');assert.equal(getUpcomingObligations(result,day)[0].amount,'200.00');assert.equal(offsetInventorySupplierDebt(result,input,actor),result);assert(inspectDemoState(result).ok);
 assert.throws(()=>offsetInventorySupplierDebt(result,{...input,amount:'700.00'},actor),/clave/);
 assert.throws(()=>offsetInventorySupplierDebt(result,{...input,amount:'300.00',idempotencyKey:'offset-over-limit'},actor),/supera/);
});

test('partial cash collections allocate existing receipts once and preserve the exact posted journal',()=>{
 const state=income(scrapSale());const sale=state.inventory!.sales[0];const tx=state.transactions[0];const originalJournal=JSON.stringify(state.transactions);const input={saleId:sale.id,transactionId:tx.id,amount:'400.00',idempotencyKey:'collection-test-one'};
 const result=linkInventoryCashCollection(state,input,actor);assert.equal(getInventorySaleOutstanding(result,sale.id),'600.00');assert.equal(JSON.stringify(result.transactions),originalJournal);assert.equal(getAccountBalance(result,'bank-test'),'600.00');assert.equal(linkInventoryCashCollection(result,input,actor),result);assert(result.cash!.metadata[0].externalReferences.some(row=>row.module==='inventory'&&row.id===sale.id));assert(inspectDemoState(result).ok);
 assert.throws(()=>linkInventoryCashCollection(result,{...input,amount:'201.00',idempotencyKey:'collection-over-total'},actor),/supera/);
 const last=linkInventoryCashCollection(result,{...input,amount:'200.00',idempotencyKey:'collection-test-two'},actor);assert.equal(getInventorySaleOutstanding(last,sale.id),'400.00');
});

test('cash collections reject a different third party, future/closed periods and spoofed actors',()=>{
 const state=income(scrapSale(),'100.00','Otro comprador');const sale=state.inventory!.sales[0];const input={saleId:sale.id,transactionId:state.transactions[0].id,amount:'100.00',idempotencyKey:'collection-invalid'};assert.throws(()=>linkInventoryCashCollection(state,input,actor),/tercero/);
 const future=supplier(scrapSale());assert.throws(()=>offsetInventorySupplierDebt(future,{saleId:future.inventory!.sales[0].id,debtId:future.debts[0].id,date:'2099-01-01',amount:'10.00',reference:'ACUERDO-FUTURO',idempotencyKey:'future-compensation'},actor),/futuro/);
 const valid=income(scrapSale(),'100.00');const args={...input,saleId:valid.inventory!.sales[0].id,transactionId:valid.transactions[0].id};assert.throws(()=>linkInventoryCashCollection(valid,args,{...actor,name:'Nombre usurpado'}),/permiso/);
 const closed=structuredClone(valid);closed.cash!.monthClosures.push({month:'2026-10'} as never);assert.throws(()=>linkInventoryCashCollection(closed,args,actor),/cerrado/);
});

test('pending supplier cash principal is reserved before noncash compensation',()=>{
 let state=supplier(scrapSale());const debt=state.debts[0];state=recordDebtPayment(state,{debtId:debt.id,accountId:'bank-test',date:day,principal:'500.00',interest:'0.00',amount:'500.00',idempotencyKey:'supplier-pending-pay',support:proof},actor);
 const input={saleId:state.inventory!.sales[0].id,debtId:debt.id,date:day,amount:'400.00',reference:'ACUERDO-PENDIENTE',idempotencyKey:'supplier-reservation'};assert.throws(()=>offsetInventorySupplierDebt(state,input,actor),/supera/);
 const result=offsetInventorySupplierDebt(state,{...input,amount:'300.00'},actor);assert.equal(getDebtBalance(result,debt.id),'500.00');
 const admin:Actor={id:'test-admin',name:'Gerente de prueba',role:'admin'};result.members.push({...admin,email:'test@local.invalid',active:true,locationIds:['sede-principal']});const approved=approveTransaction(result,result.transactions[0].id,admin);assert.equal(getDebtBalance(approved,debt.id),'0.00');assert.equal(getInventorySaleOutstanding(approved,input.saleId),'700.00');assert(inspectDemoState(approved).ok);
});

test('supplier invoices require real evidence, distinct references and their documented due date',()=>{
 const state=base();const input={creditor:'Proveedor prueba',kind:'supplier' as const,supplierInvoice:'FAC-UNICA',supplierDueDate:'2026-10-25',principal:'800.00',monthlyRate:'0.00',installments:1,startDate:day,dueDay:25,method:'fixed_principal' as const,locationId:'sede-principal',contract:proof};
 assert.throws(()=>createDebt(state,{...input,contract:undefined},actor),/factura real/);const result=createDebt(state,input,actor);assert.throws(()=>createDebt(result,input,actor),/ya existe/);assert.equal(result.transactions.length,0);assert.equal(getUpcomingObligations(result,day)[0].date,input.supplierDueDate);
});

test('an acquisition creates one linked stock receipt and never a second cash expense',()=>{
 let state=createInventoryItem(base(),{code:'MP-TEST',description:'Materia prima de prueba',inventoryType:'raw_material',unit:'kg',category:'Alambre',active:true},actor);state=zeroOrigin(state,'raw_material');state=registerCashMovement(state,{kind:'expense',categoryId:'adquisicion-insumos',accountId:'bank-test',date:day,locationId:'sede-principal',description:'Compra materia prima de prueba',party:'Proveedor prueba',amount:'100.00',support:proof,idempotencyKey:'purchase-integration-source'},actor);const cash=state.transactions[0];const inv=state.inventory!;const input={cashTransactionId:cash.id,supplier:cash.party,date:day,lines:[{itemId:inv.items[0].id,warehouseId:inv.warehouses[0].id,quantity:'10',unitValue:'10.00',totalValue:'100.00'}],support:proof};const result=receiveInventoryPurchase(state,input,actor);assert.equal(result.transactions.length,state.transactions.length);assert.equal(result.inventory!.movements.length,1);assert.equal(result.inventory!.movements[0].cashTransactionId,cash.id);assert.throws(()=>receiveInventoryPurchase(result,input,actor),/duplicar|ya fue/);assert(inspectDemoState(result).ok);
});
