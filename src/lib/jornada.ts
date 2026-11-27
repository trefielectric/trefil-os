import { getSupabaseClient } from "./supabase/client";
import { workforceRpc } from "./workforce";

export interface JornadaTask {
  id: string;
  title: string;
  details: string;
  creator: string;
  owner: string;
  assigned_by: string;
  person_id: string;
  scheduled_on: string;
  created_at: string;
  completed_at: string | null;
  due_day: string | null;
  due_at: string | null;
  status: "pending" | "in_progress" | "done";
  estimate_minutes: number | null;
  seconds: number;
  shift_seconds: number;
  running: boolean;
  carried: boolean;
  over: boolean;
  unfinished?: string;
  excess?: string;
}
export interface Summary {
  done: number;
  progress: number;
  pending: number;
  unfinished: number;
  tasks: Record<string, JornadaTask>;
  late_reason: string | null;
}
export interface Jornada {
  today: string;
  day: string;
  person: string;
  name: string;
  server_now: string;
  ready: boolean;
  can_control: boolean;
  shift: null | {
    id: string;
    arrived_at: string;
    reviewed_at: string | null;
    scheduled_start: string | null;
    scheduled_end: string | null;
  };
  tasks: JornadaTask[];
  targets: { id: string; name: string }[];
  schedule: { starts: string | null; ends: string | null };
  notifications: {
    person: string;
    name: string;
    day: string;
    kind: string;
    triggered: string;
    resolved: string | null;
  }[];
  exception: string | null;
  last_close: { at: string; summary: Summary } | null;
}
export interface ControlMember {
  id: string;
  name: string;
  manage: boolean;
  attendance: boolean;
  blocked: boolean;
  absence: string | null;
  schedule: Jornada["schedule"] | null;
  shifts: {
    id: string;
    arrived: string;
    left: string | null;
    start: string | null;
    end: string | null;
    review: string | null;
    summary: Summary | null;
  }[];
  alerts: {
    kind: string;
    scheduled: string;
    triggered: string;
    resolved: string | null;
  }[];
  tasks: JornadaTask[] | null;
}
export interface TaskHistory {
  events: {
    when: string;
    who: string | null;
    action: string;
    detail: {
      nota?: string;
      pendiente?: string;
      exceso?: string;
      despues?: { status?: string; title?: string; scheduled_on?: string };
    };
  }[];
  intervals: { start: string; stop: string | null; shift: string }[];
}
export async function jornadaRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
) {
  const client = getSupabaseClient();
  if (!client)
    throw new Error("La conexión institucional todavía no está configurada.");
  return workforceRpc<T>(client, "jornada_" + name, args);
}
export const statusText = {
  pending: "Pendiente",
  in_progress: "En proceso",
  done: "Terminada",
} as const;
export function duration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return whole >= 3600
    ? Math.floor(whole / 3600) +
        " h " +
        Math.floor((whole % 3600) / 60) +
        " min"
    : whole >= 60
      ? Math.floor(whole / 60) + " min " + (whole % 60) + " s"
      : whole + " s";
}
