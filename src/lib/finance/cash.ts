import { validateDate } from './amortization';
import { add, fromCents, money, sub, toCents } from './money';
import { createTransaction, getAccountBalance, recordDebtPayment, todayBogota } from './engine';
import { CASH_CATALOG, CASH_TEMPORARY_CATEGORY, findCashCategory, findCashIncomeCategory, suggestCashCategory } from './cash-catalog';
import type { Account, Actor, Alert, Money, State, Support, Transaction } from './types';
import type { CashAmendmentInput, CashCount, CashCountDenomination, CashExternalReference, CashMonthChecklist, CashMovementInput, CashMovementMetadata, CashPeriodReport, CashReportMovement, CashSession, CashSessionSummary, CashState, CashSupportInput, OpenCashSessionInput } from './cash-types';

const uuid = () => crypto.randomUUID();
const timestamp = () => new Date().toISOString();
const WRITERS = ['owner', 'admin', 'treasury', 'accounting'];
export const CASH_DENOMINATIONS = Object.freeze([
  ...['100000.00','50000.00','20000.00','10000.00','5000.00','2000.00','1000.00'].map(value => Object.freeze({ id:`bill_${value.split('.')[0]}`,kind:'bill' as const,value,label:`Billete $${value.split('.')[0]}` })),
  ...['1000.00','500.00','200.00','100.00','50.00'].map(value => Object.freeze({ id:`coin_${value.split('.')[0]}`,kind:'coin' as const,value,label:`Moneda $${value.split('.')[0]}` })),
]);

export function createEmptyCashState(): CashState { return { version:1,sessions:[],counts:[],legalizations:[],amendmentRequests:[],monthClosures:[],transferReceipts:[],statementImports:[],metadata:[] }; }
export function getCashState(state: State): CashState { return state.cash ?? createEmptyCashState(); }
export function isCashEnabled(state:State):boolean { return state.cash!==undefined||state.organization.id==='local-trefil-electric'; }
function clone(state: State): State & {cash:CashState} { const next=structuredClone(state); return Object.assign(next,{cash:next.cash ?? createEmptyCashState()}); }
function text(value: string, label: string, minimum=2): string { if(typeof value!=='string'||value.trim().length<minimum||value.length>2000)throw new Error(`${label} debe tener entre ${minimum} y 2000 caracteres.`);return value.trim(); }
function auth(state:State,actor:Actor,locationId?:string,roles=WRITERS):void { const member=state.members.find(row=>row.id===actor.id&&row.active&&row.role===actor.role);if(!member||!roles.includes(member.role))throw new Error('Tu usuario no tiene permiso para esta operación de Caja.');if(locationId&&!member.locationIds.includes(locationId))throw new Error('No tienes permiso en esta sede.'); }
function snapshot(value:unknown):string { return JSON.stringify(value,(key,item)=>key==='dataUrl'?'[archivo conservado por referencia]':key==='history'?'[historial conservado en entidad]':key==='report'?'[informe versionado conservado en cierre]':item).slice(0,2000); }
function audit(state:State,actor:Actor,action:string,entityType:string,entityId:string,before:unknown,after:unknown,reason?:string,locationId?:string):void { state.audit.unshift({id:uuid(),action,entityType,entityId,actorId:actor.id,actorName:actor.name,timestamp:timestamp(),reason,locationId,before:before===undefined?undefined:snapshot(before),after:after===undefined?undefined:snapshot(after)}); }
function actualDate(value:string):string { validateDate(value);if(value>todayBogota())throw new Error('La fecha efectiva de Caja no puede ser futura.');return value; }
function account(state:State,id:string):Account { const result=state.accounts.find(row=>row.id===id&&row.active&&row.kind!=='ledger');if(!result)throw new Error('La caja o cuenta no está activa.');return result; }
function session(state:State,id:string,open=true):CashSession { const result=getCashState(state).sessions.find(row=>row.id===id);if(!result)throw new Error('El turno no existe.');if(open&&result.status!=='open')throw new Error('El turno está cerrado; solicita una corrección autorizada.');return result; }
function monthEnd(month:string):string { if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('El mes debe tener formato AAAA-MM.');validateDate(`${month}-01`);return new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10); }
export function cashMonthBounds(month:string):{startDate:string;endDate:string} { return {startDate:`${month}-01`,endDate:monthEnd(month)}; }
export function isCashMonthClosed(state:State,date:string):boolean { return getCashState(state).monthClosures.some(row=>row.month>=date.slice(0,7)); }

/** Shared by every ledger write and approval; legacy snapshots without Caja remain compatible. */
export function assertCashPostingAllowed(state:State,input:{date:string;accountIds:string[];sessionIds?:string[]}):string[] {
  if(!isCashEnabled(state))return [];
  if(isCashMonthClosed(state,input.date))throw new Error('El período está cerrado. La corrección requiere autorización institucional e historial.');
  const result:string[]=[];
  const requested=input.sessionIds??[];
  if(new Set(requested).size!==requested.length)throw new Error('Los vínculos de turno están duplicados.');
  for(const id of requested){const row=session(state,id);if(row.date!==input.date||!input.accountIds.includes(row.accountId))throw new Error('El movimiento no corresponde a la fecha y caja del turno.');}
  for(const id of new Set(input.accountIds)){
    const target=state.accounts.find(row=>row.id===id);
    if(target?.kind!=='cash')continue;
    const explicit=requested.map(value=>session(state,value)).find(row=>row.accountId===id);
    const current=explicit??getCashState(state).sessions.find(row=>row.accountId===id&&row.status==='open'&&row.date===input.date);
    if(!current)throw new Error('Abre un turno de efectivo en la misma fecha antes de registrar o aprobar el movimiento.');
    if(current.status!=='open'||current.date!==input.date)throw new Error('El turno está cerrado o la fecha del movimiento no coincide.');
    result.push(current.id);
  }
  return result;
}

export function validateCashSupport(support?:Support,url?:string):void {
  if(support){
    text(support.name,'El nombre del comprobante');
    if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(support.type))throw new Error('Comprobante inválido: admite PDF, PNG, JPG o WebP.');
    if(!Number.isSafeInteger(support.size)||support.size<=0||support.size>5*1024*1024)throw new Error('El comprobante no puede estar vacío y debe pesar como máximo 5 MB.');
    if(support.dataUrl!==undefined){
      const prefix=`data:${support.type};base64,`;
      if(!support.dataUrl.startsWith(prefix))throw new Error('El contenido no coincide con el tipo del comprobante.');
      const payload=support.dataUrl.slice(prefix.length);
      if(payload.length>7*1024*1024||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload))throw new Error('El comprobante no contiene base64 válido.');
      const bytes=payload.length/4*3-(payload.endsWith('==')?2:payload.endsWith('=')?1:0);
      if(bytes!==support.size)throw new Error('El tamaño declarado del comprobante no coincide.');
    }
  }
  if(url!==undefined){if(typeof url!=='string'||url.length>2048)throw new Error('El enlace del comprobante es inválido.');let parsed:URL;try{parsed=new URL(url);}catch{throw new Error('El enlace del comprobante debe ser HTTPS.');}if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new Error('El enlace del comprobante debe ser HTTPS y no contener credenciales.');}
}

export function countCashDenominations(rows:CashCountDenomination[]):Money {
  if(!Array.isArray(rows)||rows.length!==CASH_DENOMINATIONS.length)throw new Error('El arqueo exige las 12 denominaciones completas; escribe cero explícitamente cuando no existan unidades.');
  const seen=new Set<string>();let total=0n;
  for(const row of rows){const value=money(row.value);const id=`${row.kind}:${value}`;if(!CASH_DENOMINATIONS.some(item=>item.kind===row.kind&&item.value===value)||seen.has(id))throw new Error('Denominación inválida o repetida; billetes y monedas de $1.000 son distintos.');if(!Number.isSafeInteger(row.quantity)||row.quantity<0||row.quantity>100000000)throw new Error('La cantidad debe ser un entero no negativo.');seen.add(id);total+=toCents(value)*BigInt(row.quantity);}
  return fromCents(total);
}

export function getCashSessionSummary(state:State,sessionId:string):CashSessionSummary {
  const row=session(state,sessionId,false);
  const transactions=state.transactions.filter(transaction=>transaction.cashSessionIds?.includes(sessionId));
  let incoming=0n;let outgoing=0n;
  for(const transaction of transactions.filter(item=>item.status==='posted'))for(const entry of transaction.entries.filter(item=>item.accountId===row.accountId)){incoming+=toCents(entry.debit);outgoing+=toCents(entry.credit);}
  const theoreticalBalance=fromCents(toCents(row.openingBalance)+incoming-outgoing);
  const latest=getCashState(state).counts.filter(item=>item.sessionId===sessionId)[0];
  return {session:row,openingBalance:row.openingBalance,inflows:fromCents(incoming),outflows:fromCents(outgoing),theoreticalBalance,countedAmount:latest?.countedAmount??null,difference:latest?sub(latest.countedAmount,theoreticalBalance):null,pendingTransactionIds:transactions.filter(item=>item.status==='pending').map(item=>item.id)};
}

function appendCount(next:State&{cash:CashState},input:{sessionId:string;denominations:CashCountDenomination[];notes?:string},actor:Actor,purpose:CashCount['purpose']):CashCount {
  const row=session(next,input.sessionId);auth(next,actor,row.locationId);
  const summary=getCashSessionSummary(next,row.id);const countedAmount=countCashDenominations(input.denominations);
  const record:CashCount={id:uuid(),sessionId:row.id,purpose,denominations:structuredClone(input.denominations).map(item=>({...item,value:money(item.value)})),countedAmount,theoreticalBalance:summary.theoreticalBalance,difference:sub(countedAmount,summary.theoreticalBalance),transactionIds:next.transactions.filter(item=>item.status==='posted'&&item.cashSessionIds?.includes(row.id)).map(item=>item.id).sort(),notes:input.notes?.trim()??'',actorId:actor.id,actorName:actor.name,createdAt:timestamp()};
  next.cash.counts.unshift(record);audit(next,actor,'Arqueo registrado','cash_count',record.id,undefined,record,record.notes,row.locationId);return record;
}

export function openCashSession(state:State,input:OpenCashSessionInput,actor:Actor):State {
  const target=account(state,input.accountId);auth(state,actor,target.locationId);actualDate(input.date);
  if(target.kind!=='cash')throw new Error('Los turnos y arqueos físicos corresponden únicamente a cuentas de efectivo.');
  if(isCashMonthClosed(state,input.date))throw new Error('El período está cerrado.');
  const cash=getCashState(state);if(cash.sessions.some(row=>row.accountId===target.id&&row.status==='open'))throw new Error('El turno previo sigue abierto; ciérralo antes de abrir el siguiente.');
  if(cash.sessions.some(row=>row.accountId===target.id&&row.date>input.date)||state.transactions.some(row=>row.status==='posted'&&row.date>input.date&&row.entries.some(entry=>entry.accountId===target.id)))throw new Error('La apertura no puede retroceder antes de movimientos o turnos ya registrados.');
  const next=clone(state);const row:CashSession={id:uuid(),accountId:target.id,locationId:target.locationId,date:input.date,status:'open',openingBalance:getAccountBalance(state,target.id,input.date),openedBy:actor.id,openedByName:actor.name,openedAt:timestamp(),notes:input.notes?.trim()??''};next.cash.sessions.unshift(row);
  if(input.openingCount!==undefined)row.openingCountId=appendCount(next,{sessionId:row.id,denominations:input.openingCount,notes:input.notes},actor,'opening').id;
  audit(next,actor,'Turno de efectivo abierto','cash_session',row.id,undefined,row,row.notes,row.locationId);return next;
}

export function recordCashCount(state:State,input:{sessionId:string;denominations:CashCountDenomination[];notes?:string},actor:Actor):State { const next=clone(state);appendCount(next,input,actor,'interim');return next; }

export function getCashTransactionMetadata(state:State,transactionId:string):CashMovementMetadata {
  const stored=getCashState(state).metadata.find(row=>row.transactionId===transactionId);if(stored)return stored;
  const transaction=state.transactions.find(row=>row.id===transactionId);if(!transaction)throw new Error('El movimiento no existe.');
  const expense=findCashCategory(transaction.category);const income=findCashIncomeCategory(transaction.category);const category=transaction.kind==='income'||transaction.kind==='loan'?income??expense:expense??income;
  const group=expense&&category===expense?CASH_CATALOG.find(row=>row.id===expense.groupId):undefined;
  const temporary=transaction.category.toLocaleUpperCase('es-CO')===CASH_TEMPORARY_CATEGORY.name;
  return {transactionId,sessionId:transaction.cashSessionIds?.[0],categoryId:temporary?CASH_TEMPORARY_CATEGORY.id:category?.id??'',categoryName:temporary?CASH_TEMPORARY_CATEGORY.name:category?.name??transaction.category,groupId:group?.id??(income?'entradas':''),groupName:group?.name??(income?'Entradas':''),notes:'',support:transaction.support,businessStatus:transaction.kind==='personal_expense'?'personal':'business',externalReferences:[],history:[]};
}
export function hasCashSupport(state:State,transaction:Transaction):boolean { const metadata=getCashState(state).metadata.find(row=>row.transactionId===transaction.id);return !!(transaction.support||metadata?.support||metadata?.supportUrl); }
function hasWithdrawalPhoto(state:State,transaction:Transaction):boolean { const metadata=getCashState(state).metadata.find(row=>row.transactionId===transaction.id);return [transaction.support,metadata?.support,...(metadata?.attachments??[]).map(row=>row.support)].some(item=>!!item&&item.size>0&&item.type.startsWith('image/')&&!!item.dataUrl?.startsWith(`data:${item.type};base64,`)); }
function references(rows:CashExternalReference[]|undefined):CashExternalReference[] { const result=rows??[];if(!Array.isArray(result)||result.length>20)throw new Error('Los vínculos externos son inválidos.');for(const row of result){if(!['sales','inventory','production','debts','calendar','assets','gateway'].includes(row.module))throw new Error('El módulo vinculado no existe.');text(row.id,'La referencia externa',1);if(row.label!==undefined)text(row.label,'El nombre del vínculo',1);}return structuredClone(result); }
function syncLegalizations(next:State&{cash:CashState},transaction:Transaction):void {
  const metadata=getCashTransactionMetadata(next,transaction.id);
  for(const reason of ['missing_support','temporary_category'] as const){const pending=reason==='missing_support'?!hasCashSupport(next,transaction):metadata.categoryId===CASH_TEMPORARY_CATEGORY.id;
    const existing=next.cash.legalizations.find(row=>row.transactionId===transaction.id&&row.reason===reason);
    if(pending&&!existing)next.cash.legalizations.unshift({id:uuid(),transactionId:transaction.id,status:'pending',reason,createdAt:timestamp()});
    if(!pending&&existing&&existing.status!=='documented'){existing.status='documented';existing.documentedAt=timestamp();}
  }
}

export function registerCashMovement(state:State,input:CashMovementInput,actor:Actor):State {
  const active=input.sessionId?session(state,input.sessionId):undefined;
  const accountId=active?.accountId??input.accountId;if(!accountId)throw new Error('Selecciona una caja o cuenta.');
  const target=account(state,accountId);const date=input.date??active?.date;if(!date)throw new Error('La fecha efectiva es obligatoria para cuentas bancarias y pasarelas.');actualDate(date);auth(state,actor,target.locationId);
  if(input.accountId&&input.accountId!==target.id)throw new Error('La cuenta no coincide con el turno.');if(input.locationId&&input.locationId!==target.locationId)throw new Error('La cuenta no pertenece a la sede seleccionada.');
  validateCashSupport(input.support,input.supportUrl);const refs=references(input.externalReferences);
  const outgoing=findCashCategory(input.categoryId)||suggestCashCategory(input.categoryId,input.notes??'');const incoming=findCashIncomeCategory(input.categoryId);
  const temporary=input.categoryId===CASH_TEMPORARY_CATEGORY.id||input.categoryId===CASH_TEMPORARY_CATEGORY.name;
  const inKind=input.kind==='income'||input.kind==='loan'||input.kind==='opening'||(input.kind==='adjustment'&&input.direction!=='out');
  const selected=input.kind==='transfer'?outgoing??incoming:inKind?incoming:outgoing;
  if(!selected&&!temporary)throw new Error('Selecciona una categoría concreta del catálogo aprobado.');
  if(temporary&&input.kind!=='advance')throw new Error('POR LEGALIZAR corresponde a un adelanto pendiente, no a una clasificación definitiva.');
  if(selected?.direction==='transfer'&&input.kind!=='transfer')throw new Error('Los retiros internos deben registrarse como traslado, nunca como ingreso o gasto.');
  if(input.kind==='transfer'&&selected?.direction!=='transfer')throw new Error('Selecciona una categoría de traslado interno.');
  const categoryName=temporary?CASH_TEMPORARY_CATEGORY.name:selected!.name;
  const categoryId=temporary?CASH_TEMPORARY_CATEGORY.id:selected!.id;
  if(['prestamos','inversiones'].includes(categoryId)){
    if(input.kind!=='loan')throw new Error('Préstamos e inversiones son financiación, no ingresos operativos.');
    const debt=state.debts.find(row=>row.id===input.debtId&&row.locationId===target.locationId);if(!debt)throw new Error('Crea o vincula primero la obligación con sus condiciones en Deudas.');
    if((categoryId==='inversiones')!==(debt.kind==='investment'))throw new Error('El tipo de obligación no coincide con la entrada de financiación.');
    const previous=getCashState(state).metadata.filter(row=>row.externalReferences.some(reference=>reference.module==='debts'&&reference.id===debt.id)).map(row=>state.transactions.find(transaction=>transaction.id===row.transactionId)).filter((row):row is Transaction=>!!row&&row.kind==='loan'&&row.status!=='rejected'&&!row.reversedBy&&row.idempotencyKey!==input.idempotencyKey).reduce((total,row)=>total+toCents(row.amount),0n);
    if(previous+toCents(money(input.amount))>toCents(debt.principal))throw new Error('El desembolso acumulado supera el capital de la obligación; no se puede duplicar el ingreso.');
    refs.push({module:'debts',id:debt.id,label:debt.creditor});
  }
  if(categoryId==='pago-deudas'&&!refs.some(row=>row.module==='assets'||row.module==='debts'))throw new Error('El cobro debe identificar el préstamo otorgado mediante una referencia de activo o deuda.');
  if(outgoing?.groupId==='financiacion-fondos'&&input.kind!=='debt_payment')throw new Error('Las cuotas de financiación deben separar capital e interés y vincular una obligación.');
  if(input.kind==='transfer'){const destination=account(state,input.destinationAccountId??'');if(destination.id===target.id)throw new Error('Selecciona un destino diferente.');if(destination.kind!=='cash'&&target.kind!=='cash')text(input.notes??'','La justificación del traslado',5);if(target.kind==='personal'||destination.kind==='personal')throw new Error('Los traslados personales excepcionales requieren autorización institucional de CREADOR o GERENTE.');}
  const sessionIds=assertCashPostingAllowed(state,{date,accountIds:[target.id,...(input.destinationAccountId?[input.destinationAccountId]:[])],sessionIds:[...(active?[active.id]:[]),...(input.destinationSessionId?[input.destinationSessionId]:[])]});
  const beforeIds=new Set(state.transactions.map(row=>row.id));let next:State;
  if(input.kind==='debt_payment'){
    if(!input.debtId||input.principal===undefined||input.interest===undefined)throw new Error('Vincula la obligación y distribuye el pago entre capital e interés.');
    next=recordDebtPayment(state,{debtId:input.debtId,accountId:target.id,date,amount:input.amount,principal:input.principal,interest:input.interest,insurance:input.insurance,commission:input.commission,lateFee:input.lateFee,idempotencyKey:input.idempotencyKey,support:input.support,supportUrl:input.supportUrl,appliedMonthlyRate:input.appliedMonthlyRate},actor);
  }else next=createTransaction(state,{kind:input.kind,date,description:input.description,party:input.party,category:categoryName,locationId:target.locationId,amount:input.amount,accountId:target.id,destinationAccountId:input.destinationAccountId,idempotencyKey:input.idempotencyKey,support:input.support,direction:input.direction,cashSessionIds:sessionIds},actor);
  if(next===state){const prior=state.transactions.find(row=>row.idempotencyKey===input.idempotencyKey)!;const metadata=getCashTransactionMetadata(state,prior.id);if(metadata.categoryId!==categoryId||metadata.notes!==(input.notes?.trim()??'')||metadata.supportUrl!==input.supportUrl||JSON.stringify(metadata.externalReferences)!==JSON.stringify(refs))throw new Error('La clave de idempotencia ya fue usada con otros datos de Caja.');return state;}
  const result=clone(next);const transaction=result.transactions.find(row=>!beforeIds.has(row.id))!;transaction.cashSessionIds=sessionIds;
  const group=outgoing?CASH_CATALOG.find(row=>row.id===outgoing.groupId):undefined;
  const metadata:CashMovementMetadata={transactionId:transaction.id,sessionId:active?.id,categoryId,categoryName,groupId:group?.id??(inKind?'entradas':'pendiente'),groupName:group?.name??(inKind?'Entradas':'Por legalizar'),notes:input.notes?.trim()??'',support:input.support,supportUrl:input.supportUrl,businessStatus:input.businessStatus??(input.kind==='personal_expense'?'personal':'business'),externalReferences:refs,history:[]};
  const existingMetadataIndex=result.cash.metadata.findIndex(row=>row.transactionId===transaction.id);const priorMetadata=result.cash.metadata[existingMetadataIndex];if(priorMetadata){metadata.history=priorMetadata.history;metadata.attachments=priorMetadata.attachments;}
  metadata.history.push({id:uuid(),action:'registered',actorId:actor.id,actorName:actor.name,createdAt:timestamp(),after:snapshot({...metadata,history:undefined}),notes:metadata.notes});if(existingMetadataIndex>=0)result.cash.metadata[existingMetadataIndex]=metadata;else result.cash.metadata.push(metadata);syncLegalizations(result,transaction);
  audit(result,actor,'Clasificación y origen de Caja registrados','cash_metadata',transaction.id,undefined,metadata,metadata.notes,target.locationId);return result;
}

export function attachCashSupport(state:State,input:CashSupportInput,actor:Actor):State {
  const original=state.transactions.find(row=>row.id===input.transactionId);if(!original)throw new Error('El movimiento no existe.');auth(state,actor,original.locationId);if(!input.support&&!input.supportUrl)throw new Error('Adjunta un comprobante o su enlace HTTPS.');validateCashSupport(input.support,input.supportUrl);
  const next=clone(state);const transaction=next.transactions.find(row=>row.id===original.id)!;let metadata=next.cash.metadata.find(row=>row.transactionId===original.id);if(!metadata){metadata=structuredClone(getCashTransactionMetadata(state,original.id));next.cash.metadata.push(metadata);}const before=structuredClone(metadata);
  if(input.support)metadata.support=structuredClone(input.support);if(input.supportUrl)metadata.supportUrl=input.supportUrl;
  metadata.attachments??=[];metadata.attachments.push({id:uuid(),support:input.support?structuredClone(input.support):undefined,supportUrl:input.supportUrl,actorId:actor.id,createdAt:timestamp()});
  metadata.history.push({id:uuid(),action:'support_attached',actorId:actor.id,actorName:actor.name,createdAt:timestamp(),before:snapshot(before),after:snapshot({support:metadata.support,supportUrl:metadata.supportUrl}),notes:input.notes?.trim()??'Comprobante anexado'});syncLegalizations(next,transaction);
  for(const alert of next.alerts.filter(row=>row.id===`support:${original.id}`||row.id===`cash-photo:${original.id}`&&hasWithdrawalPhoto(next,transaction))){if(alert.status!=='resolved'){alert.status='resolved';alert.resolution='Comprobante anexado con historial; importes y asiento conservados.';alert.history.push({date:timestamp(),actorName:actor.name,action:'Condición de soporte resuelta mediante anexo documentado'});}}
  audit(next,actor,'Comprobante anexado sin alterar importes','cash_metadata',original.id,before,metadata,input.notes??'Anexo posterior, incluso de períodos cerrados',original.locationId);return next;
}

export function requestCashAmendment(state:State,input:CashAmendmentInput,actor:Actor):State {
  text(input.reason,'La justificación',5);if(!['correction','exceptional_close','classification'].includes(input.kind))throw new Error('Tipo de solicitud inválido.');
  const original=input.transactionId?state.transactions.find(row=>row.id===input.transactionId):undefined;const shift=input.sessionId?session(state,input.sessionId,false):undefined;if(!original&&!shift)throw new Error('Vincula el movimiento o turno de la solicitud.');auth(state,actor,original?.locationId??shift!.locationId);
  if(input.kind==='exceptional_close'&&!shift)throw new Error('Selecciona el turno para solicitar un cierre excepcional.');if(input.kind!=='exceptional_close'&&!original)throw new Error('Selecciona el movimiento que requiere corrección.');
  if(input.proposedAmount!==undefined&&toCents(money(input.proposedAmount))<=0n)throw new Error('El valor propuesto debe ser positivo.');if(input.proposedCategoryId&&!findCashCategory(input.proposedCategoryId)&&!findCashIncomeCategory(input.proposedCategoryId))throw new Error('La clasificación propuesta no existe.');validateCashSupport(input.support,input.supportUrl);
  const next=clone(state);const request={...input,reason:input.reason.trim(),proposedAmount:input.proposedAmount===undefined?undefined:money(input.proposedAmount),id:uuid(),requestedBy:actor.id,requestedByName:actor.name,createdAt:timestamp(),status:'pending_institutional' as const,authorizationScope:'institutional_required' as const,before:snapshot(original??shift)};next.cash.amendmentRequests.unshift(request);
  if(original)for(const row of next.cash.legalizations.filter(row=>row.transactionId===original.id&&row.reason==='temporary_category')){row.status='pending_institutional';row.requestId=request.id;}
  audit(next,actor,'Autorización institucional solicitada; sin aplicación local','cash_amendment',request.id,original??shift,request,input.reason,original?.locationId??shift!.locationId);return next;
}

export function legalizeAdvance(state:State,input:{transactionId:string;categoryId:string;reason:string;support?:Support;supportUrl?:string},actor:Actor):State {
  const metadata=getCashTransactionMetadata(state,input.transactionId);if(metadata.categoryId!==CASH_TEMPORARY_CATEGORY.id)throw new Error('El movimiento no tiene una clasificación temporal pendiente.');
  if(!input.support&&!input.supportUrl&&!hasCashSupport(state,state.transactions.find(row=>row.id===input.transactionId)!))throw new Error('La legalización requiere factura o comprobante.');
  const documented=input.support||input.supportUrl?attachCashSupport(state,input,actor):state;
  return requestCashAmendment(documented,{transactionId:input.transactionId,kind:'classification',proposedCategoryId:input.categoryId,reason:input.reason,support:input.support,supportUrl:input.supportUrl},actor);
}

export function recordCashTransferReceipt(state:State,input:{transactionId:string;date:string;receivedAmount:Money;support?:Support;supportUrl?:string;notes?:string},actor:Actor):State {
  const transaction=state.transactions.find(row=>row.id===input.transactionId);if(!transaction||transaction.kind!=='transfer'||transaction.status!=='posted'||transaction.reversedBy)throw new Error('Selecciona un traslado registrado y vigente.');auth(state,actor,transaction.locationId);actualDate(input.date);if(input.date!==transaction.date)throw new Error('La recepción debe conservar la misma fecha efectiva del traslado; una diferencia de día requiere investigación.');
  validateCashSupport(input.support,input.supportUrl);if(!input.support&&!input.supportUrl)throw new Error('Adjunta el comprobante de recepción.');
  if(getCashState(state).transferReceipts.some(row=>row.transactionId===transaction.id))throw new Error('La recepción ya fue registrada; una corrección requiere autorización institucional.');
  const receivedAmount=money(input.receivedAmount);if(toCents(receivedAmount)<0n)throw new Error('El efectivo recibido no puede ser negativo.');const source=transaction.entries.find(row=>toCents(row.credit)>0n);const destination=transaction.entries.find(row=>toCents(row.debit)>0n);if(!source||!destination)throw new Error('El traslado no tiene ambos extremos.');
  const next=clone(state);const row={id:uuid(),transactionId:transaction.id,sourceAccountId:source.accountId,destinationAccountId:destination.accountId,expectedAmount:transaction.amount,receivedAmount,difference:sub(receivedAmount,transaction.amount),date:input.date,support:input.support,supportUrl:input.supportUrl,notes:input.notes?.trim()??'',actorId:actor.id,createdAt:timestamp(),status:receivedAmount===transaction.amount?'matched' as const:'difference' as const};next.cash.transferReceipts.unshift(row);
  audit(next,actor,'Recepción de traslado contrastada; sin ajuste de saldos','cash_transfer_receipt',row.id,undefined,row,row.notes,transaction.locationId);return next;
}

function transferTouches(transaction:Transaction,accountId:string):boolean { return transaction.entries.some(row=>row.accountId===accountId); }
function isWithdrawal(state:State,transaction:Transaction):boolean { return transaction.kind==='transfer'&&transaction.entries.some(entry=>toCents(entry.debit)>0n&&state.accounts.some(account=>account.id===entry.accountId&&account.kind==='cash')); }
function sessionBlockers(state:State,row:CashSession):string[] {
  const result:string[]=[];const summary=getCashSessionSummary(state,row.id);const cash=getCashState(state);
  if(summary.pendingTransactionIds.length)result.push('hay movimientos pendientes de aprobación');if(summary.countedAmount===null)result.push('falta el arqueo físico');else if(toCents(summary.difference!)!==0n)result.push(toCents(summary.difference!)<0n?'existe faltante de efectivo':'existe sobrante pendiente de legalizar');
  for(const transaction of state.transactions.filter(item=>item.status==='posted'&&item.cashSessionIds?.includes(row.id)&&!item.reversedBy&&!item.reversalOf)){
    if(transaction.kind!=='opening'&&!hasCashSupport(state,transaction))result.push('hay comprobantes obligatorios pendientes');if(getCashTransactionMetadata(state,transaction.id).categoryId===CASH_TEMPORARY_CATEGORY.id)result.push('hay adelantos por legalizar');
    if(isWithdrawal(state,transaction)&&(!cash.transferReceipts.some(receipt=>receipt.transactionId===transaction.id)||!hasWithdrawalPhoto(state,transaction)))result.push('falta recepción o fotografía del retiro');
  }
  if(cash.transferReceipts.some(receipt=>receipt.status==='difference'&&(receipt.sourceAccountId===row.accountId||receipt.destinationAccountId===row.accountId)))result.push('hay diferencia de traslado en una cuenta implicada');
  if(cash.amendmentRequests.some(request=>request.sessionId===row.id||request.transactionId&&state.transactions.some(transaction=>transaction.id===request.transactionId&&transaction.cashSessionIds?.includes(row.id))))result.push('hay autorizaciones institucionales pendientes');
  return [...new Set(result)];
}

export function closeCashSession(state:State,input:{sessionId:string;denominations?:CashCountDenomination[];notes?:string},actor:Actor):State {
  const original=session(state,input.sessionId);auth(state,actor,original.locationId);if(isCashMonthClosed(state,original.date))throw new Error('El período está cerrado.');const next=clone(state);
  const closing=input.denominations!==undefined?appendCount(next,{sessionId:original.id,denominations:input.denominations,notes:input.notes},actor,'closing'):next.cash.counts.find(row=>row.sessionId===original.id);
  const currentIds=next.transactions.filter(row=>row.status==='posted'&&row.cashSessionIds?.includes(original.id)).map(row=>row.id).sort();
  if(closing&&JSON.stringify([...closing.transactionIds].sort())!==JSON.stringify(currentIds))throw new Error('El arqueo quedó obsoleto después de nuevos movimientos; registra un conteo físico actualizado antes de cerrar.');
  const blockers=sessionBlockers(next,original);if(blockers.length)throw new Error(`No se puede cerrar el turno: ${blockers.join('; ')}. No se crea ningún ajuste automático.`);
  const row=next.cash.sessions.find(item=>item.id===original.id)!;row.status='closed';row.closingCountId=closing!.id;row.closingBalance=getCashSessionSummary(next,row.id).theoreticalBalance;row.closedBy=actor.id;row.closedAt=timestamp();audit(next,actor,'Turno de efectivo cerrado en espacio local','cash_session',row.id,original,row,input.notes,row.locationId);return next;
}

export function getCashAlerts(state:State,today=todayBogota()):Alert[] {
  validateDate(today);const cash=getCashState(state);const results:Alert[]=[];const push=(id:string,type:string,title:string,description:string,severity:Alert['severity'],responsible:string,evidence:string,dueDate=today)=>results.push({id,type,title,description,severity,responsible,evidence,dueDate,status:'open',comments:[],history:[]});
  for(const row of cash.sessions){const summary=getCashSessionSummary(state,row.id);if(summary.difference!==null&&toCents(summary.difference)!==0n)push(`cash-count:${row.id}`,'cash_count_difference',toCents(summary.difference)<0n?'Faltante crítico de efectivo':'Sobrante por legalizar',state.accounts.find(account=>account.id===row.accountId)?.name??'Caja',toCents(summary.difference)<0n?'critical':'warning',row.openedByName,`Contado ${summary.countedAmount}; teórico ${summary.theoreticalBalance}; diferencia ${summary.difference}.`,row.date);if(row.status==='open'&&row.date<today)push(`cash-open:${row.id}`,'cash_unclosed_session','Turno previo sin cierre',row.date,'warning',row.openedByName,'No se puede abrir el siguiente turno.',row.date);}
  for(const transaction of state.transactions.filter(row=>row.status!=='rejected'&&!row.reversedBy&&!row.reversalOf&&row.kind!=='opening')){
    if(!hasCashSupport(state,transaction))push(`support:${transaction.id}`,'missing_support','Movimiento sin soporte',transaction.description,'warning',state.members.find(row=>row.id===transaction.requestedBy)?.name??'Tesorería',transaction.reference,transaction.date);
    const metadata=getCashTransactionMetadata(state,transaction.id);if(metadata.categoryId===CASH_TEMPORARY_CATEGORY.id)push(`cash-legalization:${transaction.id}`,'cash_legalization','Adelanto POR LEGALIZAR',transaction.description,'warning','Tesorería',`${transaction.reference}; ${transaction.amount}; la clasificación definitiva requiere autorización.`,transaction.date);
    if(transaction.status==='posted'&&isWithdrawal(state,transaction)){
      if(!hasWithdrawalPhoto(state,transaction))push(`cash-photo:${transaction.id}`,'cash_withdrawal_photo','Retiro sin fotografía verificable',transaction.description,'warning','Tesorería','Un enlace por sí solo no verifica que el comprobante sea una fotografía.',transaction.date);
      if(!cash.transferReceipts.some(row=>row.transactionId===transaction.id))push(`cash-receipt:${transaction.id}`,'cash_transfer_unreceived','Recepción de efectivo pendiente',transaction.description,'warning','Tesorería',transaction.reference,transaction.date);
    }
  }
  for(const row of cash.transferReceipts.filter(item=>item.status==='difference'))push(`cash-transfer-difference:${row.id}`,'cash_transfer_difference','Diferencia de traslado por investigar',`Se bloquea el cierre de las dos cuentas implicadas.`,toCents(row.difference)<0n?'critical':'warning','Tesorería',`Retirado ${row.expectedAmount}; recibido ${row.receivedAmount}; diferencia ${row.difference}. Sin ajuste contable.`,row.date);
  for(const request of cash.amendmentRequests)push(`cash-authorization:${request.id}`,'cash_authorization_pending','Autorización institucional pendiente',request.reason,'warning','CREADOR / GERENTE','La solicitud no cambia movimientos ni autoriza cierres excepcionales.',request.createdAt.slice(0,10));
  for(const statement of cash.statementImports){for(const line of statement.lines.filter(row=>row.status==='unmatched'&&!(row.direction==='in'&&['interest','refund','reversal'].includes(row.nature))))push(`cash-statement:${statement.id}:${line.id}`,'cash_statement_unmatched',line.direction==='out'?'Cargo de extracto sin conciliar':'Abono de extracto sin conciliar',line.description,'warning','Responsable de la cuenta',`${line.date}; ${line.amount}; ${statement.source}`,line.date);if(statement.status==='open')push(`cash-statement-review:${statement.id}`,'cash_statement_review','Conciliación pendiente de revisión',statement.source,'warning','Responsable de la cuenta',`${statement.startDate} a ${statement.endDate}`);}
  const saved=new Map(state.alerts.map(row=>[row.id,row]));return results.map(row=>{
    const separator=row.id.indexOf(':');const prefix=row.id.slice(0,separator);const entityId=row.id.slice(separator+1);let locationId:string|undefined;
    if(['support','cash-legalization','cash-photo','cash-receipt'].includes(prefix))locationId=state.transactions.find(item=>item.id===entityId)?.locationId;
    else if(['cash-count','cash-open'].includes(prefix))locationId=cash.sessions.find(item=>item.id===entityId)?.locationId;
    else if(prefix==='cash-transfer-difference'){const receipt=cash.transferReceipts.find(item=>item.id===entityId);locationId=state.accounts.find(item=>item.id===receipt?.sourceAccountId)?.locationId;}
    else if(prefix==='cash-authorization'){const request=cash.amendmentRequests.find(item=>item.id===entityId);locationId=state.transactions.find(item=>item.id===request?.transactionId)?.locationId??cash.sessions.find(item=>item.id===request?.sessionId)?.locationId;}
    else if(prefix==='cash-statement'||prefix==='cash-statement-review'){const statement=cash.statementImports.find(item=>entityId===item.id||entityId.startsWith(`${item.id}:`));locationId=state.accounts.find(item=>item.id===statement?.accountId)?.locationId;}
    const prior=saved.get(row.id);return {...row,locationId,...(prior?{comments:prior.comments,history:prior.history,status:prior.status==='resolved'?'open' as const:prior.status}:{})};
  }).sort((a,b)=>(a.severity==='critical'?0:1)-(b.severity==='critical'?0:1)||b.dueDate.localeCompare(a.dueDate));
}

function previousDay(date:string):string { return new Date(Date.parse(`${date}T12:00:00Z`)-86400000).toISOString().slice(0,10); }
function reportNature(state:State,transaction:Transaction,metadata:CashMovementMetadata):CashReportMovement['nature'] {
  const original=transaction.reversalOf?state.transactions.find(row=>row.id===transaction.reversalOf)??transaction:transaction;
  if(metadata.businessStatus!=='business'||original.kind==='personal_expense')return 'excluded';if(original.kind==='transfer')return 'internal';if(original.kind==='opening')return 'opening';if(original.kind==='adjustment')return 'adjustment';if(original.kind==='loan'||original.kind==='debt_payment'||metadata.groupId==='financiacion-fondos'||['prestamos','inversiones'].includes(metadata.categoryId))return 'financing';if(original.kind==='advance'||metadata.groupId==='otros-activos'||metadata.categoryId==='nuevas-adquisiciones'||metadata.categoryId==='venta-activos'||metadata.categoryId==='pago-deudas')return 'asset';return 'operating';
}

export function getCashReport(state:State,input:{startDate:string;endDate:string;locationId?:string}):CashPeriodReport {
  validateDate(input.startDate);validateDate(input.endDate);if(input.startDate>input.endDate)throw new Error('La fecha inicial no puede ser posterior al corte.');if(input.locationId&&!state.locations.some(row=>row.id===input.locationId))throw new Error('La sede no existe.');
  const accounts=state.accounts.filter(row=>row.kind!=='ledger'&&(!input.locationId||row.locationId===input.locationId));const accountIds=new Set(accounts.map(row=>row.id));
  const transactions=state.transactions.filter(row=>row.status==='posted'&&row.date>=input.startDate&&row.date<=input.endDate&&row.entries.some(entry=>accountIds.has(entry.accountId)));
  const excludedIds=new Set(state.transactions.filter(row=>{const source=row.reversalOf?state.transactions.find(item=>item.id===row.reversalOf)??row:row;return reportNature(state,row,getCashTransactionMetadata(state,source.id))==='excluded';}).map(row=>row.id));
  const report:CashPeriodReport={startDate:input.startDate,endDate:input.endDate,generatedAt:timestamp(),version:1+getCashState(state).monthClosures.filter(row=>row.month>=input.startDate.slice(0,7)&&row.month<=input.endDate.slice(0,7)).length,scope:'local',openingAvailable:'0.00',closingAvailable:'0.00',externalInflows:'0.00',transferInflows:'0.00',operatingExpenses:'0.00',financingInflows:'0.00',financingOutflows:'0.00',otherAssetInflows:'0.00',otherAssetOutflows:'0.00',internalTransfers:'0.00',excludedInflows:'0.00',excludedOutflows:'0.00',accounts:[],categories:[],movements:[],alerts:getCashAlerts(state,input.endDate).filter(row=>row.dueDate<=input.endDate&&(!input.locationId||row.locationId===input.locationId)&&![...excludedIds].some(id=>row.id.includes(id)))};
  for(const target of accounts){let incoming=0n;let outgoing=0n;for(const transaction of transactions)for(const entry of transaction.entries.filter(row=>row.accountId===target.id)){incoming+=toCents(entry.debit);outgoing+=toCents(entry.credit);}const opening=getAccountBalance(state,target.id,previousDay(input.startDate));const closing=fromCents(toCents(opening)+incoming-outgoing);report.accounts.push({accountId:target.id,name:target.name,kind:target.kind,opening,inflows:fromCents(incoming),outflows:fromCents(outgoing),closing});}
  report.openingAvailable=add(...report.accounts.map(row=>row.opening));report.closingAvailable=add(...report.accounts.map(row=>row.closing));
  for(const transaction of transactions){
    const source=transaction.reversalOf?state.transactions.find(row=>row.id===transaction.reversalOf)??transaction:transaction;const metadata=getCashTransactionMetadata(state,source.id);const nature=reportNature(state,transaction,metadata);
    let incoming=0n;let outgoing=0n;for(const entry of transaction.entries.filter(row=>accountIds.has(row.accountId))){incoming+=toCents(entry.debit);outgoing+=toCents(entry.credit);}const amount=money(transaction.amount);const sign=transaction.reversalOf?-1n:1n;const incomingSource=source.entries.filter(row=>accountIds.has(row.accountId)).reduce((sum,row)=>sum+toCents(row.debit)-toCents(row.credit),0n)>0n;
    if(nature==='excluded'){report.excludedInflows=add(report.excludedInflows,fromCents(incoming));report.excludedOutflows=add(report.excludedOutflows,fromCents(outgoing));continue;}
    if(nature==='internal'){report.internalTransfers=add(report.internalTransfers,fromCents(toCents(amount)*sign));report.transferInflows=add(report.transferInflows,fromCents(incoming*sign));}
    else if(nature==='financing'){const key=incomingSource?'financingInflows':'financingOutflows';report[key]=add(report[key],fromCents(toCents(amount)*sign));}
    else if(nature==='asset'){const key=incomingSource?'otherAssetInflows':'otherAssetOutflows';report[key]=add(report[key],fromCents(toCents(amount)*sign));}
    else if(nature==='operating'){if(incomingSource)report.externalInflows=add(report.externalInflows,fromCents(toCents(amount)*sign));else report.operatingExpenses=add(report.operatingExpenses,fromCents(toCents(amount)*sign));}
    const payment=state.debtPayments.find(row=>row.transactionId===source.id);
    report.movements.push({transactionId:transaction.id,reference:transaction.reference,date:transaction.date,description:transaction.description,party:transaction.party,categoryId:metadata.categoryId,categoryName:metadata.categoryName,groupId:metadata.groupId,groupName:metadata.groupName,amount,direction:nature==='internal'?'transfer':incoming>outgoing?'in':'out',nature,accountIds:transaction.entries.filter(row=>accountIds.has(row.accountId)).map(row=>row.accountId),supportMissing:!hasCashSupport(state,source),reversalOf:transaction.reversalOf,principal:payment?.principal,interest:payment?.interest,insurance:payment?.insurance,commission:payment?.commission,lateFee:payment?.lateFee});
    if(!incomingSource&&nature!=='internal'&&nature!=='opening'&&nature!=='adjustment'){let category=report.categories.find(row=>row.categoryId===metadata.categoryId);if(!category){category={groupId:metadata.groupId,groupName:metadata.groupName,categoryId:metadata.categoryId,categoryName:metadata.categoryName,amount:'0.00',transactionIds:[]};report.categories.push(category);}category.amount=add(category.amount,fromCents(toCents(amount)*sign));category.transactionIds.push(transaction.id);}
  }
  report.movements.sort((a,b)=>a.date.localeCompare(b.date)||a.reference.localeCompare(b.reference));return report;
}

export function cashMonthChecklist(state:State,month:string):CashMonthChecklist {
  const bounds=cashMonthBounds(month);const cash=getCashState(state);const report=getCashReport(state,bounds);const items:CashMonthChecklist['items']=[];const push=(id:string,label:string,entityId?:string,amount?:Money)=>items.push({id,label,entityId,amount,blocking:true});
  if(bounds.endDate>todayBogota())push('month-not-ended','El mes calendario todavía no ha terminado.');if(cash.monthClosures.some(row=>row.month===month))push('month-closed','El mes ya está cerrado; conserva su versión.');
  for(const row of cash.sessions.filter(row=>row.date<=bounds.endDate&&row.status==='open'))push(`open:${row.id}`,'Turno de efectivo sin cierre.',row.id);
  const rows=state.transactions.filter(row=>row.date<=bounds.endDate&&row.status!=='rejected'&&!row.reversedBy&&!row.reversalOf);
  for(const row of rows){if(row.status==='pending')push(`pending:${row.id}`,'Movimiento pendiente de aprobación.',row.id);if(row.status!=='posted'||row.kind==='opening')continue;const metadata=getCashTransactionMetadata(state,row.id);if(!hasCashSupport(state,row))push(`support:${row.id}`,'Comprobante pendiente.',row.id);if(!metadata.categoryId||metadata.categoryId===CASH_TEMPORARY_CATEGORY.id)push(`category:${row.id}`,'Clasificación o legalización pendiente.',row.id);if(isWithdrawal(state,row)&&(!hasWithdrawalPhoto(state,row)||!cash.transferReceipts.some(receipt=>receipt.transactionId===row.id&&receipt.status==='matched')))push(`receipt:${row.id}`,'Retiro pendiente de fotografía o recepción contrastada.',row.id);}
  for(const row of cash.transferReceipts.filter(row=>row.date<=bounds.endDate&&row.status==='difference'))push(`transfer:${row.id}`,'Diferencia de traslado: cierre de ambas cuentas bloqueado.',row.id,row.difference);
  for(const row of cash.amendmentRequests.filter(row=>row.createdAt.slice(0,10)<=todayBogota()))push(`request:${row.id}`,'Autorización institucional pendiente; no aplicada.',row.id);
  for(const target of report.accounts){if(toCents(target.closing)<0n)push(`negative:${target.accountId}`,'Faltante: saldo de cuenta negativo.',target.accountId,target.closing);const active=state.transactions.some(row=>row.status==='posted'&&row.date<=bounds.endDate&&row.entries.some(entry=>entry.accountId===target.accountId));if(!active)continue;
    if(target.kind==='cash'){const latest=cash.sessions.filter(row=>row.accountId===target.accountId&&row.date<=bounds.endDate).sort((a,b)=>b.date.localeCompare(a.date)||b.openedAt.localeCompare(a.openedAt))[0];if(!latest||latest.status!=='closed'||latest.closingBalance!==target.closing)push(`count:${target.accountId}`,'Arqueo de efectivo final pendiente o diferente del libro.',target.accountId);}
    else{const latest=state.reconciliations.filter(row=>row.accountId===target.accountId&&row.date===bounds.endDate).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];if(!latest||latest.status!=='matched'||latest.bookAmount!==target.closing||latest.bankAmount!==target.closing)push(`reconciliation:${target.accountId}`,'Saldo al último día del mes sin conciliación exacta.',target.accountId);}
  }
  for(const statement of cash.statementImports.filter(row=>row.startDate<=bounds.endDate&&row.endDate>=bounds.startDate&&row.status!=='approved'))push(`statement:${statement.id}`,'Extracto o pasarela pendiente de revisión del responsable.',statement.id);
  const signatures=new Map<string,string>();for(const row of rows.filter(row=>row.date>=bounds.startDate&&row.status==='posted'&&row.kind!=='opening')){const key=`${row.date}|${row.kind}|${row.amount}|${row.party.trim().toLocaleLowerCase('es-CO')}|${row.entries.map(entry=>entry.accountId).sort().join(',')}`;const previous=signatures.get(key);if(previous)push(`duplicate:${row.id}`,'Posible movimiento duplicado por investigar.',row.id);else signatures.set(key,row.id);}
  return {month,canClose:items.length===0,items,report};
}

export function closeCashMonth(state:State,input:{month:string;notes?:string},actor:Actor):State {
  auth(state,actor,undefined,['owner','admin']);const checklist=cashMonthChecklist(state,input.month);if(!checklist.canClose)throw new Error(`No se puede cerrar el mes: ${checklist.items.map(row=>row.label).join(' ')}`);const next=clone(state);const row={id:uuid(),month:input.month,version:1,status:'closed' as const,scope:'local' as const,closedBy:actor.id,closedByName:actor.name,closedAt:timestamp(),notes:input.notes?.trim()??'',report:structuredClone(checklist.report),transactionIds:state.transactions.filter(transaction=>transaction.status==='posted'&&transaction.date.startsWith(input.month)).map(transaction=>transaction.id).sort()};next.cash.monthClosures.unshift(row);audit(next,actor,'Mes cerrado en espacio local; conexión institucional pendiente','cash_month_closure',row.id,undefined,row,input.notes);return next;
}
