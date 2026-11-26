// Only the trusted server of each channel holds its token. The channel comes from the verified token.
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

async function sameSecret(input: string, expected: string) {
  if (expected.length < 32 || input.length > 512) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all(
    [input, expected].map((s) =>
      crypto.subtle.digest("SHA-256", encoder.encode(s)),
    ),
  );
  const left = new Uint8Array(a),
    right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export async function serveInventory(
  request: Request,
  env: (s: string) => string | undefined,
  send: typeof fetch = fetch,
) {
  if (request.method !== "POST")
    return response({ error: "Método inválido." }, 405);
  const bearer =
    request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? "";
  const channel = request.headers.get("X-Inventory-Channel");
  if (channel !== "wired" && channel !== "mastershop")
    return response({ error: "Acceso denegado." }, 401);
  const expected =
    env(
      channel === "wired"
        ? "WIRED_INVENTORY_TOKEN"
        : "MASTERSHOP_INVENTORY_TOKEN",
    ) ?? "";
  if (!(await sameSecret(bearer, expected)))
    return response({ error: "Acceso denegado." }, 401);
  const url = env("SUPABASE_URL"),
    key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return response({ error: "Servicio sin configurar." }, 503);
  let body;
  try {
    const text = await request.text();
    if (text.length > 64000)
      return response({ error: "Solicitud demasiado extensa." }, 413);
    body = JSON.parse(text);
    if (!body || typeof body !== "object")
      return response({ error: "Solicitud inválida." }, 400);
  } catch {
    return response({ error: "Solicitud inválida." }, 400);
  }
  const version = body.action === "version";
  const read = body.action === "stock";
  const status = body.action === "status";
  if (
    !version &&
    !read &&
    !status &&
    !["reserve", "cancel", "dispatch"].includes(body.action)
  )
    return response({ error: "Acción inválida." }, 400);
  if (channel === "mastershop" && !read && !version && !status) {
    // Shipping a Wired order is another notification about the same sale.
    if (body.origin === "wired")
      return response({ logisticsOnly: true, stockChanged: false });
    if (body.origin !== "mastershop")
      return response(
        {
          error: "Identifica el origen del pedido antes de mover existencias.",
        },
        409,
      );
  }
  const values = version
    ? { p_channel: channel }
    : read
      ? { p_channel: channel, p_ids: body.ids }
      : status
        ? { p_channel: channel, p_order: body.order }
        : {
            p_channel: channel,
            p_order: body.order,
            p_action: body.action,
            p_lines: body.lines ?? [],
          };
  try {
    const upstream = await send(
      url +
        "/rest/v1/rpc/channel_inventory_" +
        (version ? "version" : read ? "stock" : status ? "status" : "sale"),
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
        signal: AbortSignal.timeout(5000),
      },
    );
    const result = await upstream.json();
    if (!upstream.ok) {
      if (result.code === "P0001")
        return response({ error: result.message }, 409);
      return response(
        { error: "No se pudo verificar el saldo de Trefi." },
        503,
      );
    }
    return response(
      version
        ? { version: result }
        : read
          ? { available: result }
          : status
            ? { order: result }
            : { state: result },
    );
  } catch {
    return response({ error: "No se pudo verificar el saldo de Trefi." }, 503);
  }
}
