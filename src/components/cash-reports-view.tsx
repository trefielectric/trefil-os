'use client';
import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import { formatCOP, getCashReport, todayBogota } from '@/lib/finance';
import { cashReportIdentity, cashReportSummary, downloadCashExcel, downloadCashPdf } from '@/lib/cash-report-export';
import { Badge, Field } from './ui';
import type { ViewProps } from './view-helpers';

function iso(year:number,month:number,day:number){return new Date(Date.UTC(year,month,day)).toISOString().slice(0,10);}
function completePeriod(preset:string,today:string):[string,string]{
  const year=Number(today.slice(0,4)),month=Number(today.slice(5,7))-1;
  if(preset==='today')return [today,today];
  if(preset==='current')return [iso(year,month,1),today];
  if(preset==='month')return [iso(year,month-1,1),iso(year,month,0)];
  if(preset==='bimonth')return [iso(year,month-2,1),iso(year,month,0)];
  if(preset==='quarter'){const quarterStart=Math.floor(month/3)*3;return [iso(year,quarterStart-3,1),iso(year,quarterStart,0)];}
  if(preset==='semester'){const halfStart=month<6?0:6;return [iso(year,halfStart-6,1),iso(year,halfStart,0)];}
  return [iso(year-1,0,1),iso(year-1,11,31)];
}
export function CashReportsView({state,location,notify}:ViewProps){
  const today=todayBogota();
  const [startDate,setStart]=useState(today.slice(0,7)+'-01');
  const [endDate,setEnd]=useState(today);
  const [preset,setPreset]=useState('current');
  const [busy,setBusy]=useState<'pdf'|'excel'|null>(null);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const result=useMemo(()=>{try{return {report:getCashReport(state,{startDate,endDate,...(location!=='all'?{locationId:location}:{})}),error:''};}catch(reason){return {report:null,error:reason instanceof Error?reason.message:'No se pudo calcular el informe.'};}},[state,startDate,endDate,location,revision]);
  const year=Number(startDate.slice(0,4));
  const comparison=useMemo(()=>/^\d{4}-\d{2}-\d{2}$/.test(startDate)&&year>=100&&year<=Number(today.slice(0,4))?Array.from({length:12},(_,month)=>{
    const from=iso(year,month,1),to=iso(year,month+1,0);
    return {label:new Intl.DateTimeFormat('es-CO',{month:'long',timeZone:'UTC'}).format(new Date(from+'T12:00:00Z')),report:to<today?getCashReport(state,{startDate:from,endDate:to,...(location!=='all'?{locationId:location}:{})}):null};
  }):[],[state,startDate,year,location,today,revision]);
  const report=result.report;
  const exportReport=async(kind:'pdf'|'excel')=>{
    if(!report||busy)return;
    setBusy(kind);setError('');
    try{const options={companyName:state.organization.name,comparison:comparison.flatMap(row=>row.report?[row.report]:[])};if(kind==='pdf')await downloadCashPdf(report,options);else await downloadCashExcel(report,options);notify(`Informe ${kind==='pdf'?'PDF':'Excel'} generado con los mismos totales del período.`);}
    catch(reason){setError(reason instanceof Error?reason.message:'No se pudo generar el archivo. Intenta de nuevo.');}
    finally{setBusy(null);}
  };
  return <div className="cash-reports">
    <section className="panel">
      <div className="panel-header"><div><h2>Informes de caja</h2><p>Un solo cálculo para el PDF, el Excel y los saldos al corte.</p></div><Badge tone="blue">Registro local</Badge></div>
      <div className="form-grid" style={{padding:'0 22px 20px'}}>
        <Field label="Período habitual"><select value={preset} onChange={event=>{const value=event.target.value;setPreset(value);setError('');if(value!=='custom'){const [from,to]=completePeriod(value,today);setStart(from);setEnd(to);}}}><option value="current">Mes actual a la fecha</option><option value="today">Hoy</option><option value="month">Último mes completo</option><option value="bimonth">Últimos dos meses completos</option><option value="quarter">Último trimestre calendario completo</option><option value="semester">Último semestre calendario completo</option><option value="year">Último año calendario completo</option><option value="custom">Fechas personalizadas</option></select></Field>
        <Field label="Fecha inicial"><input type="date" value={startDate} max={endDate||today} required onChange={event=>{setStart(event.target.value);setPreset('custom');setError('');}}/></Field>
        <Field label="Fecha final"><input type="date" value={endDate} min={startDate} max={today} required onChange={event=>{setEnd(event.target.value);setPreset('custom');setError('');}}/></Field>
        <div className="field"><span>Archivos del período</span><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="button button-secondary" disabled={!report||Boolean(busy)} onClick={()=>exportReport('pdf')}><FileText size={15}/>{busy==='pdf'?'Generando…':'Descargar PDF'}</button><button className="button button-secondary" disabled={!report||Boolean(busy)} onClick={()=>exportReport('excel')}><FileSpreadsheet size={15}/>{busy==='excel'?'Generando…':'Descargar Excel'}</button></div></div>
      </div>
      {(error||result.error)&&<p className="form-error" role="alert" style={{margin:22}}>{error||result.error}</p>}
    </section>
    {report&&<>
      <section className="panel" style={{marginTop:20}}><div className="panel-header"><div><h2>Resumen del período</h2><p>{startDate} al {endDate} · COP · Bogotá</p></div><button className="icon-button" aria-label="Recalcular informe" onClick={()=>setRevision(value=>value+1)}><RefreshCw size={17}/></button></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Concepto</th><th className="align-right">Valor COP</th></tr></thead><tbody>{cashReportSummary(report).map(([label,amount])=><tr key={label}><td>{label}</td><td className="amount align-right">{formatCOP(amount,{decimals:true})}</td></tr>)}</tbody></table></div></section>
      <section className="panel" style={{marginTop:20}}><div className="panel-header"><div><h2>Saldos por cuenta</h2><p>El consolidado corresponde a la suma de las cuentas incluidas al corte.</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Cuenta</th><th>Saldo inicial</th><th>Entradas</th><th>Salidas</th><th>Saldo al corte</th></tr></thead><tbody>{report.accounts.length?report.accounts.map(row=><tr key={row.accountId}><td>{row.name}</td><td className="amount">{formatCOP(row.opening)}</td><td className="amount">{formatCOP(row.inflows)}</td><td className="amount">{formatCOP(row.outflows)}</td><td className="amount">{formatCOP(row.closing)}</td></tr>):<tr><td colSpan={5}>Sin cuentas configuradas. El espacio inicial conserva todos los saldos en cero.</td></tr>}</tbody></table></div></section>
      <section className="panel" style={{marginTop:20}}><div className="panel-header"><div><h2>Clasificación de salidas</h2><p>Detalle por grupo y categoría. El resumen distingue operación, financiación, activos y traslados.</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Grupo</th><th>Categoría</th><th>Movimientos</th><th className="align-right">Valor neto COP</th></tr></thead><tbody>{report.categories.length?report.categories.map(row=><tr key={row.categoryId}><td>{row.groupName}</td><td>{row.categoryName}</td><td>{row.transactionIds.length}</td><td className="amount align-right">{formatCOP(row.amount)}</td></tr>):<tr><td colSpan={4}>Sin salidas clasificadas en este período.</td></tr>}</tbody></table></div></section>
      <section className="panel" style={{marginTop:20}}><div className="panel-header"><div><h2>Comparación mensual · {Number.isFinite(year)?year:'—'}</h2><p>Solo meses calendario completos. Los meses en curso o futuros se muestran sin dato.</p></div><Download size={17}/></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Mes</th><th>Entradas externas</th><th>Gastos operativos</th><th>Disponible al cierre</th></tr></thead><tbody>{comparison.map(row=><tr key={row.label}><td>{row.label}</td><td className="amount">{row.report?formatCOP(row.report.externalInflows):'—'}</td><td className="amount">{row.report?formatCOP(row.report.operatingExpenses):'—'}</td><td className="amount">{row.report?formatCOP(row.report.closingAvailable):'—'}</td></tr>)}</tbody></table></div></section>
      <div className="inline-note"><FileText size={18}/><p>Identificación del informe: {cashReportIdentity(report)}. PDF y Excel conservan esta misma versión y fuente de cálculo. Los movimientos personales o no verificados no se muestran en el detalle operativo.</p></div>
    </>}
  </div>;
}
