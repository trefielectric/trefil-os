import { assertDebtPeriodOpen } from '../debts/engine';
import { getDebtBalance, todayBogota } from '../finance/engine';
import { fromCents, money, toCents } from '../finance/money';
import { validateDate } from '../finance/amortization';
import { getCashState, getCashTransactionMetadata, isCashMonthClosed } from '../finance/cash';
import type { Actor, Money, State } from '../finance/types';
import { getInventoryState } from './engine';

const normalized=(value:string)=>value.trim().toLocaleLowerCase('es-CO');
function authorize(state:State,actor:Actor,locationIds:string[]){
  const member=state.members.find(row=>row.id===actor.id&&row.name===actor.name&&row.role===actor.role&&row.active);
  if(!member||!['owner','admin','accounting','treasury'].includes(member.role)||locationIds.some(id=>!member.locationIds.includes(id)))throw new Error('No tienes permiso financiero en las sedes vinculadas.');
}
function effectiveDate(state:State,date:string,saleId:string){
  validateDate(date);if(date>todayBogota())throw new Error('El cobro o compensación no puede ser futuro.');
  const inventory=getInventoryState(state);const sale=inventory.sales.find(row=>row.id===saleId);
  if(!sale)throw new Error('La factura de Inventarios no existe.');
  if(date<sale.date)throw new Error('La liquidación no puede ser anterior a la factura.');
  if(isCashMonthClosed(state,date)||inventory.monthClosures.some(row=>row.inventoryType===sale.kind&&row.month>=date.slice(0,7)))throw new Error('El período está cerrado; solicita revisión institucional.');
  return sale;
}
export function getInventorySaleOutstanding(state:State,saleId:string):Money{
  const inv=getInventoryState(state);const sale=inv.sales.find(row=>row.id===saleId);if(!sale)throw new Error('La factura no existe.');
  return fromCents(toCents(sale.totalValue)-inv.collections.filter(row=>row.saleId===saleId).reduce((sum,row)=>sum+toCents(row.amount),0n)-inv.supplierOffsets.filter(row=>row.saleId===saleId).reduce((sum,row)=>sum+toCents(row.amount),0n));
}
function audit(state:State,actor:Actor,id:string,action:string,reason:string){state.audit.unshift({id:crypto.randomUUID(),action,entityType:'inventory_settlement',entityId:id,actorId:actor.id,actorName:actor.name,timestamp:new Date().toISOString(),reason});}
function key(value:string){if(typeof value!=='string'||value.trim().length<8||value.length>200)throw new Error('La clave del registro es inválida.');return value.trim();}
function locations(state:State,saleId:string){const inv=getInventoryState(state);return [...new Set(inv.sales.find(row=>row.id===saleId)!.lines.map(line=>{const warehouse=inv.warehouses.find(row=>row.id===line.warehouseId);if(!warehouse)throw new Error('La bodega vinculada no existe.');return warehouse.locationId;}))];}

/** Allocate an already posted receipt. No duplicate cash or stock movement is created. */
export function linkInventoryCashCollection(state:State,input:{saleId:string;transactionId:string;amount:Money;idempotencyKey:string},actor:Actor):State{
  const inv=getInventoryState(state);const id=key(input.idempotencyKey);const amount=money(input.amount);
  const previous=inv.collections.find(row=>row.id===id);
  if(previous){authorize(state,actor,locations(state,previous.saleId));if(previous.saleId===input.saleId&&previous.transactionId===input.transactionId&&previous.amount===amount)return state;throw new Error('La clave ya se usó para otro cobro.');}
  const cash=state.transactions.find(row=>row.id===input.transactionId&&row.kind==='income'&&row.status==='posted'&&!row.reversedBy);
  if(!cash)throw new Error('Selecciona un ingreso real, contabilizado y vigente de Caja.');
  if(getCashTransactionMetadata(state,cash.id).businessStatus!=='business')throw new Error('El ingreso debe estar clasificado como empresarial.');
  const sale=effectiveDate(state,cash.date,input.saleId);const scope=locations(state,sale.id);authorize(state,actor,[...scope,cash.locationId]);
  if(scope.some(id=>id!==cash.locationId))throw new Error('La factura y el ingreso deben pertenecer a la misma sede.');
  if(isCashMonthClosed(state,cash.date))throw new Error('El comprobante pertenece a un cierre de Caja.');
  if(normalized(cash.party)!==normalized(sale.buyer))throw new Error('El tercero del ingreso debe coincidir con el comprador de la factura.');
  const allocated=inv.collections.filter(row=>row.transactionId===cash.id).reduce((sum,row)=>sum+toCents(row.amount),0n);
  if(toCents(amount)<=0n||toCents(amount)>toCents(getInventorySaleOutstanding(state,sale.id))||allocated+toCents(amount)>toCents(cash.amount))throw new Error('El cobro supera el saldo de la factura o el ingreso disponible para vincular.');
  const next=structuredClone(state);next.inventory=structuredClone(inv);next.inventory.collections.push({id,saleId:sale.id,transactionId:cash.id,date:cash.date,amount,actorId:actor.id,createdAt:new Date().toISOString()});
  next.cash=structuredClone(getCashState(state));const metadata=structuredClone(getCashTransactionMetadata(state,cash.id));
  if(!metadata.externalReferences.some(row=>row.module==='inventory'&&row.id===sale.id))metadata.externalReferences.push({module:'inventory',id:sale.id,label:sale.reference});
  metadata.history.push({id:crypto.randomUUID(),createdAt:new Date().toISOString(),actorId:actor.id,actorName:actor.name,action:'inventory_linked',after:JSON.stringify(metadata.externalReferences),notes:`Cobro vinculado a ${sale.reference}: ${amount} COP; sin nuevo ingreso.`});
  next.cash.metadata=next.cash.metadata.filter(row=>row.transactionId!==cash.id).concat(metadata);
  audit(next,actor,id,'Ingreso real vinculado a Inventarios',`${cash.reference} → ${sale.reference}; ${amount} COP. Sin nuevo movimiento de Caja.`);return next;
}

/** Reduce the supplier obligation and scrap receivable together, with no cash entry. */
export function offsetInventorySupplierDebt(state:State,input:{saleId:string;debtId:string;date:string;amount:Money;reference:string;idempotencyKey:string},actor:Actor):State{
  const inv=getInventoryState(state);const id=key(input.idempotencyKey);const amount=money(input.amount);const previous=inv.supplierOffsets.find(row=>row.id===id);
  if(previous){authorize(state,actor,locations(state,previous.saleId));if(previous.saleId===input.saleId&&previous.debtId===input.debtId&&previous.date===input.date&&previous.amount===amount&&previous.reference===input.reference.trim())return state;throw new Error('La clave ya se usó para otra compensación.');}
  const sale=effectiveDate(state,input.date,input.saleId);const debt=state.debts.find(row=>row.id===input.debtId&&row.kind==='supplier');
  if(sale.kind!=='scrap'||!debt)throw new Error('La compensación requiere una venta de chatarra y una obligación real de proveedor.');
  assertDebtPeriodOpen(state,input.date);
  const dispatch=inv.scrapDispatches.find(row=>row.saleId===sale.id);
  const recognition=dispatch?.history.find(row=>row.action==='Peso reconocido por comprador'||row.action==='Peso definitivo reconocido');
  if(!dispatch||dispatch.recognizedQuantity===undefined||!recognition||recognition.date>input.date){
    throw new Error('Documenta el peso reconocido y la factura definitiva antes de compensar la chatarra.');
  }

  const scope=locations(state,sale.id);authorize(state,actor,[...scope,debt.locationId]);
  if(scope.some(id=>id!==debt.locationId)||normalized(debt.creditor)!==normalized(sale.buyer))throw new Error('El comprador de chatarra y el proveedor deben ser el mismo tercero y sede.');
  if(input.date<debt.startDate)throw new Error('La compensación no puede ser anterior a la factura del proveedor.');
  if(!input.reference.trim()||input.reference.length>2000)throw new Error('Incluye la referencia del acuerdo de compensación.');
  const reserved=state.debtPayments.filter(row=>row.debtId===debt.id&&row.status==='pending').reduce((sum,row)=>sum+toCents(row.principal),0n);
  if(toCents(amount)<=0n||toCents(amount)>toCents(getInventorySaleOutstanding(state,sale.id))||toCents(amount)>toCents(getDebtBalance(state,debt.id))-reserved)throw new Error('La compensación supera la venta pendiente o el saldo de proveedor disponible tras pagos por aprobar.');
  const next=structuredClone(state);next.inventory=structuredClone(inv);next.inventory.supplierOffsets.push({id,saleId:sale.id,debtId:debt.id,date:input.date,amount,reference:input.reference.trim(),actorId:actor.id,createdAt:new Date().toISOString()});
  audit(next,actor,id,'Chatarra compensada con obligación de proveedor',`${sale.reference} → ${debt.supplierInvoice}; ${amount} COP; acuerdo ${input.reference.trim()}. Sin ingreso ni egreso de Caja.`);return next;
}
