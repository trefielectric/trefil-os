import { toCents } from "../finance/money";
import type { State } from "../finance/types";
import type { AgendaWorkspace } from "./types";

const date = /^\d{4}-\d{2}-\d{2}$/;
const fail = (path: string): never => { throw new Error(`Datos inválidos en agenda.${path}.`); };
export function validateAgendaState(state: AgendaWorkspace & State) {
  if (state.agenda === undefined) return;
  const agenda = state.agenda; if (agenda.version !== 1) fail("version");
  const ids = new Set<string>(); for (const row of agenda.obligations) { if (!row.id || ids.has(row.id) || !row.reference || !row.category || !row.concept || !row.party || !row.responsible || !state.locations.some(location => location.id === row.locationId)) fail("obligations"); ids.add(row.id); if (row.amount !== undefined && toCents(row.amount) <= 0n) fail("obligations.amount"); for (const value of [row.contractualDueDate, row.operationalDate, row.reviewDate]) if (value !== undefined && !date.test(value)) fail("obligations.date"); if (row.kind !== "supplier" && !row.contractualDueDate) fail("obligations.contractualDueDate"); if (row.amount === undefined && row.status !== "pending_value") fail("obligations.status"); }
  const applicationIds = new Set<string>(); const byTransaction = new Map<string, bigint>(); const byObligation = new Map<string, bigint>(); for (const row of agenda.applications) { if (!row.id || applicationIds.has(row.id) || !ids.has(row.obligationId) || !state.transactions.some(tx => tx.id === row.transactionId && tx.status === "posted" && tx.support) || toCents(row.amount) <= 0n) fail("applications"); applicationIds.add(row.id); byTransaction.set(row.transactionId, (byTransaction.get(row.transactionId) ?? 0n) + toCents(row.amount)); byObligation.set(row.obligationId, (byObligation.get(row.obligationId) ?? 0n) + toCents(row.amount)); }
  for (const [transactionId, total] of byTransaction) if (total > toCents(state.transactions.find(row => row.id === transactionId)!.amount)) fail("applications.transactionAmount");
  for (const [obligationId, total] of byObligation) { const obligation = agenda.obligations.find(row => row.id === obligationId)!; if (obligation.amount === undefined || total > toCents(obligation.amount)) fail("applications.obligationAmount"); }
  const requests = new Set<string>(); for (const row of agenda.changeRequests) { if (!row.id || requests.has(row.id) || !ids.has(row.obligationId) || !row.reason) fail("changeRequests"); requests.add(row.id); if (row.proposedAmount !== undefined && toCents(row.proposedAmount) <= 0n) fail("changeRequests.amount"); if (row.proposedDueDate !== undefined && !date.test(row.proposedDueDate)) fail("changeRequests.date"); if (row.status !== "pending" && (!row.decidedBy || !row.decidedAt || !row.decisionReason)) fail("changeRequests.decision"); }
  if (new Set(agenda.holidays).size !== agenda.holidays.length || agenda.holidays.some(value => !date.test(value))) fail("holidays");
  if (new Set(agenda.noticeClosures.map(row => row.noticeKey)).size !== agenda.noticeClosures.length) fail("noticeClosures");
}
