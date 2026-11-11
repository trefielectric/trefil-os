import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const previewOrigin =
  "https://trefil-os-git-codex-finance-preview-administrativo914.vercel.app";
const origins = new Set([
  previewOrigin,
  ...(Deno.env.get("WORKFORCE_APP_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
]);
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const key = (name) => JSON.parse(Deno.env.get(name) ?? "{}").default;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") ?? "";
  const headers = {
    "Access-Control-Allow-Origin": origins.has(origin) ? origin : previewOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info, x-region, x-supabase-api-version",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  const respond = (body, status) => Response.json(body, { headers, status });
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST" || !origins.has(origin))
    return respond({ code: "not_allowed" }, 403);
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return respond({ code: "not_allowed" }, 401);

  try {
    const payload = await request.json();
    if (typeof payload?.personId !== "string" || !uuid.test(payload.personId)) {
      return respond({ code: "invalid_person" }, 400);
    }
    const url = Deno.env.get("SUPABASE_URL");
    const publishableKey =
      key("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const secretKey =
      key("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !publishableKey || !secretKey)
      return respond({ code: "unavailable" }, 503);

    // PostgREST validates the caller's signed access token. The RPC checks the
    // current database role and AAL2 before any Auth Admin operation is attempted.
    const scoped = createClient(url, publishableKey, {
      ...options,
      global: { headers: { Authorization: authorization } },
    });
    const { data: email, error: accessError } = await scoped.rpc(
      "workforce_invite_target",
      { p_id: payload.personId },
    );
    if (accessError || typeof email !== "string")
      return respond({ code: "not_allowed" }, 403);

    const admin = createClient(url, secretKey, options);
    const { data, error } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
    });
    if (error || !data?.properties?.hashed_token) {
      const exists = [
        "email_exists",
        "user_already_exists",
        "email_already_in_use",
      ].includes(error?.code);
      return respond(
        { code: exists ? "existing_user" : "invite_unavailable" },
        exists ? 409 : 502,
      );
    }
    // The fragment stays in the browser and out of server URL logs.
    const link = new URL("/equipo/", origin);
    link.hash = new URLSearchParams({
      invitacion: data.properties.hashed_token,
    }).toString();
    return respond({ link: link.href }, 200);
  } catch {
    return respond({ code: "unavailable" }, 503);
  }
});
