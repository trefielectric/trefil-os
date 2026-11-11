'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, FileClock, FileSpreadsheet, FileText, LockKeyhole, RefreshCw } from 'lucide-react';
import { formatCOP, getCashReport, todayBogota } from '@/lib/finance';
import { cashReportIdentity, cashReportSummary, downloadCashExcel, downloadCashPdf } from '@/lib/cash-report-export';
import { getInventoryReport } from '@/lib/inventory/engine';
import type { InventoryType } from '@/lib/inventory/types';
import { downloadInventoryExcel, downloadInventoryPdf, inventoryReportIdentity, inventoryReportLabels } from '@/lib/inventory-report-export';
import { getDebtModuleReport } from '@/lib/debts/engine';
import { debtReportIdentity, debtReportSummary, downloadDebtsExcel, downloadDebtsPdf } from '@/lib/debts-report-export';
import { Badge, Empty, Field } from './ui';
import type { ViewProps } from './view-helpers';

type ReportKind = 'cash' | 'inventory' | 'debts';
type ExportFormat = 'pdf' | 'xlsx';
const reportNames: Record<ReportKind, string> = { cash: 'Caja', inventory: 'Inventarios', debts: 'Deudas' };
const reportDescriptions: Record<ReportKind, string> = {
  cash: 'Movimientos y saldos dentro del período.',
  inventory: 'Existencias y valoración al corte, sin sumar fotografías mensuales.',
  debts: 'Obligaciones, pagos y saldos reconocidos al corte.',
};
const exportRoles = new Set(['owner', 'admin', 'treasury', 'accounting']);

function dateFrom(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}
function presetRange(preset: string, today: string): [string, string] {
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)) - 1;
  if (preset === 'today') return [today, today];
  if (preset === 'month') return [dateFrom(year, month, 1), today];
  if (preset === 'quarter') return [dateFrom(year, Math.floor(month / 3) * 3, 1), today];
  if (preset === 'year') return [dateFrom(year, 0, 1), today];
  return [dateFrom(year, month, 1), today];
}

export function ReportsModule({ state, actor, location, mutate, notify }: ViewProps) {
  const today = todayBogota();
  const [kind, setKind] = useState<ReportKind>('cash');
  const [preset, setPreset] = useState('month');
  const [startDate, setStartDate] = useState(today.slice(0, 7) + '-01');
  const [endDate, setEndDate] = useState(today);
  const [inventoryType, setInventoryType] = useState<InventoryType>('asset');
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const canExport = exportRoles.has(actor.role);
  const reportResult = useMemo(() => {
    try {
      if (!startDate || !endDate || startDate > endDate) throw new Error('Selecciona un período válido.');
      if (endDate > today) throw new Error('El corte no puede ser posterior a hoy.');
      const scope = location === 'all' ? {} : { locationId: location };
      if (kind === 'cash') return { kind, report: getCashReport(state, { startDate, endDate, ...scope }), error: '' } as const;
      if (kind === 'inventory') return { kind, report: getInventoryReport(state, { inventoryType, startDate, endDate, ...scope }), error: '' } as const;
      return { kind, report: getDebtModuleReport(state, { startDate, endDate, ...scope }), error: '' } as const;
    } catch (reason) {
      return { kind, report: null, error: reason instanceof Error ? reason.message : 'No se pudo calcular la vista previa.' } as const;
    }
  }, [state, kind, startDate, endDate, inventoryType, location, today, revision]);

  const identity = reportResult.report
    ? reportResult.kind === 'cash' ? cashReportIdentity(reportResult.report)
      : reportResult.kind === 'inventory' ? inventoryReportIdentity(reportResult.report)
        : debtReportIdentity(reportResult.report)
    : 'Sin versión calculada';
  const summary = reportResult.report
    ? reportResult.kind === 'cash' ? cashReportSummary(reportResult.report)
      : reportResult.kind === 'inventory' ? [
        ['Referencias / ubicaciones', String(reportResult.report.rows.length)],
        ['Valor teórico al corte', reportResult.report.totalValue === null ? null : reportResult.report.totalValue],
        ['Conteos físicos pendientes', String(reportResult.report.rows.filter(row => row.counted === null).length)],
        ['Novedades abiertas', String(reportResult.report.issues.filter(row => row.status === 'open').length)],
      ] as [string, string | null][]
        : debtReportSummary(reportResult.report)
    : [];

  const audit = (format: ExportFormat, result: 'solicitado' | 'finalizado' | 'fallido', detail?: string) => mutate(current => ({
    ...current,
    audit: [{
      id: crypto.randomUUID(), action: `Informe ${result}`, entityType: 'report_export', entityId: identity,
      actorId: actor.id, actorName: actor.name, timestamp: new Date().toISOString(),
      ...(location === 'all' ? {} : { locationId: location }),
      reason: JSON.stringify({ modulo: reportNames[kind], inicio: startDate, corte: endDate, formato: format.toUpperCase(), resultado: result, detalle: detail ?? '' }),
    }, ...current.audit],
  }), `Solicitud de informe ${result}.`);

  const download = async (format: ExportFormat) => {
    if (!reportResult.report || busy || !canExport) return;
    setError('');
    if (!audit(format, 'solicitado')) return;
    setBusy(format);
    try {
      const companyName = state.organization.name;
      if (reportResult.kind === 'cash') {
        if (format === 'pdf') await downloadCashPdf(reportResult.report, { companyName });
        else await downloadCashExcel(reportResult.report, { companyName });
      } else if (reportResult.kind === 'inventory') {
        const options = { companyName, cashReferences: Object.fromEntries(state.transactions.map(row => [row.id, row.reference])) };
        if (format === 'pdf') await downloadInventoryPdf(reportResult.report, options);
        else await downloadInventoryExcel(reportResult.report, options);
      } else if (format === 'pdf') await downloadDebtsPdf(reportResult.report, { companyName });
      else await downloadDebtsExcel(reportResult.report, { companyName });
      audit(format, 'finalizado');
      notify(`Informe ${format.toUpperCase()} generado con los mismos filtros y cifras de la vista previa.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'No se pudo generar el archivo.';
      audit(format, 'fallido', message); setError(message);
    } finally { setBusy(null); }
  };

  const history = state.audit.filter(row => row.entityType === 'report_export').slice(0, 12);
  return <div className="reports-module">
    <section className="reports-catalog" aria-label="Catálogo de informes">
      {(Object.keys(reportNames) as ReportKind[]).map(value => <button key={value} className={kind === value ? 'active' : ''} onClick={() => { setKind(value); setError(''); }}>
        <span>{value === 'cash' ? <FileText /> : value === 'inventory' ? <FileSpreadsheet /> : <FileClock />}</span>
        <strong>{reportNames[value]}</strong><small>{reportDescriptions[value]}</small>
      </button>)}
    </section>
    <section className="panel reports-config">
      <div className="panel-header"><div><h2>Configurar informe de {reportNames[kind]}</h2><p>La vista previa y ambos archivos comparten el mismo corte, alcance y fuente.</p></div><Badge tone="blue">PDF + XLSX</Badge></div>
      <div className="reports-fields">
        <Field label="Período"><select value={preset} onChange={event => { const value = event.target.value; setPreset(value); if (value !== 'custom') { const [from, to] = presetRange(value, today); setStartDate(from); setEndDate(to); } }}><option value="today">Día</option><option value="month">Mes a la fecha</option><option value="quarter">Trimestre a la fecha</option><option value="year">Año a la fecha</option><option value="custom">Personalizado</option></select></Field>
        <Field label="Fecha inicial"><input type="date" value={startDate} max={endDate} onChange={event => { setStartDate(event.target.value); setPreset('custom'); }} /></Field>
        <Field label="Fecha de corte"><input type="date" value={endDate} min={startDate} max={today} onChange={event => { setEndDate(event.target.value); setPreset('custom'); }} /></Field>
        {kind === 'inventory' && <Field label="Tipo de inventario"><select value={inventoryType} onChange={event => setInventoryType(event.target.value as InventoryType)}>{Object.entries(inventoryReportLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>}
      </div>
      {(error || reportResult.error) && <p className="form-error reports-error" role="alert">{error || reportResult.error}</p>}
    </section>
    {reportResult.report && <section className="panel reports-preview">
      <div className="panel-header"><div><h2>Vista previa controlada</h2><p>{startDate} al {endDate} · {location === 'all' ? 'Todas las sedes' : 'Sede seleccionada'} · COP</p></div><button className="icon-button" aria-label="Recalcular vista previa" onClick={() => setRevision(value => value + 1)}><RefreshCw size={17} /></button></div>
      <div className="reports-identity"><span><CheckCircle2 size={17} />Versión calculada</span><code>{identity}</code></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Concepto</th><th className="align-right">Resultado</th></tr></thead><tbody>{summary.map(([label, value]) => <tr key={label}><td>{label}</td><td className="amount align-right">{value === null ? 'Sin dato' : /^-?\d+\.\d{2}$/.test(value) ? formatCOP(value, { decimals: true }) : value}</td></tr>)}</tbody></table></div>
      <div className="reports-actions"><p><LockKeyhole size={16} />Los archivos son temporales y no modifican los registros fuente.</p><div><button className="button button-secondary" disabled={!canExport || Boolean(busy)} onClick={() => download('pdf')}><FileText size={16} />{busy === 'pdf' ? 'Generando…' : 'Descargar PDF'}</button><button className="button button-primary" disabled={!canExport || Boolean(busy)} onClick={() => download('xlsx')}><FileSpreadsheet size={16} />{busy === 'xlsx' ? 'Generando…' : 'Descargar Excel'}</button></div></div>
      {!canExport && <p className="inline-note"><LockKeyhole size={17} />Tu rol puede consultar la vista previa, pero no descargar este informe. Solicita el permiso de exportación.</p>}
    </section>}
    <section className="panel reports-history"><div className="panel-header"><div><h2>Bitácora de exportaciones</h2><p>Usuario, hora, módulo, período, formato y resultado.</p></div><FileClock size={18} /></div>{history.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Fecha</th><th>Responsable</th><th>Resultado</th><th>Identificador</th></tr></thead><tbody>{history.map(row => <tr key={row.id}><td>{new Date(row.timestamp).toLocaleString('es-CO')}</td><td>{row.actorName}</td><td>{row.action}</td><td><code>{row.entityId}</code><small className="table-subtext">{row.reason}</small></td></tr>)}</tbody></table></div> : <Empty title="Aún no hay exportaciones" description="La primera descarga autorizada aparecerá aquí; no se conservará una copia del archivo." />}</section>
    <div className="inline-note"><FileText size={18} /><p>Producción, Reportes generales y Control Administrativo permanecen fuera del catálogo hasta que sus módulos definan contenido, filtros y permisos. La cobertura histórica empieza cuando existan datos reales cargados; ausencia no significa cero.</p></div>
  </div>;
}
