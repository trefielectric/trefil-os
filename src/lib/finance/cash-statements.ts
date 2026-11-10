import { validateDate } from './amortization';
import { todayBogota } from './engine';
import { fromCents, money, toCents } from './money';
import { getCashState, registerCashMovement } from './cash';
import type { Actor, State } from './types';
import type { CashStatementImport, CashStatementLine } from './cash-types';

export type StatementRow = Pick<CashStatementLine, 'externalId'|'date'|'description'|'direction'|'amount'|'nature'>;
const natures = ['ordinary','interest','refund','reversal','fee','shipping'] as const;
const text=(value:string,max=500)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('El extracto contiene campos vacíos o demasiado largos.');return value.trim();};
const normal=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

/** RFC4180-style parsing; imported cells are always data and never formulas. */
export function parseCashStatementCSV(raw:string):StatementRow[] {
  if(raw.length>2*1024*1024)throw new Error('El archivo debe pesar como máximo 2 MB.');
  const content=raw.replace(/^\uFEFF/,'');
  const first=content.split(/\r?\n/,1)[0]??'';
  const delimiter=first.includes(';')?';':first.includes('\t')?'\t':',';
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
  for(let i=0;i<content.length;i++){
    const c=content[i];
    if(closed&&c!==delimiter&&c!=='\n'&&c!=='\r'){if(c===' ')continue;throw new Error('Hay texto después de una comilla de cierre.');}
    if(c==='"'){if(quoted&&content[i+1]==='"'){cell+='"';i++;}else if(quoted){quoted=false;closed=true;}else if(cell===''){quoted=true;}else throw new Error('Comillas inválidas en el CSV.');}
    else if(c===delimiter&&!quoted){row.push(cell);cell='';closed=false;}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&content[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';closed=false;}
    else cell+=c;
    if(rows.length>3001)throw new Error('Importa como máximo 3.000 líneas por archivo.');
  }
  if(quoted)throw new Error('Hay comillas sin cerrar en el CSV.');
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  if(rows.length>3001)throw new Error('Importa como máximo 3.000 líneas por archivo.');
  if(rows.length<2)throw new Error('El archivo debe incluir encabezados y al menos una línea.');
  const header=rows.shift()!.map(normal);
  const columns=['id','fecha','descripcion','direccion','valor','naturaleza'];
  if(columns.some(column=>header.filter(x=>x===column).length!==1)||header.length!==columns.length)throw new Error('Usa las seis columnas de la plantilla: id;fecha;descripcion;direccion;valor;naturaleza.');
  const seen=new Set<string>();
  return rows.map((cells,index)=>{
    if(cells.length!==header.length)throw new Error(`La fila ${index+2} no tiene seis columnas.`);
    const get=(key:string)=>cells[header.indexOf(key)].trim();
    const externalId=text(get('id'),200);if(seen.has(externalId))throw new Error(`Identificador repetido en la fila ${index+2}.`);seen.add(externalId);
    const date=get('fecha');validateDate(date);
    const direction=normal(get('direccion'));if(!['in','out','entrada','salida'].includes(direction))throw new Error(`Dirección inválida en la fila ${index+2}. Usa entrada o salida.`);
    const amount=money(get('valor').replace(',','.'));if(toCents(amount)<=0n)throw new Error(`El valor de la fila ${index+2} debe ser positivo y sin separadores de miles.`);
    const nature=normal(get('naturaleza'));
    const names:Record<string,CashStatementLine['nature']>={ordinary:'ordinary',ordinario:'ordinary',interest:'interest',interes:'interest',refund:'refund',reintegro:'refund',reversal:'reversal',reverso:'reversal',fee:'fee',comision:'fee',shipping:'shipping',envio:'shipping'};
    if(!names[nature])throw new Error(`Naturaleza inválida en la fila ${index+2}.`);
    return {externalId,date,description:text(get('descripcion')),direction:['in','entrada'].includes(direction)?'in':'out',amount,nature:names[nature]};
  });
}

function authorize(state:State,accountId:string,actor:Actor){
  const account=state.accounts.find(x=>x.id===accountId&&x.active&&x.kind!=='ledger');
  const member=state.members.find(x=>x.id===actor.id&&x.active&&x.role===actor.role);
  if(!account||!member||member.name!==actor.name||!['owner','admin','treasury','accounting'].includes(member.role)||!member.locationIds.includes(account.locationId))throw new Error('No tienes permiso para conciliar esta cuenta.');
  return account;
}
function addAudit(state:State,actor:Actor,record:CashStatementImport,action:string,reason:string){state.audit.unshift({id:crypto.randomUUID(),action,entityType:'cash_statement',entityId:record.id,actorId:actor.id,actorName:actor.name,timestamp:new Date().toISOString(),locationId:state.accounts.find(x=>x.id===record.accountId)!.locationId,reason});}
function validateRow(row:StatementRow,start:string,end:string){
  text(row.externalId,200);text(row.description);validateDate(row.date);
  if(row.date<start||row.date>end||row.date>todayBogota())throw new Error('Las fechas del extracto deben estar dentro del período e incluir solo operaciones realizadas.');
  if(!['in','out'].includes(row.direction)||!natures.includes(row.nature)||money(row.amount)!==row.amount||toCents(row.amount)<=0n)throw new Error('El extracto contiene un importe, dirección o naturaleza inválidos.');
}
export function importCashStatement(state:State,input:{accountId:string;startDate:string;endDate:string;source:string;sourceKey:string;lines:StatementRow[]},actor:Actor):State{
  authorize(state,input.accountId,actor);validateDate(input.startDate);validateDate(input.endDate);
  if(input.startDate>input.endDate||input.endDate>todayBogota())throw new Error('Selecciona un período válido, sin fechas futuras.');
  const source=text(input.source,120),sourceKey=text(input.sourceKey,200);
  if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>3000)throw new Error('El extracto debe contener de 1 a 3.000 líneas.');
  const existing=getCashState(state).statementImports;
  const seen=new Set<string>();
  const lines=input.lines.map(line=>({...line,externalId:text(line.externalId,200),description:text(line.description)})).filter(line=>{
    validateRow(line,input.startDate,input.endDate);if(seen.has(line.externalId))throw new Error('El archivo repite un identificador.');seen.add(line.externalId);
    const previous=existing.filter(x=>x.accountId===input.accountId).flatMap(x=>x.lines).find(x=>x.externalId===line.externalId);
    if(previous){if(['date','amount','direction','nature','description'].some(key=>previous[key as keyof StatementRow]!==line[key as keyof StatementRow]))throw new Error('Un identificador importado ya existe con otros datos. Revisa el archivo original.');return false;}return true;
  });
  if(!lines.length)return state;
  if(existing.some(x=>x.accountId===input.accountId&&x.sourceKey===sourceKey))throw new Error('Este archivo ya se importó. Revisa sus líneas pendientes.');
  const next=structuredClone(state);next.cash=structuredClone(getCashState(next));
  const record:CashStatementImport={id:crypto.randomUUID(),accountId:input.accountId,startDate:input.startDate,endDate:input.endDate,source,sourceKey,lines:lines.map(line=>({...line,id:crypto.randomUUID(),status:'unmatched'})),importedBy:actor.id,importedAt:new Date().toISOString(),status:'open'};
  next.cash.statementImports.unshift(record);addAudit(next,actor,record,'Extracto importado',`${lines.length} líneas para conciliar. La importación no modifica saldos.`);return next;
}
export function statementCandidates(state:State,statement:CashStatementImport,line:CashStatementLine){
  const linked=new Set(getCashState(state).statementImports.filter(x=>x.accountId===statement.accountId).flatMap(x=>x.lines).filter(x=>x.id!==line.id&&x.transactionId).map(x=>x.transactionId));
  return state.transactions.filter(tx=>tx.status==='posted'&&tx.date===line.date&&!linked.has(tx.id)&&tx.entries.some(entry=>entry.accountId===statement.accountId&&fromCents(toCents(entry.debit)-toCents(entry.credit))===(line.direction==='in'?line.amount:fromCents(-toCents(line.amount)))));
}
export function matchCashStatementLine(state:State,statementId:string,lineId:string,transactionId:string,actor:Actor):State{
  const statement=getCashState(state).statementImports.find(x=>x.id===statementId);if(!statement)throw new Error('El extracto no existe.');authorize(state,statement.accountId,actor);
  const line=statement.lines.find(x=>x.id===lineId);if(!line||statement.status!=='open'||line.status!=='unmatched')throw new Error('La línea ya fue conciliada o el extracto está cerrado.');
  if(!statementCandidates(state,statement,line).some(tx=>tx.id===transactionId))throw new Error('El movimiento debe coincidir en cuenta, fecha, dirección e importe y no estar vinculado a otra línea.');
  const next=structuredClone(state);next.cash=structuredClone(getCashState(next));const record=next.cash.statementImports.find(x=>x.id===statementId)!;const target=record.lines.find(x=>x.id===lineId)!;target.transactionId=transactionId;target.status='matched';addAudit(next,actor,record,'Línea conciliada',`${line.externalId} vinculada al movimiento. No se creó otro ingreso o salida.`);return next;
}
export function registerStatementCharge(state:State,statementId:string,lineId:string,input:{party:string;supportUrl?:string},actor:Actor):State{
  const statement=getCashState(state).statementImports.find(x=>x.id===statementId);const line=statement?.lines.find(x=>x.id===lineId);
  if(!statement||!line||statement.status!=='open'||line.status!=='unmatched'||line.direction!=='out'||!['fee','shipping'].includes(line.nature))throw new Error('Solo se pueden incorporar comisiones o envíos de salida pendientes.');
  const account=authorize(state,statement.accountId,actor);if(account.kind==='cash')throw new Error('Registra los movimientos de efectivo desde un turno de Caja.');
  if(statementCandidates(state,statement,line).length)throw new Error('Hay un movimiento coincidente. Vincúlalo para evitar duplicar el cargo.');
  const next=registerCashMovement(state,{accountId:account.id,locationId:account.locationId,date:line.date,kind:'expense',categoryId:line.nature==='shipping'?'transporte':'gastos-bancarios',amount:line.amount,description:line.description,party:text(input.party,120),supportUrl:input.supportUrl,idempotencyKey:`statement:${statement.id}:${line.id}`},actor);
  const tx=next.transactions.find(x=>x.idempotencyKey===`statement:${statement.id}:${line.id}`);if(!tx)throw new Error('No se pudo registrar el cargo.');
  if(tx.status==='pending')return next;
  return matchCashStatementLine(next,statementId,lineId,tx.id,actor);
}
export function approveCashStatement(state:State,statementId:string,actor:Actor):State{
  const statement=getCashState(state).statementImports.find(x=>x.id===statementId);if(!statement)throw new Error('El extracto no existe.');const account=authorize(state,statement.accountId,actor);
  if(!['owner','admin'].includes(actor.role)&&account.custodian.trim()!==actor.name.trim())throw new Error('La revisión corresponde al responsable de la cuenta, Creador o Gerente.');
  if(statement.status!=='open'||statement.lines.some(x=>x.status!=='matched'))throw new Error('Vincula todas las líneas antes de cerrar la revisión.');
  const next=structuredClone(state);next.cash=structuredClone(getCashState(next));const record=next.cash.statementImports.find(x=>x.id===statementId)!;record.status='approved';record.approvedBy=actor.id;record.approvedAt=new Date().toISOString();addAudit(next,actor,record,'Extracto revisado en el espacio local','Todas las líneas están vinculadas a operaciones del libro.');return next;
}
