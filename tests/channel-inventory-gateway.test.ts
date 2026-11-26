import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { serveInventory } from "../supabase/functions/channel-inventory/handler";

test("El servicio autoriza a cada canal y diferencia un saldo cero de una consulta fallida", async () => {
  const wired = randomUUID(),
    master = randomUUID();
  const values: Record<string, string> = {
    WIRED_INVENTORY_TOKEN: wired,
    MASTERSHOP_INVENTORY_TOKEN: master,
    SUPABASE_URL: "https://trefi.test",
    SUPABASE_SERVICE_ROLE_KEY: "internal-test",
  };
  const env = (name: string) => values[name];
  const req = (
    token: string,
    channel: string,
    payload: Record<string, unknown>,
  ) =>
    new Request("https://trefi.test/inventory", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "X-Inventory-Channel": channel,
      },
      body: JSON.stringify(payload),
    });
  let seen = 0;
  const rpc: typeof fetch = async (url, init) => {
    seen++;
    const message = JSON.parse(String(init?.body));
    assert.equal(message.p_channel, "wired");
    assert.deepEqual(message.p_ids, ["a", "b"]);
    assert.match(String(url), /channel_inventory_stock$/);
    return Response.json({ a: 0, b: null });
  };
  assert.equal(
    (
      await serveInventory(
        req(wired, "mastershop", { action: "stock", ids: ["a"] }),
        env,
        rpc,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await serveInventory(
        req("", "wired", { action: "stock", ids: ["a"] }),
        env,
        rpc,
      )
    ).status,
    401,
  );
  const shipping = await serveInventory(
    req(master, "mastershop", {
      action: "reserve",
      origin: "wired",
      order: "WT-1",
    }),
    env,
    rpc,
  );
  assert.deepEqual(await shipping.json(), {
    logisticsOnly: true,
    stockChanged: false,
  });
  assert.equal(
    (
      await serveInventory(
        req(master, "mastershop", { action: "reserve", order: "sin-origen" }),
        env,
        rpc,
      )
    ).status,
    409,
  );
  assert.equal(seen, 0);
  const valid = await serveInventory(
    req(wired, "wired", {
      action: "stock",
      ids: ["a", "b"],
      p_channel: "mastershop",
    }),
    env,
    rpc,
  );
  assert.deepEqual(await valid.json(), { available: { a: 0, b: null } });
  assert.equal(valid.headers.get("Cache-Control"), "no-store");
  const unavailable = await serveInventory(
    req(wired, "wired", { action: "stock", ids: ["a"] }),
    env,
    async () => {
      throw Error("unavailable");
    },
  );
  assert.equal(unavailable.status, 503);
});
