import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const origins = new Set([
  "https://project-kmpca.vercel.app",
  "https://trefil-os-git-main-administrativo914.vercel.app",
  "https://trefil-os-git-codex-finance-preview-administrativo914.vercel.app",
  ...(Deno.env.get("WORKFORCE_APP_ORIGINS") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
]);
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
function key(group: string, legacy: string) {
  const raw = Deno.env.get(group);
  if (!raw) return Deno.env.get(legacy);
  try {
    return JSON.parse(raw).default ?? Deno.env.get(legacy);
  } catch {
    return raw;
  }
}
Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const headers = {
    Vary: "Origin",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origins.has(origin) ? origin : "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info, x-region, x-supabase-api-version",
  };
  const reply = (data: unknown, status = 200) =>
    Response.json(data, { status, headers });
  if (!origins.has(origin)) return reply({ error: "not_allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply({ error: "method" }, 405);
  try {
    const { email, password } = await request.json();
    if (
      typeof email !== "string" ||
      !email.includes("@") ||
      email.length > 254 ||
      typeof password !== "string" ||
      !password ||
      password.length > 1024
    )
      return reply({ error: "credentials" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!,
      adminKey = key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
      publicKey = key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    if (!adminKey || !publicKey) return reply({ error: "unavailable" }, 503);
    const admin = createClient(url, adminKey, options);
    const { data: address, error } = await admin.rpc(
      "workforce_login_address",
      { p_email: email.trim().toLowerCase() },
    );
    if (error) return reply({ error: "unavailable" }, 503);
    const auth = createClient(url, publicKey, options);
    const { data, error: failure } = await auth.auth.signInWithPassword({
      email: address ?? email.trim().toLowerCase(),
      password,
    });
    if (failure || !data.session)
      return reply(
        { error: "credentials" },
        failure?.status === 429 ? 429 : 401,
      );
    return reply({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch {
    return reply({ error: "unavailable" }, 503);
  }
});
