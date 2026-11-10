'use client';
import { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import { formatCOP, todayBogota } from '@/lib/finance';
import { getInventoryReport, getInventoryState } from '@/lib/inventory/engine';
import type { InventoryReport, InventoryType } from '@/lib/inventory/types';
import { downloadInventoryExcel, downloadInventoryPdf, formatInventoryQuantity, inventoryReportIdentity, inventoryReportLabels, inventoryReportStatus, inventoryUnitLabels, type InventoryExportOptions } from '@/lib/inventory-report-export';
import { Badge, Field } from './ui';
import type { ViewProps } from './view-helpers';

function monthRange(month:string){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Selecciona un mes válido.');return {startDate:month+'-01',endDate:new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10)};}
export function InventoryReportsView({state,location,notify}:ViewProps){
  const today=todayBogota(),inventory=getInventoryState(state);
  const [inventoryType,setInventoryType]=useState<InventoryType>('asset');
  const [month,setMonth]=useState(today.slice(0,7));
  const [warehouseId,setWarehouse]=useState('all');
  const [busy,setBusy]=useState<'pdf'|'excel'|null>(null);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const warehouses=inventory.warehouses.filter(row=>location==='all'||row.locationId===location);
  const selectedWarehouse=warehouses.some(row=>row.id===warehouseId)?warehouseId:'all';
  const result=useMemo(()=>{try{
    const range=monthRange(month);if(range.startDate>today)throw new Error('El informe mensual solo incluye períodos iniciados.');
    const endDate=range.endDate>today?today:range.endDate;
    return {report:getInventoryReport(state,{inventoryType,startDate:range.startDate,endDate,...(location==='all'?{}:{locationId:location}),...(selectedWarehouse==='all'?{}:{warehouseId:selectedWarehouse})}),error:''};
  }catch(reason){return {report:null,error:reason instanceof Error?reason.message:'No se pudo calcular el informe de inventario.'};}},[state,inventoryType,month,location,selectedWarehouse,today,revision]);
  const report=result.report;
  const comparison=useMemo(()=>{
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))>Number(today.slice(0,4)))return [];
    return Array.from({length:12},(_,index)=>{
      const value=month.slice(0,4)+'-'+String(index+1).padStart(2,'0'),range=monthRange(value);
      return {month:value,report:range.endDate<today?getInventoryReport(state,{inventoryType,...range,...(location==='all'?{}:{locationId:location}),...(selectedWarehouse==='all'?{}:{warehouseId:selectedWarehouse})}):null};
    });
  },[state,inventoryType,month,location,selectedWarehouse,today,revision]);
  const exportOptions:InventoryExportOptions={companyName:state.organization.name,...(report?.status==='closed'&&report.closedAt&&report.closedBy?{closedSnapshot:{version:report.version,closedAt:report.closedAt,closedBy:state.members.find(row=>row.id===report.closedBy)?.name??'Responsable registrado'}}:{}),cashReferences:Object.fromEntries(state.transactions.map(row=>[row.id,row.reference])),comparison:comparison.flatMap(row=>row.report?[row.report]:[])};
  const download=async(format:'pdf'|'excel')=>{
    if(!report||busy)return;setBusy(format);setError('');
    try{if(format==='pdf')await downloadInventoryPdf(report,exportOptions);else await downloadInventoryExcel(report,exportOptions);notify(`Informe ${format==='pdf'?'PDF':'Excel'} de ${inventoryReportLabels[inventoryType]} generado con el período y los valores mostrados.`);}
    catch(reason){setError(reason instanceof Error?reason.message:'No se pudo generar el archivo.');}finally{setBusy(null);}
  };
  return <div className="inventory-reports">
    <section className="panel"><div className="panel-header"><div><h2>Informes mensuales por inventario</h2><p>Un PDF y un Excel diferenciados por inventario, mes y versión.</p></div><Badge tone="blue">Registro local</Badge></div><div className="form-grid" style={{padding:'0 22px 20px'}}>
      <Field label="Inventario"><select value={inventoryType} onChange={event=>{setInventoryType(event.target.value as InventoryType);setError('');}}>{Object.entries(inventoryReportLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="Mes del informe"><input type="month" value={month} max={today.slice(0,7)} required onChange={event=>{setMonth(event.target.value);setError('');}}/></Field>
      <Field label="Ubicación o bodega"><select value={selectedWarehouse} onChange={event=>{setWarehouse(event.target.value);setError('');}}><option value="all">Todas las ubicaciones de la sede seleccionada</option>{warehouses.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
      <div className="field"><span>Archivos del mismo informe</span><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="button button-secondary" disabled={!report||Boolean(busy)} onClick={()=>download('pdf')}><FileText size={15}/>{busy==='pdf'?'Generando…':'Descargar PDF'}</button><button className="button button-secondary" disabled={!report||Boolean(busy)} onClick={()=>download('excel')}><FileSpreadsheet size={15}/>{busy==='excel'?'Generando…':'Descargar Excel'}</button></div></div>
    </div>{(error||result.error)&&<p className="form-error" role="alert" style={{margin:22}}>{error||result.error}</p>}</section>
    {report&&<>
      <section className="panel" style={{marginTop:20}}><div className="panel-header"><div><h2>{inventoryReportLabels[report.inventoryType]}</h2><p>{report.startDate} al {report.endDate} · {inventoryReportStatus(report,exportOptions)}</p></div><button className="icon-button" aria-label="Recalcular informe de inventario" onClick={()=>setRevision(value=>value+1)}><RefreshCw size={17}/></button></div><div className="detail-grid" style={{padding:'0 22px 20px'}}><div className="detail-item"><small>Referencias / ubicaciones</small><strong>{report.rows.length}</strong></div><div className="detail-item"><small>Valor teórico de existencias</small><strong>{report.totalValue===null?'Sin valoración completa':formatCOP(report.totalValue,{decimals:true})}</strong></div><div className="detail-item"><small>Conteos físicos pendientes</small><strong>{report.rows.filter(row=>row.counted===null).length}</strong></div><div className="detail-item"><small>Novedades abiertas</small><strong>{report.issues.filter(row=>row.status==='open').length}</strong></div></div></section>
      <section className="panel" style={{marginTop:20}}><div className="panel-header"><div><h2>Existencias teóricas frente a conteo físico</h2><p>Las cantidades faltantes se muestran sin dato. No se suman unidades de medida diferentes.</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Referencia</th><th>Ubicación</th><th>Unidad</th><th>Inicial</th><th>Entradas</th><th>Salidas</th><th>Teórico</th><th>Conteo físico</th><th>Diferencia</th><th>Precio del período</th><th>Valor teórico</th></tr></thead><tbody>{report.rows.length?report.rows.map(row=>{const integer=row.unit==='unit'||['asset','finished'].includes(report.inventoryType);return <tr key={row.itemId+':'+row.warehouseId}><td><strong>{row.code}</strong><small className="table-subtext">{row.description}</small></td><td>{row.warehouseName}</td><td>{inventoryUnitLabels[row.unit]}</td>{[row.opening,row.incoming,row.outgoing,row.theoretical,row.counted,row.difference].map((value,index)=><td key={index} className="amount nowrap">{formatInventoryQuantity(value,integer)}</td>)}<td className="amount nowrap">{row.unitPrice===null?'—':formatCOP(row.unitPrice,{decimals:true})}</td><td className="amount nowrap">{row.theoreticalValue===null?'—':formatCOP(row.theoreticalValue,{decimals:true})}</td></tr>}):<tr><td colSpan={11}>Sin referencias registradas para este inventario y ubicación. No se han creado existencias de ejemplo.</td></tr>}</tbody></table></div></section>
      <section className="panel" style={{marginTop:20}}><div className="panel-header"><div><h2>Novedades del informe</h2><p>Un faltante o discrepancia conserva su estado y su historia.</p></div></div>{report.issues.length?<div className="table-scroll"><table className="data-table"><thead><tr><th>Fecha</th><th>Prioridad</th><th>Novedad</th><th>Estado</th></tr></thead><tbody>{report.issues.map(row=><tr key={row.id}><td>{row.date}</td><td>{row.priority===2?'2 · Crítica':'3 · General'}</td><td><strong>{row.title}</strong><small className="table-subtext">{row.description}</small></td><td><Badge tone={row.status==='resolved'?'green':row.severity==='critical'?'red':'orange'}>{row.status==='resolved'?'Resuelta':'Abierta'}</Badge></td></tr>)}</tbody></table></div>:<p className="muted" style={{padding:'0 22px 20px'}}>Sin novedades registradas en este alcance. La ausencia de conteo o precio se conserva como dato pendiente.</p>}</section>
      <InventoryAnnualComparison reports={comparison}/>
      <div className="inline-note"><FileText size={18}/><p><span className="monospace">{inventoryReportIdentity(report)}</span>. El PDF y el Excel usan este mismo cálculo y conservan el precio registrado para el período. Los valores desconocidos quedan vacíos; no se calculan promedios ni se presupone que un conteo pendiente sea cero. Un cierre local no equivale a una aprobación institucional autenticada.</p></div>
    </>}
  </div>;
}
function InventoryAnnualComparison({reports}:{reports:{month:string;report:InventoryReport|null}[]}){
  return <section className="panel" style={{marginTop:20}}><div className="panel-header"><div><h2>Comparación por meses completos</h2><p>Los meses en curso y futuros no se presentan como períodos completos.</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Mes</th><th>Referencias / ubicaciones</th><th>Conteos pendientes</th><th>Valor teórico COP</th><th>Estado</th></tr></thead><tbody>{reports.map(({month,report})=><tr key={month}><td>{month}</td><td>{report?report.rows.length:'—'}</td><td>{report?report.rows.filter(row=>row.counted===null).length:'—'}</td><td className="amount">{report&&report.totalValue!==null?formatCOP(report.totalValue,{decimals:true}):'—'}</td><td>{report?inventoryReportStatus(report):'Mes sin completar'}</td></tr>)}</tbody></table></div></section>;
}
