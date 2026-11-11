import { getDebtCalendar } from '@/lib/debts/engine';
import { add, fromCents, toCents, buildAmortization, getAccountBalance, getUpcomingObligations, todayBogota, getCashReport } from '@/lib/finance';
import type { State, Transaction, TransactionKind, Money, Actor, Debt, AmortizationRow } from '@/lib/finance';

export type View = 'inventory'|'overview'|'transactions'|'accounts'|'debts'|'reconciliations'|'approvals'|'alerts'|'audit'|'settings';
export type Mutation = (operation:(current:State)=>State,message:string)=>boolean;
export interface ViewProps { state:State; actor:Actor; location:string; mutate:Mutation; notify:(message:string)=>void }
export const DEMO_DATE='2026-11-10';
export const WORKSPACE_DATE=todayBogota();
export const kindLabels:Record<TransactionKind,string>={income:'Ingreso',expense:'Gasto',transfer:'Traslado',opening:'Saldo inicial',advance:'Anticipo',reimbursement:'Reembolso',salary:'Salario',loan:'Préstamo recibido',adjustment:'Ajuste',reversal:'Reverso',debt_payment:'Pago de deuda',personal_expense:'Gasto personal'};
export const roleLabels:Record<Actor['role'],string>={owner:'Creador',admin:'Gerente',treasury:'Tesorería',accounting:'Contabilidad',inventory:'Inventarios',production:'Producción',sales:'Ventas',hr:'Recursos humanos',employee:'Empleado',auditor:'Auditor de solo lectura'};
export const accountKindLabels={bank:'Banco',cash:'Efectivo',wallet:'Billetera digital',personal:'Personal autorizada',ledger:'Contable'};
export const methods={fixed_payment:'Cuota fija',fixed_principal:'Capital fijo',interest_only:'Interés y capital al final'};
export function dateLabel(value:string,short=false) {return new Intl.DateTimeFormat('es-CO',{day:'numeric',month:short?'short':'long',timeZone:'America/Bogota'}).format(new Date(`${value}T12:00:00Z`));}
export function timestamp(value:string) {return new Intl.DateTimeFormat('es-CO',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Bogota'}).format(new Date(value));}
export function canWrite(actor:Actor) {return ['owner','admin','treasury','accounting'].includes(actor.role);}
export function canApprove(actor:Actor) {return ['owner','admin'].includes(actor.role);}
export function visibleAccounts(state:State,location='all') {return state.accounts.filter(a=>a.kind!=='ledger'&&(location==='all'||a.locationId===location));}
export function cashDelta(state:State,tx:Transaction):bigint {const ids=new Set(visibleAccounts(state).map(a=>a.id));return tx.entries.reduce((s,e)=>s+(ids.has(e.accountId)?toCents(e.debit)-toCents(e.credit):0n),0n);}
export function periodTotals(state:State,location:string,period:string,cutoff=DEMO_DATE) {
  if(!/^\d{4}-\d{2}$/.test(period)||Number(period.slice(5))<1||Number(period.slice(5))>12)throw new Error('Período inválido.');
  const monthEnd=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).toISOString().slice(0,10);
  const asOf=monthEnd<cutoff?monthEnd:cutoff;
  if(state.cash&&period+'-01'<=asOf){const report=getCashReport(state,{startDate:period+'-01',endDate:asOf,...(location!=='all'?{locationId:location}:{})});return {income:report.externalInflows,expenses:report.operatingExpenses,net:fromCents(toCents(report.externalInflows)-toCents(report.operatingExpenses)),available:report.closingAvailable};}
  let income=0n,expense=0n;
  const txs=state.transactions.filter(t=>t.status==='posted'&&t.date.startsWith(period)&&t.date<=cutoff&&(location==='all'||t.locationId===location));
  for(const tx of txs) {let kind=tx.kind;if(kind==='reversal')kind=state.transactions.find(t=>t.id===tx.reversalOf)?.kind??kind;const d=cashDelta(state,tx);if(kind==='income')income+=d;else if(['expense','salary','reimbursement'].includes(kind))expense-=d;}
  return {income:fromCents(income),expenses:fromCents(expense),net:fromCents(income-expense),available:add(...visibleAccounts(state,location).map(a=>getAccountBalance(state,a.id,asOf)))};
}
export interface Obligation {debt:Debt;row:Pick<AmortizationRow,'period'|'date'>;remaining:Money}
export function obligations(state:State,location='all',cutoff=DEMO_DATE):Obligation[] {
  return getUpcomingObligations(state,cutoff).flatMap(item=>{
    const debt=state.debts.find(row=>row.id===item.debtId);
    return debt&&(location==='all'||debt.locationId===location)?[{debt,row:{period:item.period,date:item.date},remaining:item.amount}]:[];
  });
}

/** Full cash flow includes financing and principal, but opening equity is a baseline. */
export function cashSeries(state:State,location:string,period:string,cutoff=DEMO_DATE) {
  if(!/^\d{4}-\d{2}$/.test(period)||Number(period.slice(5))<1||Number(period.slice(5))>12)throw new Error('Período inválido.');
  const lastDay=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).getUTCDate();
  const actualThrough=period===cutoff.slice(0,7)?Number(cutoff.slice(8)):period<cutoff.slice(0,7)?lastDay:0;
  const ids=new Set(visibleAccounts(state,location).map(account=>account.id));
  const delta=(transaction:Transaction)=>transaction.entries.reduce((total,row)=>total+(ids.has(row.accountId)?toCents(row.debit)-toCents(row.credit):0n),0n);
  const posted=state.transactions.filter(transaction=>transaction.status==='posted'&&transaction.date<=cutoff&&(location==='all'||transaction.locationId===location));
  const isOpening=(transaction:Transaction)=>transaction.kind==='opening'||(transaction.kind==='reversal'&&state.transactions.find(row=>row.id===transaction.reversalOf)?.kind==='opening');
  const monthStart=period+'-01';
  // Seed openings on day one are the starting position, never a fictional upward trend.
  let runningBalance=posted.filter(transaction=>transaction.date<monthStart||(transaction.date===monthStart&&transaction.kind==='opening')).reduce((total,transaction)=>total+delta(transaction),0n);
  let runningNet=0n;
  const balances:Money[]=[fromCents(runningBalance)];
  const net:Money[]=['0.00'];
  const upcoming=[...obligations(state,location,cutoff).map(item=>({date:item.row.date,remaining:item.remaining})),...getDebtCalendar(state,cutoff,{category:'recurring',...(location!=='all'?{locationId:location}:{})}).map(item=>({date:item.dueDate,remaining:item.remaining}))].filter(item=>item.date>cutoff);
  // For a future month, carry the real balance at cutoff minus preceding projected dues.
  if(actualThrough===0&&period>cutoff.slice(0,7)){
    runningBalance=posted.reduce((total,transaction)=>total+delta(transaction),0n)-upcoming.filter(item=>item.date<monthStart).reduce((total,item)=>total+toCents(item.remaining),0n);
    balances[0]=fromCents(runningBalance);
  }
  for(let day=1;day<=lastDay;day++){
    const date=period+'-'+String(day).padStart(2,'0');
    if(day<=actualThrough){
      const daily=posted.filter(transaction=>transaction.date===date);
      runningBalance+=daily.filter(transaction=>!(day===1&&transaction.kind==='opening')).reduce((total,transaction)=>total+delta(transaction),0n);
      runningNet+=daily.filter(transaction=>!isOpening(transaction)).reduce((total,transaction)=>total+delta(transaction),0n);
    }else{
      const projected=-upcoming.filter(item=>item.date===date).reduce((total,item)=>total+toCents(item.remaining),0n);
      runningBalance+=projected;runningNet+=projected;
    }
    balances.push(fromCents(runningBalance));net.push(fromCents(runningNet));
  }
  return {balances,net,lastDay,actualThrough};
}
