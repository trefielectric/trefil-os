"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { jornadaRpc } from "@/lib/jornada";
import { Brand } from "./brand";
import { PublicShift, PublicPlant, TeamPage } from "./public-workspace";
import { JornadaPermissions, PublicWorkspace } from "@/lib/jornada-permissions";
import { JornadaPanel } from "./jornada-panel";
import { WorkforceApp } from "./workforce-app";

type Phase = "loading" | "login" | "plan" | "ready" | "error";
export function JornadaGate({ children }: { children: ReactNode }) {
  const path = usePathname();
  const personal = path.replace(/\/$/, "") === "/usuario";
  if (path.replace(/\/$/, "") === "/acceso") return children;

  return (
    <SessionGate
      key={path}
      path={path.replace(/\/$/, "") || "/"}
      personal={personal}
    >
      {children}
    </SessionGate>
  );
}
function SessionGate({
  children,
  personal,
  path,
}: {
  path: string;
  children: ReactNode;
  personal: boolean;
}) {
  const [privateEntry, setPrivateEntry] = useState(path.startsWith("/oauth/"));
  const [activation, setActivation] = useState(false);
  const [publicEnabled, setPublicEnabled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [unread, setUnread] = useState(0);
  const identity = useRef("");
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(async () => {
    const current = ++seq.current;
    setPrivateEntry(
      path.startsWith("/oauth/") ||
        (personal &&
          new URLSearchParams(location.search).get("ingresar") === "1"),
    );
    setActivation(
      path === "/equipo" &&
        (new URLSearchParams(location.hash.slice(1)).has("activacion") ||
          !!sessionStorage.getItem("trefil-os:workforce:activate")),
    );
    const client = getSupabaseClient();
    if (!client) {
      setPublicEnabled(false);
      setPhase("login");
      return;
    }
    try {
      const [{ data, error }, setting] = await Promise.all([
        client.auth.getSession(),
        client.rpc("workforce_preview_enabled"),
      ]);
      if (current !== seq.current) return;
      setPublicEnabled(!setting.error && setting.data === true);
      if (error) throw error;
      if (
        !data.session ||
        new URLSearchParams(location.hash.slice(1)).has("activacion") ||
        sessionStorage.getItem("trefil-os:workforce:activate") ===
          data.session.user.id
      ) {
        setPhase("login");
        return;
      }
      const entry = await jornadaRpc<{
        ready: boolean;
        capabilities: string[];
        unread: number;
      }>("access");
      if (current !== seq.current) return;
      setCapabilities(entry.capabilities);
      setUnread(entry.unread);
      setSubject(data.session.user.id);
      setPhase(entry.ready ? "ready" : "plan");
    } catch (reason) {
      if (current === seq.current) {
        setPhase("error");
        setMessage(
          reason instanceof Error
            ? reason.message
            : "No se pudo comprobar la jornada.",
        );
      }
    }
  }, [path, personal]);
  useEffect(() => {
    const client = getSupabaseClient();
    const later = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(), 0);
    };
    const subscription = client?.auth.onAuthStateChange((event, session) => {
      if (
        identity.current !== (session?.user.id ?? "") ||
        event === "SIGNED_OUT"
      ) {
        ++seq.current;
        identity.current = session?.user.id ?? "";
        if (!location.hash.includes("activacion=")) setPhase("loading");
      }
      later();
    }).data.subscription;
    const visible = () => {
      if (document.visibilityState === "visible") later();
    };
    const changed = (e: StorageEvent) => {
      if (e.key === "trefil:jornada:changed") {
        setPhase("loading");
        later();
      }
    };
    void refresh();
    const poll = setInterval(visible, 30000);
    window.addEventListener("storage", changed);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("jornada-updated", later);
    return () => {
      ++seq.current;
      subscription?.unsubscribe();
      if (timer.current) clearTimeout(timer.current);
      clearInterval(poll);
      window.removeEventListener("storage", changed);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("jornada-updated", later);
    };
  }, [refresh]);
  if (activation) return <WorkforceApp entryOnly />;
  if (
    path === "/equipo" ||
    (path === "/" &&
      publicEnabled === false &&
      phase !== "ready" &&
      typeof window !== "undefined" &&
      window.location.hash === "#equipo")
  )
    return <TeamPage />;
  if (
    publicEnabled === true &&
    !privateEntry &&
    phase !== "ready" &&
    !(personal && phase === "plan")
  ) {
    return (
      <PublicWorkspace.Provider value={true}>
        {personal ? (
          <PublicShift />
        ) : path === "/produccion" || path === "/control-administrativo" ? (
          <PublicPlant control={path === "/control-administrativo"} />
        ) : (
          children
        )}
      </PublicWorkspace.Provider>
    );
  }
  if (phase === "login") return <WorkforceApp entryOnly />;
  if (phase === "loading" || phase === "error")
    return (
      <main className="jrn-shell">
        <Brand />
        <h1>Mi jornada</h1>
        <p role="status">
          {phase === "loading" ? "Abriendo la plataforma…" : message}
        </p>
        {phase === "error" && (
          <>
            <button onClick={refresh}>Reintentar</button>{" "}
            <button
              onClick={() =>
                getSupabaseClient()?.auth.signOut({ scope: "local" })
              }
            >
              Cambiar de cuenta
            </button>
          </>
        )}
      </main>
    );
  if (personal || phase !== "ready")
    return (
      <JornadaPanel key={subject} onChange={refresh} personal={personal} />
    );
  return (
    <JornadaPermissions.Provider value={capabilities}>
      <a className="jrn-shortcut" href="/usuario/">
        <CalendarClock size={17} />
        Mi jornada{unread > 0 ? " · " + unread + " alertas" : ""}
      </a>
      {children}
    </JornadaPermissions.Provider>
  );
}
