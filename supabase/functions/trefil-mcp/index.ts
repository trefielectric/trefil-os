import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const protocolVersion = "2025-06-18";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const tools = [
  {
    name: "trefil_system_status", scope: "system.read",
    description: "Consulta la versión del servidor y qué módulos institucionales están realmente conectados.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "trefil_workforce_today", scope: "workforce.read",
    description: "Consulta la identidad laboral y las tareas de hoy del propietario de esta clave.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "trefil_team_targets", scope: "workforce.tasks.write",
    description: "Lista las personas a quienes el propietario puede programar tareas según su rol.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "trefil_assign_task", scope: "workforce.tasks.write",
    description: "Programa una tarea para una persona autorizada del equipo. No permite cambiar equipos ni roles.",
    inputSchema: {
      type: "object",
      properties: {
        personId: { type: "string", format: "uuid" },
        date: { type: "string", format: "date" },
        time: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
        title: { type: "string", minLength: 2, maxLength: 120 },
        details: { type: "string", maxLength: 1000 },
      },
      required: ["personId", "date", "title"], additionalProperties: false,
    },
  },
];

function secret(name: string) {
  const value = Deno.env.get(name);
  if (!value) return "";
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : parsed?.default ?? value;
  } catch { return value; }
}
function response(id: unknown, result?: unknown, error?: { code: number; message: string }) {
  return Response.json(error ? { jsonrpc: "2.0", id: id ?? null, error } : { jsonrpc: "2.0", id: id ?? null, result }, {
    headers: { "Cache-Control": "no-store", "MCP-Protocol-Version": protocolVersion },
  });
}
async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function toolContent(value: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const started = performance.now();
  let requestId = crypto.randomUUID();
  let keyId = "";
  let method = "unknown";
  let tool: string | null = null;
  try {
    const authorization = request.headers.get("Authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : (request.headers.get("X-Trefil-Access-Token") ?? "").trim();
    if (!/^tos_[a-z0-9]{8}\.[A-Za-z0-9_-]{32,128}$/.test(token)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "WWW-Authenticate": 'Bearer realm="Trefil OS MCP"' } });
    }
    const body = await request.json();
    method = typeof body?.method === "string" ? body.method : "unknown";
    tool = method === "tools/call" && typeof body?.params?.name === "string" ? body.params.name : null;
    const suppliedRequest = request.headers.get("X-Request-Id") ?? "";
    if (uuidPattern.test(suppliedRequest)) requestId = suppliedRequest;
    const url = secret("SUPABASE_URL");
    const serviceKey = secret("SUPABASE_SECRET_KEYS") || secret("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("server_not_configured");
    const admin = createClient(url, serviceKey, clientOptions);
    const { data: access, error: accessError } = await admin.rpc("developer_authorize_key", {
      p_hash: await sha256(token), p_method: method, p_tool: tool,
      p_origin: request.headers.get("Origin") ?? "", p_request: requestId,
    });
    if (accessError?.message.includes("rate_limited")) return response(body?.id, undefined, { code: -32029, message: "Límite de solicitudes alcanzado." });
    if (accessError || !access?.key_id) return response(body?.id, undefined, { code: -32001, message: "La clave no autoriza esta operación." });
    keyId = access.key_id;
    const scopes = new Set<string>(access.scopes ?? []);
    let result: unknown;
    if (method === "initialize") result = { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "Trefil OS", version: "1.0.0" } };
    else if (method === "ping") result = {};
    else if (method === "tools/list") result = { tools: tools.filter((item) => scopes.has(item.scope)).map(({ scope: _scope, ...item }) => item) };
    else if (method === "tools/call") {
      const args = body?.params?.arguments ?? {};
      if (tool === "trefil_system_status") result = toolContent({ server: "Trefil OS MCP", protocolVersion, connected: ["Equipo"], pendingAdapters: ["Finanzas", "Caja", "Inventarios", "Ventas", "Deudas", "Auditoría"], scopes: [...scopes] });
      else if (tool === "trefil_workforce_today") {
        const { data, error } = await admin.rpc("developer_workforce_today", { p_key: keyId });
        result = error ? toolContent({ error: "No se pudo consultar Equipo." }, true) : toolContent(data);
      } else if (tool === "trefil_team_targets") {
        const { data, error } = await admin.rpc("developer_team_targets", { p_key: keyId });
        result = error ? toolContent({ error: "No se pudo consultar el equipo autorizado." }, true) : toolContent(data);
      } else if (tool === "trefil_assign_task") {
        if (!uuidPattern.test(args.personId ?? "") || !datePattern.test(args.date ?? "") || (args.time && !timePattern.test(args.time)) || typeof args.title !== "string" || args.title.trim().length < 2 || args.title.trim().length > 120 || String(args.details ?? "").length > 1000) {
          result = toolContent({ error: "Parámetros de tarea inválidos." }, true);
        } else {
          const taskId = crypto.randomUUID();
          const { error } = await admin.rpc("developer_assign_task", { p_key: keyId, p_id: taskId, p_person: args.personId, p_day: args.date, p_time: args.time || null, p_title: args.title, p_details: args.details || "" });
          result = error ? toolContent({ error: "El rol o el alcance de la clave no permite programar esta tarea." }, true) : toolContent({ id: taskId, created: true });
        }
      } else return response(body?.id, undefined, { code: -32601, message: "Herramienta no disponible." });
    } else if (method.startsWith("notifications/")) return new Response(null, { status: 202 });
    else return response(body?.id, undefined, { code: -32601, message: "Método no disponible." });
    await admin.rpc("developer_log_call", { p_key: keyId, p_request: requestId, p_method: method, p_tool: tool, p_outcome: "success", p_duration: Math.round(performance.now() - started) });
    return response(body?.id, result);
  } catch (error) {
    console.error("trefil-mcp", error instanceof Error ? error.message : "unknown");
    return response(null, undefined, { code: -32603, message: "Error interno del servidor MCP." });
  }
});
