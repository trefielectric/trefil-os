import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CashView, MovementEvidenceModal } from '../src/components/cash-view';
import { createEmptyState } from '../src/lib/finance/empty';
import { createAccount, todayBogota } from '../src/lib/finance/engine';
import { attachCashSupport, getCashState, openCashSession, registerCashMovement } from '../src/lib/finance/cash';
import type { State, Support } from '../src/lib/finance/types';

const noMutation=()=>{throw new Error('Rendering a view must never write records');};
const noNotification=()=>{throw new Error('Rendering a view must never announce a completed operation');};
const props=(state:State)=>({state,actor:state.members[0],location:'all',mutate:noMutation,notify:noNotification});
const proof=(name:string,type:string):Support=>({name,type,size:1,dataUrl:`data:${type};base64,AA==`});

function walletOperation():State {
  let state=createEmptyState();const actor=state.members[0];
  state=createAccount(state,{name:'Cuenta aislada de revisión',kind:'wallet',custodian:actor.name,locationId:'sede-principal',active:true},actor);
  const wallet=state.accounts.find(row=>row.kind==='wallet')!;
  return registerCashMovement(state,{accountId:wallet.id,date:todayBogota(),kind:'income',categoryId:'entradas-devoluciones',description:'Reintegro aislado para verificar ficha',party:'Contraparte de prueba aislada',amount:'100.00',idempotencyKey:'cash-ui-receipt-original-0001',support:proof('Comprobante original.pdf','application/pdf')},actor);
}

test('CashView starts empty without creating sample accounts, movements, counts or audit',()=>{
  const state=createEmptyState();const before=JSON.stringify(state);
  const html=renderToStaticMarkup(createElement(CashView,{...props(state),onConfigureAccounts:()=>{}}));
  assert.match(html,/Primero configura tu caja de efectivo/);
  assert.match(html,/Configurar cuentas/);
  assert.match(html,/Turnos y arqueos/);assert.match(html,/Movimientos y legalización/);assert.match(html,/Cierre mensual/);
  assert.match(html,/role="tablist"/);assert.match(html,/role="tabpanel"/);assert.match(html,/aria-controls=/);
  assert.equal(JSON.stringify(state),before);
  assert.equal(state.accounts.length,0);assert.equal(state.transactions.length,0);assert.equal(state.audit.length,0);
  assert.deepEqual(getCashState(state).sessions,[]);assert.deepEqual(getCashState(state).counts,[]);
});

test('CashView represents an uncounted real session with a missing value, not a fabricated physical zero',()=>{
  let state=createEmptyState();const actor=state.members[0];
  state=createAccount(state,{name:'Caja de prueba sin arqueo',kind:'cash',custodian:actor.name,locationId:'sede-principal',active:true},actor);
  state=openCashSession(state,{accountId:state.accounts.find(row=>row.kind==='cash')!.id,date:todayBogota()},actor);
  const before=JSON.stringify(state);const html=renderToStaticMarkup(createElement(CashView,props(state)));
  assert.match(html,/Último arqueo contado/);assert.match(html,/—/);assert.match(html,/Guardar|Arqueo/);
  assert.equal(JSON.stringify(state),before);assert.equal(getCashState(state).counts.length,0);
});

test('independent movement evidence sheet exposes preserved original and later attachments with attribution',()=>{
  let state=walletOperation();const actor=state.members[0];const transactionId=state.transactions[0].id;
  state=attachCashSupport(state,{transactionId,support:proof('Fotografía posterior.png','image/png'),notes:'Fotografía recibida después del registro'},actor);
  state=attachCashSupport(state,{transactionId,support:proof('Factura posterior.pdf','application/pdf'),notes:'Factura adicional conservada'},actor);
  const original=JSON.stringify(state.transactions);const before=JSON.stringify(state);
  const html=renderToStaticMarkup(createElement(MovementEvidenceModal,{...props(state),transaction:state.transactions[0],mode:'support',onClose:()=>{}}));
  assert.match(html,/Comprobantes conservados/);assert.match(html,/Comprobante original.pdf/);assert.match(html,/Fotografía posterior.png/);assert.match(html,/Factura posterior.pdf/);
  assert.match(html,/Soporte original/);assert.match(html,/Anexo conservado/);assert.match(html,/Propietario local/);
  assert.match(html,/data:image\/png;base64,AA==/);assert.match(html,/data:application\/pdf;base64,AA==/);
  assert.equal(JSON.stringify(state.transactions),original);assert.equal(JSON.stringify(state),before);
});

test('unsafe or mismatched attachment URLs are never rendered as download or navigation links',()=>{
  const state=walletOperation();const transactionId=state.transactions[0].id;const metadata=getCashState(state).metadata.find(row=>row.transactionId===transactionId)!;
  metadata.attachments=[
    {id:'bad-javascript',support:{name:'Archivo inválido.pdf',type:'application/pdf',size:1,dataUrl:'javascript:alert(1)'},actorId:state.members[0].id,createdAt:new Date().toISOString()},
    {id:'bad-html',support:{name:'Contenido no permitido.pdf',type:'application/pdf',size:1,dataUrl:'data:text/html;base64,AA=='},actorId:state.members[0].id,createdAt:new Date().toISOString()},
    {id:'bad-protocol',supportUrl:'javascript:alert(2)',actorId:state.members[0].id,createdAt:new Date().toISOString()},
    {id:'bad-credentials',supportUrl:'https://user:password@example.test/receipt',actorId:state.members[0].id,createdAt:new Date().toISOString()},
    {id:'empty-image',support:{name:'Fotografía vacía.png',type:'image/png',size:0,dataUrl:'data:image/png;base64,'},actorId:state.members[0].id,createdAt:new Date().toISOString()},
  ];
  const html=renderToStaticMarkup(createElement(MovementEvidenceModal,{...props(state),transaction:state.transactions[0],mode:'support',onClose:()=>{}}));
  assert.doesNotMatch(html,/href="javascript:/);assert.doesNotMatch(html,/href="data:text\/html/);assert.doesNotMatch(html,/https:\/\/user:password/);
  assert.doesNotMatch(html,/href="data:image\/png;base64,"/);
  assert.match(html,/Archivo no disponible/);
});

test('HTTPS evidence opens as an isolated external link and corrections remain explicitly pending',()=>{
  let state=walletOperation();const transactionId=state.transactions[0].id;
  state=attachCashSupport(state,{transactionId,supportUrl:'https://example.test/authorized-receipt',notes:'Enlace documental de prueba'},state.members[0]);
  const html=renderToStaticMarkup(createElement(MovementEvidenceModal,{...props(state),transaction:state.transactions[0],mode:'correct',onClose:()=>{}}));
  assert.match(html,/href="https:\/\/example.test\/authorized-receipt"/);assert.match(html,/rel="noopener noreferrer"/);
  assert.match(html,/Guardar solicitud pendiente/);assert.match(html,/no se simulan sus códigos ni sus identidades/);
  assert.doesNotMatch(html,/Cambiar perfil|Aprobar con código|Aplicar corrección/);
  assert.equal(getCashState(state).amendmentRequests.length,0,'Rendering the form does not create a request');
});

test('a preserved withdrawal photograph still permits adding another PDF after a later attachment',()=>{
  let state=walletOperation();const actor=state.members[0];const wallet=state.accounts.find(row=>row.kind==='wallet')!;
  state=createAccount(state,{name:'Caja aislada para recepción',kind:'cash',custodian:actor.name,locationId:'sede-principal',active:true},actor);
  const cash=state.accounts.find(row=>row.kind==='cash')!;
  state=openCashSession(state,{accountId:cash.id,date:todayBogota()},actor);
  state=registerCashMovement(state,{accountId:wallet.id,date:todayBogota(),kind:'transfer',categoryId:'retiro-entre-cuentas',destinationAccountId:cash.id,amount:'100.00',description:'Retiro aislado con evidencia posterior',party:'Responsable de prueba',idempotencyKey:'cash-ui-transfer-photo-history-0001',supportUrl:'https://example.test/withdrawal'},actor);
  const transactionId=state.transactions[0].id;
  state=attachCashSupport(state,{transactionId,support:proof('Fotografía conservada.png','image/png')},actor);
  state=attachCashSupport(state,{transactionId,support:proof('Factura adicional.pdf','application/pdf')},actor);
  const html=renderToStaticMarkup(createElement(MovementEvidenceModal,{...props(state),transaction:state.transactions[0],mode:'support',onClose:()=>{}}));
  assert.match(html,/Fotografía conservada.png/);assert.match(html,/Factura adicional.pdf/);
  assert.match(html,/accept="application\/pdf,image\/jpeg,image\/png,image\/webp"/);
  assert.doesNotMatch(html,/Fotografía del comprobante de retiro/);
});
