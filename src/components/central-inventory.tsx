"use client";

import { useContext, useEffect, useRef, useState, type FormEvent } from "react";
import { PublicWorkspace } from "@/lib/jornada-permissions";
import {
  getSupabaseClient,
  publicSupabaseConfiguration,
} from "@/lib/supabase/client";
import { signInWithDocument } from "@/lib/workforce";

type Source = "todos" | "wired" | "mastershop" | "alegra" | "fisico";
type Balance = {
  warehouse: string;
  physical: number;
  reserved: number;
  available: number;
  revision: number;
};
type Row = {
  source?: Source;
  external_id?: string;
  sku?: string | null;
  label: string;
  variant?: string | null;
  unit?: string | null;
  reported?: number | null;
  available_presentations?: number | null;
  code?: string | null;
  factor?: number | null;
  base_unit?: string | null;
  balances?: Balance[];
};
type Feed = {
  source: Source;
  evidence: string;
  product_count?: number | null;
  last_success: string | null;
  last_error: string | null;
};
type Snapshot = {
  items: Row[];
  total: number;
  page: number;
  page_size: number;
  approve: boolean;
  register: boolean;
  sources: { source: Source; total: number; linked: number }[];
  feeds: Feed[];
};
const names: Record<Source, string> = {
  todos: "Todos los orígenes",
  wired: "Wired",
  mastershop: "Mastershop",
  alegra: "Histórico Alegra",
  fisico: "Existencias físicas",
};
const kinds: Record<string, string> = {
  conteo: "Conteo físico",
  entrada: "Entrada",
  salida: "Salida sin reserva",
  reserva: "Reservar",
  liberacion: "Liberar reserva",
  despacho: "Despachar reserva",
  devolucion: "Devolución recibida",
};
const fmt = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 5 });
const time = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Bogota",
});
const field = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "La operación no se pudo completar.";

export function CentralInventory() {
  const guest=useContext(PublicWorkspace);
  const [identity, setIdentity] = useState<string | null | undefined>(
    undefined,
  );
  const [source, setSource] = useState<Source>("todos");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<Row | null>(null);
  const [requestId, setRequestId] = useState("");
  const writing = useRef(false);
  const [canConfigure, setCanConfigure] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  useEffect(() => {
    setCanConfigure(false);
    setShowConnect(false);
    if (!identity) return;
    const client = getSupabaseClient();
    if (!client) return;
    let active = true;
    void client.rpc("central_inventory_can_configure").then(
      ({ data }) => {
        if (active) setCanConfigure(data === true);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [identity]);

  useEffect(() => {
    if(guest){setData({items:[],total:0,page:1,page_size:50,approve:false,register:false,sources:[],feeds:[]});setLoading(false);return;}
    const client = getSupabaseClient();
    if (!client) {
      setIdentity(null);
      setLoading(false);
      return;
    }
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      setIdentity(session?.user.id ?? null);
      if (!session) {
        setData(null);
        setSelection(null);
        setError("");
        setNotice("");
      }
    });
    return () => subscription.unsubscribe();
  }, [guest]);
  useEffect(() => {
    if (!identity) return;
    const client = getSupabaseClient();
    if (!client) return;
    let active = true;
    setData(null);
    setLoading(true);
    setError("");
    setSelection(null);
    const timer = setTimeout(() => {
      void client
        .rpc("central_inventory", {
          p_source: source,
          p_search: search,
          p_page: page,
        })
        .then(
          ({ data: next, error: failed }) => {
            if (!active) return;
            setLoading(false);
            if (failed) {
              setError(failed.message);
              return;
            }
            setData(next as Snapshot);
          },
          () => {
            if (active) {
              setLoading(false);
              setError("No se pudo consultar el inventario.");
            }
          },
        );
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [identity, source, search, page, revision]);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const client = getSupabaseClient();
    if (!client || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      await signInWithDocument(
        client,
        field(values, "user"),
        String(values.get("pass") ?? ""),
      );
      form.reset();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function connectMastershop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const client = getSupabaseClient();
    if (!client || !canConfigure || writing.current) return;
    const key = field(new FormData(form), "credential");
    writing.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data: count, error: failed } = await client.rpc(
        "central_inventory_connect_mastershop",
        { p_credential: key },
      );
      if (failed) throw new Error(failed.message);
      setShowConnect(false);
      setNotice(
        "Mastershop conectado · " + count + " productos recibidos por la API.",
      );
      setRevision((n) => n + 1);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      form.reset();
      writing.current = false;
      setBusy(false);
    }
  }
  function choose(row: Row) {
    setSelection(row);
    setError("");
    setNotice("");
    setRequestId(crypto.randomUUID());
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabaseClient();
    if (!client || !selection || writing.current) return;
    const f = new FormData(event.currentTarget);
    writing.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let result;
      if (source === "fisico") {
        const warehouse = field(f, "warehouse").toUpperCase();
        const previous = selection.balances?.find(
          (x) => x.warehouse === warehouse,
        );
        result = await client.rpc("central_inventory_record", {
          p_code: selection.code,
          p_warehouse: warehouse,
          p_kind: field(f, "kind"),
          p_qty: field(f, "qty"),
          p_document: field(f, "document"),
          p_revision: previous?.revision ?? 0,
          p_request: requestId,
        });
      } else {
        result = await client.rpc("central_inventory_link", {
          p_source: selection.source,
          p_id: selection.external_id,
          p_code: field(f, "code"),
          p_name: field(f, "name"),
          p_unit: field(f, "unit"),
          p_factor: field(f, "factor"),
        });
      }
      if (result.error) throw new Error(result.error.message);
      setNotice(
        source === "fisico"
          ? "Movimiento registrado en bodega."
          : "Equivalencia guardada. Puedes registrar el conteo en Existencias físicas.",
      );
      setSelection(null);
      setRevision((n) => n + 1);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const configuration = publicSupabaseConfiguration();
  return (
    <main className="hub">
      <header className="hub-head">
        <div>
          <a href="/#inventarios">Volver a Inventarios</a>
          <h1>Inventario central</h1>
          <p>Trefil Electric · Wired Colombia</p>
        </div>
        {identity && (
          <button
            type="button"
            onClick={() => setRevision((n) => n + 1)}
            disabled={busy}
          >
            Actualizar vista
          </button>
        )}
      </header>
      {error && (
        <p className="hub-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="hub-notice" role="status">
          {notice}
        </p>
      )}
      {!guest && !configuration.configured ? (
        <p role="status">{configuration.reason}</p>
      ) : !guest && identity === undefined ? (
        <p role="status">Comprobando sesión…</p>
      ) : !guest && identity === null ? (
        <form className="hub-form" onSubmit={submitLogin}>
          <h2>Ingreso de equipo</h2>
          <label>
            Cédula o correo
            <input name="user" autoComplete="username" required />
          </label>
          <label>
            Contraseña
            <input
              name="pass"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button disabled={busy}>Ingresar</button>
        </form>
      ) : (
        <>
          {data && (
            <div className="hub-stats">
              {(["wired", "mastershop", "alegra"] as const).map((key) => {
                const summary = data.sources.find((x) => x.source === key);
                const feed = data.feeds.find((x) => x.source === key);
                const method =
                  key === "alegra"
                    ? "Lote histórico"
                    : feed?.evidence === "panel"
                      ? "Lectura del panel"
                      : feed?.evidence === "api"
                        ? "API de Mastershop"
                        : feed?.evidence === "directa"
                          ? "Base de Wired"
                          : "Pendiente";
                return (
                  <section key={key}>
                    <h2>{names[key]}</h2>
                    <strong>
                      {fmt.format(
                        key === "mastershop" && feed?.product_count != null
                          ? feed.product_count
                          : (summary?.total ?? 0),
                      )}
                    </strong>
                    {key === "mastershop" && feed?.product_count != null && (
                      <small>
                        productos · {summary?.total ?? 0} presentaciones
                      </small>
                    )}
                    <p>
                      {method}
                      {feed?.last_success
                        ? " · " + time.format(new Date(feed.last_success))
                        : ""}
                    </p>
                    <small>{summary?.linked ?? 0} vinculadas a bodega</small>
                    {feed?.last_error && (
                      <p className="hub-warning">{feed.last_error}</p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
          {data &&
            canConfigure &&
            data.feeds.find((f) => f.source === "mastershop")?.evidence !==
              "api" && (
              <div className="hub-connect">
                {showConnect ? (
                  <form className="hub-form" onSubmit={connectMastershop}>
                    <h2>Conectar Mastershop</h2>
                    <label>
                      Llave API de Wired Colombia
                      <input
                        type="password"
                        name="credential"
                        autoComplete="off"
                        maxLength={1024}
                        required
                      />
                    </label>
                    <small>
                      La llave se guarda en el Vault institucional después de
                      validar el catálogo con Mastershop.
                    </small>
                    <div className="hub-actions">
                      <button disabled={busy}>Guardar y comprobar</button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setShowConnect(false)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <button type="button" onClick={() => setShowConnect(true)}>
                    Conectar Mastershop
                  </button>
                )}
              </div>
            )}
          <div className="hub-filters">
            <label>
              Ver
              <select
                value={source}
                onChange={(e) => {
                  setSource(e.target.value as Source);
                  setPage(1);
                  setNotice("");
                }}
              >
                {Object.entries(names).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Buscar referencia
              <input
                type="search"
                value={search}
                placeholder="Código, SKU, nombre o ID"
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>
          {loading ? (
            <p role="status">Consultando existencias…</p>
          ) : (
            data && (
              <>
                <p className="hub-note">
                  {source === "fisico"
                    ? "Cada saldo corresponde a una referencia física y una bodega."
                    : "Cada fila conserva la unidad informada por su origen. Vincula las presentaciones confirmadas antes de comparar saldos."}
                </p>
                {!data.items.length ? (
                  <p>
                    {source === "fisico" && !search
                      ? "Vincula una referencia de origen para abrir su ficha física y registrar el primer conteo."
                      : "Sin resultados para esta consulta."}
                  </p>
                ) : (
                  <div className="hub-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Referencia</th>
                          <th>
                            {source === "fisico" ? "Unidad base" : "Origen"}
                          </th>
                          <th>
                            {source === "fisico"
                              ? "Saldos por bodega"
                              : "Cantidad informada"}
                          </th>
                          <th>
                            {source === "fisico"
                              ? "Movimiento"
                              : "Referencia física"}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((row) => (
                          <tr
                            key={
                              (row.source ?? "fisico") +
                              ":" +
                              (row.external_id ?? row.code)
                            }
                          >
                            <td>
                              <strong>
                                {row.label}
                                {row.variant ? " · " + row.variant : ""}
                              </strong>
                              <small>
                                {row.sku || row.code || row.external_id}
                              </small>
                            </td>
                            <td>
                              {row.source ? names[row.source] : row.base_unit}
                            </td>
                            <td>
                              {source === "fisico"
                                ? row.balances?.length
                                  ? row.balances.map((b) => (
                                      <small key={b.warehouse}>
                                        {b.warehouse} ·{" "}
                                        {fmt.format(b.available)} disponibles /{" "}
                                        {fmt.format(b.physical)} físicos /{" "}
                                        {fmt.format(b.reserved)} reservados
                                      </small>
                                    ))
                                  : "Pendiente de conteo"
                                : row.reported == null
                                  ? "Sin saldo actual"
                                  : fmt.format(row.reported) +
                                    " " +
                                    (row.unit ?? "")}
                              {row.available_presentations != null && (
                                <small>
                                  En bodegas con conteo:{" "}
                                  {fmt.format(row.available_presentations)}{" "}
                                  presentaciones disponibles
                                  {row.reported != null &&
                                    " · Diferencia frente al canal: " +
                                      fmt.format(
                                        row.available_presentations -
                                          row.reported,
                                      )}
                                </small>
                              )}
                            </td>
                            <td>
                              {source === "fisico" ? (
                                (data.approve || data.register) && (
                                  <button
                                    type="button"
                                    onClick={() => choose(row)}
                                  >
                                    Registrar
                                  </button>
                                )
                              ) : row.code ? (
                                <span>
                                  {row.code} · ×{row.factor} {row.base_unit}
                                </span>
                              ) : data.approve ? (
                                <button
                                  type="button"
                                  onClick={() => choose(row)}
                                >
                                  Vincular
                                </button>
                              ) : (
                                "Pendiente"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="hub-pages">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((n) => n - 1)}
                  >
                    Anterior
                  </button>
                  <span>
                    {data.total} referencias · Página {page} de{" "}
                    {Math.max(1, Math.ceil(data.total / data.page_size))}
                  </span>
                  <button
                    type="button"
                    disabled={page * data.page_size >= data.total}
                    onClick={() => setPage((n) => n + 1)}
                  >
                    Siguiente
                  </button>
                </div>
              </>
            )
          )}
          {selection && data && (
            <form className="hub-form" onSubmit={save} key={requestId}>
              <h2>
                {source === "fisico"
                  ? "Movimiento de bodega"
                  : "Vincular a referencia física"}
              </h2>
              <strong>
                {selection.label} {selection.variant}
              </strong>
              {source === "fisico" ? (
                <>
                  <label>
                    Bodega
                    <input
                      name="warehouse"
                      list="hub-warehouses"
                      required
                      maxLength={100}
                    />
                  </label>
                  <datalist id="hub-warehouses">
                    {selection.balances?.map((b) => (
                      <option key={b.warehouse} value={b.warehouse} />
                    ))}
                  </datalist>
                  <label>
                    Operación
                    <select name="kind">
                      {Object.entries(kinds)
                        .filter(([v]) =>
                          v === "conteo" ? data.approve : data.register,
                        )
                        .map(([v, label]) => (
                          <option value={v} key={v}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Cantidad en {selection.base_unit}
                    <input
                      name="qty"
                      type="number"
                      min="0"
                      step="any"
                      required
                    />
                  </label>
                  <label>
                    Documento de soporte o pedido
                    <input name="document" maxLength={160} required />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Código físico de Trefil
                    <input name="code" required maxLength={80} />
                  </label>
                  <label>
                    Nombre de la referencia física
                    <input
                      name="name"
                      defaultValue={selection.label}
                      required
                      maxLength={200}
                    />
                  </label>
                  <label>
                    Unidad base de bodega
                    <input
                      name="unit"
                      placeholder="metro, rollo o unidad"
                      required
                      maxLength={40}
                    />
                  </label>
                  <label>
                    Unidades base por presentación de origen
                    <input
                      name="factor"
                      type="number"
                      min="0.000001"
                      step="any"
                      required
                    />
                  </label>
                  <small>
                    Confirma el material, calibre, color y presentación antes de
                    vincular.
                  </small>
                </>
              )}
              <div className="hub-actions">
                <button disabled={busy}>Guardar</button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => setSelection(null)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </main>
  );
}
