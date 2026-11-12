import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const previewOrigin = "https://trefil-os-git-codex-finance-preview-administrativo914.vercel.app";
const origins = new Set([
  previewOrigin,
  "https://trefil-os-git-main-administrativo914.vercel.app",
  "https://project-kmpca.vercel.app",
  ...(Deno.env.get("WORKFORCE_APP_ORIGINS") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
]);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const key = (name) => {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : parsed?.default;
  } catch {
    return raw;
  }
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const lastFour = /^\d{4}$/;
const emailFor = (value) => `${value}@identidad.trefielectric.internal`;
const initialAdministrator = Object.freeze({
  name: "Federico Velásquez Perdomo",
  email: "fevepe1510@gmail.com",
  title: "Administrador general",
  area: "Administración",
});

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") ?? "";
  const headers = {
    "Access-Control-Allow-Origin": origins.has(origin) ? origin : previewOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-region, x-supabase-api-version",
    "Cache-Control": "no-store", Vary: "Origin",
  };
  const respond = (body, status = 200) => Response.json(body, { headers, status });
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST" || !origins.has(origin)) return respond({ code: "not_allowed" }, 403);

  try {
    const payload = await request.json();
    const url = Deno.env.get("SUPABASE_URL");
    const publishableKey = key("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const secretKey = key("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !publishableKey || !secretKey) return respond({ code: "unavailable" }, 503);
    const admin = createClient(url, secretKey, options);

    if (payload?.action === "status") {
      const { data, error } = await admin.rpc("workforce_bootstrap_available");
      if (error) console.error("workforce status", error.message);
      return error ? respond({ code: "unavailable" }, 503) : respond({ available: data === true });
    }

    if (payload?.action === "bootstrap") {
      if (!hash.test(payload.identifierHash) || !lastFour.test(payload.identifierLastFour) ||
        typeof payload.password !== "string" || payload.password.length < 6 ||
        payload.name !== initialAdministrator.name || payload.email !== initialAdministrator.email ||
        payload.title !== initialAdministrator.title || payload.area !== initialAdministrator.area)
        return respond({ code: "invalid_setup" }, 400);
      const email = emailFor(payload.identifierHash);
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: payload.password, email_confirm: true });
      if (createError || !created.user) return respond({ code: "setup_unavailable" }, 409);
      try {
        const publicClient = createClient(url, publishableKey, options);
        const { data: signed, error: signError } = await publicClient.auth.signInWithPassword({ email, password: payload.password });
        if (signError || !signed.session) throw signError ?? new Error("session");
        const scoped = createClient(url, publishableKey, { ...options, global: { headers: { Authorization: `Bearer ${signed.session.access_token}` } } });
        const { error: bootstrapError } = await scoped.rpc("workforce_bootstrap_admin", {
          p_hash: payload.identifierHash, p_last_four: payload.identifierLastFour,
          p_name: initialAdministrator.name,
          p_title: initialAdministrator.title,
          p_area: initialAdministrator.area,
        });
        if (bootstrapError) throw bootstrapError;
        return respond({ accessToken: signed.session.access_token, refreshToken: signed.session.refresh_token }, 201);
      } catch {
        await admin.auth.admin.deleteUser(created.user.id);
        return respond({ code: "setup_unavailable" }, 409);
      }
    }

    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ") || payload?.action !== "link" || !uuid.test(payload.personId))
      return respond({ code: "not_allowed" }, 401);
    const scoped = createClient(url, publishableKey, { ...options, global: { headers: { Authorization: authorization } } });
    const { data: target, error: accessError } = await scoped.rpc("workforce_invite_target", { p_id: payload.personId });
    if (accessError || !hash.test(target?.identifier_hash)) return respond({ code: "not_allowed" }, 403);
    const type = target.registered ? "recovery" : "invite";
    const { data, error } = await admin.auth.admin.generateLink({ type, email: emailFor(target.identifier_hash) });
    if (error || !data?.properties?.hashed_token) return respond({ code: "link_unavailable" }, 502);
    const link = new URL("/equipo/", origin);
    link.hash = new URLSearchParams({ activacion: data.properties.hashed_token, tipo: type }).toString();
    return respond({ link: link.href, type });
  } catch (error) {
    console.error("workforce invite", error instanceof Error ? error.message : "unknown");
    return respond({ code: "unavailable" }, 503);
  }
});
