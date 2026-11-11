'use client';
import { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import { formatCOP, todayBogota, toCents } from '@/lib/finance';
import { getDebtModuleReport } from '@/lib/debts/engine';
import type { DebtCategory } from '@/lib/debts/types';
import {
  debtReportCategoryLabels,
  debtReportIdentity,
  debtReportRowStatusLabels,
  debtReportStatus,
  debtReportSummary,
  downloadDebtsExcel,
  downloadDebtsPdf,
  type DebtReportExportOptions,
} from '@/lib/debts-report-export';
import { Badge, Field } from './ui';
import type { ViewProps } from './view-helpers';

function reportMonthBounds(month: string, today: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Selecciona un mes válido.');
  const startDate = month + '-01';
  if (startDate > today) throw new Error('El informe solo incluye períodos iniciados.');
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
  return { startDate, endDate: end > today ? today : end };
}
export function DebtReportsView({ state, location, notify }: ViewProps) {
  const today = todayBogota();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [category, setCategory] = useState<DebtCategory | 'all'>('all');
  const [creditor, setCreditor] = useState('all');
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const base = useMemo(() => {
    try {
      const bounds = reportMonthBounds(month, today);
      return {
        report: getDebtModuleReport(state, {
          ...bounds,
          ...(category === 'all' ? {} : { category }),
          ...(location === 'all' ? {} : { locationId: location }),
        }),
        error: '',
      };
    } catch (reason) {
      return {
        report: null,
        error: reason instanceof Error ? reason.message : 'No se pudo calcular el informe.',
      };
    }
  }, [state, month, category, location, today, revision]);
  const creditors = Array.from(new Set(base.report?.rows.map((row) => row.creditor) ?? [])).sort((a, b) =>
    a.localeCompare(b, 'es-CO'),
  );
  const selectedCreditor = creditors.includes(creditor) ? creditor : 'all';
  const result = useMemo(() => {
    if (!base.report || selectedCreditor === 'all') return base;
    try {
      return {
        report: getDebtModuleReport(state, {
          startDate: base.report.startDate,
          endDate: base.report.endDate,
          ...(category === 'all' ? {} : { category }),
          ...(location === 'all' ? {} : { locationId: location }),
          creditor: selectedCreditor,
        }),
        error: '',
      };
    } catch (reason) {
      return {
        report: null,
        error: reason instanceof Error ? reason.message : 'No se pudo filtrar el acreedor.',
      };
    }
  }, [state, base, selectedCreditor, category, location]);
  const report = result.report;
  const options: DebtReportExportOptions = {
    companyName: state.organization.name,
    ...(report?.closedBy
      ? {
          closedByName:
            state.members.find((member) => member.id === report.closedBy)?.name ?? 'Responsable registrado',
        }
      : {}),
  };
  const download = async (format: 'pdf' | 'excel') => {
    if (!report || busy) return;
    setBusy(format);
    setError('');
    try {
      if (format === 'pdf') await downloadDebtsPdf(report, options);
      else await downloadDebtsExcel(report, options);
      notify(
        `Informe de Deudas ${format === 'pdf' ? 'PDF' : 'Excel'} generado con el mismo período, versión y valores mostrados.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo generar el archivo.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="debts-reports">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Informe mensual de Deudas</h2>
            <p>
              Saldos reconocidos, pagos confirmados y pendientes al corte. Las simulaciones no forman parte de
              estos informes.
            </p>
          </div>
          <Badge tone="blue">Registro local</Badge>
        </div>
        <div className="form-grid" style={{ padding: '0 22px 20px' }}>
          <Field label="Mes del informe">
            <input
              type="month"
              value={month}
              max={today.slice(0, 7)}
              required
              onChange={(event) => {
                setMonth(event.target.value);
                setError('');
              }}
            />
          </Field>
          <Field label="Categoría">
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as DebtCategory | 'all');
                setCreditor('all');
                setError('');
              }}
            >
              <option value="all">Las cuatro categorías</option>
              {Object.entries(debtReportCategoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Acreedor">
            <select
              value={selectedCreditor}
              onChange={(event) => {
                setCreditor(event.target.value);
                setError('');
              }}
            >
              <option value="all">Todos los acreedores del alcance</option>
              {creditors.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <div className="field">
            <span>Archivos del mismo informe</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="button button-secondary"
                disabled={!report || Boolean(busy)}
                onClick={() => download('pdf')}
              >
                <FileText size={15} />
                {busy === 'pdf' ? 'Generando…' : 'Descargar PDF'}
              </button>
              <button
                className="button button-secondary"
                disabled={!report || Boolean(busy)}
                onClick={() => download('excel')}
              >
                <FileSpreadsheet size={15} />
                {busy === 'excel' ? 'Generando…' : 'Descargar Excel'}
              </button>
            </div>
          </div>
        </div>
        {(error || result.error) && (
          <p className="form-error" role="alert" style={{ margin: 22 }}>
            {error || result.error}
          </p>
        )}
      </section>
      {report && (
        <>
          <section className="panel" style={{ marginTop: 20 }}>
            <div className="panel-header">
              <div>
                <h2>Resumen reconocido al corte</h2>
                <p>
                  {report.startDate} al {report.endDate} · {debtReportStatus(report)}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Recalcular informe de Deudas"
                onClick={() => setRevision((value) => value + 1)}
              >
                <RefreshCw size={17} />
              </button>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th className="align-right">Valor COP</th>
                  </tr>
                </thead>
                <tbody>
                  {debtReportSummary(report).map(([label, value]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td className="amount align-right nowrap">{formatCOP(value, { decimals: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel" style={{ marginTop: 20 }}>
            <div className="panel-header">
              <div>
                <h2>Saldos por categoría y acreedor</h2>
                <p>
                  El ORIGEN documentado reconoce el saldo al corte y no supone un desembolso nuevo. El pago de
                  Caja y la disminución del capital se presentan por separado.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Acreedor / documento</th>
                    <th>Categoría</th>
                    <th>Inicial</th>
                    <th>Altas / ORIGEN</th>
                    <th>Capital pagado</th>
                    <th>Chatarra</th>
                    <th>Devoluciones aceptadas</th>
                    <th>Ajustes aplicados</th>
                    <th>Saldo final</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.length ? (
                    report.rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.creditor}</strong>
                          <small className="table-subtext">
                            {row.documentReference} · {row.concept}
                          </small>
                        </td>
                        <td>{debtReportCategoryLabels[row.category]}</td>
                        {[
                          row.openingBalance,
                          row.newObligations,
                          row.principalPaid,
                          row.noncashScrap,
                          row.acceptedReturns,
                          row.documentedAdjustments,
                          row.closingBalance,
                        ].map((value, index) => (
                          <td key={index} className="amount nowrap">
                            {formatCOP(value)}
                          </td>
                        ))}
                        <td>{debtReportRowStatusLabels[row.status]}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={10}>
                        Sin obligaciones reconocidas en este alcance. No se han precargado deudas ni pagos de
                        ejemplo.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel" style={{ marginTop: 20 }}>
            <div className="panel-header">
              <div>
                <h2>Vencimientos y pendientes documentados</h2>
                <p>
                  Solo planes oficiales, facturas de proveedores y recibos recurrentes recibidos. Un pendiente
                  reconocido se conserva al cierre.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Acreedor / obligación</th>
                    <th>Vencimiento</th>
                    <th>Programado</th>
                    <th>Aplicado al corte</th>
                    <th>Pendiente al corte</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.calendar.length ? (
                    report.calendar.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.creditor}</strong>
                          <small className="table-subtext">{row.concept}</small>
                        </td>
                        <td>{row.dueDate}</td>
                        <td className="amount nowrap">{formatCOP(row.amount)}</td>
                        <td className="amount nowrap">{formatCOP(row.paidAmount)}</td>
                        <td className="amount nowrap">{formatCOP(row.remaining)}</td>
                        <td>
                          <Badge
                            tone={
                              toCents(row.remaining) === 0n
                                ? 'green'
                                : row.status === 'overdue'
                                  ? 'red'
                                  : 'orange'
                            }
                          >
                            {row.status === 'paid'
                              ? 'Cancelada'
                              : row.status === 'partially_paid'
                                ? 'Pagada parcialmente'
                                : row.status === 'overdue'
                                  ? 'Vencida'
                                  : row.status === 'upcoming'
                                    ? 'Próxima a vencer'
                                    : 'Programada según documento'}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>
                        Sin vencimientos documentados en este alcance. Las cuotas del simulador no sustituyen
                        el plan oficial.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel" style={{ marginTop: 20 }}>
            <div className="panel-header">
              <div>
                <h2>Novedades y soportes pendientes</h2>
                <p>
                  Las diferencias se conservan hasta documentar su revisión. Un saldo sin conciliar mantiene
                  su observación.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Categoría</th>
                    <th>Novedad</th>
                    <th>Valor COP</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.issues.length ? (
                    report.issues.map((row) => (
                      <tr key={row.id}>
                        <td>{row.date}</td>
                        <td>{debtReportCategoryLabels[row.category]}</td>
                        <td>
                          <strong>{row.title}</strong>
                          <small className="table-subtext">{row.description}</small>
                        </td>
                        <td className="amount nowrap">
                          {row.amount === undefined ? '—' : formatCOP(row.amount)}
                        </td>
                        <td>
                          <Badge
                            tone={
                              row.status === 'resolved'
                                ? 'green'
                                : row.severity === 'critical'
                                  ? 'red'
                                  : 'orange'
                            }
                          >
                            {row.status === 'resolved' ? 'Resuelta' : 'Abierta'}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>Sin novedades registradas para el alcance seleccionado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <div className="inline-note">
            <FileText size={18} />
            <p>
              <span className="monospace">{debtReportIdentity(report)}</span>. PDF y Excel conservan este
              mismo cálculo y versión. Los abonos de chatarra y devoluciones aceptadas reducen la obligación
              sin simular efectivo. Los pagos posteriores no reescriben un cierre anterior. Un cierre local no
              equivale a autorización institucional autenticada.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
