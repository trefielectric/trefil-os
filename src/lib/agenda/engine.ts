import { add, fromCents, toCents } from "../finance/money";
import type { Actor, Money, State, Support } from "../finance/types";
import type { AgendaChangeRequest, AgendaKind, AgendaNoticeClosure, AgendaObligation, AgendaState, AgendaWorkspace } from "./types";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const text = (value: string, label: string, minimum = 2) => { const clean = value.trim(); if (clean.length < minimum || clean.length > 500) throw new Error(`${label} no es válido.`); return clean; };
const date = (value: string | undefined, label: string) => { if (value !== undefined && (!datePattern.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00Z`)))) throw new Error(`${label} no es válida.`); return value; };
const money = (value: Money | undefined) => { if (value === undefined) return undefined; toCents(value); if (toCents(value) <= 0n) throw new Error("El valor debe ser positivo."); return fromCents(toCents(value)); };
const canManage = (actor: Actor) => ["owner", "admin", "treasury", "accounting"].includes(actor.role);
const canApprove = (actor: Actor) => ["owner", "admin"].includes(actor.role);
function authorize(actor: Actor) { if (!canManage(actor)) throw new Error("Tu rol no permite administrar la Agenda Financiera."); }
function audit(state: State, actor: Actor, action: string, entityType: string, entityId: string, reason?: string) { state.audit.push({ id: id(), action, entityType, entityId, actorId: actor.id, actorName: actor.name, timestamp: now(), reason }); }
function copy(state: AgendaWorkspace): AgendaWorkspace & { agenda: AgendaState } { const next = structuredClone(state) as AgendaWorkspace & { agenda: AgendaState }; next.agenda = structuredClone(getAgendaState(state)); return next; }

export function createEmptyAgendaState(): AgendaState { return { version: 1, obligations: [], applications: [], changeRequests: [], noticeClosures: [], holidays: [] }; }
export function getAgendaState(state: AgendaWorkspace): AgendaState { return state.agenda ?? createEmptyAgendaState(); }

export function isBusinessDay(value: string, holidays: string[] = []) { const day = new Date(`${value}T12:00:00Z`).getUTCDay(); return day !== 0 && day !== 6 && !holidays.includes(value); }
export function businessDate(contractual: string | undefined, publicService: boolean, holidays: string[] = []) {
  if (!contractual) return undefined;
  date(contractual, "La fecha contractual");
  if (isBusinessDay(contractual, holidays)) return contractual;
  const cursor = new Date(`${contractual}T12:00:00Z`);
  do cursor.setUTCDate(cursor.getUTCDate() + (publicService ? -1 : 1)); while (!isBusinessDay(cursor.toISOString().slice(0, 10), holidays));
  return cursor.toISOString().slice(0, 10);
}

export function obligationApplied(state: AgendaWorkspace, obligationId: string): Money { return add(...getAgendaState(state).applications.filter(row => row.obligationId === obligationId).map(row => row.amount)); }
export function obligationBalance(state: AgendaWorkspace, obligation: AgendaObligation): Money | undefined { return obligation.amount === undefined ? undefined : fromCents(toCents(obligation.amount) - toCents(obligationApplied(state, obligation.id))); }

export function createAgendaObligation(state: AgendaWorkspace, input: { kind: AgendaKind; category: string; concept: string; party: string; invoiceNumber?: string; amount?: Money; contractualDueDate?: string; reviewDate?: string; isPublicService?: boolean; responsible: string; alertDays?: number; locationId: string; support?: Support; notes?: string; recurrence?: AgendaObligation["recurrence"] }, actor: Actor): AgendaWorkspace {
  authorize(actor);
  if (!state.locations.some(row => row.id === input.locationId)) throw new Error("La sede no existe.");
  const variable = input.kind === "variable_recurring";
  const supplier = input.kind === "supplier";
  const amount = variable && input.amount === undefined ? undefined : money(input.amount);
  if (!variable && amount === undefined) throw new Error("Registra el valor confirmado de la obligación.");
  const due = date(input.contractualDueDate, "La fecha contractual");
  if (!supplier && !due) throw new Error("Registra la fecha contractual de vencimiento.");
  const holidays = getAgendaState(state).holidays;
  const next = copy(state);
  const stamp = now();
  const record: AgendaObligation = {
    id: id(), reference: `AGE-${String(next.agenda.obligations.length + 1).padStart(5, "0")}`, kind: input.kind,
    category: text(input.category, "La categoría"), concept: text(input.concept, "El concepto"), party: text(input.party, "El tercero"),
    invoiceNumber: input.invoiceNumber?.trim() || undefined, amount, currency: "COP", contractualDueDate: due,
    operationalDate: businessDate(due, Boolean(input.isPublicService), holidays), reviewDate: date(input.reviewDate, "La fecha de revisión"),
    isPublicService: Boolean(input.isPublicService), responsible: text(input.responsible, "El responsable"),
    status: amount === undefined ? "pending_value" : "scheduled", alertDays: input.alertDays ?? 5, locationId: input.locationId,
    supports: input.support ? [input.support] : [], notes: input.notes?.trim() ?? "", recurrence: input.recurrence,
    createdBy: actor.id, createdAt: stamp, updatedAt: stamp,
  };
  if (!Number.isInteger(record.alertDays) || record.alertDays < 0 || record.alertDays > 365) throw new Error("Los días de aviso no son válidos.");
  next.agenda.obligations.push(record); audit(next, actor, "Obligación creada directamente en Agenda Financiera", "agenda_obligation", record.id); return next;
}

export function requestAgendaChange(state: AgendaWorkspace, input: { obligationId: string; reason: string; amount?: Money; contractualDueDate?: string }, actor: Actor): AgendaWorkspace {
  authorize(actor); const source = getAgendaState(state).obligations.find(row => row.id === input.obligationId);
  if (!source || ["draft", "annulled"].includes(source.status)) throw new Error("La obligación no admite esta solicitud.");
  if (getAgendaState(state).changeRequests.some(row => row.obligationId === source.id && row.status === "pending")) throw new Error("Ya existe una modificación pendiente.");
  const next = copy(state); const request: AgendaChangeRequest = { id: id(), obligationId: source.id, requestedBy: actor.id, requestedAt: now(), reason: text(input.reason, "El motivo", 5), proposedAmount: money(input.amount), proposedDueDate: date(input.contractualDueDate, "La fecha propuesta"), status: "pending" };
  if (request.proposedAmount === undefined && request.proposedDueDate === undefined) throw new Error("Propón un nuevo valor o vencimiento.");
  next.agenda.changeRequests.push(request); audit(next, actor, "Modificación solicitada; los datos vigentes se conservan", "agenda_change", request.id, request.reason); return next;
}

export function decideAgendaChange(state: AgendaWorkspace, input: { requestId: string; decision: "approved" | "rejected"; reason: string }, actor: Actor): AgendaWorkspace {
  if (!canApprove(actor)) throw new Error("Solo Gerencia o Creador pueden decidir cambios confirmados.");
  const source = getAgendaState(state).changeRequests.find(row => row.id === input.requestId && row.status === "pending"); if (!source) throw new Error("La solicitud no está pendiente.");
  const next = copy(state); const request = next.agenda.changeRequests.find(row => row.id === source.id)!; request.status = input.decision; request.decidedBy = actor.id; request.decidedAt = now(); request.decisionReason = text(input.reason, "El motivo", 3);
  if (input.decision === "approved") { const obligation = next.agenda.obligations.find(row => row.id === request.obligationId)!; if (request.proposedAmount !== undefined) obligation.amount = request.proposedAmount; if (request.proposedDueDate !== undefined) { obligation.contractualDueDate = request.proposedDueDate; obligation.operationalDate = businessDate(request.proposedDueDate, obligation.isPublicService, next.agenda.holidays); } obligation.status = "scheduled"; obligation.updatedAt = now(); }
  audit(next, actor, input.decision === "approved" ? "Modificación aprobada" : "Modificación rechazada", "agenda_change", request.id, request.decisionReason); return next;
}

export function linkAgendaPayment(state: AgendaWorkspace, input: { transactionId: string; applications: { obligationId: string; amount: Money }[] }, actor: Actor): AgendaWorkspace {
  authorize(actor); if (!input.applications.length) throw new Error("Distribuye el pago al menos a una obligación.");
  const transaction = state.transactions.find(row => row.id === input.transactionId && row.status === "posted" && !row.reversedBy);
  if (!transaction || !transaction.support || !["expense", "debt_payment", "salary", "reimbursement", "personal_expense"].includes(transaction.kind)) throw new Error("Vincula un egreso real de Caja con comprobante.");
  const already = getAgendaState(state).applications.filter(row => row.transactionId === transaction.id).reduce((sum, row) => sum + toCents(row.amount), 0n);
  const requested = input.applications.reduce((sum, row) => sum + toCents(money(row.amount)!), 0n);
  if (already + requested > toCents(transaction.amount)) throw new Error("La distribución supera el egreso confirmado en Caja.");
  const next = copy(state);
  for (const application of input.applications) { const obligation = next.agenda.obligations.find(row => row.id === application.obligationId && row.status !== "annulled"); if (!obligation || obligation.amount === undefined) throw new Error("La obligación no tiene un valor confirmado."); const amount = money(application.amount)!; const remaining = obligationBalance(next, obligation)!; if (toCents(amount) > toCents(remaining)) throw new Error("La aplicación supera el saldo de una obligación."); next.agenda.applications.push({ id: id(), obligationId: obligation.id, transactionId: transaction.id, amount, appliedBy: actor.id, appliedAt: now() }); const balance = toCents(remaining) - toCents(amount); obligation.status = balance === 0n ? "paid_supported" : "pending_payment"; obligation.updatedAt = now(); }
  audit(next, actor, "Pago de Caja distribuido sin duplicar el egreso", "agenda_payment", transaction.id); return next;
}

export interface AgendaNotice { key: string; obligationId: string; type: "overdue" | "value_missing" | "support_missing" | "authorization" | "reconciliation"; title: string; detail: string; severity: "critical" | "warning" | "info"; }
export function agendaNotices(state: AgendaWorkspace, asOf: string): AgendaNotice[] {
  date(asOf, "La fecha de consulta"); const agenda = getAgendaState(state); const closed = new Set(agenda.noticeClosures.map(row => row.noticeKey)); const notices: AgendaNotice[] = [];
  for (const row of agenda.obligations) { if (row.status === "annulled") continue; const balance = obligationBalance(state, row); if (row.amount === undefined) notices.push({ key: `${row.id}:value`, obligationId: row.id, type: "value_missing", title: "Factura o valor por confirmar", detail: `${row.reference} · ${row.party}`, severity: "warning" }); if (row.contractualDueDate && row.contractualDueDate < asOf && balance !== undefined && toCents(balance) > 0n) notices.push({ key: `${row.id}:overdue`, obligationId: row.id, type: "overdue", title: "Obligación vencida con saldo", detail: `${row.reference} · saldo ${balance}`, severity: row.isPublicService ? "critical" : "warning" }); }
  for (const request of agenda.changeRequests.filter(row => row.status === "pending")) notices.push({ key: `${request.obligationId}:change:${request.id}`, obligationId: request.obligationId, type: "authorization", title: "Modificación pendiente de autorización", detail: request.reason, severity: "info" });
  return notices.filter(row => !closed.has(row.key));
}

export function closeAgendaNotice(state: AgendaWorkspace, noticeKey: string, reason: string, actor: Actor): AgendaWorkspace {
  if (!canApprove(actor)) throw new Error("Solo Gerencia o Creador pueden cerrar una novedad excepcionalmente."); if (getAgendaState(state).noticeClosures.some(row => row.noticeKey === noticeKey)) throw new Error("La novedad ya está cerrada.");
  const next = copy(state); const closure: AgendaNoticeClosure = { noticeKey, reason: text(reason, "El motivo", 8), closedBy: actor.id, closedAt: now() }; next.agenda.noticeClosures.push(closure); audit(next, actor, "Novedad cerrada excepcionalmente sin alterar obligación ni saldo", "agenda_notice", noticeKey, closure.reason); return next;
}
