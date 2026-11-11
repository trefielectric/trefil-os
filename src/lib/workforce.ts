import type { SupabaseClient } from "@supabase/supabase-js";

export const accessRoles = {
  employee: "Colaborador",
  supervisor: "Coordinador",
  admin: "Administrador",
} as const;

export type AccessRole = keyof typeof accessRoles;
export type TaskStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface Person {
  id: string;
  full_name: string;
  job_title: string;
  area: string;
  access_role: AccessRole;
}

export interface DirectoryPerson extends Person {
  email: string | null;
  supervisor_id: string | null;
  active: boolean;
  registered: boolean;
}

export interface Shift {
  id: string;
  person_id: string;
  arrived_at: string;
  left_at: string | null;
}

export interface DailyTask {
  id: string;
  person_id: string;
  title: string;
  details: string;
  due_at: string | null;
  status: TaskStatus;
}

export interface WorkforceDay {
  me: Person;
  can_manage: boolean;
  day: string;
  today: string;
  server_now: string;
  people: DirectoryPerson[];
  shifts: Shift[];
  tasks: DailyTask[];
}

export class WorkforceError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function workforceRpc<T>(
  client: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, parameters);
  if (error) {
    const message =
      error.code === "23505"
        ? "Ya existe una persona con ese correo."
        : error.code === "23514" || error.code === "23502"
          ? "Revisa los datos obligatorios del formulario."
          : error.code === "22023" ||
              (error.code === "42501" &&
                !error.message.startsWith("permission denied"))
            ? error.message
            : "No pudimos conectar con Equipo. Intenta de nuevo.";
    throw new WorkforceError(message, error.code);
  }
  return data as T;
}

export const businessTimeZone = "America/Bogota";
const clock = new Intl.DateTimeFormat("es-CO", {
  timeZone: businessTimeZone,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});
const timestamp = new Intl.DateTimeFormat("es-CO", {
  timeZone: businessTimeZone,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dateTitle = new Intl.DateTimeFormat("es-CO", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});

export const clockLabel = (value: string) => clock.format(new Date(value));
export const markLabel = (value: string) => timestamp.format(new Date(value));
export const dayLabel = (value: string) =>
  dateTitle.format(new Date(value + "T12:00:00Z"));

export function workDuration(
  shifts: Shift[],
  day: string,
  serverNow: string,
): string {
  const start = Date.parse(day + "T00:00:00-05:00");
  const end = start + 86_400_000;
  const total = shifts.reduce((minutes, shift) => {
    const arrival = Math.max(start, Date.parse(shift.arrived_at));
    const departure = Math.min(end, Date.parse(shift.left_at ?? serverNow));
    return minutes + Math.max(0, departure - arrival);
  }, 0);
  const minutes = Math.floor(total / 60_000);
  return Math.floor(minutes / 60) + " h " + (minutes % 60) + " min";
}
