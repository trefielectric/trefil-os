import { serveInventory } from "./handler.ts";

Deno.serve((request) => serveInventory(request, (name) => Deno.env.get(name)));
