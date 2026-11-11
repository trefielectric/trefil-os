'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  BadgeCheck,
  Calculator,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileCheck2,
  FileText,
  Landmark,
  Link2,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Store,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import {
  add,
  formatCOP,
  fromCents,
  getDebtBalance,
  money,
  todayBogota,
  toCents,
  type Debt,
  type State,
  type Support,
} from '@/lib/finance';
import * as debtDomain from '@/lib/debts';
import { InventoryProofInput } from './inventory-view';
import { SimulatorModal } from './debt-view';
import { Badge, Field, Modal } from './ui';
import { timestamp, type ViewProps } from './view-helpers';

export interface DebtsModuleProps extends ViewProps {
  integrations?: ReactNode;
  reports?: ReactNode;
  onOpenCash?: () => void;
}
type DebtCategory = 'entities' | 'investors' | 'suppliers' | 'recurring';
type DebtTab = 'portfolio' | 'documents' | 'payments' | 'calendar' | 'close' | 'reports' | 'integrations';
type DebtAction =
  | 'supplier_origin'
  | 'cashlink'
  | 'dossier'
  | 'plan'
  | 'reconcile'
  | 'renegotiate'
  | 'template'
  | 'bill'
  | 'bill_payment'
  | 'issue'
  | 'close'
  | 'supplier';
interface DebtDialog {
  kind: DebtAction | 'simulator' | 'detail';
  debtId?: string;
  entityId?: string;
}
const CATEGORIES: { id: DebtCategory; label: string; description: string; icon: typeof Landmark }[] = [
  {
    id: 'entities',
    label: 'Entidades financieras',
    description: 'Bancos, fondos y otras entidades',
    icon: Landmark,
  },
  { id: 'investors', label: 'Inversionistas', description: 'Capital y acuerdos documentados', icon: Users },
  { id: 'suppliers', label: 'Proveedores', description: 'Cuenta corriente por tercero', icon: Store },
  {
    id: 'recurring',
    label: 'Control de pagos',
    description: 'Recibos y obligaciones recurrentes',
    icon: CalendarDays,
  },
];
const TABS: { id: DebtTab; label: string; icon: typeof Landmark }[] = [
  { id: 'portfolio', label: 'Cartera y fichas', icon: Wallet },
  { id: 'documents', label: 'ORIGEN y planes', icon: FileCheck2 },
  { id: 'payments', label: 'Pagos y conciliación', icon: ArrowRightLeft },
  { id: 'calendar', label: 'Agenda de vencimientos', icon: CalendarDays },
  { id: 'close', label: 'Cierre mensual', icon: LockKeyhole },
  { id: 'reports', label: 'Informes', icon: FileText },
  { id: 'integrations', label: 'Integraciones', icon: Link2 },
];
const decimal = (raw: string) => raw.trim().replace(',', '.');
const field = (data: FormData, name: string) => String(data.get(name) ?? '').trim();
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Revisa los datos y vuelve a intentarlo.';
const nameFor = (category: DebtCategory) => CATEGORIES.find((row) => row.id === category)!.label;
function permitted(props: ViewProps) {
  return (
    props.state.members.some(
      (row) => row.id === props.actor.id && row.active && row.role === props.actor.role,
    ) && ['owner', 'admin', 'treasury', 'accounting'].includes(props.actor.role)
  );
}
function sourceHref(proof: Support | undefined): string | undefined {
  if (
    !proof?.dataUrl ||
    !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(proof.type) ||
    !Number.isSafeInteger(proof.size) ||
    proof.size <= 0 ||
    proof.size > 5 * 1024 * 1024
  )
    return;
  const prefix = `data:${proof.type};base64,`;
  if (!proof.dataUrl.startsWith(prefix)) return;
  const encoded = proof.dataUrl.slice(prefix.length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return;
  const size = (encoded.length / 4) * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  return size === proof.size ? proof.dataUrl : undefined;
}
function EvidenceLink({ proof, label }: { proof?: Support; label?: string }) {
  const href = sourceHref(proof);
  return href ? (
    <a className="debts-support-link" href={href} download={proof!.name}>
      <FileText size={13} />
      {label ?? proof!.name}
    </a>
  ) : (
    <span className="debts-secondary-text">{proof ? 'Archivo no disponible' : 'Documento pendiente'}</span>
  );
}
function Notice({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return <div className={`debts-notice${warning ? ' debts-warning' : ''}`}>{children}</div>;
}
function Card({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="debts-card">
      <div className="debts-card-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Empty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="debts-empty">
      <FileCheck2 size={25} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Summary({ label, amount, note }: { label: string; amount: string; note: string }) {
  return (
    <div className="debts-summary-card">
      <span>{label}</span>
      <strong>{amount}</strong>
      <small>{note}</small>
    </div>
  );
}
function FormError({ message }: { message: string }) {
  return message ? (
    <p className="form-error" role="alert">
      {message}
    </p>
  ) : null;
}
function proofRequired(proof: Support | undefined, label = 'El documento de soporte'): Support {
  if (!proof)
    throw new Error(`${label} es obligatorio. Adjunta el archivo y espera a que termine de leerlo.`);
  return proof;
}
function DateField({
  label = 'Fecha efectiva',
  name = 'date',
  future = false,
  defaultValue,
}: {
  label?: string;
  name?: string;
  future?: boolean;
  defaultValue?: string;
}) {
  return (
    <Field label={label}>
      <input
        required
        name={name}
        type="date"
        defaultValue={defaultValue ?? ''}
        max={future ? undefined : todayBogota()}
      />
    </Field>
  );
}
function AmountField({ label, name, optional = false }: { label: string; name: string; optional?: boolean }) {
  return (
    <Field
      label={label}
      hint={
        optional
          ? 'Deja en blanco únicamente si este concepto no aplica.'
          : 'Valor documental. Si es cero, escríbelo expresamente.'
      }
    >
      <input name={name} inputMode="decimal" required={!optional} placeholder="Sin informar" />
    </Field>
  );
}
function NotesField({
  label = 'Observaciones y justificación',
  required = true,
}: {
  label?: string;
  required?: boolean;
}) {
  return (
    <Field label={label} full>
      <textarea
        name="notes"
        required={required}
        maxLength={2000}
        placeholder={
          required
            ? 'Explica la fuente y el hecho documentado'
            : 'Información adicional para conservar en el historial'
        }
      />
    </Field>
  );
}
function ReferenceField({
  label = 'Número del documento',
  name = 'reference',
}: {
  label?: string;
  name?: string;
}) {
  return (
    <Field label={label}>
      <input name={name} required autoComplete="off" placeholder="Referencia real y única" maxLength={200} />
    </Field>
  );
}
function LocationField({ props }: { props: ViewProps }) {
  const member = props.state.members.find((row) => row.id === props.actor.id && row.active);
  return (
    <Field label="Sede de la obligación">
      <select name="locationId" required defaultValue={props.location === 'all' ? '' : props.location}>
        <option value="">Selecciona la sede</option>
        {props.state.locations
          .filter((row) => member?.locationIds.includes(row.id))
          .map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
      </select>
    </Field>
  );
}
function Footer({
  onClose,
  busy,
  disabled = false,
  label = 'Guardar registro documental',
}: {
  onClose: () => void;
  busy: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="debts-form-actions">
      <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
        Cancelar
      </button>
      <button type="submit" disabled={busy || disabled} className="button button-primary">
        {busy ? 'Leyendo documento…' : label}
      </button>
    </div>
  );
}

export function DebtsModule(props: DebtsModuleProps) {
  const [category, setCategory] = useState<DebtCategory>('entities');
  const [tab, setTab] = useState<DebtTab>('portfolio');
  const [dialog, setDialog] = useState<DebtDialog | null>(null);
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState(todayBogota().slice(0, 7));
  const prefix = useId();
  const module = debtDomain.getDebtModuleState(props.state);
  const member = props.state.members.find((row) => row.id === props.actor.id && row.active);
  const allowed = new Set(member?.locationIds ?? []);
  const inScope = (locationId: string) =>
    allowed.has(locationId) && (props.location === 'all' || props.location === locationId);
  const kind = category === 'entities' ? 'loan' : category === 'investors' ? 'investment' : 'supplier';
  const debts = props.state.debts.filter((debt) => debt.kind === kind && inScope(debt.locationId));
  const ids = new Set(debts.map((debt) => debt.id));
  const metadata = module.obligations.filter((row) => ids.has(row.debtId));
  const calendar = debtDomain
    .getDebtCalendar(props.state, todayBogota(), {
      ...(category === 'recurring'
        ? {}
        : {
            category:
              category === 'entities'
                ? ('bank' as const)
                : category === 'investors'
                  ? ('investment' as const)
                  : ('supplier' as const),
          }),
      ...(props.location === 'all' ? {} : { locationId: props.location }),
    })
    .filter((row) => inScope(row.locationId));
  const templates = module.recurringTemplates.filter((row) => inScope(row.locationId));
  const templateIds = new Set(templates.map((row) => row.id));
  const bills = module.recurringBills.filter((row) => templateIds.has(row.templateId));
  const writable = permitted(props);
  const filtered = debts.filter((debt) =>
    `${debt.creditor} ${module.obligations.find((row) => row.debtId === debt.id)?.documentReference ?? debt.supplierInvoice ?? ''}`
      .toLocaleLowerCase('es')
      .includes(search.toLocaleLowerCase('es')),
  );
  const payments = [
    ...debtDomain
      .getActualDebtModulePayments(props.state)
      .filter((row) => ids.has(row.debtId))
      .map((row) => ({ ...row, status: 'posted' as const })),
    ...props.state.debtPayments.filter((row) => ids.has(row.debtId) && row.status !== 'posted'),
  ];
  const upcoming = calendar
    .filter((row) => row.remaining !== '0.00')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const paidPrincipal =
    category === 'recurring'
      ? fromCents(
          bills.reduce(
            (total, bill) =>
              total +
              toCents(bill.amount) -
              toCents(debtDomain.getRecurringBillBalance(props.state, bill.id)),
            0n,
          ),
        )
      : add(
          ...debtDomain
            .getActualDebtModulePayments(props.state)
            .filter((row) => ids.has(row.debtId))
            .map((row) => row.principal),
        );
  const capital =
    category === 'recurring'
      ? add(...bills.map((bill) => debtDomain.getRecurringBillBalance(props.state, bill.id)))
      : add(...debts.map((debt) => getDebtBalance(props.state, debt.id)));
  const open = (kind: DebtDialog['kind'], debtId?: string, entityId?: string) =>
    setDialog({ kind, debtId, entityId });
  return (
    <div className="debts-workspace">
      <div className="debts-header">
        <div>
          <div className="eyebrow">MÓDULO 03 · OBLIGACIONES Y VENCIMIENTOS</div>
          <h2>Cada compromiso, con su respaldo</h2>
          <p>
            Documenta el origen, distingue capital de intereses y confirma cada pago desde el libro de Caja.
            El plan oficial y el simulador conservan propósitos diferentes.
          </p>
        </div>
        <button type="button" className="button button-secondary" onClick={() => open('simulator')}>
          <Calculator size={16} />
          Simular financiación
        </button>
      </div>
      <Notice>
        <ShieldCheck size={17} />
        <p>
          Registro local en este navegador. No existe conexión operativa institucional con bancos o Supabase.
          Los ORÍGENES bancarios históricos, renegociaciones y excepciones que requieren autorización
          permanecen pendientes; no se simulan identidades, códigos ni aprobaciones.
        </p>
      </Notice>
      <div className="debts-layout">
        <nav className="debts-selector" aria-label="Categoría de deudas">
          <span>Obligaciones</span>
          {CATEGORIES.map(({ id, label, description, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === category}
              onClick={() => {
                setCategory(id);
                setSearch('');
              }}
            >
              <Icon size={20} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="debts-content">
          <div className="debts-navigation" role="tablist" aria-label="Control de obligaciones">
            {TABS.filter(
              (row) =>
                (row.id !== 'integrations' || props.integrations) && (row.id !== 'reports' || props.reports),
            ).map(({ id, label, icon: Icon }, index, all) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`${prefix}-${id}`}
                aria-selected={tab === id}
                aria-controls={`${prefix}-panel`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={(event) => {
                  let next: number | undefined;
                  if (event.key === 'ArrowRight') next = (index + 1) % all.length;
                  else if (event.key === 'ArrowLeft') next = (index + all.length - 1) % all.length;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = all.length - 1;
                  if (next !== undefined) {
                    event.preventDefault();
                    setTab(all[next].id);
                    event.currentTarget.parentElement
                      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                      [next]?.focus();
                  }
                }}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          <div
            className="debts-panel"
            id={`${prefix}-panel`}
            role="tabpanel"
            aria-labelledby={`${prefix}-${tab}`}
          >
            <div className="debts-toolbar">
              <div>
                <h3>{nameFor(category)}</h3>
                <p>
                  {category === 'recurring'
                    ? 'Recibos recibidos cada mes, consumo informado y pagos reales, sin duplicar cuotas bancarias ni compromisos de inversionistas.'
                    : category === 'suppliers'
                      ? 'Directorio y cuenta corriente: facturas a crédito, pagos reales, chatarra y devoluciones reconocidas.'
                      : 'Expedientes documentales, planes oficiales, pagos y conciliación por acreedor.'}
                </p>
              </div>
              <Field label="Período de revisión">
                <input
                  type="month"
                  max={todayBogota().slice(0, 7)}
                  value={month}
                  onChange={(event) => {
                    if (event.target.value && event.target.value <= todayBogota().slice(0, 7))
                      setMonth(event.target.value);
                  }}
                />
              </Field>
            </div>
            {tab === 'portfolio' && (
              <>
                <div className="debts-summary">
                  <Summary
                    label={category === 'recurring' ? 'Recibos pendientes por pagar' : 'Capital pendiente'}
                    amount={formatCOP(capital)}
                    note="Calculado desde documentos y aplicaciones confirmadas"
                  />
                  <Summary
                    label={category === 'recurring' ? 'Pagos aplicados a recibos' : 'Capital pagado'}
                    amount={formatCOP(paidPrincipal)}
                    note="Incluye pagos de Caja vinculados y confirmados"
                  />
                  <Summary
                    label="Próximos y vencidos"
                    amount={String(upcoming.length)}
                    note="Agenda documental, sin cuotas simuladas"
                  />
                  <Summary
                    label={category === 'recurring' ? 'Recibos del período' : 'Expedientes pendientes'}
                    amount={String(
                      category === 'recurring'
                        ? bills.filter((bill) => bill.month === month).length
                        : debts.filter(
                            (debt) =>
                              !metadata.some(
                                (row) =>
                                  row.debtId === debt.id &&
                                  (row.status === 'documented' ||
                                    (row.originMode === 'cash_new' &&
                                      debtDomain.getDebtCapitalBasis(props.state, debt.id) ===
                                        debt.principal)),
                              ),
                          ).length,
                    )}
                    note="Los documentos ausentes no se presumen completos"
                  />
                </div>
                {category === 'suppliers' && (
                  <SupplierDirectory
                    {...props}
                    onCreate={() => open('supplier')}
                    onOrigin={() => open('supplier_origin')}
                  />
                )}
                {upcoming[0] && (
                  <div className="debts-upcoming-banner">
                    <CalendarDays size={18} />
                    <p>
                      <strong>
                        {upcoming[0].status === 'overdue' ? 'Vencimiento pendiente' : 'Próxima obligación'}:{' '}
                        {upcoming[0].creditor}
                      </strong>
                      <br />
                      {upcoming[0].dueDate} · Pendiente {formatCOP(upcoming[0].remaining)} ·{' '}
                      {upcoming[0].concept}
                    </p>
                    <button className="debts-text-button" onClick={() => setTab('calendar')}>
                      Ver agenda
                    </button>
                  </div>
                )}
                {category === 'recurring' ? (
                  <RecurringPortfolio
                    {...props}
                    onTemplate={() => open('template')}
                    onBill={() => open('bill')}
                    onPayment={(billId) => open('bill_payment', undefined, billId)}
                  />
                ) : (
                  <>
                    <div className="debts-toolbar">
                      <Field label="Buscar acreedor o documento">
                        <span className="debts-actions">
                          <Search size={15} />
                          <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Buscar en las obligaciones"
                          />
                        </span>
                      </Field>
                      <div className="debts-actions">
                        {writable && category !== 'suppliers' && (
                          <button className="button button-primary" onClick={() => open('dossier')}>
                            <Plus size={16} />
                            Abrir expediente documental
                          </button>
                        )}
                        {category === 'suppliers' && props.integrations && (
                          <button className="button button-primary" onClick={() => setTab('integrations')}>
                            <Store size={16} />
                            Compras y cuenta del proveedor
                          </button>
                        )}
                      </div>
                    </div>
                    {!filtered.length ? (
                      <Empty
                        title={
                          search
                            ? 'No encontramos ese acreedor'
                            : category === 'suppliers'
                              ? 'Tu cuenta de proveedores empieza vacía'
                              : 'Todavía no hay obligaciones en esta categoría'
                        }
                        description={
                          category === 'suppliers'
                            ? 'Registra proveedores reales y facturas con vencimiento manual en Integraciones. Una compra a crédito no produce una salida ficticia de Caja.'
                            : 'Abre un expediente con sus documentos reales. Este registro no crea un segundo desembolso ni supone aprobación institucional.'
                        }
                        action={
                          writable && category !== 'suppliers' ? (
                            <button className="button button-primary" onClick={() => open('dossier')}>
                              Crear primer expediente
                            </button>
                          ) : undefined
                        }
                      />
                    ) : (
                      <div className="debts-card-grid">
                        {filtered.map((debt) => {
                          const record = metadata.find((row) => row.debtId === debt.id);
                          const funded = debtDomain.getDebtCapitalBasis(props.state, debt.id);
                          const fundedFull = record?.originMode === 'cash_new' && funded === debt.principal;
                          const fundedPartial =
                            record?.originMode === 'cash_new' && toCents(funded) > 0n && !fundedFull;
                          const due = calendar.find(
                            (row) => row.debtId === debt.id && row.remaining !== '0.00',
                          );
                          return (
                            <article className="debts-account-card" key={debt.id}>
                              <div className="debts-record-state">
                                <Badge
                                  tone={record?.status === 'documented' || fundedFull ? 'green' : 'orange'}
                                >
                                  {record?.status === 'documented'
                                    ? 'Documentado'
                                    : record?.status === 'pending_institutional'
                                      ? 'Autorización pendiente'
                                      : fundedFull
                                        ? 'Desembolso confirmado'
                                        : fundedPartial
                                          ? 'Desembolso parcial confirmado'
                                          : record?.status === 'draft_funding'
                                            ? 'Desembolso por vincular'
                                            : 'Expediente incompleto'}
                                </Badge>
                              </div>
                              <div>
                                <h3>{debt.creditor}</h3>
                                <p>
                                  {record?.concept ?? debt.notes ?? 'Condiciones pendientes de documentar'}
                                  <br />
                                  {record?.documentReference ??
                                    debt.supplierInvoice ??
                                    'Documento de origen pendiente'}
                                </p>
                              </div>
                              <strong>{formatCOP(getDebtBalance(props.state, debt.id))}</strong>
                              <p>
                                Capital pendiente ·{' '}
                                {props.state.locations.find((row) => row.id === debt.locationId)?.name}
                                <br />
                                {due
                                  ? `Próximo pendiente: ${due.dueDate} · ${formatCOP(due.remaining)}`
                                  : 'Sin vencimiento oficial pendiente registrado'}
                              </p>
                              <div className="debts-actions">
                                <button className="debts-text-button" onClick={() => open('detail', debt.id)}>
                                  Consultar expediente
                                </button>
                                {writable && debt.kind !== 'supplier' && (
                                  <button className="debts-text-button" onClick={() => open('plan', debt.id)}>
                                    Registrar plan oficial
                                  </button>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {tab === 'documents' && (
              <>
                <Notice warning>
                  <FileCheck2 size={17} />
                  <p>
                    El plan oficial se transcribe desde el documento del acreedor: fechas y cinco componentes
                    reales de cada cuota. El simulador genera proyecciones y no sustituye ese documento.
                  </p>
                </Notice>
                {category === 'recurring' ? (
                  <Empty
                    title="Los recibos se confirman cada mes"
                    description="Las obligaciones de servicios, arriendo y otros conceptos se documentan en Cartera y fichas. Las cuotas de entidades e inversionistas aparecen desde sus propios planes, sin plantillas duplicadas."
                    action={
                      <button className="button button-secondary" onClick={() => setTab('portfolio')}>
                        Revisar recibos
                      </button>
                    }
                  />
                ) : (
                  <>
                    <div className="debts-toolbar">
                      <p>Conserva el acuerdo original y todas las versiones posteriores.</p>
                      <div className="debts-actions">
                        {writable && category !== 'suppliers' && (
                          <button className="button button-primary" onClick={() => open('dossier')}>
                            <Plus size={16} />
                            Registrar expediente
                          </button>
                        )}
                      </div>
                    </div>
                    {debts.length ? (
                      <Card
                        title="ORIGEN y soportes"
                        description="Un registro histórico bancario autorizado permanece pendiente hasta verificar la identidad institucional."
                      >
                        <div className="debts-table-wrap">
                          <table className="debts-table">
                            <thead>
                              <tr>
                                <th>Acreedor y documento</th>
                                <th>Origen y estado</th>
                                <th>Soportes</th>
                                <th>Acciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {debts.map((debt) => {
                                const record = metadata.find((row) => row.debtId === debt.id);
                                return (
                                  <tr key={debt.id}>
                                    <td>
                                      <strong>{debt.creditor}</strong>
                                      <small>
                                        {record?.documentReference ??
                                          debt.supplierInvoice ??
                                          'Sin documento de origen'}
                                      </small>
                                    </td>
                                    <td>
                                      {record?.originDate ?? debt.startDate}
                                      <small>
                                        {record?.originMode === 'historical_bank_request'
                                          ? 'ORIGEN bancario sujeto a autorización'
                                          : record?.originMode === 'cash_new'
                                            ? 'Préstamo nuevo: Caja confirma el desembolso'
                                            : record?.originMode.startsWith('historical')
                                              ? 'ORIGEN histórico documentado'
                                              : 'Documento pendiente'}
                                      </small>
                                    </td>
                                    <td>
                                      <div className="debts-document-links">
                                        <EvidenceLink proof={record?.support ?? debt.contract} />
                                        {record?.bankStatement && (
                                          <EvidenceLink
                                            proof={record.bankStatement}
                                            label="Extracto de la entidad"
                                          />
                                        )}
                                        {record?.initialReceipt && (
                                          <EvidenceLink
                                            proof={record.initialReceipt}
                                            label="Recibo inicial del dinero"
                                          />
                                        )}
                                      </div>
                                    </td>
                                    <td>
                                      <div className="debts-actions">
                                        {writable && !record && (
                                          <button
                                            className="debts-text-button"
                                            onClick={() => open('dossier', debt.id)}
                                          >
                                            Completar expediente
                                          </button>
                                        )}
                                        {writable && debt.kind !== 'supplier' && (
                                          <button
                                            className="debts-text-button"
                                            onClick={() => open('plan', debt.id)}
                                          >
                                            Añadir plan oficial
                                          </button>
                                        )}
                                        {writable && debt.kind === 'investment' && (
                                          <button
                                            className="debts-text-button"
                                            onClick={() => open('renegotiate', debt.id)}
                                          >
                                            Solicitar renegociación
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    ) : (
                      <Empty
                        title="No hay documentos de esta categoría"
                        description="El módulo empieza sin contratos, extractos ni saldos de ejemplo."
                      />
                    )}
                    <OfficialPlanHistory {...props} debtIds={ids} />
                  </>
                )}
              </>
            )}
            {tab === 'payments' && (
              <>
                <Notice>
                  <Wallet size={17} />
                  <p>
                    Los pagos efectivos proceden de Caja. Aplicar un pago existente a una cuota no registra
                    otro egreso; capital, intereses, seguros, comisiones y mora se mantienen separados.
                  </p>
                </Notice>
                <div className="debts-toolbar">
                  <p>Conciliaciones y aplicaciones documentales del período.</p>
                  {props.onOpenCash && (
                    <button className="button button-primary" onClick={props.onOpenCash}>
                      <Link2 size={16} />
                      Registrar pago desde Caja
                    </button>
                  )}
                </div>
                {category === 'recurring' ? (
                  <RecurringPortfolio
                    {...props}
                    compact
                    onTemplate={() => open('template')}
                    onBill={() => open('bill')}
                    onPayment={(billId) => open('bill_payment', undefined, billId)}
                  />
                ) : (
                  <>
                    <Card
                      title="Pagos registrados en Caja"
                      description="Solo los pagos contabilizados disminuyen capital; las solicitudes pendientes conservan su estado."
                    >
                      {payments.length ? (
                        <div className="debts-table-wrap">
                          <table className="debts-table">
                            <thead>
                              <tr>
                                <th>Fecha y acreedor</th>
                                <th>Capital</th>
                                <th>Interés</th>
                                <th>Seguros / cargos / mora</th>
                                <th>Estado y aplicación</th>
                              </tr>
                            </thead>
                            <tbody>
                              {payments
                                .slice()
                                .sort((a, b) => b.date.localeCompare(a.date))
                                .map((payment) => (
                                  <tr key={payment.id}>
                                    <td>
                                      {payment.date}
                                      <small>
                                        {debts.find((debt) => debt.id === payment.debtId)?.creditor} ·{' '}
                                        {
                                          props.state.transactions.find(
                                            (row) => row.id === payment.transactionId,
                                          )?.reference
                                        }
                                      </small>
                                    </td>
                                    <td className="debts-number">{formatCOP(payment.principal)}</td>
                                    <td className="debts-number">{formatCOP(payment.interest)}</td>
                                    <td>
                                      <small>Seguros {formatCOP(payment.insurance ?? '0.00')}</small>
                                      <small>Cargos {formatCOP(payment.commission ?? '0.00')}</small>
                                      <small>Mora {formatCOP(payment.lateFee ?? '0.00')}</small>
                                    </td>
                                    <td>
                                      <Badge
                                        tone={
                                          payment.status === 'posted'
                                            ? 'green'
                                            : payment.status === 'pending'
                                              ? 'orange'
                                              : 'red'
                                        }
                                      >
                                        {payment.status === 'posted'
                                          ? 'Contabilizado'
                                          : payment.status === 'pending'
                                            ? 'Por aprobar'
                                            : 'Rechazado'}
                                      </Badge>
                                      {payment.status === 'posted' && writable && (
                                        <button
                                          className="debts-text-button"
                                          onClick={() => open('detail', payment.debtId, payment.id)}
                                        >
                                          Aplicar a cuota oficial
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="debts-card-body debts-secondary-text">
                          No hay pagos registrados de estas obligaciones. Una tabla proyectada no representa
                          pagos realizados.
                        </p>
                      )}
                    </Card>
                    <div className="debts-record-grid">
                      {debts.map((debt) => (
                        <div className="debts-operation" key={debt.id}>
                          <h3>{debt.creditor}</h3>
                          <p>
                            Confronta capital pendiente con el extracto y conserva la diferencia, el documento
                            y las observaciones.
                          </p>
                          <div className="debts-actions">
                            {debt.kind !== 'supplier' && (
                              <button
                                className="button button-secondary"
                                disabled={!writable}
                                onClick={() => open('reconcile', debt.id)}
                              >
                                Conciliar extracto
                              </button>
                            )}
                            <button
                              className="debts-text-button"
                              disabled={!writable}
                              onClick={() => open('cashlink', debt.id)}
                            >
                              Vincular egreso existente
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <ReconciliationHistory {...props} debtIds={ids} />
                  </>
                )}
              </>
            )}
            {tab === 'calendar' && <CalendarPanel entries={calendar} onCash={props.onOpenCash} />}
            {tab === 'close' && (
              <DebtClosurePanel {...props} month={month} onCloseRequest={() => open('close')} />
            )}
            {tab === 'reports' && props.reports}
            {tab === 'integrations' && props.integrations}
          </div>
        </div>
      </div>
      {dialog?.kind === 'simulator' ? (
        <SimulatorModal notify={props.notify} onClose={() => setDialog(null)} />
      ) : dialog?.kind === 'detail' ? (
        <DebtDossierDetail
          {...props}
          debtId={dialog.debtId!}
          paymentId={dialog.entityId}
          onClose={() => setDialog(null)}
          onPlan={() => setDialog({ kind: 'plan', debtId: dialog.debtId })}
          onRenegotiate={() => setDialog({ kind: 'renegotiate', debtId: dialog.debtId })}
        />
      ) : (
        dialog && (
          <DebtModuleModal
            {...props}
            category={category}
            action={dialog.kind}
            debtId={dialog.debtId}
            entityId={dialog.entityId}
            month={month}
            onClose={() => setDialog(null)}
          />
        )
      )}
    </div>
  );
}

function CalendarPanel({
  entries,
  onCash,
}: {
  entries: ReturnType<typeof debtDomain.getDebtCalendar>;
  onCash?: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'overdue'>('pending');
  const visible = entries
    .filter((row) =>
      filter === 'all' ? true : filter === 'overdue' ? row.status === 'overdue' : row.remaining !== '0.00',
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return (
    <>
      <div className="debts-toolbar">
        <div className="debts-category-pills">
          {(
            [
              { id: 'all', label: 'Todos' },
              { id: 'pending', label: 'Pendientes' },
              { id: 'overdue', label: 'Vencidos' },
            ] as const
          ).map((row) => (
            <button
              key={row.id}
              type="button"
              aria-pressed={filter === row.id}
              onClick={() => setFilter(row.id)}
            >
              {row.label}
            </button>
          ))}
        </div>
        {onCash && (
          <button className="button button-secondary" onClick={onCash}>
            Ir a Caja
          </button>
        )}
      </div>
      <Notice>
        <CalendarDays size={17} />
        <p>
          Agenda local agregada desde cuotas oficiales, facturas de proveedor y recibos confirmados. No crea
          plantillas recurrentes adicionales para obligaciones ya registradas.
        </p>
      </Notice>
      {!visible.length ? (
        <Empty
          title="Sin vencimientos documentados en esta vista"
          description="Las fechas aparecen al registrar un plan oficial, una factura de proveedor o un recibo recibido. No se crean cuotas a partir de una simulación."
        />
      ) : (
        <Card
          title="Agenda documental"
          description="El estado considera aplicaciones confirmadas y conserva los pagos parciales."
        >
          <div className="debts-table-wrap">
            <table className="debts-table">
              <thead>
                <tr>
                  <th>Vencimiento</th>
                  <th>Acreedor / concepto</th>
                  <th>Fuente</th>
                  <th>Programado</th>
                  <th>Aplicado</th>
                  <th>Pendiente</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>{row.dueDate}</td>
                    <td>
                      <strong>{row.creditor}</strong>
                      <small>{row.concept}</small>
                    </td>
                    <td>
                      {row.source === 'official_installment'
                        ? 'Cuota del plan oficial'
                        : row.source === 'supplier_invoice'
                          ? 'Factura de proveedor'
                          : 'Recibo confirmado'}
                    </td>
                    <td className="debts-number">{formatCOP(row.amount)}</td>
                    <td className="debts-number">{formatCOP(row.paidAmount)}</td>
                    <td className="debts-number">{formatCOP(row.remaining)}</td>
                    <td>
                      <Badge
                        tone={row.status === 'paid' ? 'green' : row.status === 'overdue' ? 'red' : 'orange'}
                      >
                        {row.status === 'paid'
                          ? 'Pagado'
                          : row.status === 'overdue'
                            ? 'Vencido'
                            : row.status === 'partially_paid'
                              ? 'Pago parcial'
                              : row.status === 'future'
                                ? 'Futuro'
                                : 'Próximo'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
function RecurringPortfolio(
  props: ViewProps & {
    compact?: boolean;
    onTemplate: () => void;
    onBill: () => void;
    onPayment: (id: string) => void;
  },
) {
  const module = debtDomain.getDebtModuleState(props.state);
  const templates = module.recurringTemplates.filter(
    (row) => props.location === 'all' || row.locationId === props.location,
  );
  const ids = new Set(templates.map((row) => row.id));
  const bills = module.recurringBills
    .filter((row) => ids.has(row.templateId))
    .sort((a, b) => b.month.localeCompare(a.month));
  return (
    <>
      {!props.compact && (
        <>
          <div className="debts-toolbar">
            <p>Crea el concepto una sola vez y confirma cada recibo mensual real.</p>
            <div className="debts-actions">
              {permitted(props) && (
                <>
                  <button className="button button-secondary" onClick={props.onTemplate}>
                    <Plus size={16} />
                    Crear concepto recurrente
                  </button>
                  <button
                    className="button button-primary"
                    disabled={!templates.some((row) => row.active)}
                    onClick={props.onBill}
                  >
                    <FileCheck2 size={16} />
                    Confirmar recibo recibido
                  </button>
                </>
              )}
            </div>
          </div>
          {templates.length > 0 && (
            <Card
              title="Conceptos recurrentes"
              description="Los importes no se presuponen; Administración los confirma con cada recibo."
            >
              <div className="debts-table-wrap">
                <table className="debts-table">
                  <thead>
                    <tr>
                      <th>Concepto y acreedor</th>
                      <th>Sede</th>
                      <th>Consumo, si aplica</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.name}</strong>
                          <small>
                            {row.creditor} · {row.concept}
                          </small>
                        </td>
                        <td>
                          {props.state.locations.find((location) => location.id === row.locationId)?.name}
                        </td>
                        <td>{row.consumptionUnit ?? 'No registrado'}</td>
                        <td>
                          <Badge tone={row.active ? 'green' : 'neutral'}>
                            {row.active ? 'Activo' : 'Inactivo'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
      {!bills.length ? (
        <Empty
          title="No hay recibos recibidos"
          description="Un concepto recurrente no presume que llegó la factura ni crea un valor por pagar. Confirma fecha, documento, consumo cuando aplique y vencimiento real."
        />
      ) : (
        <Card
          title="Recibos y saldos pendientes"
          description="Un saldo reconocido puede quedar pendiente al cierre. Su pago posterior conserva el recibo y el reporte originales."
        >
          <div className="debts-table-wrap">
            <table className="debts-table">
              <thead>
                <tr>
                  <th>Período y recibo</th>
                  <th>Concepto</th>
                  <th>Vencimiento</th>
                  <th>Valor cobrado</th>
                  <th>Pendiente</th>
                  <th>Consumo</th>
                  <th>Comprobante / aplicación</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => {
                  const template = templates.find((row) => row.id === bill.templateId)!;
                  const remaining = debtDomain.getRecurringBillBalance(props.state, bill.id);
                  return (
                    <tr key={bill.id}>
                      <td>
                        <strong>{bill.month}</strong>
                        <small>
                          {bill.reference} · Recibido {bill.receivedDate}
                        </small>
                      </td>
                      <td>
                        {template.name}
                        <small>{template.creditor}</small>
                      </td>
                      <td>{bill.dueDate}</td>
                      <td className="debts-number">{formatCOP(bill.amount)}</td>
                      <td className="debts-number">{formatCOP(remaining)}</td>
                      <td>
                        {bill.consumption === undefined
                          ? 'Sin dato'
                          : `${bill.consumption} ${bill.consumptionUnit ?? ''}`}
                      </td>
                      <td>
                        <EvidenceLink proof={bill.support} />
                        {permitted(props) && remaining !== '0.00' && (
                          <button className="debts-text-button" onClick={() => props.onPayment(bill.id)}>
                            Vincular pago real de Caja
                          </button>
                        )}
                        {module.recurringPayments
                          .filter((row) => row.billId === bill.id)
                          .map((row) => (
                            <small key={row.id}>
                              {row.date} · {formatCOP(row.amount)} ·{' '}
                              {props.state.transactions.find(
                                (transaction) => transaction.id === row.transactionId,
                              )?.reference ?? 'Comprobante conservado'}
                            </small>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
function OfficialPlanHistory(props: ViewProps & { debtIds: Set<string> }) {
  const module = debtDomain.getDebtModuleState(props.state);
  const plans = module.officialPlans
    .filter((plan) => props.debtIds.has(plan.debtId))
    .slice()
    .reverse();
  return plans.length ? (
    <Card
      title="Planes oficiales y versiones conservadas"
      description="Cada versión mantiene documento fuente, vigencia, motivo y componentes. No se recalculan cuotas retrospectivamente."
    >
      <div className="debts-card-body debts-timeline">
        {plans.map((plan) => (
          <div key={plan.id}>
            <strong>
              {props.state.debts.find((debt) => debt.id === plan.debtId)?.creditor} · {plan.reference} ·
              Versión {plan.version}
            </strong>
            <small>
              Vigencia {plan.effectiveDate} · {plan.installments.length} cuotas · {plan.reason}
            </small>
            <EvidenceLink proof={plan.support} />
            <details>
              <summary>Ver cuotas documentadas</summary>
              <OfficialRows plan={plan} />
            </details>
          </div>
        ))}
      </div>
    </Card>
  ) : null;
}
function OfficialRows({
  plan,
}: {
  plan: ReturnType<typeof debtDomain.getDebtModuleState>['officialPlans'][number];
}) {
  return (
    <div className="debts-table-wrap">
      <table className="debts-table">
        <thead>
          <tr>
            <th>Cuota</th>
            <th>Vencimiento</th>
            <th>Capital</th>
            <th>Interés</th>
            <th>Seguro</th>
            <th>Comisión / cargos</th>
            <th>Mora</th>
            <th>Total oficial</th>
          </tr>
        </thead>
        <tbody>
          {plan.installments.map((row) => (
            <tr key={row.id}>
              <td>{row.number}</td>
              <td>{row.dueDate}</td>
              <td>{formatCOP(row.principal)}</td>
              <td>{formatCOP(row.interest)}</td>
              <td>{formatCOP(row.insurance)}</td>
              <td>{formatCOP(row.commission)}</td>
              <td>{formatCOP(row.lateFee)}</td>
              <td className="debts-number">{formatCOP(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ReconciliationHistory(props: ViewProps & { debtIds: Set<string> }) {
  const records = debtDomain
    .getDebtModuleState(props.state)
    .reconciliations.filter((row) => props.debtIds.has(row.debtId));
  return records.length ? (
    <Card
      title="Extractos conciliados y diferencias"
      description="Conserva el saldo del documento y el libro en el momento de la revisión."
    >
      <div className="debts-table-wrap">
        <table className="debts-table">
          <thead>
            <tr>
              <th>Acreedor / fecha</th>
              <th>Capital del extracto</th>
              <th>Capital del libro</th>
              <th>Diferencia</th>
              <th>Estado y soporte</th>
            </tr>
          </thead>
          <tbody>
            {records
              .slice()
              .reverse()
              .map((row) => (
                <tr key={row.id}>
                  <td>
                    {props.state.debts.find((debt) => debt.id === row.debtId)?.creditor}
                    <small>
                      {row.date} · {row.reference}
                    </small>
                  </td>
                  <td>{formatCOP(row.statementPrincipal)}</td>
                  <td>{formatCOP(row.bookPrincipal)}</td>
                  <td>{formatCOP(row.difference)}</td>
                  <td>
                    <Badge tone={row.status === 'matched' ? 'green' : 'red'}>
                      {row.status === 'matched' ? 'Coincide en este corte' : 'Diferencia abierta'}
                    </Badge>
                    <EvidenceLink proof={row.support} />
                    <small>{row.notes}</small>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Card>
  ) : null;
}

interface DebtFormProps extends ViewProps {
  category: DebtCategory;
  action: DebtAction;
  debtId?: string;
  entityId?: string;
  month: string;
  onClose: () => void;
}
const ACTION_TITLE: Record<DebtAction, string> = {
  supplier_origin: 'Documentar ORIGEN de proveedor',
  cashlink: 'Vincular pago existente con desglose',
  dossier: 'Expediente documental y ORIGEN',
  plan: 'Registrar plan oficial del acreedor',
  reconcile: 'Conciliar extracto y capital pendiente',
  renegotiate: 'Solicitar renegociación con soporte',
  template: 'Crear concepto recurrente',
  bill: 'Confirmar recepción del recibo mensual',
  bill_payment: 'Vincular pago real de Caja',
  issue: 'Documentar revisión de novedad',
  close: 'Revisar y conservar cierre local',
  supplier: 'Directorio del proveedor',
};
export function DebtModuleModal(props: DebtFormProps) {
  return (
    <Modal
      title={ACTION_TITLE[props.action]}
      subtitle={`${nameFor(props.category)} · Registro local con trazabilidad`}
      wide
      onClose={props.onClose}
    >
      <div className="debts-dialog">
        {props.action === 'supplier_origin' ? (
          <SupplierOriginForm {...props} />
        ) : props.action === 'supplier' ? (
          <SupplierForm {...props} />
        ) : props.action === 'cashlink' ? (
          <CashPaymentLinkForm {...props} />
        ) : props.action === 'dossier' ? (
          <DossierForm {...props} />
        ) : props.action === 'plan' ? (
          <PlanForm {...props} />
        ) : props.action === 'reconcile' ? (
          <ReconcileForm {...props} />
        ) : props.action === 'renegotiate' ? (
          <AuthorizationForm {...props} />
        ) : props.action === 'template' ? (
          <TemplateForm {...props} />
        ) : props.action === 'bill' ? (
          <BillForm {...props} />
        ) : props.action === 'bill_payment' ? (
          <BillPaymentForm {...props} />
        ) : props.action === 'close' ? (
          <CloseForm {...props} />
        ) : (
          <ReviewForm {...props} />
        )}
      </div>
    </Modal>
  );
}
function useForm(props: Pick<ViewProps, 'mutate'> & { onClose: () => void }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(0);
  const onBusy = (busy: boolean) => setPending((count) => Math.max(0, count + (busy ? 1 : -1)));
  const submit = (
    event: FormEvent<HTMLFormElement>,
    apply: (state: State, data: FormData) => State,
    message: string,
  ) => {
    event.preventDefault();
    setError('');
    if (pending) {
      setError('Espera a que finalice la lectura de todos los documentos.');
      return;
    }
    try {
      const data = new FormData(event.currentTarget);
      if (props.mutate((current) => apply(current, data), message)) props.onClose();
    } catch (error) {
      setError(errorText(error));
    }
  };
  return { error, busy: pending > 0, onBusy, submit };
}
function DossierForm(props: DebtFormProps) {
  const form = useForm(props);
  const existing = props.state.debts.find((row) => row.id === props.debtId);
  const isBank = (existing?.kind ?? (props.category === 'entities' ? 'loan' : 'investment')) === 'loan';
  const [originMode, setOriginMode] = useState('');
  const [mainProof, setMainProof] = useState<Support>();
  const [statement, setStatement] = useState<Support>();
  const [receipt, setReceipt] = useState<Support>();
  return (
    <form
      className="debts-form"
      onSubmit={(event) =>
        form.submit(
          event,
          (state, data) => {
            const support = proofRequired(
              mainProof,
              isBank ? 'El plan de amortización oficial' : 'El contrato o acuerdo original',
            );
            const common = {
              debtId: existing?.id ?? '',
              originMode: originMode as debtDomain.DebtOriginMode,
              concept: field(data, 'concept'),
              documentReference: field(data, 'reference'),
              originDate: field(data, 'startDate'),
              openingPrincipal: money(
                decimal(
                  originMode === 'cash_new'
                    ? (existing?.principal ?? field(data, 'principal'))
                    : field(data, 'openingPrincipal'),
                ),
              ),
              openingAsOfDate: originMode === 'cash_new' ? undefined : field(data, 'openingAsOfDate'),
              terminationDate: field(data, 'terminationDate'),
              interestRule: field(data, 'interestRule'),
              statedInterest: money(decimal(field(data, 'statedInterest'))),
              bankStatement: isBank ? proofRequired(statement, 'El extracto de la entidad') : undefined,
              officialPlanSupport: isBank ? support : undefined,
              initialReceipt: !isBank ? proofRequired(receipt, 'El recibo inicial del dinero') : undefined,
              contract: !isBank ? support : undefined,
              support,
            };
            if (existing) return debtDomain.recordDebtObligationMetadata(state, common, props.actor);
            return debtDomain.registerDebtObligation(
              state,
              {
                ...common,
                creditor: field(data, 'creditor'),
                kind: isBank ? 'loan' : 'investment',
                principal: money(decimal(field(data, 'principal'))),
                monthlyRate: decimal(field(data, 'monthlyRate')),
                installments: Number(field(data, 'installments')),
                startDate: common.originDate,
                dueDay: Number(field(data, 'dueDay')),
                method: field(data, 'method') as Debt['method'],
                locationId: field(data, 'locationId'),
                notes: field(data, 'notes'),
                guarantee: field(data, 'guarantee') || undefined,
              },
              props.actor,
            );
          },
          originMode === 'historical_bank_request'
            ? 'Expediente histórico conservado, pendiente de autorización institucional de Creador o Gerente.'
            : 'Expediente registrado sin crear un ingreso de Caja ni una cuota simulada.',
        )
      }
    >
      <Notice warning>
        <ShieldCheck size={17} />
        <p>
          {isBank
            ? 'El ORIGEN bancario histórico requiere autorización de Creador o Gerente. Una ficha de préstamo nuevo queda pendiente de vincular el ingreso real de Caja; no crea otro desembolso.'
            : 'Conserva contrato y recibo inicial. La ficha no duplica el ingreso de dinero; una renegociación posterior se solicita con versión y autorización institucional.'}
        </p>
      </Notice>
      <FormError message={form.error} />
      <div className="debts-form-grid">
        <Field label="Modalidad del ORIGEN">
          <select required value={originMode} onChange={(event) => setOriginMode(event.target.value)}>
            <option value="">Selecciona la fuente documentada</option>
            <option value="cash_new">Préstamo / capital nuevo: vincular ingreso real en Caja</option>
            <option value={isBank ? 'historical_bank_request' : 'historical_investment'}>
              {isBank
                ? 'ORIGEN bancario histórico: solicitar autorización'
                : 'ORIGEN histórico desde recibo inicial'}
            </option>
          </select>
        </Field>
        <Field label={isBank ? 'Entidad financiera' : 'Inversionista'}>
          <input
            name="creditor"
            required
            defaultValue={existing?.creditor}
            readOnly={Boolean(existing)}
            placeholder="Nombre real del acreedor"
          />
        </Field>
        <ReferenceField label="Documento de la obligación" />
        <Field label="Concepto de la obligación">
          <input required name="concept" placeholder="Objeto del préstamo o inversión" />
        </Field>
        <DateField
          label="Fecha de inicio / recibo inicial"
          name="startDate"
          defaultValue={existing?.startDate}
        />
        <Field label="Capital original documentado · COP">
          <input
            name="principal"
            inputMode="decimal"
            required
            defaultValue={existing?.principal}
            readOnly={Boolean(existing)}
            placeholder="Sin informar"
          />
        </Field>
        {originMode !== 'cash_new' && (
          <>
            <AmountField
              label="Saldo de capital pendiente al ORIGEN histórico · COP"
              name="openingPrincipal"
            />
            <DateField label="Fecha de corte del saldo de ORIGEN" name="openingAsOfDate" />
          </>
        )}
        <DateField name="terminationDate" label="Fecha pactada de terminación" future />
        <AmountField name="statedInterest" label="Valor de intereses según documento · COP" />
        <Field label="Regla contractual de intereses">
          <textarea
            name="interestRule"
            required
            placeholder="Transcribe la regla pactada, periodicidad y devolución de capital"
          />
        </Field>
        {!existing && (
          <>
            <AmountField name="monthlyRate" label="Tasa mensual documentada · %" />
            <Field label="Número total de cuotas según acuerdo">
              <input
                required
                name="installments"
                type="number"
                min="1"
                max="600"
                placeholder="Sin informar"
              />
            </Field>
            <Field label="Día de vencimiento pactado">
              <input required name="dueDay" type="number" min="1" max="31" placeholder="Sin informar" />
            </Field>
            <Field label="Método pactado, para simulación separada">
              <select required name="method" defaultValue="">
                <option value="">Selecciona el método documentado</option>
                <option value="fixed_payment">Cuota fija</option>
                <option value="fixed_principal">Capital fijo</option>
                <option value="interest_only">Interés y capital al final</option>
              </select>
            </Field>
            <LocationField props={props} />
            <Field label="Garantía, si existe">
              <input name="guarantee" placeholder="Sin garantía documentada si no aplica" />
            </Field>
          </>
        )}
      </div>
      {existing && (
        <p className="debts-hint">
          La obligación existente conserva su capital, pagos y condiciones. Completar los documentos no
          reemplaza su historia ni realiza una renegociación.
        </p>
      )}
      {isBank ? (
        <>
          <InventoryProofInput
            label="Extracto obligatorio de la entidad"
            onChange={setStatement}
            onBusy={form.onBusy}
          />
          <InventoryProofInput
            label="Plan de amortización oficial obligatorio"
            onChange={setMainProof}
            onBusy={form.onBusy}
          />
        </>
      ) : (
        <>
          <InventoryProofInput
            label="Contrato o acuerdo original"
            onChange={setMainProof}
            onBusy={form.onBusy}
          />
          <InventoryProofInput
            label="Recibo inicial del dinero obligatorio"
            onChange={setReceipt}
            onBusy={form.onBusy}
          />
        </>
      )}
      <NotesField />
      <Footer
        onClose={props.onClose}
        busy={form.busy}
        label={
          originMode === 'historical_bank_request'
            ? 'Conservar ORIGEN pendiente de autorización'
            : 'Guardar expediente sin duplicar Caja'
        }
      />
    </form>
  );
}
interface PlanDraft {
  key: string;
  number: string;
  dueDate: string;
  principal: string;
  interest: string;
  insurance: string;
  commission: string;
  lateFee: string;
}
const blankPlan = (): PlanDraft => ({
  key: crypto.randomUUID(),
  number: '',
  dueDate: '',
  principal: '',
  interest: '',
  insurance: '',
  commission: '',
  lateFee: '',
});
function PlanForm(props: DebtFormProps) {
  const form = useForm(props);
  const [proof, setProof] = useState<Support>();
  const [rows, setRows] = useState<PlanDraft[]>(() => [blankPlan()]);
  const debt = props.state.debts.find((row) => row.id === props.debtId);
  const update = (index: number, key: keyof PlanDraft, next: string) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [key]: next } : row)));
  return (
    <form
      className="debts-form"
      onSubmit={(event) =>
        form.submit(
          event,
          (state, data) =>
            debtDomain.recordOfficialDebtPlan(
              state,
              {
                debtId: props.debtId!,
                reference: field(data, 'reference'),
                effectiveDate: field(data, 'date'),
                support: proofRequired(proof),
                reason: field(data, 'notes'),
                installments: rows.map((row, index) => {
                  for (const key of ['principal', 'interest', 'insurance', 'commission', 'lateFee'] as const)
                    if (!row[key].trim())
                      throw new Error(
                        `Completa los cinco componentes de la cuota ${index + 1}; escribe 0 expresamente si no aplica.`,
                      );
                  const components = {
                    principal: money(decimal(row.principal)),
                    interest: money(decimal(row.interest)),
                    insurance: money(decimal(row.insurance)),
                    commission: money(decimal(row.commission)),
                    lateFee: money(decimal(row.lateFee)),
                  };
                  return {
                    ...components,
                    number: Number(row.number),
                    dueDate: row.dueDate,
                    amount: add(...Object.values(components)),
                    notes: '',
                  };
                }),
              },
              props.actor,
            ),
          'Plan oficial conservado como una nueva versión; no se modificaron las cuotas históricas.',
        )
      }
    >
      <Notice warning>
        <FileCheck2 size={17} />
        <p>
          {debt?.creditor}. Transcribe las cuotas del documento oficial, incluidos ceros expresos. El sistema
          suma los cinco conceptos; no calcula ni inventa intereses. Un plan posterior conserva todas las
          versiones previas.
        </p>
      </Notice>
      <FormError message={form.error} />
      <div className="debts-form-grid">
        <ReferenceField label="Referencia del plan oficial" />
        <DateField label="Vigencia del plan" />
      </div>
      <div className="debts-plan-editor">
        <div className="debts-plan-title">
          Capital, interés, seguro, comisión/cargos y mora son obligatorios. Los campos vacíos no significan
          cero.
        </div>
        {rows.map((row, index) => (
          <div className="debts-plan-row" key={row.key}>
            <Field label="N.º cuota">
              <input
                type="number"
                min="1"
                max="600"
                required
                value={row.number}
                placeholder="Número oficial"
                aria-label={`Número oficial de la cuota del renglón ${index + 1}`}
                onChange={(event) => update(index, 'number', event.target.value)}
              />
            </Field>
            <Field label="Vencimiento">
              <input
                type="date"
                required
                value={row.dueDate}
                onChange={(event) => update(index, 'dueDate', event.target.value)}
              />
            </Field>
            {(
              [
                { key: 'principal', label: 'Capital COP' },
                { key: 'interest', label: 'Interés COP' },
                { key: 'insurance', label: 'Seguro COP' },
                { key: 'commission', label: 'Comisión COP' },
                { key: 'lateFee', label: 'Mora COP' },
              ] as const
            ).map(({ key, label }) => (
              <Field label={label} key={key}>
                <input
                  required
                  inputMode="decimal"
                  placeholder="Sin informar"
                  value={row[key]}
                  onChange={(event) => update(index, key, event.target.value)}
                />
              </Field>
            ))}
            <button
              type="button"
              aria-label={`Quitar cuota ${index + 1}`}
              disabled={rows.length === 1}
              onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="debts-text-button"
        type="button"
        onClick={() => setRows((current) => [...current, blankPlan()])}
      >
        <Plus size={15} />
        Añadir cuota documentada
      </button>
      <NotesField label="Motivo y documento de esta versión" />
      <InventoryProofInput
        label="Documento oficial del plan completo"
        onChange={setProof}
        onBusy={form.onBusy}
      />
      <Footer onClose={props.onClose} busy={form.busy} label="Conservar nueva versión oficial" />
    </form>
  );
}
function ReconcileForm(props: DebtFormProps) {
  const form = useForm(props);
  const [proof, setProof] = useState<Support>();
  return (
    <form
      className="debts-form"
      onSubmit={(event) =>
        form.submit(
          event,
          (state, data) =>
            debtDomain.reconcileDebtStatement(
              state,
              {
                debtId: props.debtId!,
                date: field(data, 'date'),
                reference: field(data, 'reference'),
                statementPrincipal: money(decimal(field(data, 'principal'))),
                support: proofRequired(proof),
                notes: field(data, 'notes'),
              },
              props.actor,
            ),
          'Conciliación documental conservada; la diferencia no ajustó el capital.',
        )
      }
    >
      <Notice>
        <FileCheck2 size={17} />
        <p>
          Compara el capital pendiente del extracto con el libro a esta fecha. La diferencia permanece visible
          y no modifica la obligación.
        </p>
      </Notice>
      <FormError message={form.error} />
      <div className="debts-form-grid">
        <DateField label="Fecha de corte del extracto" />
        <ReferenceField label="Número de extracto" />
        <AmountField name="principal" label="Capital pendiente según extracto · COP" />
      </div>
      <NotesField />
      <InventoryProofInput
        label="Extracto de la entidad o acreedor"
        onChange={setProof}
        onBusy={form.onBusy}
      />
      <Footer onClose={props.onClose} busy={form.busy} label="Guardar conciliación sin ajustar saldo" />
    </form>
  );
}
function AuthorizationForm(props: DebtFormProps) {
  const form = useForm(props);
  const [proof, setProof] = useState<Support>();
  return (
    <form
      className="debts-form"
      onSubmit={(event) =>
        form.submit(
          event,
          (state, data) =>
            debtDomain.requestDebtAuthorization(
              state,
              {
                debtId: props.debtId,
                kind: 'investment_renegotiation',
                reason: field(data, 'notes'),
                effectiveDate: field(data, 'date'),
                proposedPrincipal: field(data, 'principal')
                  ? money(decimal(field(data, 'principal')))
                  : undefined,
                proposedMonthlyRate: field(data, 'monthlyRate')
                  ? decimal(field(data, 'monthlyRate'))
                  : undefined,
                proposedTerminationDate: field(data, 'terminationDate') || undefined,
                proposedConditions: field(data, 'conditions'),
                support: proofRequired(proof),
              },
              props.actor,
            ),
          'Renegociación solicitada. El contrato vigente y su historia permanecen conservados.',
        )
      }
    >
      <Notice warning>
        <ShieldCheck size={17} />
        <p>
          La renegociación requiere autorización institucional de Creador o Gerente. Esta solicitud conserva
          las condiciones propuestas y el acuerdo original; no cambia capital, tasas o vencimientos de forma
          retroactiva.
        </p>
      </Notice>
      <FormError message={form.error} />
      <div className="debts-form-grid">
        <DateField label="Fecha de vigencia propuesta" future />
        <AmountField name="principal" label="Capital propuesto · COP" optional />
        <AmountField name="monthlyRate" label="Tasa mensual propuesta · %" optional />
        <Field label="Fecha de terminación propuesta">
          <input name="terminationDate" type="date" />
        </Field>
        <Field label="Periodicidad y condiciones propuestas" full>
          <textarea
            name="conditions"
            required
            placeholder="Capital, intereses, periodicidad, plazos y fundamento documental"
          />
        </Field>
      </div>
      <NotesField label="Justificación de la renegociación" />
      <InventoryProofInput
        label="Acuerdo de renegociación propuesto"
        onChange={setProof}
        onBusy={form.onBusy}
      />
      <Footer onClose={props.onClose} busy={form.busy} label="Guardar solicitud pendiente" />
    </form>
  );
}

function TemplateForm(props: DebtFormProps) {
  const form = useForm(props);
  return (
    <form
      className="debts-form"
      onSubmit={(event) =>
        form.submit(
          event,
          (state, data) =>
            debtDomain.createRecurringDebtTemplate(
              state,
              {
                name: field(data, 'name'),
                creditor: field(data, 'creditor'),
                concept: field(data, 'concept'),
                locationId: field(data, 'locationId'),
                frequency: 'monthly',
                dueDay: field(data, 'dueDay') ? Number(field(data, 'dueDay')) : undefined,
                consumptionUnit: field(data, 'unit') || undefined,
                active: true,
              },
              props.actor,
            ),
          'Concepto recurrente creado sin importe, factura ni pago ficticios.',
        )
      }
    >
      <Notice warning>
        <CalendarDays size={17} />
        <p>
          Solo servicios, arriendo y otros conceptos recurrentes independientes. Las cuotas bancarias e
          intereses de inversionistas se toman de sus obligaciones y planes: no los registres de nuevo aquí.
        </p>
      </Notice>
      <FormError message={form.error} />
      <div className="debts-form-grid">
        <Field label="Nombre del concepto">
          <input name="name" required placeholder="Concepto real de la empresa" />
        </Field>
        <Field label="Acreedor / prestador">
          <input name="creditor" required placeholder="Tercero del recibo" />
        </Field>
        <Field label="Detalle de la obligación">
          <input name="concept" required />
        </Field>
        <LocationField props={props} />
        <Field label="Día habitual de vencimiento, si está pactado">
          <input name="dueDay" type="number" min="1" max="31" placeholder="Sin valor predeterminado" />
        </Field>
        <Field label="Unidad de consumo, si aplica">
          <input name="unit" placeholder="Unidad consignada en el recibo" />
        </Field>
      </div>
      <Footer onClose={props.onClose} busy={form.busy} label="Crear concepto sin importe automático" />
    </form>
  );
}
function BillForm(props: DebtFormProps) {
  const form = useForm(props);
  const [proof, setProof] = useState<Support>();
  const [templateId, setTemplateId] = useState('');
  const templates = debtDomain
    .getDebtModuleState(props.state)
    .recurringTemplates.filter(
      (row) => row.active && (props.location === 'all' || row.locationId === props.location),
    );
  const template = templates.find((row) => row.id === templateId);
  return (
    <form
      className="debts-form"
      onSubmit={(event) =>
        form.submit(
          event,
          (state, data) =>
            debtDomain.registerRecurringDebtBill(
              state,
              {
                templateId,
                month: field(data, 'month'),
                reference: field(data, 'reference'),
                invoiceDate: field(data, 'invoiceDate'),
                receivedDate: field(data, 'receivedDate'),
                dueDate: field(data, 'dueDate'),
                amount: money(decimal(field(data, 'amount'))),
                support: proofRequired(proof),
                consumption: field(data, 'consumption') ? decimal(field(data, 'consumption')) : undefined,
                consumptionUnit: field(data, 'consumption')
                  ? field(data, 'unit') || template?.consumptionUnit
                  : undefined,
                notes: field(data, 'notes'),
              },
              props.actor,
            ),
          'Recepción del recibo confirmada con su importe y vencimiento reales. No se registró un pago.',
        )
      }
    >
      <Notice>
        <FileCheck2 size={17} />
        <p>
          Administración confirma el recibo de este período. El importe y el vencimiento son manuales y
          corresponden al documento; un consumo vacío se conserva como ausencia de dato.
        </p>
      </Notice>
      <FormError message={form.error} />
      <div className="debts-form-grid">
        <Field label="Concepto recurrente">
          <select required value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            <option value="">Selecciona el concepto real</option>
            {templates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} · {row.creditor}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Período facturado">
          <input
            type="month"
            name="month"
            defaultValue={props.month}
            max={todayBogota().slice(0, 7)}
            required
          />
        </Field>
        <ReferenceField label="Factura o recibo mensual" />
        <DateField name="invoiceDate" label="Fecha del recibo" />
        <DateField name="receivedDate" label="Fecha de recepción confirmada" />
        <DateField name="dueDate" label="Vencimiento consignado en el recibo" future />
        <AmountField name="amount" label="Valor realmente cobrado · COP" />
        <Field label="Consumo real, cuando aplique">
          <input name="consumption" inputMode="decimal" placeholder="Sin dato si no aplica" />
        </Field>
        <Field label="Unidad del consumo">
          <input
            name="unit"
            key={templateId}
            defaultValue={template?.consumptionUnit}
            placeholder="Unidad del documento"
          />
        </Field>
      </div>
      <NotesField required={false} />
      <InventoryProofInput
        label="Factura o recibo mensual recibido"
        onChange={setProof}
        onBusy={form.onBusy}
      />
      <Footer onClose={props.onClose} busy={form.busy} label="Confirmar recibo y obligación real" />
    </form>
  );
}
function BillPaymentForm(props: DebtFormProps) {
  const form = useForm(props);
  const module = debtDomain.getDebtModuleState(props.state);
  const bill = module.recurringBills.find((row) => row.id === props.entityId);
  const template = module.recurringTemplates.find((row) => row.id === bill?.templateId);
  const [key] = useState(() => crypto.randomUUID());
  const expenses = props.state.transactions.filter(
    (row) =>
      row.status === 'posted' &&
      row.kind === 'expense' &&
      !row.reversedBy &&
      row.locationId === template?.locationId &&
      row.party.trim().toLocaleLowerCase('es-CO') === template.creditor.trim().toLocaleLowerCase('es-CO'),
  );
  return (
    <form
      className="debts-form"
      onSubmit={(event) =>
        form.submit(
          event,
          (state, data) =>
            debtDomain.linkRecurringDebtPayment(
              state,
              {
                billId: props.entityId!,
                transactionId: field(data, 'transactionId'),
                amount: money(decimal(field(data, 'amount'))),
                idempotencyKey: key,
              },
              props.actor,
            ),
          'Pago existente vinculado al recibo. No se creó un segundo egreso de Caja.',
        )
      }
    >
      <Notice>
        <Link2 size={17} />
        <p>
          {template?.name} · {bill?.reference}. Vincula un egreso real del mismo acreedor y sede. Los abonos
          parciales conservan el saldo pendiente y su fecha de cancelación posterior.
        </p>
      </Notice>
      <FormError message={form.error} />
      <div className="debts-form-grid">
        <Field label="Egreso contabilizado de Caja">
          <select name="transactionId" defaultValue="" required>
            <option value="">Selecciona el comprobante real</option>
            {expenses.map((row) => (
              <option key={row.id} value={row.id}>
                {row.reference} · {row.date} · {formatCOP(row.amount)}
              </option>
            ))}
          </select>
        </Field>
        <AmountField name="amount" label="Importe de este pago aplicado al recibo · COP" />
      </div>
      {!expenses.length && (
        <p className="debts-hint">
          No hay egresos contabilizados para este acreedor y sede. Registra el pago en Caja y vuelve a esta
          ficha para vincularlo.
        </p>
      )}
      <Footer
        onClose={props.onClose}
        busy={form.busy}
        disabled={!expenses.length}
        label="Vincular pago sin duplicar Caja"
      />
    </form>
  );
}
function ReviewForm(props: DebtFormProps) {
  const form = useForm(props);
  const [proof, setProof] = useState<Support>();
  return (
    <form
      className="debts-form"
      onSubmit={(event) =>
        form.submit(
          event,
          (state, data) =>
            debtDomain.reviewDebtIssue(
              state,
              { alertId: props.entityId!, reason: field(data, 'notes'), support: proofRequired(proof) },
              props.actor,
            ),
          'Revisión documental conservada. Una causa activa permanece visible hasta resolverse.',
        )
      }
    >
      <Notice warning>
        <ClipboardList size={17} />
        <p>
          La revisión documenta el seguimiento y su evidencia. No cancela un saldo pendiente, no modifica una
          aplicación y no declara conciliada una diferencia activa.
        </p>
      </Notice>
      <FormError message={form.error} />
      <NotesField label="Revisión, acciones realizadas y pendientes" />
      <InventoryProofInput label="Soporte de la revisión" onChange={setProof} onBusy={form.onBusy} />
      <Footer onClose={props.onClose} busy={form.busy} label="Guardar revisión sin ocultar la novedad" />
    </form>
  );
}
function DebtClosurePanel(props: DebtsModuleProps & { month: string; onCloseRequest: () => void }) {
  const checklist = debtDomain.getDebtMonthChecklist(props.state, { month: props.month });
  const module = debtDomain.getDebtModuleState(props.state);
  const closure = module.monthClosures.find((row) => row.month === props.month);
  const issues = debtDomain
    .getDebtModuleAlerts(props.state)
    .filter((row) => props.location === 'all' || row.locationId === props.location);
  const [reviewId, setReviewId] = useState<string>();
  const [reviewKey, setReviewKey] = useState(0);
  return (
    <>
      <Notice warning>
        <LockKeyhole size={17} />
        <p>
          Un pendiente reconocido por pagar se informa y no bloquea por sí solo el cierre. El cierre conserva
          una versión local y no sustituye la autorización institucional, cuya matriz completa sigue pendiente
          de definición.
        </p>
      </Notice>
      <div className="debts-summary">
        <Summary
          label="Estado del mes"
          amount={closure ? 'Cerrado localmente' : checklist.canClose ? 'Revisión completa' : 'Pendiente'}
          note={closure ? `Versión ${closure.version} conservada` : 'No se borran obligaciones pendientes'}
        />
        <Summary
          label="Controles que bloquean"
          amount={String(checklist.items.filter((row) => row.blocking).length)}
          note="Diferencias y documentos sin revisión"
        />
        <Summary
          label="Obligaciones al cierre"
          amount={formatCOP(checklist.report.totals.closingBalance)}
          note="Incluye pendientes reconocidos"
        />
      </div>
      <Card
        title={`Revisión del período · ${props.month}`}
        description="El informe diferencia pagos reales, capital, cargos, abonos no monetarios y pendientes."
      >
        <div className="debts-card-body">
          <div className="debts-checklist">
            {checklist.items.length ? (
              checklist.items.map((row) => (
                <div key={row.id} className={row.blocking ? '' : 'debts-check-ok'}>
                  {row.blocking ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                  <span>
                    {row.label}
                    {!row.blocking && ' · Informativo, no bloquea por sí solo'}
                  </span>
                </div>
              ))
            ) : (
              <div className="debts-check-ok">
                <CheckCircle2 size={16} />
                <span>Controles locales completados.</span>
              </div>
            )}
          </div>
          {!closure && (
            <div className="debts-form-actions">
              <button
                className="button button-primary"
                disabled={!checklist.canClose || !permitted(props)}
                onClick={props.onCloseRequest}
              >
                Revisar y conservar cierre local
              </button>
            </div>
          )}
          {closure && (
            <p className="debts-hint">
              Conservado el {timestamp(closure.closedAt)}. Los pagos posteriores se reflejan en su fecha real
              y no reescriben este informe.
            </p>
          )}
        </div>
      </Card>
      {issues.length > 0 && (
        <Card
          title="Novedades y seguimiento"
          description="Una revisión documental no oculta la causa activa."
        >
          <div className="debts-card-body">
            {issues.map((issue) => (
              <div className="debts-issue-review" key={issue.id}>
                <div className="debts-record-state">
                  <Badge
                    tone={
                      issue.severity === 'critical' ? 'red' : issue.status === 'resolved' ? 'green' : 'orange'
                    }
                  >
                    {issue.status === 'resolved' ? 'Resuelta' : 'Novedad abierta'}
                  </Badge>
                  <h4>{issue.title}</h4>
                </div>
                <p>
                  {issue.description} · {issue.date}
                  {issue.amount ? ` · ${formatCOP(issue.amount)}` : ''}
                </p>
                {module.reviews
                  .filter((row) => row.alertId === issue.id)
                  .map((row) => (
                    <div className="debts-secondary-text" key={row.id}>
                      {row.reason} · {timestamp(row.createdAt)} <EvidenceLink proof={row.support} />
                    </div>
                  ))}
                {permitted(props) && (
                  <button
                    type="button"
                    className="debts-text-button"
                    onClick={() => {
                      setReviewId(issue.id);
                      setReviewKey((key) => key + 1);
                    }}
                  >
                    Documentar revisión
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      {module.monthClosures.length > 0 && (
        <Card
          title="Histórico de cierres locales"
          description="Cada versión mantiene sus pendientes y observaciones originales."
        >
          <div className="debts-table-wrap">
            <table className="debts-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Versión</th>
                  <th>Fecha</th>
                  <th>Estado documental</th>
                  <th>Saldo al corte</th>
                </tr>
              </thead>
              <tbody>
                {module.monthClosures.map((row) => (
                  <tr key={row.id}>
                    <td>{row.month}</td>
                    <td>{row.version}</td>
                    <td>{timestamp(row.closedAt)}</td>
                    <td>
                      <Badge tone={row.report.reconciled ? 'green' : 'orange'}>
                        {row.report.reconciled ? 'Conciliado localmente' : 'Con novedades informadas'}
                      </Badge>
                    </td>
                    <td>{formatCOP(row.report.totals.closingBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {reviewId && (
        <DebtModuleModal
          key={reviewKey}
          {...props}
          category={
            issues.find((row) => row.id === reviewId)?.category === 'investment'
              ? 'investors'
              : issues.find((row) => row.id === reviewId)?.category === 'supplier'
                ? 'suppliers'
                : issues.find((row) => row.id === reviewId)?.category === 'recurring'
                  ? 'recurring'
                  : 'entities'
          }
          action="issue"
          entityId={reviewId}
          month={props.month}
          onClose={() => setReviewId(undefined)}
        />
      )}
    </>
  );
}
function CloseForm(props: DebtFormProps) {
  const form = useForm(props);
  const checklist = debtDomain.getDebtMonthChecklist(props.state, { month: props.month });
  return (
    <form
      className="debts-form"
      onSubmit={(event) =>
        form.submit(
          event,
          (state, data) =>
            debtDomain.closeDebtMonth(
              state,
              { month: props.month, notes: field(data, 'notes') },
              props.actor,
            ),
          'Cierre local y versión de informe conservados con sus pendientes reconocidos.',
        )
      }
    >
      <Notice warning>
        <LockKeyhole size={17} />
        <p>
          Cierre local de {props.month}. Los saldos pendientes reconocidos quedan informados; los pagos
          posteriores conservarán su fecha y documento originales. No se simula una autorización
          institucional.
        </p>
      </Notice>
      <FormError message={form.error} />
      <NotesField label="Revisión y observaciones del cierre" />
      <label className="debts-checkbox">
        <input type="checkbox" required />
        He revisado extractos, planes, pagos, novedades y pendientes; comprendo el alcance local de este
        cierre.
      </label>
      <Footer
        onClose={props.onClose}
        busy={form.busy}
        disabled={!checklist.canClose}
        label="Conservar cierre local y versión"
      />
    </form>
  );
}

export function DebtDossierDetail(
  props: ViewProps & {
    debtId: string;
    paymentId?: string;
    onClose: () => void;
    onPlan: () => void;
    onRenegotiate: () => void;
  },
) {
  const debt = props.state.debts.find((row) => row.id === props.debtId);
  const module = debtDomain.getDebtModuleState(props.state);
  const metadata = module.obligations.find((row) => row.debtId === props.debtId);
  const plans = module.officialPlans.filter((row) => row.debtId === props.debtId);
  const requests = module.requests.filter((row) => row.debtId === props.debtId);
  const capitalBasis = debt ? debtDomain.getDebtCapitalBasis(props.state, debt.id) : '0.00';
  if (!debt) return null;
  return (
    <Modal title={debt.creditor} subtitle="Expediente documental · Libro local" wide onClose={props.onClose}>
      <div className="debts-dialog debts-form">
        <div className="debts-summary">
          <Summary
            label="Capital pendiente"
            amount={formatCOP(getDebtBalance(props.state, debt.id))}
            note="Solo capital confirmado"
          />
          <Summary
            label="Planes oficiales"
            amount={String(plans.length)}
            note="Versiones anteriores conservadas"
          />
          <Summary
            label="Autorizaciones pendientes"
            amount={String(requests.length)}
            note="No se aplican con el perfil local"
          />
        </div>
        <Notice warning>
          <FileCheck2 size={17} />
          <p>
            {metadata?.status === 'pending_institutional'
              ? 'ORIGEN pendiente de autorización institucional.'
              : metadata?.status === 'draft_funding'
                ? capitalBasis === '0.00'
                  ? 'El desembolso está pendiente de vincular a un ingreso real de Caja.'
                  : `Desembolso ${capitalBasis === debt.principal ? 'confirmado' : 'parcial confirmado'} desde Caja: ${formatCOP(capitalBasis)}.`
                : !metadata
                  ? 'Expediente documental incompleto.'
                  : 'Origen documentado localmente.'}{' '}
            Las cuotas oficiales y sus aplicaciones se mantienen separadas de cualquier simulación.
          </p>
        </Notice>
        <dl className="debts-detail-list">
          <div>
            <dt>Documento de origen</dt>
            <dd>{metadata?.documentReference ?? debt.supplierInvoice ?? 'Pendiente'}</dd>
          </div>
          <div>
            <dt>Fecha original</dt>
            <dd>{metadata?.originDate ?? debt.startDate}</dd>
          </div>
          <div>
            <dt>Concepto</dt>
            <dd>{metadata?.concept ?? debt.notes ?? 'Pendiente de documentar'}</dd>
          </div>
          <div>
            <dt>Regla de intereses</dt>
            <dd>{metadata?.interestRule ?? 'Consultar acuerdo original'}</dd>
          </div>
          <div>
            <dt>Terminación pactada</dt>
            <dd>{metadata?.terminationDate ?? debt.supplierDueDate ?? 'Sin documento registrado'}</dd>
          </div>
          <div>
            <dt>Soporte original</dt>
            <dd>
              <EvidenceLink proof={metadata?.support ?? debt.contract} />
            </dd>
          </div>
        </dl>
        {metadata?.bankStatement && (
          <EvidenceLink proof={metadata.bankStatement} label="Descargar extracto de origen" />
        )}
        {metadata?.initialReceipt && (
          <EvidenceLink proof={metadata.initialReceipt} label="Descargar recibo inicial" />
        )}
        {props.paymentId ? (
          <PaymentAllocationForm {...props} paymentId={props.paymentId} />
        ) : (
          <>
            <div className="debts-actions">
              {permitted(props) && debt.kind !== 'supplier' && (
                <button type="button" className="button button-secondary" onClick={props.onPlan}>
                  Registrar plan oficial documentado
                </button>
              )}
              {permitted(props) && debt.kind === 'investment' && (
                <button type="button" className="button button-secondary" onClick={props.onRenegotiate}>
                  Solicitar renegociación
                </button>
              )}
            </div>
            {plans.length ? (
              plans
                .slice()
                .reverse()
                .map((plan) => (
                  <Card
                    key={plan.id}
                    title={`Plan ${plan.reference} · Versión ${plan.version}`}
                    description={`Vigencia ${plan.effectiveDate} · ${plan.reason}`}
                  >
                    <OfficialRows plan={plan} />
                    <div className="debts-card-body">
                      <EvidenceLink proof={plan.support} />
                    </div>
                  </Card>
                ))
            ) : (
              <p className="debts-hint">
                Todavía no hay cuotas oficiales transcritas. El simulador está disponible como proyección
                separada y no crea vencimientos ni pagos.
              </p>
            )}
          </>
        )}
        {requests.length > 0 && (
          <Card
            title="Acuerdos y solicitudes conservados"
            description="Una renegociación pendiente no sobrescribe el contrato original."
          >
            <div className="debts-card-body debts-timeline">
              {requests.map((row) => (
                <div key={row.id}>
                  <Badge tone="orange">Pendiente de autorización institucional</Badge>
                  <p>{row.reason}</p>
                  <small>
                    Vigencia propuesta {row.effectiveDate} · Capturado {timestamp(row.createdAt)}
                  </small>
                  <small>{row.proposedConditions}</small>
                  <EvidenceLink proof={row.support} />
                </div>
              ))}
            </div>
          </Card>
        )}
        <div className="debts-form-actions">
          <button type="button" className="button button-secondary" onClick={props.onClose}>
            Cerrar expediente
          </button>
        </div>
      </div>
    </Modal>
  );
}
function PaymentAllocationForm(
  props: ViewProps & { debtId: string; paymentId: string; onClose: () => void },
) {
  const form = useForm(props);
  const module = debtDomain.getDebtModuleState(props.state);
  const plans = module.officialPlans.filter((row) => row.debtId === props.debtId);
  const [planId, setPlanId] = useState('');
  const selected = plans.find((row) => row.id === planId);
  const payment = debtDomain
    .getActualDebtModulePayments(props.state, props.debtId)
    .find((row) => row.id === props.paymentId);
  const [extraordinary, setExtraordinary] = useState(false);
  const [extraordinaryProof, setExtraordinaryProof] = useState<Support>();
  const alreadyExtraordinary = module.extraordinaryPayments.find(
    (row) => row.debtPaymentId === props.paymentId,
  );
  const canClassify = Boolean(
    payment &&
    payment.principal === payment.amount &&
    !module.installmentAllocations.some((row) => row.debtPaymentId === payment.id),
  );

  if (alreadyExtraordinary)
    return (
      <Notice>
        <FileCheck2 size={17} />
        <p>Abono extraordinario documentado. {alreadyExtraordinary.reference}.</p>
        <EvidenceLink proof={alreadyExtraordinary.support} />
      </Notice>
    );
  const chooseExtraordinary = canClassify && (
    <button
      type="button"
      className="button button-secondary"
      onClick={() => setExtraordinary((value) => !value)}
    >
      {extraordinary ? 'Aplicar a una cuota' : 'Documentar abono extraordinario'}
    </button>
  );

  if (extraordinary) {
    return (
      <>
        <div className="debts-actions">{chooseExtraordinary}</div>
        <form
          className="debts-form"
          onSubmit={(event) =>
            form.submit(
              event,
              (state, data) =>
                debtDomain.documentExtraordinaryDebtPayment(
                  state,
                  {
                    debtPaymentId: props.paymentId,
                    reference: field(data, 'reference'),
                    notes: field(data, 'notes'),
                    support: proofRequired(extraordinaryProof),
                  },
                  props.actor,
                ),
              'Abono extraordinario documentado. Registra el nuevo plan cuando la entidad lo emita.',
            )
          }
        >
          <FormError message={form.error} />
          <ReferenceField label="Referencia del abono extraordinario" />
          <NotesField label="Justificación documental" />
          <InventoryProofInput
            label="Soporte del abono extraordinario"
            onChange={setExtraordinaryProof}
            onBusy={form.onBusy}
          />
          <Footer onClose={props.onClose} busy={form.busy} label="Guardar clasificación del abono" />
        </form>
      </>
    );
  }
  return (
    <>
      <div className="debts-actions">{chooseExtraordinary}</div>
      <form
        className="debts-form"
        onSubmit={(event) =>
          form.submit(
            event,
            (state, data) =>
              debtDomain.allocateDebtPayment(
                state,
                {
                  debtPaymentId: props.paymentId,
                  planId,
                  installmentId: field(data, 'installmentId'),
                  reference: field(data, 'reference'),
                  principal: money(decimal(field(data, 'principal'))),
                  interest: money(decimal(field(data, 'interest'))),
                  insurance: money(decimal(field(data, 'insurance'))),
                  commission: money(decimal(field(data, 'commission'))),
                  lateFee: money(decimal(field(data, 'lateFee'))),
                },
                props.actor,
              ),
            'Pago existente aplicado documentalmente a la cuota, sin registrar otro egreso ni reducir capital dos veces.',
          )
        }
      >
        <Notice>
          <Link2 size={17} />
          <p>
            Pago confirmado {payment?.date} · {payment ? formatCOP(payment.amount) : 'No disponible'}.
            Distribuye únicamente el importe real que corresponde a esta cuota. La aplicación documental no
            produce un nuevo movimiento de Caja.
          </p>
        </Notice>
        <FormError message={form.error} />
        <div className="debts-form-grid">
          <Field label="Versión del plan oficial">
            <select required value={planId} onChange={(event) => setPlanId(event.target.value)}>
              <option value="">Selecciona el plan documental</option>
              {plans.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.reference} · Versión {row.version} · Vigencia {row.effectiveDate}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cuota a la que corresponde">
            <select name="installmentId" required defaultValue="" key={planId}>
              <option value="">Selecciona la cuota oficial</option>
              {selected?.installments.map((row) => (
                <option value={row.id} key={row.id}>
                  Cuota {row.number} · {row.dueDate} · {formatCOP(row.amount)}
                </option>
              ))}
            </select>
          </Field>
          <ReferenceField label="Referencia de aplicación del pago" />
          {[
            { name: 'principal', label: 'Capital aplicado · COP' },
            { name: 'interest', label: 'Interés aplicado · COP' },
            { name: 'insurance', label: 'Seguro aplicado · COP' },
            { name: 'commission', label: 'Comisión / cargos aplicados · COP' },
            { name: 'lateFee', label: 'Mora aplicada · COP' },
          ].map((row) => (
            <AmountField key={row.name} {...row} />
          ))}
        </div>
        <Footer
          onClose={props.onClose}
          busy={form.busy}
          disabled={!payment || !plans.length}
          label="Aplicar pago existente a cuota"
        />
      </form>
    </>
  );
}
function CashPaymentLinkForm(props: DebtFormProps) {
  const form = useForm(props);
  const debt = props.state.debts.find((row) => row.id === props.debtId);
  const [key] = useState(() => crypto.randomUUID());
  const expenses = props.state.transactions.filter(
    (row) =>
      row.status === 'posted' &&
      row.kind === 'expense' &&
      !row.reversedBy &&
      row.locationId === debt?.locationId &&
      row.party.trim().toLocaleLowerCase('es-CO') === debt.creditor.trim().toLocaleLowerCase('es-CO'),
  );
  return (
    <form
      className="debts-form"
      onSubmit={(event) =>
        form.submit(
          event,
          (state, data) => {
            const parts = {
              principal: money(decimal(field(data, 'principal'))),
              interest: money(decimal(field(data, 'interest'))),
              insurance: money(decimal(field(data, 'insurance') || '0')),
              commission: money(decimal(field(data, 'commission') || '0')),
              lateFee: money(decimal(field(data, 'lateFee') || '0')),
            };
            return debtDomain.linkDebtCashPayment(
              state,
              {
                debtId: props.debtId!,
                transactionId: field(data, 'transactionId'),
                ...parts,
                amount: add(...Object.values(parts)),
                reference: field(data, 'reference'),
                idempotencyKey: key,
              },
              props.actor,
            );
          },
          'Egreso real vinculado a la obligación con su distribución; Caja no registró un segundo pago.',
        )
      }
    >
      <Notice warning>
        <Wallet size={17} />
        <p>
          {debt?.creditor}. Esta aplicación usa un gasto ya contabilizado en Caja. Capital e intereses
          requieren un valor explícito; los demás conceptos pueden quedar vacíos solo cuando no aplican. Una
          cuota no se considera íntegramente capital.
        </p>
      </Notice>
      <FormError message={form.error} />
      <div className="debts-form-grid">
        <Field label="Egreso real de Caja del mismo acreedor">
          <select name="transactionId" required defaultValue="">
            <option value="">Selecciona el comprobante</option>
            {expenses.map((row) => (
              <option value={row.id} key={row.id}>
                {row.reference} · {row.date} · {formatCOP(row.amount)}
              </option>
            ))}
          </select>
        </Field>
        <ReferenceField label="Referencia del pago aplicado" />
        <AmountField label="Capital pagado · COP" name="principal" />
        <AmountField label="Interés pagado · COP" name="interest" />
        <AmountField label="Seguro pagado · COP" name="insurance" optional />
        <AmountField label="Comisión o cargos pagados · COP" name="commission" optional />
        <AmountField label="Mora pagada · COP" name="lateFee" optional />
      </div>
      {!expenses.length && (
        <p className="debts-hint">
          No hay egresos disponibles del mismo acreedor y sede. Registra el pago real en Caja antes de
          vincularlo aquí.
        </p>
      )}
      <Footer
        onClose={props.onClose}
        busy={form.busy}
        disabled={!expenses.length}
        label="Vincular egreso existente sin duplicarlo"
      />
    </form>
  );
}

function SupplierDirectory(props: ViewProps & { onCreate: () => void; onOrigin: () => void }) {
  const module = debtDomain.getDebtModuleState(props.state);
  const member = props.state.members.find((row) => row.id === props.actor.id && row.active);
  const suppliers = module.suppliers.filter(
    (row) =>
      member?.locationIds.includes(row.locationId) &&
      (props.location === 'all' || row.locationId === props.location),
  );
  return (
    <>
      <Card
        title="Directorio único de proveedores"
        description="La identificación y el nombre legal previenen terceros duplicados. Crear el proveedor no genera saldo ni una compra."
        action={
          permitted(props) ? (
            <div className="debts-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={!suppliers.length}
                onClick={props.onOrigin}
              >
                Documentar ORIGEN proveedor
              </button>
              <button type="button" className="button button-primary" onClick={props.onCreate}>
                <Plus size={15} />
                Registrar proveedor
              </button>
            </div>
          ) : undefined
        }
      >
        {suppliers.length ? (
          <div className="debts-table-wrap">
            <table className="debts-table">
              <thead>
                <tr>
                  <th>Proveedor e identificación</th>
                  <th>Contacto</th>
                  <th>Sede</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      <small>{row.identification}</small>
                    </td>
                    <td>
                      {row.contactName ?? 'Sin contacto registrado'}
                      <small>{[row.email, row.phone].filter(Boolean).join(' · ')}</small>
                    </td>
                    <td>{props.state.locations.find((location) => location.id === row.locationId)?.name}</td>
                    <td>
                      <Badge tone={row.active ? 'green' : 'neutral'}>
                        {row.active ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="debts-card-body debts-secondary-text">
            No hay proveedores registrados. Crea la identificación real para habilitar compras a crédito,
            devoluciones y su cuenta corriente.
          </p>
        )}
      </Card>
      <SupplierAccountHistory {...props} />
    </>
  );
}
function SupplierForm(props: DebtFormProps) {
  const form = useForm(props);
  return (
    <form
      className="debts-form"
      onSubmit={(event) =>
        form.submit(
          event,
          (state, data) =>
            debtDomain.createDebtSupplier(
              state,
              {
                identification: field(data, 'identification'),
                name: field(data, 'name'),
                contactName: field(data, 'contactName') || undefined,
                email: field(data, 'email') || undefined,
                phone: field(data, 'phone') || undefined,
                address: field(data, 'address') || undefined,
                locationId: field(data, 'locationId'),
                active: true,
              },
              props.actor,
            ),
          'Proveedor registrado en el directorio único, sin compras ni saldo ficticios.',
        )
      }
    >
      <Notice>
        <Store size={17} />
        <p>
          Registra una sola identidad por proveedor. Sus facturas, pagos, chatarra y devoluciones se
          vincularán a este tercero y su sede.
        </p>
      </Notice>
      <FormError message={form.error} />
      <div className="debts-form-grid">
        <Field label="Identificación tributaria o documento">
          <input name="identification" required autoComplete="off" />
        </Field>
        <Field label="Nombre legal del proveedor">
          <input name="name" required />
        </Field>
        <LocationField props={props} />
        <Field label="Persona de contacto, si existe">
          <input name="contactName" />
        </Field>
        <Field label="Correo de contacto, si existe">
          <input name="email" type="email" />
        </Field>
        <Field label="Teléfono, si existe">
          <input name="phone" type="tel" />
        </Field>
        <Field label="Dirección, si existe" full>
          <input name="address" />
        </Field>
      </div>
      <Footer onClose={props.onClose} busy={form.busy} label="Registrar tercero sin crear saldo" />
    </form>
  );
}
function SupplierOriginForm(props: DebtFormProps) {
  const form = useForm(props);
  const [proof, setProof] = useState<Support>();
  const suppliers = debtDomain
    .getDebtModuleState(props.state)
    .suppliers.filter((row) => row.active && (props.location === 'all' || row.locationId === props.location));
  return (
    <form
      className="debts-form"
      onSubmit={(event) =>
        form.submit(
          event,
          (state, data) => {
            const supplier = suppliers.find((row) => row.id === field(data, 'supplierId'));
            if (!supplier) throw new Error('Selecciona un proveedor del directorio único.');
            const support = proofRequired(proof);
            const dueDate = field(data, 'dueDate');
            const date = field(data, 'date');
            const reference = field(data, 'reference');
            const before = new Set(state.debts.map((row) => row.id));
            const next = debtDomain.registerDebtObligation(
              state,
              {
                creditor: supplier.name,
                kind: 'supplier',
                supplierInvoice: reference,
                supplierDueDate: dueDate,
                principal: money(decimal(field(data, 'principal'))),
                monthlyRate: '0.00',
                installments: 1,
                startDate: date,
                dueDay: Number(dueDate.slice(8)),
                method: 'fixed_principal',
                locationId: supplier.locationId,
                contract: support,
                originMode: 'historical_supplier',
                openingAsOfDate: field(data, 'openingAsOfDate'),
                concept: field(data, 'notes'),
                documentReference: reference,
                support,
                supplierId: supplier.id,
              },
              props.actor,
            );
            const obligation = next.debts.find((row) => !before.has(row.id))!;
            return debtDomain.registerSupplierInvoice(
              next,
              {
                debtId: obligation.id,
                supplierId: supplier.id,
                invoiceReference: reference,
                date,
                dueDate,
                source: 'historical',
                support,
              },
              props.actor,
            );
          },
          'ORIGEN de proveedor documentado. No se generó una compra de inventario ni un movimiento de Caja.',
        )
      }
    >
      <Notice warning>
        <Store size={17} />
        <p>
          Documenta un saldo real anterior a esta puesta en marcha. No es una compra nueva y no incorpora
          existencias. Usa el vencimiento efectivamente pactado, sin un plazo predeterminado.
        </p>
      </Notice>
      <FormError message={form.error} />
      <div className="debts-form-grid">
        <Field label="Proveedor del directorio">
          <select name="supplierId" defaultValue="" required>
            <option value="">Selecciona el tercero real</option>
            {suppliers.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} · {row.identification}
              </option>
            ))}
          </select>
        </Field>
        <ReferenceField label="Factura o documento del saldo histórico" />
        <DateField label="Fecha del documento de ORIGEN" />
        <DateField name="dueDate" label="Vencimiento pactado de esta factura" future />
        <AmountField name="principal" label="Saldo realmente pendiente al ORIGEN · COP" />
        <DateField name="openingAsOfDate" label="Fecha de corte del saldo histórico" />
      </div>
      <NotesField label="Concepto y explicación del saldo histórico" />
      <InventoryProofInput
        label="Soporte del saldo inicial de proveedor"
        onChange={setProof}
        onBusy={form.onBusy}
      />
      <Footer onClose={props.onClose} busy={form.busy} label="Documentar ORIGEN sin Caja ni stock" />
    </form>
  );
}

function SupplierAccountHistory({ state, actor, location }: ViewProps) {
  const [supplierId, setSupplierId] = useState('');
  const allowedSites =
    state.members.find((member) => member.id === actor.id && member.active)?.locationIds ?? [];
  const suppliers = debtDomain
    .getDebtModuleState(state)
    .suppliers.filter(
      (supplier) =>
        allowedSites.includes(supplier.locationId) &&
        (location === 'all' || supplier.locationId === location),
    );
  const selected = suppliers.find((supplier) => supplier.id === supplierId);
  const today = todayBogota();
  const firstDate =
    selected &&
    state.debts
      .filter(
        (debt) =>
          debt.kind === 'supplier' &&
          debt.locationId === selected.locationId &&
          debt.creditor.trim().toLocaleLowerCase('es-CO') === selected.name.trim().toLocaleLowerCase('es-CO'),
      )
      .map((debt) => debt.startDate)
      .sort()[0];
  const report =
    selected && firstDate
      ? debtDomain.getDebtModuleReport(state, {
          startDate: firstDate,
          endDate: today,
          category: 'supplier',
          creditor: selected.name,
          locationId: selected.locationId,
        })
      : undefined;
  let balance = toCents(report?.totals.openingBalance ?? '0.00');
  const postingOrder = (kind: string) => (kind === 'opening' || kind === 'new_obligation' ? 0 : 1);
  const chronological = [...(report?.movements ?? [])].sort(
    (left, right) =>
      left.date.localeCompare(right.date) || postingOrder(left.kind) - postingOrder(right.kind),
  );
  const movements = chronological.map((movement) => {
    const reduction =
      movement.kind === 'cash_payment'
        ? movement.principal
        : movement.kind === 'scrap_offset' || movement.kind === 'accepted_return'
          ? movement.total
          : '0.00';
    balance +=
      movement.kind === 'opening' || movement.kind === 'new_obligation'
        ? toCents(movement.total)
        : -toCents(reduction);
    return { movement, balance: fromCents(balance) };
  });
  const labels: Record<string, string> = {
    opening: 'ORIGEN',
    new_obligation: 'Compra u obligación',
    cash_payment: 'Pago de Caja',
    scrap_offset: 'Cruce de chatarra',
    accepted_return: 'Devolución reconocida',
  };
  if (!suppliers.length) return null;
  return (
    <Card
      title="Cuenta corriente por proveedor"
      description="Consulta el saldo posterior a cada movimiento confirmado."
    >
      <div className="debts-card-body">
        <Field label="Proveedor de la cuenta corriente">
          <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
            <option value="">Selecciona un proveedor</option>
            {suppliers.map((row) => (
              <option value={row.id} key={row.id}>
                {row.name} · {row.identification}
              </option>
            ))}
          </select>
        </Field>
        {selected && (
          <p>
            Saldo pendiente <strong>{formatCOP(report?.totals.closingBalance ?? '0.00')}</strong>
          </p>
        )}
      </div>
      {selected &&
        (movements.length ? (
          <div className="debts-table-wrap">
            <table className="debts-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Movimiento y documento</th>
                  <th>Importe</th>
                  <th>Saldo posterior</th>
                </tr>
              </thead>
              <tbody>
                {movements.map(({ movement, balance }) => (
                  <tr key={movement.id}>
                    <td>{movement.date}</td>
                    <td>
                      {labels[movement.kind]}
                      <small>
                        {movement.sourceReference} · {movement.documentReference}
                      </small>
                    </td>
                    <td className="debts-number">{formatCOP(movement.total)}</td>
                    <td className="debts-number">{formatCOP(balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="debts-card-body debts-secondary-text">
            El proveedor todavía no tiene movimientos en su cuenta corriente.
          </p>
        ))}
    </Card>
  );
}
