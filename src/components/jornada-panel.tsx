"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { CalendarClock, ListChecks, LogOut } from "lucide-react";
import { Brand } from "./brand";
import { JornadaControl, TaskTrail } from "./jornada-control";
import { getSupabaseClient } from "@/lib/supabase/client";
import { dayLabel, markLabel, clockLabel } from "@/lib/workforce";
import {
  duration,
  jornadaRpc,
  statusText,
  type Jornada,
  type JornadaTask,
} from "@/lib/jornada";

export function JornadaPanel({
  personal,
  onChange,
}: {
  personal: boolean;
  onChange: () => Promise<void>;
}) {
  const [data, setData] = useState<Jornada | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"work" | "close" | "control">("work");
  const [elapsed, setElapsed] = useState(0);
  const [review, setReview] = useState(false);
  const [plan, setPlan] = useState(false);
  const [why, setWhy] = useState<
    Record<string, { unfinished?: string; excess?: string }>
  >({});
  const [late, setLate] = useState("");
  const clock = useRef(0);
  const locked = useRef(false);
  const seq = useRef(0);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const load = useCallback(async () => {
    const version = ++seq.current;
    const next = await jornadaRpc<Jornada>("snapshot");
    if (version === seq.current) {
      setData(next);
      clock.current = Date.now();
      setElapsed(0);
    }
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (live && !locked.current)
        void load().catch((reason) => {
          if (live) setMessage(reason.message);
        });
    };
    refresh();
    const poll = setInterval(refresh, 30000),
      tick = setInterval(
        () => setElapsed(Math.max(0, (Date.now() - clock.current) / 1000)),
        1000,
      );
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      ++seq.current;
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  const taskKey = data?.tasks.map((t) => t.id).join(",");
  useEffect(() => {
    setReview(false);
    setPlan(false);
  }, [taskKey, data?.shift?.id]);
  async function command(op: string, fields: Record<string, unknown> = {}) {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setMessage("");
    const payload = {
      ...fields,
      ...(data?.shift ? { shift: data.shift.id } : {}),
    };
    const signature = JSON.stringify([op, payload]);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, id: crypto.randomUUID() };
    try {
      await jornadaRpc("command", {
        op,
        payload,
        request_id: attempt.current.id,
      });
      attempt.current = null;
      await load();
      setMessage(op === "close" ? "Cierre guardado." : "Cambios guardados.");
      if (op === "close") {
        setTab("work");
        setWhy({});
        setLate("");
      }
      if (["open", "review", "close"].includes(op)) {
        try {
          localStorage.setItem("trefil:jornada:changed", crypto.randomUUID());
        } catch {}
        await onChange();
      }
      return true;
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "No se pudo guardar el cambio.",
      );
      await load().catch(() => {});
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function createTask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (await command("task", Object.fromEntries(new FormData(form))))
      form.reset();
  }
  function note(id: string, key: "unfinished" | "excess", value: string) {
    setWhy((old) => ({ ...old, [id]: { ...old[id], [key]: value } }));
  }
  const signout = () =>
    void getSupabaseClient()?.auth.signOut({ scope: "local" });
  if (!data)
    return (
      <main className="jrn-shell">
        <Brand />
        <h1>Mi jornada</h1>
        <p role="status">{message || "Cargando tus pendientes…"}</p>
        <div className="jrn-actions">
          <button
            onClick={() => void load().catch((e) => setMessage(e.message))}
          >
            Actualizar
          </button>
          <button onClick={signout}>Salir de la cuenta</button>
        </div>
      </main>
    );
  const s = data.shift,
    previous = !!s && data.day < data.today;
  const scheduleStart = s?.scheduled_start ?? data.schedule.starts,
    scheduleEnd = s?.scheduled_end ?? data.schedule.ends;
  const status = previous
    ? "Turno anterior abierto"
    : s
      ? s.reviewed_at
        ? "Jornada en curso"
        : "Plan por confirmar"
      : data.last_close &&
          data.last_close.at &&
          new Date(Date.parse(data.last_close.at) - 5 * 3600000)
            .toISOString()
            .slice(0, 10) === data.today
        ? "Jornada cerrada"
        : "Sin iniciar";
  const seconds = (t: JornadaTask) =>
    Number(t.seconds) + (t.running ? elapsed : 0);
  const over = (t: JornadaTask) =>
    t.estimate_minutes !== null && seconds(t) > t.estimate_minutes * 60;
  const counts = {
    done: data.tasks.filter((t) => t.status === "done").length,
    progress: data.tasks.filter((t) => t.status === "in_progress").length,
    pending: data.tasks.filter((t) => t.status === "pending").length,
  };
  const closing = previous || tab === "close";
  const newTasks = data.tasks.filter((t) => !t.carried).length;
  return (
    <main className="jrn-shell">
      <header className="jrn-brand">
        <Brand />
        <button onClick={signout}>
          <LogOut size={16} />
          Salir de la cuenta
        </button>
      </header>
      <div className="jrn-title">
        <div>
          <p>
            {data.name} · {dayLabel(data.day)}
          </p>
          <h1>Mi jornada</h1>
        </div>
        <strong className="jrn-state">
          <CalendarClock size={17} />
          {status}
        </strong>
      </div>
      <div className="jrn-card jrn-heading">
        <div>
          <h2>Horario</h2>
          <p>
            {scheduleStart && scheduleEnd
              ? clockLabel(scheduleStart) + " — " + clockLabel(scheduleEnd)
              : (data.exception ?? "Sin horario programado")}{" "}
            · Bogotá
          </p>
          {s && <p>Apertura registrada el {markLabel(s.arrived_at)}.</p>}
        </div>
        {!s && (
          <button
            className="jrn-primary"
            disabled={busy}
            onClick={() => command("open")}
          >
            Abrir mi jornada
          </button>
        )}
        {data.ready && personal && (
          <a className="jrn-primary" href="/">
            Entrar a Trefil OS →
          </a>
        )}
      </div>
      {message && (
        <p className="jrn-notice" role="status">
          {message}
        </p>
      )}
      {!s && data.last_close && (
        <section className="jrn-card">
          <h2>Último cierre</h2>
          <p>
            {markLabel(data.last_close.at)} · {data.last_close.summary.done}{" "}
            terminadas · {data.last_close.summary.unfinished} sin cumplir
          </p>
        </section>
      )}
      {data.notifications.length > 0 && (
        <section className="jrn-card">
          <h2>Alertas de jornada</h2>
          {data.notifications.map((a) => (
            <div className="jrn-row" key={[a.person, a.day, a.kind].join("/")}>
              <strong>
                {a.name} · Falta de {a.kind}
              </strong>
              <p>
                {markLabel(a.triggered)} ·{" "}
                {a.resolved
                  ? "Regularizada " + markLabel(a.resolved)
                  : "Pendiente de regularizar"}
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  command("read_alert", {
                    person: a.person,
                    day: a.day,
                    kind: a.kind,
                  })
                }
              >
                Marcar como vista
              </button>
            </div>
          ))}
        </section>
      )}
      {previous && (
        <p className="jrn-attention">
          Tu turno del {dayLabel(data.day)} sigue abierto. Completa el resumen
          para registrar la hora real de cierre.
        </p>
      )}
      {s && !previous && (
        <nav className="jrn-tabs" aria-label="Secciones de mi jornada">
          <button aria-pressed={tab === "work"} onClick={() => setTab("work")}>
            Control de pendientes
          </button>
          <button
            aria-pressed={tab === "close"}
            onClick={() => setTab("close")}
          >
            Resumen de cierre
          </button>
          {data.can_control && (
            <button
              aria-pressed={tab === "control"}
              onClick={() => setTab("control")}
            >
              Control de usuarios
            </button>
          )}
        </nav>
      )}
      <fieldset className="jrn-content" disabled={busy}>
        {s && closing ? (
          <section className="jrn-card">
            <h2>Resumen de cierre</h2>
            <p>
              {data.tasks.length} actividades · {counts.done} terminadas ·{" "}
              {counts.progress} en proceso · {counts.pending} sin iniciar
            </p>
            <strong>
              {counts.progress + counts.pending} pendientes pasan a la siguiente
              jornada.
            </strong>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void command("close", { reasons: why, late_reason: late });
              }}
            >
              {data.tasks.map((t) => (
                <div className="jrn-row" key={t.id}>
                  <h3>{t.title}</h3>
                  <p>
                    {statusText[t.status]} · {duration(seconds(t))} acumulados
                    {t.estimate_minutes &&
                      " · " + t.estimate_minutes + " min previstos"}
                  </p>
                  {t.status !== "done" && (
                    <label>
                      Avance o motivo del pendiente
                      <textarea
                        required
                        maxLength={1500}
                        value={why[t.id]?.unfinished ?? ""}
                        onChange={(e) =>
                          note(t.id, "unfinished", e.target.value)
                        }
                      />
                    </label>
                  )}
                  {over(t) && (
                    <label>
                      Motivo del tiempo excedido
                      <textarea
                        required
                        maxLength={1500}
                        value={why[t.id]?.excess ?? ""}
                        onChange={(e) => note(t.id, "excess", e.target.value)}
                      />
                    </label>
                  )}
                </div>
              ))}
              {previous && (
                <label>
                  Motivo del cierre tardío
                  <textarea
                    required
                    maxLength={1500}
                    value={late}
                    onChange={(e) => setLate(e.target.value)}
                  />
                </label>
              )}
              <button className="jrn-primary">
                Confirmar y cerrar mi jornada
              </button>
            </form>
          </section>
        ) : tab === "control" && data.can_control ? (
          <JornadaControl today={data.today} command={command} />
        ) : (
          <>
            <section className="jrn-card">
              <h2>Control de pendientes</h2>
              {!data.tasks.length && (
                <p>Aún no tienes actividades para esta jornada.</p>
              )}
              {data.tasks.map((t) => (
                <article className="jrn-row" key={t.id}>
                  <div className="jrn-heading">
                    <h3>{t.title}</h3>
                    <span>{statusText[t.status]}</span>
                  </div>
                  <p>
                    {t.owner} ·{" "}
                    {t.assigned_by === t.person_id
                      ? "Propia"
                      : "Asignada por " + t.creator}
                    {t.carried ? " · Heredada" : ""} · Programada para{" "}
                    {dayLabel(t.scheduled_on)}
                  </p>
                  {t.details && <p>{t.details}</p>}
                  {t.due_day && (
                    <p>
                      Vence el {dayLabel(t.due_day)} {t.due_at?.slice(0, 5)}
                      {t.status !== "done" &&
                      (t.due_day < data.today ||
                        (!!t.due_at &&
                          Date.parse(t.due_day + "T" + t.due_at + "-05:00") <
                            Date.parse(data.server_now)))
                        ? " · Vencida"
                        : ""}
                    </p>
                  )}
                  <p>
                    {duration(seconds(t))} acumulados ·{" "}
                    {duration(
                      Number(t.shift_seconds) + (t.running ? elapsed : 0),
                    )}{" "}
                    en esta jornada ·{" "}
                    {t.estimate_minutes
                      ? t.estimate_minutes + " min previstos"
                      : "Sin estimación"}
                    {over(t) ? " · Tiempo excedido" : ""}
                  </p>
                  {data.ready && t.status !== "done" && (
                    <>
                      <div className="jrn-actions">
                        <button
                          onClick={() =>
                            command(t.running ? "pause" : "start", {
                              task: t.id,
                            })
                          }
                        >
                          {t.running
                            ? "Pausar"
                            : t.status === "pending"
                              ? "Iniciar"
                              : "Reanudar"}
                        </button>
                        <button
                          onClick={() => command("finish", { task: t.id })}
                        >
                          Marcar terminada
                        </button>
                      </div>
                      <details>
                        <summary>Registrar avance</summary>
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const f = e.currentTarget;
                            if (
                              await command("note", {
                                task: t.id,
                                note: new FormData(f).get("note"),
                              })
                            )
                              f.reset();
                          }}
                        >
                          <label>
                            Avance
                            <textarea name="note" required maxLength={1500} />
                          </label>
                          <button>Guardar avance</button>
                        </form>
                      </details>
                    </>
                  )}
                  <TaskTrail task={t} />
                </article>
              ))}
            </section>
            {s && (
              <section className="jrn-card">
                <h2>Nueva actividad</h2>
                <form onSubmit={createTask}>
                  <label>
                    Actividad
                    <input
                      name="title"
                      required
                      minLength={2}
                      maxLength={140}
                    />
                  </label>
                  <label>
                    Descripción
                    <textarea name="details" maxLength={1500} />
                  </label>
                  <div className="jrn-grid">
                    <label>
                      Responsable
                      <select name="person" defaultValue={data.person}>
                        {data.targets.map((p) => (
                          <option value={p.id} key={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Día programado
                      <input
                        name="day"
                        type="date"
                        min={data.today}
                        defaultValue={data.today}
                        required
                      />
                    </label>
                    <label>
                      Fecha límite (opcional)
                      <input type="date" name="deadline" />
                    </label>
                    <label>
                      Minutos previstos (opcional)
                      <input
                        name="estimate"
                        type="number"
                        min="1"
                        max="525600"
                        step="1"
                      />
                    </label>
                  </div>
                  <button>Agregar actividad</button>
                </form>
              </section>
            )}
            {s && !s.reviewed_at && (
              <section className="jrn-card">
                <h2>Confirmar el plan del día</h2>
                <label className="jrn-check">
                  <input
                    type="checkbox"
                    checked={review}
                    onChange={(e) => setReview(e.target.checked)}
                  />
                  Revisé mis pendientes heredados (
                  {data.tasks.filter((t) => t.carried).length}).
                </label>
                <label className="jrn-check">
                  <input
                    type="checkbox"
                    checked={plan}
                    onChange={(e) => setPlan(e.target.checked)}
                  />
                  {newTasks
                    ? "Confirmo las actividades nuevas y asignadas (" +
                      newTasks +
                      ")."
                    : "Confirmo que hoy no tengo actividades nuevas."}
                </label>
                <button
                  className="jrn-primary"
                  disabled={!review || !plan}
                  onClick={() =>
                    command("review", {
                      tasks: data.tasks.map((t) => t.id),
                      reviewed: review,
                      new_plan: newTasks ? "confirmed" : "none",
                    })
                  }
                >
                  <ListChecks size={17} />
                  Confirmar mi plan
                </button>
              </section>
            )}
          </>
        )}
      </fieldset>
      <footer>
        La jornada en Trefil OS es un registro operativo. Los registros
        laborales se gestionan en Nómina.
      </footer>
    </main>
  );
}
