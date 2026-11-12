"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Clock,
  DoorOpen,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  getSupabaseClient,
  publicSupabaseConfiguration,
} from "@/lib/supabase/client";
import {
  authErrorMessage,
  signOut,
  updateRecoveredPassword,
} from "@/lib/supabase/auth";
import {
  clockLabel,
  dayLabel,
  documentIdentity,
  hasCapability,
  roleLabel,
  signInWithDocument,
  workforceRpc,
  WorkforceError,
  type Shift,
  type WorkforceDay,
} from "@/lib/workforce";
import { Badge, Field } from "./ui";
import { Brand } from "./brand";
import { TeamManagement } from "./workforce-team";
import { ShiftList, TaskList } from "./workforce-lists";

type Screen =
  | "loading"
  | "setup"
  | "signin"
  | "activation"
  | "blocked"
  | "day";
const activationKey = "trefil-os:workforce:activate";
const initialAdministrator = {
  name: "Federico Velásquez Perdomo",
  email: "fevepe1510@gmail.com",
  title: "Administrador general",
  area: "Administración",
} as const;
export type Perform = (
  operation: (client: SupabaseClient) => Promise<void>,
  success?: string,
  refresh?: boolean,
) => Promise<void>;

function errorText(reason: unknown) {
  return reason instanceof WorkforceError
    ? reason.message
    : authErrorMessage(reason);
}

export function WorkforceApp() {
  const configured = publicSupabaseConfiguration().configured;
  const [screen, setScreen] = useState<Screen>("loading");
  const [data, setData] = useState<WorkforceDay | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [tab, setTab] = useState<"personal" | "team">("personal");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const invitation = useRef<string | null>(null);
  const activationType = useRef<"invite" | "recovery">("invite");
  const bootstrapChecked = useRef(false);
  const version = useRef(0);
  const locked = useRef(false);
  const arrival = useRef<string | null>(null);

  const load = useCallback(
    async (client: SupabaseClient, selected: string | null) => {
      const currentVersion = ++version.current;
      setRefreshing(true);
      try {
        const snapshot = await workforceRpc<WorkforceDay>(
          client,
          "workforce_day",
          { p_day: selected },
        );
        if (version.current !== currentVersion) return;
        setData(snapshot);
        setScreen("day");
        if (!snapshot.can_manage) setTab("personal");
      } catch (reason) {
        if (version.current !== currentVersion) return;
        setError(errorText(reason));
        setData(null);
        setScreen("blocked");
      } finally {
        if (version.current === currentVersion) setRefreshing(false);
      }
    },
    [],
  );
  const refresh = useRef(load);
  const requestedDay = useRef(day);
  requestedDay.current = day;

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setScreen("signin");
      return;
    }
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    invitation.current = fragment.get("activacion");
    activationType.current = fragment.get("tipo") === "recovery" ? "recovery" : "invite";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (timer) clearTimeout(timer);
      if (!session || event === "SIGNED_OUT") {
        version.current++;
        setData(null);
        setTab("personal");
        setDay(null);
        setRefreshing(false);
      }
      timer = setTimeout(() => {
        if (
          invitation.current ||
          (session && sessionStorage.getItem(activationKey) === session.user.id)
        ) {
          setScreen("activation");
        } else if (session) {
          void refresh.current(client, requestedDay.current);
        } else if (!bootstrapChecked.current) {
          bootstrapChecked.current = true;
          void client.functions
            .invoke<{ available: boolean }>("workforce-invite", { body: { action: "status" } })
            .then(({ data }) => setScreen(data?.available ? "setup" : "signin"))
            .catch(() => setScreen("signin"));
        } else {
          setScreen("signin");
        }
      }, 0);
    });
    return () => {
      subscription.unsubscribe();
      if (timer) clearTimeout(timer);
      version.current++;
    };
  }, []);

  useEffect(() => {
    if (screen !== "day") return;
    function refreshVisible() {
      const client = getSupabaseClient();
      if (client && document.visibilityState === "visible" && !locked.current) {
        void refresh.current(client, requestedDay.current);
      }
    }
    const timer = setInterval(refreshVisible, 60_000);
    window.addEventListener("focus", refreshVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
    };
  }, [screen]);

  const perform: Perform = async (operation, success, shouldRefresh = true) => {
    const client = getSupabaseClient();
    if (!client || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation(client);
      if (success) setNotice(success);
      if (shouldRefresh) await load(client, requestedDay.current);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  function chooseDay(value: string | null) {
    const client = getSupabaseClient();
    if (!client || busy) return;
    setDay(value);
    requestedDay.current = value;
    setError("");
    setNotice("");
    void load(client, value);
  }

  function submitAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const documentNumber = String(fields.get("document") ?? "");
    const password = String(fields.get("password") ?? "");
    void perform(
      async (client) => {
        if (screen === "setup") {
          if (password !== fields.get("confirm"))
            throw new WorkforceError("Las contraseñas no coinciden.");
          const identity = await documentIdentity(documentNumber);
          const { data: created, error: setupError } = await client.functions.invoke<{
            accessToken: string; refreshToken: string;
          }>("workforce-invite", { body: {
            action: "bootstrap", identifierHash: identity.hash,
            identifierLastFour: identity.lastFour, password,
            name: initialAdministrator.name,
            email: initialAdministrator.email,
            title: initialAdministrator.title,
            area: initialAdministrator.area,
          } });
          if (setupError || !created?.accessToken || !created.refreshToken)
            throw new WorkforceError("No pudimos crear la cuenta administradora. Revisa los datos o vuelve a cargar.");
          const { error: sessionError } = await client.auth.setSession({
            access_token: created.accessToken, refresh_token: created.refreshToken,
          });
          if (sessionError) throw new WorkforceError("La cuenta se creó, pero no pudimos iniciar la sesión.");
        } else if (screen === "activation") {
          if (password !== fields.get("confirm"))
            throw new WorkforceError("Las contraseñas no coinciden.");
          const token = invitation.current;
          if (token) {
            const { data: verified, error: activationError } =
              await client.auth.verifyOtp({
                token_hash: token,
                type: activationType.current,
              });
            if (activationError || !verified.user)
              throw new WorkforceError(
                "La invitación venció o ya se usó. Solicita un enlace nuevo.",
              );
            sessionStorage.setItem(activationKey, verified.user.id);
            invitation.current = null;
            window.history.replaceState(null, "", window.location.pathname);
          }
          await updateRecoveredPassword(client, password);
          sessionStorage.removeItem(activationKey);
          await load(client, null);
        } else {
          await signInWithDocument(client, documentNumber, password);
        }
        form.reset();
      },
      undefined,
      false,
    );
  }

  function closeSession() {
    void perform(
      async (client) => {
        await signOut(client);
        sessionStorage.removeItem(activationKey);
        invitation.current = null;
        arrival.current = null;
        window.history.replaceState(null, "", window.location.pathname);
        setScreen("signin");
      },
      undefined,
      false,
    );
  }

  function mark(open?: Shift) {
    void perform(
      async (client) => {
        const id = open?.id ?? (arrival.current ??= crypto.randomUUID());
        await workforceRpc(client, "workforce_mark_shift", {
          p_action: open ? "departure" : "arrival",
          p_id: id,
        });
        arrival.current = null;
        setDay(null);
        requestedDay.current = null;
      },
      open ? "Salida registrada." : "Llegada registrada.",
    );
  }

  if (!configured || screen !== "day" || !data) {
    const activation = screen === "activation";
    const setup = screen === "setup";
    return (
      <div className="workforce-shell workforce-access">
        <aside className="workforce-access-brand">
          <Brand href="/" />
          <div>
            <Users size={29} />
            <h1>Equipo</h1>
            <p>Consulta tus tareas y registra tu jornada.</p>
          </div>
        </aside>
        <main className="workforce-card workforce-auth-card" aria-busy={busy}>
          {!configured ? (
            <>
              <h2>Acceso en preparación</h2>
              <p>La conexión institucional de Equipo está pendiente.</p>
            </>
          ) : screen === "loading" ? (
            <h2>Comprobando sesión…</h2>
          ) : screen === "blocked" ? (
            <>
              <h2>Acceso a Equipo</h2>
              <p>
                Si es tu primer ingreso, pide al administrador que confirme tu
                alta.
              </p>
              <div className="workforce-actions">
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => chooseDay(null)}
                >
                  <RefreshCw size={16} /> Reintentar
                </button>
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={closeSession}
                >
                  Cerrar sesión
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>
                {activation
                  ? "Activa tu cuenta"
                  : setup
                    ? "Activa tu usuario de control total"
                    : "Inicia sesión"}
              </h2>
              <p>
                {activation
                  ? "Crea una contraseña para tu cuenta de Equipo."
                  : setup
                    ? "Tu perfil de propietario ya está reservado. Completa únicamente tu identificación de ingreso y una contraseña nueva."
                    : "Usa tu número de cédula y la contraseña de Equipo."}
              </p>
              <form onSubmit={submitAccess} className="workforce-form">
                {setup && <>
                  <section className="workforce-owner-profile" aria-label="Perfil administrador reservado">
                    <Badge tone="blue">Control total</Badge>
                    <strong>{initialAdministrator.name}</strong>
                    <span>{initialAdministrator.email}</span>
                    <small>{initialAdministrator.title} · {initialAdministrator.area}</small>
                  </section>
                </>}
                {!activation && (
                  <Field label="Número de cédula" hint={setup ? "Será tu usuario de ingreso. La plataforma no guardará el número completo." : undefined}>
                    <input
                      name="document"
                      autoComplete="username"
                      required
                    />
                  </Field>
                )}
                <Field label={activation || setup ? "Nueva contraseña" : "Contraseña"}>
                    <input
                      name="password"
                      type="password"
                      autoComplete={
                        activation || setup ? "new-password" : "current-password"
                      }
                      minLength={activation || setup ? 6 : undefined}
                      required
                    />
                  </Field>
                {(activation || setup) && (
                  <Field
                    label="Repetir contraseña"
                    hint="Mínimo técnico de Supabase: 6 caracteres. Sin requisitos de mayúsculas, números o símbolos."
                  >
                    <input
                      name="confirm"
                      type="password"
                      minLength={6}
                      autoComplete="new-password"
                      required
                    />
                  </Field>
                )}
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={busy}
                >
                  {activation ? (
                    <KeyRound size={16} />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                  {busy
                    ? "Procesando…"
                    : activation
                      ? "Activar mi cuenta"
                      : setup
                        ? "Activar mi usuario"
                        : "Iniciar sesión"}
                </button>
              </form>
              {!activation && !setup && <p className="workforce-help">Si olvidaste tu contraseña, solicita al administrador un enlace de recuperación desde Personas.</p>}
            </>
          )}
          {error && (
            <p className="workforce-feedback error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="workforce-feedback" role="status">
              {notice}
            </p>
          )}
          <Link className="text-button" href="/">
            <ArrowLeft size={16} /> Volver a Trefil OS
          </Link>
        </main>
      </div>
    );
  }

  const mine = data.shifts.filter((shift) => shift.person_id === data.me.id);
  const open = mine.find((shift) => !shift.left_at);
  const tasks = data.tasks.filter((task) => task.person_id === data.me.id);
  const managementRole = data.capabilities.some((permission) =>
    [
      "team_view",
      "attendance_view_team",
      "tasks_view_team",
      "tasks_assign",
      "tasks_cancel",
      "people_manage",
      "access_manage",
      "roles_manage",
    ].includes(permission),
  );
  const busyDay = busy || refreshing;
  return (
    <div className="workforce-shell">
      <header className="workforce-header">
        <div className="workforce-header-inner">
          <Link href="/" className="workforce-wordmark">
            <img
              src="/brand/trefielectric-logo.jpg"
              width={46}
              height={46}
              alt="TrefiElectric"
            />{" "}
            <strong>Trefil OS</strong>
          </Link>
          <div className="workforce-actions">
            <Link href="/" className="text-button workforce-home">
              <ArrowLeft size={15} /> Espacio financiero
            </Link>
            <button
              className="button button-secondary"
              onClick={closeSession}
              disabled={busy}
            >
              <LogOut size={16} /> Cerrar sesión
            </button>
          </div>
        </div>
      </header>
      <main className="workforce-main" aria-busy={busyDay}>
        <section className="workforce-heading">
          <div>
            <p className="workforce-eyebrow">TREFIL ELECTRIC · EQUIPO</p>
            <h1>{data.me.full_name}</h1>
            <p>
              {data.me.job_title} · {data.me.area}
            </p>
          </div>
          <Badge tone="blue">{roleLabel(data.roles, data.me.access_role)}</Badge>
        </section>
        {managementRole && (
          <nav className="workforce-tabs" aria-label="Secciones de Equipo">
            <button
              aria-current={tab === "personal" ? "page" : undefined}
              onClick={() => setTab("personal")}
            >
              <CalendarDays size={17} /> Mi día
            </button>
            {data.can_manage ? (
              <button
                aria-current={tab === "team" ? "page" : undefined}
                onClick={() => setTab("team")}
              >
                <Users size={17} /> Gestionar equipo
              </button>
            ) : (
              <Link href="/acceso/?equipo=1">
                <ShieldCheck size={17} /> Verificar para gestionar
              </Link>
            )}
          </nav>
        )}
        <div className="workforce-datebar">
          <div>
            <CalendarDays size={17} />
            <strong>{dayLabel(data.day)}</strong>
            <span>
              {data.day === data.today ? "Hoy · Bogotá" : "Hora de Bogotá"}
            </span>
          </div>
          <div className="workforce-actions">
            <input
              aria-label="Fecha de consulta"
              type="date"
              value={day ?? data.today}
              max="9999-12-31"
              onChange={(event) => chooseDay(event.target.value || null)}
              disabled={busy}
            />
            {data.day !== data.today && (
              <button
                className="button button-secondary"
                onClick={() => chooseDay(null)}
                disabled={busy}
              >
                Hoy
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Actualizar"
              onClick={() => chooseDay(day)}
              disabled={busyDay}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>
        {error && (
          <p className="workforce-feedback error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="workforce-feedback" role="status">
            {notice}
          </p>
        )}
        {tab === "team" && data.can_manage ? (
          <TeamManagement snapshot={data} busy={busyDay} perform={perform} />
        ) : (
          <div className="workforce-layout">
            <section className="workforce-card workforce-attendance">
              <div className="workforce-card-heading">
                <Clock size={20} />
                <h2>Mi asistencia</h2>
              </div>
              {data.day === data.today && (
                <>
                  <div className="workforce-punch">
                    <span>
                      {open
                        ? "Jornada en curso"
                        : mine.length
                          ? "Jornada cerrada"
                          : "Llegada pendiente"}
                    </span>
                    <strong>{clockLabel(data.server_now)}</strong>
                    {hasCapability(data, "attendance_mark") ? (
                      <button
                        className="button button-primary"
                        disabled={busyDay}
                        onClick={() => mark(open)}
                      >
                        {open ? <DoorOpen size={19} /> : <Plus size={19} />}
                        {open ? "Marcar salida" : "Marcar llegada"}
                      </button>
                    ) : (
                      <span>Tu rol permite consultar, pero no marcar asistencia.</span>
                    )}
                  </div>
                </>
              )}
              <ShiftList shifts={mine} day={data.day} now={data.server_now} />
            </section>
            <section className="workforce-card">
              <div className="workforce-card-heading">
                <ClipboardList size={20} />
                <h2>Mis tareas</h2>
                <span>
                  {tasks.filter((task) => task.status === "done").length}/
                  {tasks.filter((task) => task.status !== "cancelled").length}{" "}
                  completadas
                </span>
              </div>
              <TaskList
                tasks={tasks}
                busy={busyDay}
                interactive={hasCapability(data, "tasks_update_own")}
                change={(id, status) =>
                  void perform(
                    (client) =>
                      workforceRpc<void>(client, "workforce_set_task_status", {
                        p_id: id,
                        p_status: status,
                      }),
                    status === "done" ? "Tarea completada." : "Tarea iniciada.",
                  )
                }
              />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
