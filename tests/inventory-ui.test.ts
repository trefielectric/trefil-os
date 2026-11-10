import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InventoryView, InventoryOperationModal, InventorySalesHistory } from '../src/components/inventory-view';
import { createEmptyState } from '../src/lib/finance/empty';
import { createInventoryItem, createEmptyInventoryState, getInventoryState } from '../src/lib/inventory';
import type { State, Support } from '../src/lib/finance';

const noWrite=()=>{throw new Error('Rendering must never write state');};
const props=(state:State)=>({state,actor:state.members[0],location:'all',mutate:noWrite,notify:noWrite});
const support:Support={name:'Fotografía real de prueba.png',type:'image/png',size:1,dataUrl:'data:image/png;base64,AA=='};
const modal=(state:State,operation:Parameters<typeof InventoryOperationModal>[0]['operation'],inventoryType:Parameters<typeof InventoryOperationModal>[0]['inventoryType'])=>renderToStaticMarkup(createElement(InventoryOperationModal,{...props(state),operation,inventoryType,month:'2026-11',onClose:()=>{}}));

test('InventoryView starts with five empty inventories and never invents stock or audit events',()=>{
  const state=createEmptyState();const before=JSON.stringify(state);
  const html=renderToStaticMarkup(createElement(InventoryView,{...props(state),cashLinks:createElement('p',null,'Integración de Caja'),supplierOffset:createElement('p',null,'Abonos a proveedor'),reports:createElement('p',null,'Informes de inventario')}));
  for(const label of ['Propiedad, planta y equipo','Materia prima','Insumos de fabricación','Chatarra','Producto terminado','Catálogo','Movimientos','Conteos','Operaciones especiales','Integraciones','Cierre','Informes'])assert.ok(html.includes(label),label);
  assert.match(html,/Tu inventario de activos empieza vacío/);assert.match(html,/ORIGEN histórico/);assert.match(html,/Pendiente/);
  assert.match(html,/role="tablist"/);assert.match(html,/role="tabpanel"/);assert.match(html,/aria-controls=/);
  assert.equal(JSON.stringify(state),before);assert.equal(getInventoryState(state).items.length,0);assert.equal(getInventoryState(state).movements.length,0);assert.equal(state.audit.length,0);
  assert.equal(getInventoryState(state).warehouses.length,2);assert.deepEqual(getInventoryState(state).warehouses.map(row=>row.name),['Bodega Principal','Bodega Despachos']);
});

test('asset catalog requires photo and real value without creating quantity or payment inputs',()=>{
  const state=createEmptyState();const html=modal(state,'item','asset');
  assert.match(html,/Fotografía obligatoria del activo/);assert.match(html,/accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html,/Serial, cuando exista/);assert.match(html,/Valor del activo COP/);assert.match(html,/Estado o condición/);
  assert.doesNotMatch(html,/name="quantity"|name="accountId"/);assert.doesNotMatch(html,/value="0(?:\.00)?"/);
});

test('ORIGEN preserves blank quantities for every item and warehouse, while empty origin needs explicit confirmation',()=>{
  const empty=createEmptyState();const emptyHtml=modal(empty,'origin','finished');assert.match(emptyHtml,/He verificado que este inventario no tiene referencias/);assert.doesNotMatch(emptyHtml,/checked=""/);
  const state=createInventoryItem(empty,{code:'QA-PRODUCTO-UI',description:'Producto aislado de contrato',inventoryType:'finished',unit:'unit',category:'Referencia de prueba',active:true},empty.members[0]);
  const before=JSON.stringify(state);const html=modal(state,'origin','finished');
  assert.match(html,/Bodega Principal/);assert.match(html,/Bodega Despachos/);assert.equal((html.match(/placeholder="Sin informar"/g)??[]).length,2);
  assert.doesNotMatch(html,/value="0(?:\.000000)?"/);assert.match(html,/Guardar borrador de ORIGEN/);assert.equal(JSON.stringify(state),before);
});

test('count sheet requires each physical observation and keeps an absent count distinct from zero',()=>{
  const empty=createEmptyState();const state=createInventoryItem(empty,{code:'QA-MATERIAL-UI',description:'Material aislado para acta',inventoryType:'raw_material',unit:'kg',category:'Prueba aislada',active:true},empty.members[0]);
  const html=modal(state,'count','raw_material');assert.match(html,/Bodega Principal/);assert.match(html,/Bodega Despachos/);assert.match(html,/Cantidad física observada/);assert.match(html,/Guardar acta sin ajustar stock/);assert.doesNotMatch(html,/value="0(?:\.000000)?"/);
});

test('documentary lot conformity does not pretend a role switch or institutional authentication',()=>{
  const empty=createEmptyState();const before=JSON.stringify(empty);const html=modal(empty,'lot','finished');
  assert.match(html,/Crear el lote no incorpora existencias/);assert.match(html,/dos áreas|Producción y Ventas/);assert.match(html,/Crear lote pendiente/);assert.doesNotMatch(html,/Cambiar perfil|PIN|Aprobar con código/);assert.equal(JSON.stringify(empty),before);
});

test('exceptions are explicitly pending and never offer local approval or silent adjustment',()=>{
  const state=createEmptyState();const html=modal(state,'request','asset');assert.match(html,/Guardar solicitud pendiente/);assert.match(html,/No se aplican cambios con el perfil local/);assert.match(html,/Creador o Gerente/);assert.match(html,/Activo omitido en el ORIGEN/);assert.doesNotMatch(html,/Aprobar con código|Aplicar ajuste|Cambiar rol/);assert.equal(getInventoryState(state).requests.length,0);
});

test('unsafe asset evidence is never rendered as a navigable URL',()=>{
  const empty=createEmptyState();const state=createInventoryItem(empty,{code:'QA-ACTIVO-UI',description:'Activo aislado con fotografía',inventoryType:'asset',unit:'unit',category:'Equipo de prueba',active:true,condition:'Prueba',unitValue:'1.00',photo:support},empty.members[0]);
  const inventoryState=getInventoryState(state);inventoryState.items[0].photo={...support,dataUrl:'javascript:alert(1)'};
  const html=renderToStaticMarkup(createElement(InventoryView,props(state)));assert.doesNotMatch(html,/href="javascript:/);
});


test('sales history shows allocated receipts and supplier offsets rather than stale settlement placeholders',()=>{
  const state=createEmptyState();state.inventory=createEmptyInventoryState();const inv=state.inventory;const warehouseId=inv.warehouses[0].id;
  inv.sales.push({id:'ui-sale',reference:'FACTURA-UI-FINAL',date:'2026-10-20',buyer:'Proveedor aislado de prueba',lines:[{itemId:'ui-item',warehouseId,quantity:'10.000000',unitPrice:'100.00',totalValue:'1000.00'}],support,totalValue:'1000.00',kind:'scrap',sourceReference:'FACTURA-UI-ORIGINAL',notes:'Fixture exclusivo de interfaz',settlements:[],createdBy:state.members[0].id,createdAt:'2026-10-20T12:00:00Z',history:[{date:'2026-10-20',action:'Factura original de despacho',reference:'FACTURA-UI-ORIGINAL',totalValue:'1000.00',support,actorId:state.members[0].id}]});
  inv.collections.push({id:'ui-collection',saleId:'ui-sale',transactionId:'ui-income',date:'2026-10-21',amount:'400.00',actorId:state.members[0].id,createdAt:'2026-10-21T12:00:00Z'});
  inv.supplierOffsets.push({id:'ui-offset',saleId:'ui-sale',debtId:'ui-supplier',date:'2026-10-22',amount:'600.00',reference:'Acuerdo aislado de compensación',actorId:state.members[0].id,createdAt:'2026-10-22T12:00:00Z'});
  const before=JSON.stringify(state);const html=renderToStaticMarkup(createElement(InventorySalesHistory,{props:props(state),type:'scrap'}));
  assert.match(html,/Recaudo de Caja/);assert.match(html,/Abono a proveedor/);assert.match(html,/2026-10-21/);assert.match(html,/2026-10-22/);assert.match(html,/Sin saldo por cobrar/);assert.match(html,/Acuerdo aislado de compensación/);assert.match(html,/FACTURA-UI-ORIGINAL/);assert.match(html,/Propietario local/);assert.doesNotMatch(html,/Pendiente de confirmar/);assert.equal(JSON.stringify(state),before);
});
