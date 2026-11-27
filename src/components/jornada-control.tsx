"use client";
import { useEffect, useState } from "react";
import { dayLabel, markLabel } from "@/lib/workforce";
import {
  duration,
  jornadaRpc,
  statusText,
  type ControlMember,
  type JornadaTask,
  type TaskHistory,
} from "@/lib/jornada";

export function TaskTrail({ task }: { task: JornadaTask }) {
  const [history, setHistory] = useState<TaskHistory | null>(null);
  const [error, setError] = useState("");
  return (
    <details
      onToggle={async (e) => {
        if (!e.currentTarget.open) return;
        try {
          setHistory(
            await jornadaRpc<TaskHistory>("history", { p_task: task.id }),
          );
          setError("");
        } catch (reason) {
          setError(String(reason instanceof Error ? reason.message : reason));
        }
      }}
    >
      <summary>Ver historial</summary>
      {error && <p role="alert">{error}</p>}
      {history && (
        <>
          <p>
            Creada el {markLabel(task.created_at)} por {task.creator}.{" "}
            {task.completed_at &&
              "Terminada el " + markLabel(task.completed_at) + "."}
          </p>
          <ul>
            {history.events.map((e, i) => (
              <li key={i}>
                {markLabel(e.when)} · {e.who} · {e.action}
                {e.detail.despues?.status &&
                  " · " +
                    (statusText[
                      e.detail.despues.status as keyof typeof statusText
                    ] ?? e.detail.despues.status)}
                {e.detail.nota && " · " + e.detail.nota}
                {e.detail.pendiente && " · " + e.detail.pendiente}
                {e.detail.exceso && " · " + e.detail.exceso}
              </li>
            ))}
          </ul>
          {history.intervals.length > 0 && (
            <>
              <h4>Intervalos de trabajo</h4>
              <ul>
                {history.intervals.map((v, i) => (
                  <li key={i}>
                    {markLabel(v.start)} —{" "}
                    {v.stop ? markLabel(v.stop) : "En curso"}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </details>
  );
}
export function JornadaControl({
  today,
  command,
}: {
  today: string;
  command: (op: string, payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [day, setDay] = useState(today);
  const [version, setVersion] = useState(0);
  const [rows, setRows] = useState<ControlMember[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const list = await jornadaRpc<ControlMember[]>("control", {
          p_day: day,
        });
        if (active) {
          setRows(list);
          setError("");
        }
      } catch (reason) {
        if (active) {
          setRows(null);
          setError(
            reason instanceof Error
              ? reason.message
              : "No se pudo consultar el control.",
          );
        }
      }
    }
    setRows(null);
    void refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [day, version]);
  return (
    <section className="jrn-card">
      <div className="jrn-heading">
        <h2>Control de usuarios</h2>
        <label>
          Fecha de consulta
          <input
            type="date"
            value={day}
            onChange={(e) => {
              if (e.target.value) setDay(e.target.value);
            }}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {!rows && !error && <p role="status">Consultando jornadas…</p>}
      {rows?.map((p) => (
        <details className="jrn-person" key={p.id}>
          <summary>
            <strong>{p.name}</strong>
            <span>
              {p.attendance
                ? p.blocked
                  ? "Cierre anterior pendiente"
                  : p.shifts.length
                    ? p.shifts.some((s) => !s.left)
                      ? "Jornada abierta"
                      : "Jornada cerrada"
                    : (p.absence ??
                      (p.schedule?.starts ? "Sin abrir" : "Sin horario"))
                : "Ver actividades"}
            </span>
          </summary>
          {p.attendance && (
            <>
              <p>
                Horario programado ·{" "}
                {p.schedule?.starts && p.schedule.ends
                  ? markLabel(p.schedule.starts) +
                    " — " +
                    markLabel(p.schedule.ends)
                  : (p.absence ?? "Sin horario")}
              </p>
              {p.shifts.map((s) => (
                <div key={s.id} className="jrn-row">
                  <strong>Apertura {markLabel(s.arrived)}</strong>
                  <p>
                    {s.start && Date.parse(s.arrived) > Date.parse(s.start)
                      ? "Entrada tardía. "
                      : ""}
                    {s.left
                      ? "Cierre " + markLabel(s.left)
                      : "Pendiente de cierre"}
                    {s.end && s.left && Date.parse(s.left) > Date.parse(s.end)
                      ? " · Cierre tardío"
                      : ""}
                  </p>
                  {s.summary && (
                    <>
                      <p>
                        {s.summary.done} terminadas · {s.summary.unfinished} sin
                        cumplir. {s.summary.late_reason}
                      </p>
                      {Object.values(s.summary.tasks)
                        .filter((t) => t.unfinished || t.excess)
                        .map((t) => (
                          <p key={t.id}>
                            <strong>{t.title}</strong>{" "}
                            {t.unfinished && " · Pendiente: " + t.unfinished}
                            {t.excess && " · Exceso: " + t.excess}
                          </p>
                        ))}
                    </>
                  )}
                </div>
              ))}
              {p.alerts.map((a) => (
                <p className="jrn-attention" key={a.kind}>
                  Alerta de {a.kind} · {markLabel(a.triggered)} ·{" "}
                  {a.resolved
                    ? "Regularizada " + markLabel(a.resolved)
                    : "Pendiente de regularizar"}
                </p>
              ))}
            </>
          )}
          {p.tasks && (
            <>
              <h3>Actividades</h3>
              {!p.tasks.length && <p>Sin actividades para este día.</p>}
              {p.tasks.map((t) => (
                <div className="jrn-row" key={t.id}>
                  <strong>{t.title}</strong>
                  <p>
                    {statusText[t.status]} ·{" "}
                    {t.assigned_by === t.person_id
                      ? "Propia"
                      : "Asignada por " + t.creator}
                    {t.carried ? " · Heredada" : ""}
                    {t.due_day && t.due_day < day && t.status !== "done"
                      ? " · Vencida"
                      : ""}{" "}
                    · {duration(t.seconds)} acumulados ·{" "}
                    {duration(t.shift_seconds)} en jornada ·{" "}
                    {t.estimate_minutes
                      ? t.estimate_minutes + " min previstos"
                      : "Sin estimación"}
                    {t.over ? " · Tiempo excedido" : ""}
                  </p>
                  <TaskTrail task={t} />
                </div>
              ))}
            </>
          )}
          {p.manage && (
            <div className="jrn-row">
              <a href="/equipo/">Editar horario semanal en Equipo</a>
              {day >= today && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    if (
                      await command("absence", {
                        person: p.id,
                        day,
                        kind: f.get("kind"),
                      })
                    )
                      setVersion((v) => v + 1);
                  }}
                >
                  <label>
                    Excepción para {dayLabel(day)}
                    <select name="kind">
                      <option>Vacaciones</option>
                      <option>Permiso</option>
                      <option>Día no laborable</option>
                    </select>
                  </label>
                  <button>Guardar excepción</button>
                </form>
              )}
            </div>
          )}
        </details>
      ))}
    </section>
  );
}
