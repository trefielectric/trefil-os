'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowUpRight, Calculator, CalendarDays, ChevronRight, CircleDollarSign, Landmark, Plus, Search, ShieldCheck, X } from 'lucide-react';
import {
  add, buildAmortization, createDebt, formatCOP, getDebtBalance,
  getEffectiveDebtPayments, getSupplierOffsets, getUpcomingObligations, money, recordDebtPayment, toCents,
  type AmortizationInput, type AmortizationMethod, type AmortizationRow, type Debt, type Support,
} from '@/lib/finance';
import { Badge, Empty, Field, Modal } from './ui';
import { canWrite, dateLabel, WORKSPACE_DATE as DEMO_DATE, methods, type ViewProps } from './view-helpers';

type Dialog = { kind: 'create' | 'simulator' } | { kind: 'detail' | 'payment'; debtId: string };
type TermsDraft = {
  principal: string; monthlyRate: string; installments: string; startDate: string; dueDay: string;
  method: AmortizationMethod; graceMonths: string;
  extras: { period: string; amount: string }[]; changes: { period: string; monthlyRate: string }[];
};
const defaultTerms = (): TermsDraft => ({ principal: '', monthlyRate: '', installments: '', startDate: DEMO_DATE, dueDay: '', method: 'fixed_payment', graceMonths: '0', extras: [], changes: [] });
const decimalPattern = '\\d+(\\.\\d{1,2})?';
function termsInput(draft: TermsDraft): AmortizationInput {
  return { principal: money(draft.principal), monthlyRate: draft.monthlyRate, installments: Number(draft.installments), startDate: draft.startDate, dueDay: Number(draft.dueDay), method: draft.method, graceMonths: Number(draft.graceMonths), extraPayments: draft.extras.map(row => ({ period: Number(row.period), amount: money(row.amount) })), rateChanges: draft.changes.map(row => ({ period: Number(row.period), monthlyRate: row.monthlyRate })) };
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Revisa los datos e inténtalo de nuevo.'; }
function totalOrZero(left: string, right: string): string { try { return add(left, right); } catch { return '0.00'; } }
function downloadSchedule(rows: AmortizationRow[], name: string) {
  const columns = ['Cuota', 'Fecha', 'Saldo inicial COP', 'Tasa mensual %', 'Pago proyectado COP', 'Interes COP', 'Capital COP', 'Abono extra incluido COP', 'Saldo final COP'];
  const lines = rows.map(row => [row.period, row.date, row.openingBalance, row.monthlyRate, row.payment, row.interest, row.principal, row.extraPayment, row.balance].join(';'));
  const url = URL.createObjectURL(new Blob(['\uFEFF', [columns.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

export function DebtView(props: ViewProps) {
  const { state, actor, location } = props;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | Debt['kind']>('all');
  const debts = state.debts.filter(debt => location === 'all' || debt.locationId === location);
  const ids = new Set(debts.map(debt => debt.id));
  const payments = getEffectiveDebtPayments(state).filter(payment => ids.has(payment.debtId));
  const remaining = add(...debts.map(debt => getDebtBalance(state, debt.id)));
  const paidPrincipal = add(...payments.map(payment => payment.principal));
  const paidInterest = add(...payments.map(payment => payment.interest));
  const upcoming = getUpcomingObligations(state, DEMO_DATE).filter(row => ids.has(row.debtId))[0];
  const visible = debts.filter(debt => (filter === 'all' || debt.kind === filter) && `${debt.creditor} ${debt.guarantee ?? ''}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  const selected = dialog && 'debtId' in dialog ? state.debts.find(debt => debt.id === dialog.debtId) : undefined;

  return <>
    <div className="stat-grid debt-stats">
      <div className="stat-card"><span className="stat-label">Capital pendiente <Landmark size={17} /></span><div className="metric-value">{formatCOP(remaining)}</div><span className="muted">{debts.filter(debt => toCents(getDebtBalance(state, debt.id)) > 0n).length} obligaciones activas · COP</span></div>
      <div className="stat-card"><span className="stat-label">Capital pagado <ArrowUpRight size={17} /></span><div className="metric-value">{formatCOP(paidPrincipal)}</div><span className="muted">Abonos efectivamente contabilizados</span></div>
      <div className="stat-card"><span className="stat-label">Intereses pagados <CircleDollarSign size={17} /></span><div className="metric-value">{formatCOP(paidInterest)}</div><span className="muted">Separados del abono a capital</span></div>
    </div>
    {upcoming && <div className={`inline-note ${upcoming.status === 'overdue' ? 'note-warning' : ''}`}><CalendarDays size={19} /><span><strong>{upcoming.status === 'overdue' ? 'Obligación vencida' : 'Próxima obligación'}:</strong> {upcoming.creditor} · {dateLabel(upcoming.date)} · {formatCOP(upcoming.amount)}. <span className="muted">Valor proyectado, pendiente de pago.</span></span><button className="text-button" onClick={() => setDialog({ kind: 'detail', debtId: upcoming.debtId })}>Revisar <ChevronRight size={15} /></button></div>}
    <section className="panel">
      <div className="panel-header"><div><h2>Obligaciones financieras</h2><p>Controla cada compromiso, desde el desembolso hasta el último abono.</p></div><div className="button-group"><button className="button button-secondary" onClick={() => setDialog({ kind: 'simulator' })}><Calculator size={17} /> Simular crédito</button>{canWrite(actor) && <button className="button button-primary" onClick={() => setDialog({ kind: 'create' })}><Plus size={17} /> Nueva obligación</button>}</div></div>
      <div className="table-toolbar"><div className="tabs" aria-label="Tipo de obligación">{(['all', 'loan', 'investment', 'supplier'] as const).map(kind => <button key={kind} className={`tab ${filter === kind ? 'active' : ''}`} aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{kind === 'all' ? 'Todas' : kind === 'loan' ? 'Préstamos' : kind === 'supplier' ? 'Proveedores' : 'Inversionistas'} <span>{debts.filter(debt => kind === 'all' || debt.kind === kind).length}</span></button>)}</div><label className="search-input"><Search size={17} /><input type="search" placeholder="Buscar acreedor…" aria-label="Buscar acreedor" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
      {visible.length ? <div className="debt-grid">{visible.map(debt => {
        const balance = getDebtBalance(state, debt.id);
        const paid = toCents(debt.principal) - toCents(balance);
        const progress = toCents(debt.principal) > 0n ? (paid * 100n) / toCents(debt.principal) : 0n;
        const next = getUpcomingObligations(state, DEMO_DATE).find(row => row.debtId === debt.id);
        const pending = state.debtPayments.filter(payment => payment.debtId === debt.id && payment.status === 'pending').length;
        return <article className="debt-card" key={debt.id}>
          <div className="debt-card-top"><span className="account-icon"><Landmark size={22} /></span><Badge tone={toCents(balance) === 0n ? 'green' : next?.status === 'overdue' ? 'red' : 'blue'}>{toCents(balance) === 0n ? 'Saldada' : next?.status === 'overdue' ? 'Cuota vencida' : 'Activa'}</Badge></div>
          <div><span className="eyebrow">{debt.kind === 'investment' ? 'INVERSIONISTA' : debt.kind==='supplier'?'PROVEEDOR':'PRÉSTAMO'}</span><h3>{debt.creditor}</h3><p className="muted">{state.locations.find(item => item.id === debt.locationId)?.name} · {debt.kind==='supplier'?`Factura ${debt.supplierInvoice}`:methods[debt.method]}</p></div>
          <div><span className="muted">Capital pendiente</span><div className="metric-value">{formatCOP(balance)}</div></div>
          <div className="debt-terms">{debt.kind==='supplier'?<span><strong>{debt.supplierDueDate}</strong><small>vencimiento de la factura</small></span>:<><span><strong>{debt.monthlyRate} %</strong><small>interés mensual</small></span><span><strong>{debt.installments} cuotas</strong><small>frecuencia mensual</small></span></>}</div>
          <div className="debt-progress" role="img" aria-label={`${progress.toString()} por ciento del capital saldado`}><span style={{ width: `${progress.toString()}%` }} /></div><div className="debt-progress-label"><span>{progress.toString()} % del capital saldado</span><span>{formatCOP(debt.principal)} original</span></div>
          <div className="debt-card-footer"><span className="muted">{pending ? `${pending} pago(s) por aprobar` : next ? `Vence ${dateLabel(next.date, true)}` : 'Sin cuotas pendientes'}</span><button className="text-button" onClick={() => setDialog({ kind: 'detail', debtId: debt.id })}>Ver estado <ChevronRight size={15} /></button></div>
        </article>;
      })}</div> : <Empty title={query ? 'No encontramos ese acreedor' : 'Sin obligaciones en esta vista'} description="Los préstamos, aportes y facturas de proveedor aparecerán aquí con sus pagos y saldos separados." />}
    </section>
    <div className="inline-note"><ShieldCheck size={18} /><span>El simulador y las cuotas son proyecciones. Un pago modifica los saldos solo cuando se registra y queda contabilizado.</span></div>
    {dialog?.kind === 'create' && <CreateDebtModal {...props} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'simulator' && <SimulatorModal notify={props.notify} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'detail' && selected && <DebtDetail {...props} debt={selected} onClose={() => setDialog(null)} onPay={() => setDialog({ kind: 'payment', debtId: selected.id })} />}
    {dialog?.kind === 'payment' && selected && <PaymentModal {...props} debt={selected} onClose={() => setDialog(null)} />}
  </>;
}

function TermsFields({ draft, setDraft, advanced = false }: { draft: TermsDraft; setDraft: (draft: TermsDraft) => void; advanced?: boolean }) {
  const field = <K extends keyof TermsDraft>(key: K, value: TermsDraft[K]) => setDraft({ ...draft, [key]: value });
  return <>
    <Field label="Capital original · COP" hint="Introduce el capital pactado, sin separadores de miles y con punto decimal."><input required inputMode="decimal" pattern={decimalPattern} value={draft.principal} onChange={event => field('principal', event.target.value)} /></Field>
    <Field label="Tasa de interés mensual · %" hint="Introduce el porcentaje mensual vencido pactado, con punto decimal."><input required inputMode="decimal" pattern="\d+(\.\d{1,8})?" value={draft.monthlyRate} onChange={event => field('monthlyRate', event.target.value)} /></Field>
    <Field label="Número de cuotas"><input type="number" min="1" max="600" required value={draft.installments} onChange={event => field('installments', event.target.value)} /></Field>
    <Field label="Método de amortización"><select value={draft.method} onChange={event => field('method', event.target.value as AmortizationMethod)}>{Object.entries(methods).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></Field>
    <Field label="Fecha de desembolso"><input type="date" required value={draft.startDate} onChange={event => field('startDate', event.target.value)} /></Field>
    <Field label="Día mensual de vencimiento" hint="Se ajusta al último día si el mes es más corto."><input type="number" min="1" max="31" required value={draft.dueDay} onChange={event => field('dueDay', event.target.value)} /></Field>
    {advanced && <>
      <Field label="Meses de gracia a capital" hint="Durante la gracia se pagan intereses; no se capitalizan."><input type="number" min="0" max="599" required value={draft.graceMonths} onChange={event => field('graceMonths', event.target.value)} /></Field><div />
      <div className="full"><div className="panel-header compact"><div><h3>Abonos extraordinarios</h3><p>Reducen capital y recalculan las cuotas restantes.</p></div><button type="button" className="button button-secondary" onClick={() => field('extras', [...draft.extras, { period: '', amount: '' }])}><Plus size={15} /> Añadir abono</button></div>{draft.extras.map((extra, index) => <div className="form-grid extra-term-row" key={index}><Field label={`Cuota del abono ${index + 1}`}><input type="number" min="1" max={draft.installments} required value={extra.period} onChange={event => field('extras', draft.extras.map((row, position) => position === index ? { ...row, period: event.target.value } : row))} /></Field><Field label="Abono extraordinario · COP"><div className="input-action"><input required inputMode="decimal" pattern={decimalPattern} value={extra.amount} onChange={event => field('extras', draft.extras.map((row, position) => position === index ? { ...row, amount: event.target.value } : row))} /><button type="button" className="icon-button" aria-label={`Quitar abono ${index + 1}`} onClick={() => field('extras', draft.extras.filter((_, position) => position !== index))}><X size={17} /></button></div></Field></div>)}</div>
      <div className="full"><div className="panel-header compact"><div><h3>Cambios de tasa</h3><p>Vigentes desde la cuota indicada, según lo pactado.</p></div><button type="button" className="button button-secondary" onClick={() => field('changes', [...draft.changes, { period: '', monthlyRate: '' }])}><Plus size={15} /> Añadir cambio</button></div>{draft.changes.map((change, index) => <div className="form-grid extra-term-row" key={index}><Field label={`Desde la cuota ${index + 1}`}><input type="number" min="1" max={draft.installments} required value={change.period} onChange={event => field('changes', draft.changes.map((row, position) => position === index ? { ...row, period: event.target.value } : row))} /></Field><Field label="Nueva tasa mensual · %"><div className="input-action"><input required inputMode="decimal" pattern="\d+(\.\d{1,8})?" value={change.monthlyRate} onChange={event => field('changes', draft.changes.map((row, position) => position === index ? { ...row, monthlyRate: event.target.value } : row))} /><button type="button" className="icon-button" aria-label={`Quitar cambio de tasa ${index + 1}`} onClick={() => field('changes', draft.changes.filter((_, position) => position !== index))}><X size={17} /></button></div></Field></div>)}</div>
    </>}
  </>;
}

function ScheduleTable({ rows }: { rows: AmortizationRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, 24);
  return <><div className="table-scroll"><table className="data-table"><caption className="sr-only">Tabla de amortización proyectada. No representa pagos realizados.</caption><thead><tr><th>Cuota</th><th>Vencimiento</th><th className="numeric">Pago proyectado</th><th className="numeric">Interés</th><th className="numeric">Capital</th><th className="numeric">Saldo capital</th></tr></thead><tbody>{visible.map(row => <tr key={row.period}><td><span className="muted">{String(row.period).padStart(2, '0')}</span></td><td>{dateLabel(row.date, true)} {row.date.slice(0, 4)}</td><td className="numeric"><strong>{formatCOP(row.payment)}</strong>{toCents(row.extraPayment) > 0n && <small className="muted">Incluye extra {formatCOP(row.extraPayment)}</small>}</td><td className="numeric">{formatCOP(row.interest)}<small className="muted">{row.monthlyRate} % mensual</small></td><td className="numeric">{formatCOP(row.principal)}</td><td className="numeric">{formatCOP(row.balance)}</td></tr>)}</tbody></table></div>{rows.length > 24 && <button className="button button-secondary" onClick={() => setShowAll(value => !value)}>{showAll ? 'Ver primeras 24 cuotas' : `Ver las ${rows.length} cuotas`}</button>}</>;
}

export function SimulatorModal({ onClose, notify }: { onClose: () => void; notify: ViewProps['notify'] }) {
  const [draft, setDraft] = useState(defaultTerms);
  const [rows, setRows] = useState<AmortizationRow[] | null>(null);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try { setRows(buildAmortization(termsInput(draft))); setChanged(false); } catch (reason) { setError(errorMessage(reason)); }
  }
  return <Modal title="Simulador de financiación" subtitle="Compara condiciones y conoce el costo antes de comprometer caja." onClose={onClose} wide>
    <form onSubmit={submit}><div className="form-grid"><TermsFields draft={draft} setDraft={value => { setDraft(value); setChanged(true); }} advanced /></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><span className="muted">Simulación mensual · COP · redondeo a centavos</span><button className="button button-primary" type="submit"><Calculator size={16} /> Calcular proyección</button></div></form>
    {rows && <div className="simulator-result">{changed && <div className="inline-note note-warning">Cambiaste las condiciones. Vuelve a calcular para actualizar esta proyección.</div>}<div className="stat-grid"><div className="stat-card"><span className="muted">Primera cuota proyectada</span><div className="metric-value">{formatCOP(rows[0].payment)}</div></div><div className="stat-card"><span className="muted">Intereses proyectados</span><div className="metric-value">{formatCOP(add(...rows.map(row => row.interest)))}</div></div><div className="stat-card"><span className="muted">Total proyectado</span><div className="metric-value">{formatCOP(add(...rows.map(row => row.payment)))}</div></div></div><div className="panel-header compact"><div><h3>Tabla de amortización</h3><p>Solo proyección. No crea una obligación ni registra pagos.</p></div><button className="button button-secondary" disabled={changed} onClick={() => { downloadSchedule(rows, 'trefil-simulacion-proyectada.csv'); notify('Proyección exportada. No representa pagos realizados.'); }}><ArrowDownToLine size={16} /> Exportar CSV</button></div><ScheduleTable rows={rows} /></div>}
  </Modal>;
}

function CreateDebtModal({ state, actor, location, mutate, onClose }: ViewProps & { onClose: () => void }) {
  const [draft, setDraft] = useState(defaultTerms);
  const [creditor, setCreditor] = useState('');
  const [kind, setKind] = useState<Debt['kind']>('loan');
  const member = state.members.find(item => item.id === actor.id);
  const locations = state.locations.filter(item => member?.locationIds.includes(item.id));
  const [locationId, setLocationId] = useState(location !== 'all' ? location : locations[0]?.id ?? '');
  const [guarantee, setGuarantee] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try {
      const input = { ...termsInput(draft), dueDay: Number(draft.dueDay), creditor, kind, locationId, guarantee, notes };
      buildAmortization(input);
      if (mutate(current => createDebt(current, input, actor), 'Obligación registrada. El desembolso se registra por separado en movimientos.')) onClose();
      else setError('No fue posible registrar la obligación. Revisa los datos y el aviso.');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  return <Modal title="Nueva obligación financiera" subtitle="Registra las condiciones pactadas y conserva el control por acreedor." onClose={onClose} wide><form onSubmit={submit}>
    <div className="form-grid"><Field label="Acreedor o inversionista"><input required minLength={2} maxLength={200} value={creditor} onChange={event => setCreditor(event.target.value)} placeholder="Nombre del tercero" /></Field><Field label="Tipo de obligación"><select value={kind} onChange={event => setKind(event.target.value as Debt['kind'])}><option value="loan">Préstamo</option><option value="investment">Inversionista con obligación pactada</option></select></Field><Field label="Sede responsable"><select required value={locationId} onChange={event => setLocationId(event.target.value)}>{locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Garantía" hint="Opcional. No incluyas números de documentos sensibles."><input maxLength={500} value={guarantee} onChange={event => setGuarantee(event.target.value)} placeholder="Sin garantía / según contrato" /></Field><TermsFields draft={draft} setDraft={setDraft} advanced={advanced} /><Field label="Condiciones y referencia de contrato" full><textarea rows={3} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Acuerdo, referencia del contrato y condiciones relevantes…" /></Field></div>
    <button type="button" className="text-button" onClick={() => setAdvanced(value => !value)}>{advanced ? 'Ocultar' : 'Añadir'} gracia, pagos extraordinarios y cambios de tasa</button>
    <div className="inline-note"><ShieldCheck size={18} /><span>Registrar esta obligación no genera un ingreso ni un desembolso. Se guardará en este navegador; la conexión del libro institucional está pendiente.</span></div>{error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit">Registrar obligación</button></div>
  </form></Modal>;
}

function DebtDetail({ state, actor, debt, onClose, onPay, notify }: ViewProps & { debt: Debt; onClose: () => void; onPay: () => void }) {
  const [tab, setTab] = useState<'schedule' | 'payments' | 'terms'>('schedule');
  const rows = useMemo(() => debt.kind==='supplier'?[{period:1,date:debt.supplierDueDate!,openingBalance:debt.principal,payment:debt.principal,interest:'0.00',principal:debt.principal,extraPayment:'0.00',balance:'0.00',monthlyRate:'0.00',projected:true as const}]:buildAmortization(debt), [debt]);
  const offsets=getSupplierOffsets(state,debt.id);
  const actual = getEffectiveDebtPayments(state, debt.id);
  const paymentRows = state.debtPayments.filter(payment => payment.debtId === debt.id).sort((a, b) => b.date.localeCompare(a.date));
  return <Modal title={debt.creditor} subtitle={`${debt.kind === 'loan' ? 'Préstamo' : debt.kind==='supplier'?'Proveedor':'Inversionista'} · ${state.locations.find(item => item.id === debt.locationId)?.name} · Estado de cuenta`} onClose={onClose} wide>
    <div className="stat-grid"><div className="stat-card"><span className="muted">Capital pendiente</span><div className="metric-value">{formatCOP(getDebtBalance(state, debt.id))}</div></div><div className="stat-card"><span className="muted">Capital efectivamente pagado</span><div className="metric-value">{formatCOP(add(...actual.map(payment => payment.principal)))}</div></div><div className="stat-card"><span className="muted">Interés efectivamente pagado</span><div className="metric-value">{formatCOP(add(...actual.map(payment => payment.interest)))}</div></div></div>
    <div className="panel-header compact"><div className="tabs">{([['schedule', 'Plan proyectado'], ['payments', 'Pagos registrados'], ['terms', 'Condiciones']] as const).map(([key, title]) => <button key={key} className={`tab ${tab === key ? 'active' : ''}`} aria-pressed={tab === key} onClick={() => setTab(key)}>{title}</button>)}</div>{canWrite(actor) && toCents(getDebtBalance(state, debt.id)) > 0n && <button className="button button-primary" onClick={onPay}><Plus size={16} /> Registrar pago</button>}</div>
    {tab === 'schedule' && <><div className="inline-note"><Calculator size={18} /><span>Proyección original según condiciones pactadas. Las cifras de esta tabla no son pagos realizados. Los abonos reales están en su pestaña.</span></div><ScheduleTable rows={rows} /><div className="modal-actions"><span className="muted">Intereses proyectados: {formatCOP(add(...rows.map(row => row.interest)))}</span><button className="button button-secondary" onClick={() => { downloadSchedule(rows, 'trefil-plan-proyectado.csv'); notify('Plan proyectado exportado.'); }}><ArrowDownToLine size={16} /> Exportar plan</button></div></>}
    {offsets.length>0&&<div className="inline-note"><span><strong>Compensado sin Caja: {formatCOP(add(...offsets.map(row=>row.amount)))}</strong><br/>{offsets.map(row=>`${row.date} · ${row.reference} · ${formatCOP(row.amount)}`).join(' / ')}</span></div>}
    {tab === 'payments' && (paymentRows.length ? <div className="table-scroll"><table className="data-table"><caption className="sr-only">Pagos registrados de esta obligación, con distribución entre capital e intereses y estado contable.</caption><thead><tr><th>Fecha / referencia</th><th className="numeric">Pago</th><th className="numeric">Capital</th><th className="numeric">Interés</th><th>Estado</th></tr></thead><tbody>{paymentRows.map(payment => {
      const transaction = state.transactions.find(item => item.id === payment.transactionId);
      const reversed = Boolean(transaction?.reversedBy);
      return <tr key={payment.id}><td>{dateLabel(payment.date, true)} {payment.date.slice(0, 4)}<small className="muted">{transaction?.reference}</small></td><td className="numeric"><strong>{formatCOP(payment.amount)}</strong></td><td className="numeric">{formatCOP(payment.principal)}</td><td className="numeric">{formatCOP(payment.interest)}</td><td><Badge tone={reversed || payment.status === 'rejected' ? 'red' : payment.status === 'posted' ? 'green' : 'orange'}>{reversed ? 'Reversado' : payment.status === 'posted' ? 'Contabilizado' : payment.status === 'pending' ? 'Por aprobar' : 'Rechazado'}</Badge></td></tr>;
    })}</tbody></table></div> : <Empty title="Todavía no hay pagos registrados" description="Las cuotas del plan son proyecciones. Registra un pago únicamente cuando haya ocurrido y tengas su distribución entre capital e intereses." />)}
    {tab === 'terms' && <>{debt.kind==='supplier'?<dl className="detail-grid"><div><dt>Factura del proveedor</dt><dd>{debt.supplierInvoice}</dd></div><div><dt>Fecha de la factura</dt><dd>{debt.startDate}</dd></div><div><dt>Vencimiento pactado</dt><dd>{debt.supplierDueDate}</dd></div><div><dt>Total original</dt><dd>{formatCOP(debt.principal)}</dd></div></dl>:<dl className="detail-grid"><div><dt>Capital original</dt><dd>{formatCOP(debt.principal)}</dd></div><div><dt>Tasa inicial pactada</dt><dd>{debt.monthlyRate} % mensual vencido</dd></div><div><dt>Desembolso</dt><dd>{dateLabel(debt.startDate)} {debt.startDate.slice(0, 4)}</dd></div><div><dt>Frecuencia</dt><dd>Mensual · día {debt.dueDay}</dd></div><div><dt>Plan</dt><dd>{debt.installments} cuotas · {methods[debt.method]}</dd></div><div><dt>Vencimiento final proyectado</dt><dd>{dateLabel(rows[rows.length - 1].date)} {rows[rows.length - 1].date.slice(0, 4)}</dd></div><div><dt>Gracia a capital</dt><dd>{debt.graceMonths ?? 0} meses</dd></div><div><dt>Garantía</dt><dd>{debt.guarantee || 'Sin garantía registrada'}</dd></div></dl>}<div className="inline-note"><span><strong>Condiciones y contrato</strong><br />{debt.notes || 'No se han registrado condiciones adicionales.'}</span></div>{debt.contract?.dataUrl && <a className="button button-secondary" href={debt.contract.dataUrl} download={debt.contract.name}><ArrowDownToLine size={16} /> Descargar contrato</a>}{Boolean(debt.rateChanges?.length) && <p className="muted">Cambios pactados: {debt.rateChanges!.map(change => `cuota ${change.period}: ${change.monthlyRate} % mensual`).join(' · ')}.</p>}</>}
  </Modal>;
}

function PaymentModal({ state, actor, debt, mutate, onClose }: ViewProps & { debt: Debt; onClose: () => void }) {
  const next = getUpcomingObligations(state, DEMO_DATE).find(row => row.debtId === debt.id);
  const accounts = state.accounts.filter(account => account.locationId === debt.locationId && account.active && account.kind !== 'ledger');
  const [principal, setPrincipal] = useState(next?.principal ?? '0.00');
  const [interest, setInterest] = useState(next?.interest ?? '0.00');
  const [date, setDate] = useState(DEMO_DATE);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [appliedRate, setAppliedRate] = useState(debt.monthlyRate);
  const [support, setSupport] = useState<Support>();
  const [loadingSupport, setLoadingSupport] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const amount = totalOrZero(principal, interest);
  async function attach(file: File | undefined) {
    setSupport(undefined); setError(''); if (!file) return;
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Adjunta un PDF o imagen de hasta 5 MB.'); return; }
    setLoadingSupport(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('No fue posible leer el soporte.')); reader.readAsDataURL(file); });
      setSupport({ name: file.name, size: file.size, type: file.type, dataUrl });
    } catch (reason) { setError(errorMessage(reason)); } finally { setLoadingSupport(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try {
      const input = { debtId: debt.id, accountId, date, principal: money(principal), interest: money(interest), amount: add(principal, interest), appliedMonthlyRate: appliedRate, support, idempotencyKey };
      const message = 'Pago solicitado. Requiere aprobación de otra persona autorizada.';
      if (mutate(current => recordDebtPayment(current, input, actor), message)) onClose();
      else setError('No fue posible registrar el pago. Revisa la cuenta, la distribución y el aviso.');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  return <Modal title="Registrar pago realizado" subtitle={`${debt.creditor} · Capital pendiente ${formatCOP(getDebtBalance(state, debt.id))}`} onClose={onClose}><form onSubmit={submit}>
    {!accounts.length&&<div className="inline-note note-warning"><Landmark size={18}/><p>Crea primero una cuenta de esta sede en Caja y cuentas. No se puede registrar un pago sin una cuenta de origen.</p></div>}
    <div className="inline-note note-warning"><CalendarDays size={18} /><span>Los valores sugeridos provienen del plan. Confirma los valores efectivamente pagados y su soporte antes de registrar.</span></div><div className="form-grid">
      <Field label="Fecha del pago"><input required type="date" max={DEMO_DATE} value={date} onChange={event => setDate(event.target.value)} /></Field><Field label="Cuenta de origen"><select required value={accountId} onChange={event => setAccountId(event.target.value)}>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
      <Field label="Abono a capital · COP"><input required inputMode="decimal" pattern={decimalPattern} value={principal} onChange={event => setPrincipal(event.target.value)} /></Field><Field label="Intereses pagados · COP"><input required inputMode="decimal" pattern={decimalPattern} value={interest} onChange={event => setInterest(event.target.value)} /></Field>
      <Field label="Total del pago · COP" hint="Capital + intereses, calculado con centavos exactos."><input readOnly value={amount} aria-label="Total exacto del pago" /></Field><Field label="Tasa mensual aplicada · %" hint="Una diferencia con la tasa pactada genera una alerta."><input required inputMode="decimal" pattern="\d+(\.\d{1,8})?" value={appliedRate} onChange={event => setAppliedRate(event.target.value)} /></Field>
      <Field label="Soporte del pago" hint="PDF, JPG, PNG o WebP · hasta 5 MB · guardado local en este navegador." full><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={event => void attach(event.target.files?.[0])} />{support && <small>{support.name}</small>}</Field>
    </div><label className="checkbox-label"><input required type="checkbox" /> Confirmo que este pago ya ocurrió y que la distribución es correcta.</label><div className="inline-note">Este pago requiere aprobación independiente; no afectará los saldos mientras esté pendiente.</div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit" disabled={loadingSupport || !accounts.length}>{loadingSupport ? 'Leyendo soporte…' : 'Registrar pago'}</button></div>
  </form></Modal>;
}
