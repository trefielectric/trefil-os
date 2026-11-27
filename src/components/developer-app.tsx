"use client";

import { useContext, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { PublicWorkspace } from "@/lib/jornada-permissions";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Code2, Copy, KeyRound, Link2, LockKeyhole, RefreshCw, ShieldCheck, Unplug, UsersRound, Webhook } from "lucide-react";
import { getSupabaseClient, publicSupabaseConfiguration } from "@/lib/supabase/client";
import { developerRpc, type DeveloperSnapshot } from "@/lib/developer";
import { signInWithDocument } from "@/lib/workforce";
import { Field } from "./ui";

type MainTab = "mcp" | "api" | "webhooks";
type ClientTab = "chatgpt" | "cursor" | "claude" | "other";

const clientNames: Record<ClientTab, string> = { chatgpt: "ChatGPT", cursor: "Cursor", claude: "Claude", other: "Otros" };

function clientConfiguration(client: ClientTab, endpoint: string) {
  if (client === "chatgpt") return `En ChatGPT:\n1. Abre Configuración → Conectores.\n2. Activa el modo desarrollador.\n3. Elige Agregar conector personalizado.\n4. Pega esta dirección:\n\n${endpoint}\n\n5. Inicia sesión en Trefil OS y aprueba la conexión.\n\nChatGPT recibirá únicamente las funciones autorizadas para tu usuario.`;
  if (client === "claude") return `Conexión individual con OAuth 2.1:\nclaude mcp add --transport http trefil-os ${endpoint}\n\nEl navegador abrirá Trefil OS para identificar a la persona y solicitar su autorización.`;
  if (client === "other") return `Servidor MCP con OAuth 2.1:\n${endpoint}\n\nEl cliente debe admitir descubrimiento OAuth, PKCE y Streamable HTTP.`;
  return JSON.stringify({ mcpServers: { "trefil-os": { url: endpoint } } }, null, 2);
}

export function DeveloperApp() {
  const guest=useContext(PublicWorkspace);
  const configured = publicSupabaseConfiguration().configured;
  const [snapshot, setSnapshot] = useState<DeveloperSnapshot | null>(null);
  const [screen, setScreen] = useState<"loading" | "signin" | "blocked" | "ready">("loading");
  const [tab, setTab] = useState<MainTab>("mcp");
  const [clientTab, setClientTab] = useState<ClientTab>("chatgpt");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const client = getSupabaseClient();
    if (!client) { setScreen("signin"); return; }
    setBusy(true);
    setError("");
    try {
      const data = await developerRpc<DeveloperSnapshot>(client, "developer_snapshot");
      setSnapshot(data);
      setScreen("ready");
    } catch (reason) {
      setSnapshot(null);
      setError(reason instanceof Error ? reason.message : "No se pudo abrir el centro de desarrolladores.");
      setScreen("blocked");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if(guest)return;
    const client = getSupabaseClient();
    if (!client) { setScreen("signin"); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => session ? void load() : (setSnapshot(null), setScreen("signin")), 0);
    });
    return () => { subscription.unsubscribe(); if (timer) clearTimeout(timer); };
  }, [load,guest]);

  const endpoint = snapshot?.endpoint ?? "https://kifmqoolaerepvlzrqnk.supabase.co/functions/v1/trefil-mcp";
  const configuration = useMemo(() => clientConfiguration(clientTab, endpoint), [clientTab, endpoint]);

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("Copiado al portapapeles."); }
    catch { setError("El navegador no permitió copiar. Selecciona el texto manualmente."); }
  }

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const client = getSupabaseClient();
    if (!client) return;
    setBusy(true);
    setError("");
    void signInWithDocument(client, String(fields.get("document") ?? ""), String(fields.get("password") ?? ""))
      .catch(reason => setError(reason instanceof Error ? reason.message : "No se pudo iniciar sesión."))
      .finally(() => setBusy(false));
  }

  if (!guest && screen === "loading") return <DeveloperFrame><div className="developer-loading"><RefreshCw className="spin" />Preparando conexiones seguras…</div></DeveloperFrame>;
  if (!guest && !configured) return <DeveloperFrame><AccessState title="Supabase no está configurado" text="El centro MCP necesita la conexión institucional para proteger identidades y permisos." /></DeveloperFrame>;
  if (!guest && screen === "signin") return <DeveloperFrame><section className="developer-access"><LockKeyhole /><h1>Acceso administrativo</h1><p>Inicia sesión para administrar la conexión con asistentes de IA.</p><form onSubmit={submitLogin}><Field label="Correo o número de cédula"><input name="document" autoComplete="username" required /></Field><Field label="Contraseña"><input name="password" type="password" autoComplete="current-password" required /></Field><button className="button button-primary" disabled={busy}><KeyRound size={16} />Ingresar</button></form><Link href="/equipo/">Ir a Equipo</Link>{error && <p className="developer-feedback error">{error}</p>}</section></DeveloperFrame>;
  if (!guest && screen === "blocked") return <DeveloperFrame><AccessState title="Acceso restringido" text={error || "Tu rol debe incluir el permiso para administrar integraciones."} action={<Link className="button button-primary" href="/equipo/"><ShieldCheck size={16} />Ir a Equipo</Link>} /></DeveloperFrame>;

  return <DeveloperFrame>
    <main className="developer-main" aria-busy={busy}>
      <header className="developer-hero"><div><p>TREFIL ELECTRIC · INTEGRACIONES</p><h1>Conexiones de IA</h1><span>Cada persona conecta su propio ChatGPT y conserva exactamente los permisos asignados en Equipo.</span></div><Link className="button button-primary" href="/equipo/"><UsersRound size={17} />Funciones y permisos</Link></header>
      <nav className="developer-tabs" aria-label="Tipos de integración">{([["mcp", "MCP", Link2], ["api", "API REST", Code2], ["webhooks", "Webhooks", Webhook]] as const).map(([id, label, Icon]) => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><Icon size={17} />{label}</button>)}</nav>
      {notice && <p className="developer-feedback" role="status">{notice}</p>}{error && <p className="developer-feedback error" role="alert">{error}</p>}
      {tab === "mcp" ? <section className="developer-connection"><div><div className="developer-title"><Link2 /><div><h2>Conexión MCP individual</h2><p>OAuth 2.1, sin claves compartidas.</p></div></div><p>Al conectar, Trefil OS identifica a la persona y entrega a ChatGPT solo las herramientas permitidas por su rol y sus permisos individuales.</p><label>Dirección del servidor</label><div className="developer-copy"><code>{endpoint}</code><button aria-label="Copiar dirección" onClick={() => void copy(endpoint)}><Copy size={18} /></button></div><p className="developer-caution"><ShieldCheck size={15} />Quitar un permiso o desactivar una persona corta ese acceso también en ChatGPT.</p></div><div><nav className="developer-client-tabs" aria-label="Configuración por cliente">{(Object.keys(clientNames) as ClientTab[]).map(id => <button key={id} aria-current={clientTab === id ? "page" : undefined} onClick={() => setClientTab(id)}>{clientNames[id]}</button>)}</nav><div className="developer-code"><button aria-label="Copiar configuración" onClick={() => void copy(configuration)}><Copy size={18} /></button><pre>{configuration}</pre></div></div></section> : <Unavailable tab={tab} />}
    </main>
  </DeveloperFrame>;
}

function DeveloperFrame({ children }: { children: React.ReactNode }) { return <div className="developer-shell"><header className="developer-header"><Link href="/" className="developer-wordmark"><Image src="/brand/trefielectric-logo.jpg" alt="TrefiElectric" width={42} height={42} /><strong>Trefil OS</strong></Link><Link href="/" className="text-button"><ArrowLeft size={15} />Volver a la plataforma</Link></header>{children}</div>; }
function AccessState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) { return <section className="developer-access"><ShieldCheck /><h1>{title}</h1><p>{text}</p>{action}</section>; }
function Unavailable({ tab }: { tab: Exclude<MainTab, "mcp"> }) { return <section className="developer-unavailable"><Unplug /><h2>{tab === "api" ? "API REST" : "Webhooks"} se habilitará después</h2><p>Primero se audita MCP. No se exponen endpoints o eventos sin autorización, límites y registro de actividad.</p></section>; }
