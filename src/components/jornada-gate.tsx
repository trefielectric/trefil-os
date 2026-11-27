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
import { JornadaPermissions } from "@/lib/jornada-permissions";
import { JornadaPanel } from "./jornada-panel";
import { WorkforceApp } from "./workforce-app";

type Phase = "loading" | "login" | "plan" | "ready" | "error";
export function JornadaGate({ children }: { children: ReactNode }) {
  const path = usePathname();
  const personal = path.replace(/\/$/, "") === "/usuario";
  if (path.replace(/\/$/, "") === "/acceso") return children;
  if (path === "/acceso/" || path === "/acceso") return <>{children}</>;
  return (
    <SessionGate key={path} personal={personal}>
      {children}
    </SessionGate>
  );
}
function SessionGate({
  children,
  personal,
}: {
  children: ReactNode;
  personal: boolean;
}) {
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
    const client = getSupabaseClient();
    if (!client) {
      setPhase("login");
      return;
    }
    try {
      const { data, error } = await client.auth.getSession();
      if (current !== seq.current) return;
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
  }, []);
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
  if (phase === "login") return <WorkforceApp entryOnly />;
  if (phase === "loading" || phase === "error")
    return (
      <main className="jrn-shell">
        <Brand />
        <h1>Mi jornada</h1>
        <p role="status">
          {phase === "loading" ? "Comprobando tu jornada…" : message}
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
