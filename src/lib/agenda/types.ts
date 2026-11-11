import type { Money, State, Support } from "../finance/types";

export type AgendaKind = "fixed_recurring" | "variable_recurring" | "occasional" | "supplier";
export type AgendaStatus = "draft" | "pending_value" | "pending_authorization" | "scheduled" | "pending_payment" | "paid_supported" | "annulled";

export interface AgendaObligation {
  id: string;
  reference: string;
  kind: AgendaKind;
  category: string;
  concept: string;
  party: string;
  invoiceNumber?: string;
  amount?: Money;
  currency: "COP";
  contractualDueDate?: string;
  operationalDate?: string;
  reviewDate?: string;
  isPublicService: boolean;
  responsible: string;
  status: AgendaStatus;
  alertDays: number;
  locationId: string;
  supports: Support[];
  notes: string;
  recurrence?: { frequency: "monthly" | "weekly" | "annual"; sourceId?: string };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgendaPaymentApplication {
  id: string;
  obligationId: string;
  transactionId: string;
  amount: Money;
  appliedBy: string;
  appliedAt: string;
}

export interface AgendaChangeRequest {
  id: string;
  obligationId: string;
  requestedBy: string;
  requestedAt: string;
  reason: string;
  proposedAmount?: Money;
  proposedDueDate?: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
  decidedAt?: string;
  decisionReason?: string;
}

export interface AgendaNoticeClosure {
  noticeKey: string;
  reason: string;
  closedBy: string;
  closedAt: string;
}

export interface AgendaState {
  version: 1;
  obligations: AgendaObligation[];
  applications: AgendaPaymentApplication[];
  changeRequests: AgendaChangeRequest[];
  noticeClosures: AgendaNoticeClosure[];
  holidays: string[];
}

export type AgendaWorkspace = State & { agenda?: AgendaState };
