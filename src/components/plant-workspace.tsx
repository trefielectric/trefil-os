"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  Factory,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { PlantFinance } from "./plant-finance";
import { PlantReport } from "./plant-report";
import { DocumentReview } from "./document-review";
import { PlantSuppliers } from "./plant-suppliers";
import { signInWithDocument } from "@/lib/workforce";
import {
  accessProfiles,
  materialsOf,
  orderLines,
  plantKinds,
  ref,
  rightsLabels,
  sections,
  type Area,
  type FieldSpec,
  type Line,
  type Member,
  type Row,
  type Snapshot,
} from "@/lib/plant-forms";

type Editor = { action: string; row?: Row; member?: Member };
const actionNames: Record<string, string> = {
  crear: "Crear",
  despachar: "Registrar corte y despacho",
  conciliar_garantia: "Conciliar devolución y compensación",
  verificar: "Verificar checklist",
  recibir: "Confirmar recepción",
  aprobar: "Aprobar",
  rechazar: "Rechazar",
  reabrir: "Reabrir",
  cerrar: "Cerrar",
  seguimiento: "Actualizar",
  acceso: "Asignar perfil y permisos",
};
const sectionNames: Record<string, string> = {
  personas: "Usuarios y permisos",
  panel: "Panel gerencial",
  auditoria: "Auditoría",
  revision: "Importaciones de SharePoint",
  informes: "Informes históricos",
};
const label = (k: string) => sections[k]?.name ?? sectionNames[k] ?? k;
const textValue = (v: unknown) => (v == null ? "" : String(v));
const fieldLabel = (key: string) =>
  Object.values(sections)
    .flatMap((s) => s.fields)
    .find((f) => f.key === key)?.label ??
  {
    primerConteo: "Primer conteo",
    numero: "Consecutivo de serie",
    recibido: "Cantidad recibida",
    ejecutado: "Ejecución (COP)",
    ficha: "Ficha",
    receptor: "Responsable de recepción",
  }[key] ??
  key;
function Input({ f, initial }: { f: FieldSpec; initial?: string }) {
  return (
    <label>
      {f.label}
      {f.choices ? (
        <select name={f.key} defaultValue={initial} required={!f.optional}>
          {f.choices.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      ) : f.type === "textarea" ? (
        <textarea
          name={f.key}
          required={!f.optional}
          defaultValue={initial}
          rows={3}
        />
      ) : (
        <input
          type={f.type ?? "text"}
          name={f.key}
          accept={f.type === "file" ? "application/pdf" : undefined}
          min={f.type === "number" ? 0 : undefined}
          step={f.type === "number" ? "0.000001" : undefined}
          defaultValue={initial}
          required={!f.optional}
        />
      )}
    </label>
  );
}
function ReferenceSelect({
  title,
  rows,
  value,
  change,
}: {
  title: string;
  rows: Row[];
  value: string;
  change: (id: string) => void;
}) {
  return (
    <label>
      {title}
      <select required value={value} onChange={(e) => change(e.target.value)}>
        <option value="">Selecciona</option>
        {rows.map((r) => (
          <option value={r.id} key={r.id}>
            {ref(r)} · {r.title}
          </option>
        ))}
      </select>
    </label>
  );
}
function renderDetails(data: Record<string, unknown>): ReactNode {
  return (
    <dl className="plant-details">
      {Object.entries(data)
        .filter(
          ([k, v]) =>
            v !== null && v !== "" && !["archivo", "clave"].includes(k),
        )
        .map(([k, v]) => (
          <div key={k}>
            <dt>{fieldLabel(k)}</dt>
            <dd>
              {Array.isArray(v)
                ? v.map((item, i) => (
                    <section key={i}>
                      {typeof item === "object"
                        ? renderDetails(item)
                        : String(item)}
                    </section>
                  ))
                : typeof v === "object"
                  ? renderDetails(v as Record<string, unknown>)
                  : typeof v === "boolean"
                    ? v
                      ? "Sí"
                      : "No"
                    : String(v)}
            </dd>
          </div>
        ))}
    </dl>
  );
}
async function readPdf(file: File) {
  if (file.size > 3 * 1024 * 1024)
    throw new Error("El PDF supera el límite de 3 MB.");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el PDF."));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
}
function WarrantyMovement({
  item,
  field,
  mode,
  label,
}: {
  item: string;
  field: string;
  mode: string;
  label: string;
}) {
  const [query, setQuery] = useState(""),
    [options, setOptions] = useState<{ id: string; etiqueta: string }[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setOptions([]);
    setError("");
    const timer = setTimeout(async () => {
      const client = getSupabaseClient();
      if (!client) return;
      const result = await client.rpc("plant_warranty_sources", {
        item,
        mode,
        search_term: query,
      });
      if (active) {
        if (result.error) setError(result.error.message);
        else setOptions(result.data ?? []);
      }
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [item, mode, query]);
  return (
    <fieldset>
      <legend>{label}</legend>
      <label>
        Buscar documento o código
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <label>
        Movimiento
        <select required name={field} defaultValue="" key={query}>
          <option value="">Selecciona</option>
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.etiqueta}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
function EditPanel({
  kind,
  edit,
  snapshot,
  busy,
  save,
  cancel,
}: {
  kind: string;
  edit: Editor;
  snapshot: Snapshot;
  busy: boolean;
  save: (body: Record<string, unknown>, reason: string) => Promise<void>;
  cancel: () => void;
}) {
  const { action, row, member } = edit;
  const fichas = snapshot.registros.filter((r) => r.kind === "ficha");
  const orders = snapshot.registros.filter(
    (r) => r.kind === "ot" && r.state === "abierto",
  );
  const [parent, setParent] = useState(orders[0]?.id ?? "");
  const [sheet, setSheet] = useState("");
  const [count, setCount] = useState(1);
  const [materials, setMaterials] = useState(0);
  const [parts, setParts] = useState(1);
  const [fileError, setFileError] = useState("");
  const forLine =
    action === "verificar" || (action === "seguimiento" && kind === "ot");
  const forChild =
    action === "crear" && ["rotulo", "lote", "entrega"].includes(kind);
  const otherParent: Record<string, string> = {
    traslado: "rotulo",
    carreta: "entrega",
    corte: "carreta",
  };
  const lines = orderLines(forLine ? row : orders.find((o) => o.id === parent));
  const selected = lines.find((l) => l.ficha === sheet);
  const steps =
    selected?.fichaTecnica?.ruta
      ?.split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {};
    try {
      for (const [key, v] of fd.entries()) {
        if (key === "motivo" || key.startsWith("_")) continue;
        body[key] = v instanceof File ? await readPdf(v) : v;
      }
      if (action === "crear") body.tipo = kind;
      if (forChild) body.padre = parent;
      if (forChild || forLine) body.ficha = sheet;
      if (action === "crear" && kind === "lote")
        body.rotulos = fd.getAll("_rotulos");
      if (action === "verificar") body.ruta = selected?.fichaTecnica?.ruta;
      if (action === "crear" && kind === "ot")
        body.lineas = Array.from({ length: count }, (_, i) =>
          Object.fromEntries(
            [
              "ficha",
              "cantidad",
              "fecha",
              "responsable",
              "prioridad",
              "bodegaMaterial",
            ].map((k) => [k, fd.get("_" + k + i)]),
          ),
        );
      if (
        (action === "crear" || action === "seguimiento") &&
        kind === "ficha" &&
        materials
      )
        body.formula = Array.from({ length: materials }, (_, i) =>
          Object.fromEntries(
            ["codigo", "unidad", "cantidad", "costo"].map((k) => [
              k,
              fd.get("_mat" + k + i),
            ]),
          ),
        );
      if (action === "cerrar" && kind === "ot")
        body.faltantes = Object.fromEntries(
          orderLines(row).map((l) => [l.ficha, fd.get("_motivo" + l.ficha)]),
        );
      if (action === "acceso") body.permisos = fd.getAll("_permisos");
      if (action === "cerrar" && ["rotulo", "recuperacion"].includes(kind))
        body.partes = Array.from({ length: parts }, (_, i) =>
          Object.fromEntries(
            [
              "clase",
              "cantidad",
              "unidad",
              "factor",
              "conversion",
              "destino",
            ].map((key) => [key, fd.get("_parte" + i + key)]),
          ),
        );
      if (action === "cerrar" && kind === "ot")
        body.consumos = Object.fromEntries(
          materialsOf(row).map((m, i) => [m.clave, fd.get("_consumo" + i)]),
        );
      await save(body, String(fd.get("motivo") ?? ""));
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Revisa los campos.");
    }
  }
  let fields: FieldSpec[] = [];
  if (action === "crear") fields = sections[kind].fields;
  if (action === "aprobar" && kind === "garantia") {
    fields = [
      {
        key: "solucion",
        label: "Solución comercial autorizada",
        choices: ["Reposición", "Reembolso"],
      },
    ];
    if (snapshot.perfil === "GERENTE DE VENTAS")
      fields.push(
        {
          key: "adicionales",
          label: "Cantidad adicional de venta",
          type: "number",
          optional: true,
        },
        {
          key: "lista",
          label: "Lista vigente para adicionales",
          optional: true,
        },
      );
  }
  if (action === "conciliar_garantia" && row) {
    const solution =
      row.state === "rechazado"
        ? "Sin compensación"
        : String(row.data.solucionAutorizada);
    fields = [
      { key: "solucion", label: "Solución autorizada", choices: [solution] },
      {
        key: "documentoOriginal",
        label: "Factura y soporte que acredita el precio pagado por unidad",
      },
      {
        key: "codigoDestino",
        label: "Código físico del material ya clasificado",
      },
      {
        key: "bodegaDestino",
        label: "Bodega de clasificación",
        choices: ["GARANTÍAS - " + String(row.data.destino).toUpperCase()],
      },
      {
        key: "factor",
        label: "Unidades clasificadas por unidad recibida",
        type: "number",
      },
      {
        key: "conversion",
        label: "Soporte de conversión si el factor difiere de 1",
        optional: true,
      },
    ];
    if (solution === "Reembolso")
      fields.push(
        {
          key: "compensacion",
          label: "Consecutivo del egreso original en Caja",
        },
        {
          key: "cliente",
          label: "Cliente beneficiario, tal como figura en Caja",
        },
      );
    if (solution === "Reposición")
      fields.push(
        {
          key: "costoInterno",
          label: "Costo interno total de la reposición (COP)",
          type: "number",
        },
        {
          key: "entregaCliente",
          label: "Soporte de entrega al cliente sin cobro",
        },
      );
    if (Number(row.data.adicionalesAutorizados) > 0)
      fields.push({
        key: "ventaAdicional",
        label: "Documento de venta separado por los adicionales autorizados",
      });
  }
  if (action === "recibir")
    fields = [
      { key: "recibido", label: "Cantidad física recibida", type: "number" },
    ];
  if (action === "despachar")
    fields = [
      { key: "real", label: "Metros realmente cortados", type: "number" },
    ];
  if (action === "cerrar" && kind === "carreta")
    fields = [
      { key: "saldo", label: "Saldo físico final (metros)", type: "number" },
    ];
  if (action === "cerrar" && ["rotulo", "recuperacion"].includes(kind))
    fields = [
      { key: "conciliado", label: "Cantidad conciliada total", type: "number" },
      { key: "unidad", label: "Unidad" },
      {
        key: "destinos",
        label: "Cantidad y destino de cada componente",
        type: "textarea",
      },
      { key: "soporte", label: "Soporte" },
    ];
  if (action === "seguimiento") {
    if (kind === "ficha")
      fields = sections.ficha.fields.filter((f) =>
        ["ruta", "materiales"].includes(f.key),
      );
    else if (kind === "recuperacion")
      fields = [
        {
          key: "fisico",
          label: "Primer peso físico verificado (kg)",
          type: "number",
        },
        { key: "soporte", label: "Soporte del pesaje" },
      ];
    else if (kind === "expediente")
      fields = sections.expediente.fields.filter((f) => f.key === "archivo");
    else if (kind === "ot")
      fields = [
        { key: "cantidad", label: "Nueva cantidad", type: "number" },
        { key: "fecha", label: "Fecha objetivo", type: "date" },
        { key: "responsable", label: "Responsable" },
        {
          key: "prioridad",
          label: "Prioridad",
          choices: ["Alta", "Media", "Baja"],
        },
      ];
    else
      fields = [
        { key: "seguimiento", label: "Avance o decisión", type: "textarea" },
        { key: "responsable", label: "Responsable" },
        ...(kind === "proyecto"
          ? [
              {
                key: "ejecutado",
                label: "Ejecutado al corte (COP)",
                type: "number",
              },
              { key: "supuestos", label: "Supuestos vigentes" },
            ]
          : []),
      ];
  }
  return (
    <form onSubmit={submit} className="plant-editor">
      <div className="plant-heading">
        <h2>
          {actionNames[action]}{" "}
          {member?.nombre ?? row?.title ?? sections[kind]?.singular}
        </h2>
        <button type="button" onClick={cancel}>
          Cancelar
        </button>
      </div>
      <fieldset disabled={busy}>
        <div className="plant-fields">
          {action === "crear" && (
            <Input f={{ key: "titulo", label: "Nombre o referencia" }} />
          )}
          {forChild && (
            <ReferenceSelect
              title="Orden de trabajo"
              value={parent}
              rows={orders}
              change={(id) => {
                setParent(id);
                setSheet("");
              }}
            />
          )}
          {(forChild || forLine) && (
            <ReferenceSelect
              title="Referencia de la OT"
              rows={fichas.filter((f) => lines.some((l) => l.ficha === f.id))}
              value={sheet}
              change={setSheet}
            />
          )}
          {action === "crear" && kind === "lote" && (
            <>
              <Input
                f={{
                  key: "compra",
                  label: "Factura de compra si es producto terminado adquirido",
                  optional: true,
                }}
              />
              <div className="plant-checks">
                {snapshot.registros
                  .filter(
                    (r) =>
                      r.kind === "rotulo" &&
                      r.parent === parent &&
                      r.data.ficha === sheet,
                  )
                  .map((r) => (
                    <label key={r.id}>
                      <input type="checkbox" name="_rotulos" value={r.id} />
                      {textValue(r.data.categoria)} {textValue(r.data.numero)} ·{" "}
                      {r.title}
                    </label>
                  ))}
              </div>
            </>
          )}
          {action === "crear" && kind === "entrega" && (
            <label>
              Lote de esta referencia
              <select name="lote" required key={parent + sheet} defaultValue="">
                <option value="">Selecciona</option>
                {snapshot.registros
                  .filter(
                    (r) =>
                      r.kind === "lote" &&
                      r.state === "abierto" &&
                      r.parent === parent &&
                      r.data.ficha === sheet,
                  )
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {ref(r)} · {r.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {action === "crear" && otherParent[kind] && (
            <label>
              {sections[otherParent[kind]].singular} de origen
              <select name="padre" required defaultValue="">
                <option value="">Selecciona</option>
                {snapshot.registros
                  .filter(
                    (r) =>
                      r.kind === otherParent[kind] &&
                      r.state === (kind === "carreta" ? "aceptado" : "abierto"),
                  )
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {ref(r)} · {r.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {action === "crear" && kind === "corte" && (
            <label>
              OP confirmada
              <select name="pedido" required defaultValue="">
                <option value="">Selecciona</option>
                {snapshot.registros
                  .filter(
                    (r) => r.kind === "pedido_corte" && r.state === "abierto",
                  )
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {textValue(r.data.op)} · {textValue(r.data.codigo)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {fields.map((f) => (
            <Input
              key={f.key}
              f={f}
              initial={
                action === "seguimiento" && row && f.type !== "file"
                  ? textValue(row.data[f.key])
                  : undefined
              }
            />
          ))}
          {action === "conciliar_garantia" && row && (
            <>
              <WarrantyMovement
                item={row.id}
                field="clasificacion"
                mode="clasificacion"
                label="Entrada física de clasificación"
              />
              {row.data.solucionAutorizada === "Reposición" && (
                <WarrantyMovement
                  item={row.id}
                  field="compensacion"
                  mode="reposicion"
                  label="Salida física de reposición"
                />
              )}
            </>
          )}
          {action === "acceso" && (
            <>
              <Input
                f={{
                  key: "perfil",
                  label: "Perfil organizacional",
                  choices:
                    snapshot.perfil === "CREADOR"
                      ? accessProfiles
                      : [member?.perfil ?? "COLABORADOR"],
                }}
                initial={member?.perfil ?? "COLABORADOR"}
              />
              <div className="plant-checks">
                {snapshot.opciones
                  .filter(
                    (p) =>
                      snapshot.perfil === "CREADOR" ||
                      (snapshot.permisos.includes(p) &&
                        p !== "control.administrar_permisos"),
                  )
                  .map((p) => (
                    <label key={p}>
                      <input
                        type="checkbox"
                        name="_permisos"
                        value={p}
                        defaultChecked={member?.permisos?.includes(p)}
                      />
                      {rightsLabels[p]}
                    </label>
                  ))}
              </div>
            </>
          )}
        </div>
        {kind === "ficha" && (
          <>
            <div className="plant-lines">
              {Array.from({ length: materials }, (_, i) => (
                <fieldset key={i}>
                  <legend>Insumo teórico {i + 1}</legend>
                  <div className="plant-fields">
                    {[
                      { key: "codigo", label: "Código del material" },
                      { key: "unidad", label: "Unidad" },
                      {
                        key: "cantidad",
                        label: "Cantidad por unidad de producto",
                        type: "number",
                      },
                      {
                        key: "costo",
                        label: "Costo por unidad de material (COP)",
                        type: "number",
                      },
                    ].map((f) => (
                      <Input
                        key={f.key}
                        f={{ ...f, key: "_mat" + f.key + i }}
                      />
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <button type="button" onClick={() => setMaterials(materials + 1)}>
              + Añadir material a la fórmula
            </button>
            {materials > 0 && (
              <button type="button" onClick={() => setMaterials(materials - 1)}>
                Quitar último material
              </button>
            )}
          </>
        )}
        {action === "cerrar" && ["rotulo", "recuperacion"].includes(kind) && (
          <>
            {Array.from({ length: parts }, (_, i) => (
              <fieldset key={i}>
                <legend>Componente {i + 1}</legend>
                <div className="plant-fields">
                  {[
                    {
                      key: "clase",
                      label: "Clasificación",
                      choices:
                        kind === "recuperacion"
                          ? [
                              "Material limpio",
                              "Insumo reutilizable",
                              "Chatarra comercial",
                              "Descarte",
                            ]
                          : [
                              "Producto regular",
                              "Cortas",
                              "Dañado",
                              "Sobrante",
                            ],
                    },
                    { key: "cantidad", label: "Cantidad", type: "number" },
                    { key: "unidad", label: "Unidad física" },
                    {
                      key: "factor",
                      label: "Factor a la unidad de conciliación",
                      type: "number",
                    },
                    {
                      key: "conversion",
                      label: "Soporte de conversión",
                      optional: true,
                    },
                    { key: "destino", label: "Ubicación o destino" },
                  ].map((f) => (
                    <Input
                      key={f.key}
                      f={{ ...f, key: "_parte" + i + f.key }}
                      initial={
                        f.key === "factor"
                          ? "1"
                          : f.key === "unidad"
                            ? kind === "recuperacion"
                              ? "kg"
                              : String(row?.data.unidad ?? "")
                            : undefined
                      }
                    />
                  ))}
                </div>
              </fieldset>
            ))}
            <button type="button" onClick={() => setParts((n) => n + 1)}>
              Añadir componente
            </button>
            {parts > 1 && (
              <button type="button" onClick={() => setParts((n) => n - 1)}>
                Quitar último componente
              </button>
            )}
          </>
        )}
        {action === "crear" && kind === "ot" && (
          <>
            <div className="plant-lines">
              {Array.from({ length: count }, (_, i) => (
                <fieldset key={i}>
                  <legend>Producto {i + 1}</legend>
                  <div className="plant-fields">
                    <label>
                      Ficha
                      <select name={"_ficha" + i} required defaultValue="">
                        <option value="">Selecciona</option>
                        {fichas.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.title} · {textValue(f.data.codigo)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {[
                      { key: "cantidad", label: "Cantidad", type: "number" },
                      { key: "fecha", label: "Fecha objetivo", type: "date" },
                      { key: "responsable", label: "Responsable" },
                      {
                        key: "bodegaMaterial",
                        label:
                          "Bodega física de los insumos de esta referencia",
                        optional: true,
                      },
                      {
                        key: "prioridad",
                        label: "Prioridad",
                        choices: ["Media", "Alta", "Baja"],
                      },
                    ].map((f) => (
                      <Input key={f.key} f={{ ...f, key: "_" + f.key + i }} />
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <button type="button" onClick={() => setCount(count + 1)}>
              + Añadir referencia
            </button>
            {count > 1 && (
              <button type="button" onClick={() => setCount(count - 1)}>
                Quitar última
              </button>
            )}
          </>
        )}
        {action === "verificar" && (
          <div className="plant-checks">
            {steps.map((s, i) => (
              <label key={i}>
                <input required type="checkbox" />
                {s}
              </label>
            ))}
          </div>
        )}
        {action === "cerrar" &&
          kind === "ot" &&
          orderLines(row).map((l) => (
            <Input
              key={l.ficha}
              f={{
                key: "_motivo" + l.ficha,
                label:
                  "Justificación si hay saldo pendiente · " +
                  l.fichaTecnica?.codigo,
                optional: true,
              }}
            />
          ))}
        {action === "cerrar" &&
          kind === "ot" &&
          materialsOf(row).map((m, i) => (
            <Input
              key={m.clave}
              f={{
                key: "_consumo" + i,
                type: "number",
                label: `Consumo real por registrar · ${m.codigo} · ${m.bodega} (${m.unidad})`,
              }}
            />
          ))}
        <Input
          f={{ key: "motivo", label: "Motivo o soporte de la operación" }}
        />
        {fileError && <p role="alert">{fileError}</p>}
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </fieldset>
    </form>
  );
}

export function PlantWorkspace({ area }: { area: Area }) {
  const control = area === "control";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [loading, setLoading] = useState(true),
    [session, setSession] = useState(false);
  const [kind, setKind] = useState(control ? "panel" : "ot"),
    [editor, setEditor] = useState<Editor | null>(null);
  const [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  function incidentField(r: Row, field: string) {
    if (field === "estado") return r.state;
    if (field === "fecha")
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Bogota",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(r.created));
    return String(
      r.data[field] ??
        (field === "importancia" && r.parent
          ? "Alta"
          : field === "areaResponsable" && r.parent
            ? "Producción"
            : ""),
    );
  }
  const serial = useRef(0),
    lock = useRef(false),
    request = useRef<{ key: string; id: string; target: string } | null>(null);
  const client = getSupabaseClient();
  const [history, setHistory] = useState<{
    id: string;
    rows: Record<string, unknown>[];
  } | null>(null);
  const refresh = useCallback(async () => {
    const generation = ++serial.current;
    if (!client) {
      setError("Falta la configuración institucional de la plataforma.");
      setLoading(false);
      return;
    }
    const {
      data: { session: current },
    } = await client.auth.getSession();
    if (generation !== serial.current) return;
    setSession(!!current);
    if (!current) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    const result = await client.rpc("plant_workspace", { area });
    if (generation !== serial.current) return;
    setHistory(null);
    setSnapshot(result.error ? null : (result.data as Snapshot));
    setError(result.error?.message ?? "");
    setLoading(false);
  }, [client, area]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 0);
    };
    schedule();
    const subscription = client?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
        ++serial.current;
        setSnapshot(null);
        setEditor(null);
      }
      schedule();
    });
    window.addEventListener("focus", schedule);
    return () => {
      ++serial.current;
      clearTimeout(timer);
      subscription?.data.subscription.unsubscribe();
      window.removeEventListener("focus", schedule);
    };
  }, [client, refresh]);
  const has = (p: string) => !!snapshot?.permisos.includes(p);
  const sectionsVisible = control
    ? [
        ...(has("control.panel") ? ["panel"] : []),
        ...(has("control.personas") ? ["personas"] : []),
        ...(has("control.aprobar") || has("control.seguimiento")
          ? ["caso"]
          : []),
        ...(has("control.proyectos") ? ["proyecto"] : []),
        ...(has("archivo.ver") ? ["expediente"] : []),
        ...(snapshot?.perfil === "CREADOR" ? ["revision"] : []),
        ...(has("control.auditar") ? ["auditoria"] : []),
      ]
    : [...plantKinds, "informes"];
  useEffect(() => {
    if (area === "control" && window.location.hash === "#revision")
      setKind("revision");
    if (area === "produccion" && window.location.hash === "#informes")
      setKind("informes");
  }, [area]);
  const current = sectionsVisible.includes(kind)
    ? kind
    : (sectionsVisible[0] ?? "");
  const rows =
    snapshot?.registros.filter(
      (r) =>
        r.kind === current &&
        (current !== "caso" ||
          Object.entries(filters).every(
            ([key, v]) => !v || incidentField(r, key) === v,
          )) &&
        [
          r.title,
          r.series,
          r.state,
          ...Object.values(r.data).filter((v) => typeof v === "string"),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    ) ?? [];
  async function run(job: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await job();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se completó la operación.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await run(async () => {
      if (!client) throw new Error("Conexión no disponible.");
      await signInWithDocument(
        client,
        String(fd.get("user")),
        String(fd.get("pass")),
      );
      await refresh();
    });
  }
  const edit = (e: Editor) => {
    request.current = null;
    setEditor(e);
    setError("");
    setNotice("");
  };
  async function save(body: Record<string, unknown>, reason: string) {
    await run(async () => {
      if (!client || !editor) throw new Error("Abre la operación de nuevo.");
      const key = JSON.stringify([
        editor.action,
        editor.row?.id,
        editor.member?.id,
        body,
        reason,
      ]);
      if (key !== request.current?.key)
        request.current = {
          key,
          id: crypto.randomUUID(),
          target: editor.row?.id ?? editor.member?.id ?? crypto.randomUUID(),
        };
      const { error: err } =
        editor.action === "conciliar_garantia"
          ? await client.rpc("plant_warranty_close", {
              item: request.current.target,
              expected: editor.row?.version,
              request: request.current.id,
              body,
              note: reason,
            })
          : await client.rpc("plant_command", {
              area,
              action: editor.action,
              target: request.current.target,
              expected: editor.row?.version ?? 0,
              body,
              reason,
              request: request.current.id,
            });
      if (err)
        throw new Error(
          err.code === "23505"
            ? "Ya hay un registro abierto o una referencia repetida. Actualiza la vista."
            : err.message,
        );
      setEditor(null);
      setNotice("Operación guardada.");
      await refresh();
    });
  }
  async function download(r: Row, version: number) {
    await run(async () => {
      if (!client) return;
      const { data, error: err } = await client.rpc("plant_file", {
        item: r.id,
        revision: version,
      });
      if (err) throw new Error(err.message);
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "Expediente-" + r.series + "-v" + version + ".pdf";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      await refresh();
    });
  }
  const canCreate =
    sections[current] &&
    (control
      ? has(
          current === "proyecto"
            ? "control.proyectos"
            : current === "expediente"
              ? "archivo.editar"
              : "control.seguimiento",
        )
      : has("planta.registrar")) &&
    (!["ot", "entrega", "lote", "rotulo", "garantia", "cierre"].includes(
      current,
    ) ||
      ["PRODUCCIÓN", "CREADOR"].includes(snapshot?.perfil ?? "")) &&
    (current !== "precio" ||
      ["CREADOR", "GERENTE", "GERENTE DE VENTAS"].includes(
        snapshot?.perfil ?? "",
      ));
  function actions(r: Row) {
    if (
      r.kind === "garantia" &&
      ["aprobado", "rechazado"].includes(r.state) &&
      has("planta.registrar") &&
      ["CREADOR", "GERENTE", "GERENTE DE VENTAS", "PRODUCCIÓN"].includes(
        snapshot?.perfil ?? "",
      )
    )
      return ["conciliar_garantia"];
    if (
      r.state === "cerrado" ||
      (r.kind === "cierre" && r.state === "aprobado")
    )
      return snapshot?.perfil === "CREADOR" &&
        ["rotulo", "ot", "recuperacion", "lote", "cierre"].includes(r.kind)
        ? ["reabrir"]
        : [];
    if (["aceptado", "aprobado", "rechazado"].includes(r.state)) return [];
    const result: string[] = [];
    const technicalCase =
      !control &&
      r.kind === "caso" &&
      snapshot?.perfil === "PRODUCCIÓN" &&
      has("planta.registrar") &&
      has("planta.verificar") &&
      snapshot.registros.some(
        (p) =>
          p.id === r.parent && ["traslado", "recuperacion"].includes(p.kind),
      );
    if (technicalCase && r.author !== snapshot?.persona)
      result.push("aprobar", "rechazar");
    if (
      ["entrega", "traslado"].includes(r.kind) &&
      has("bodega.recibir") &&
      r.author !== snapshot?.persona
    )
      result.push("recibir");
    if (r.kind === "corte" && has("planta.registrar")) result.push("despachar");
    if (r.kind === "ot" && has("planta.verificar")) result.push("verificar");
    if (
      (["ot", "rotulo", "recuperacion", "lote", "carreta"].includes(r.kind) &&
        has("planta.verificar")) ||
      (r.kind === "proyecto" && has("control.proyectos"))
    )
      result.push("cerrar");
    if (
      (r.kind === "proyecto" && has("control.proyectos")) ||
      (r.kind === "expediente" && has("archivo.editar")) ||
      (r.kind === "ficha" && snapshot?.perfil === "CREADOR") ||
      (r.kind === "recuperacion" &&
        (r.data.fisico == null || r.data.fisico === "") &&
        has("planta.registrar") &&
        ["PRODUCCIÓN", "CREADOR"].includes(snapshot?.perfil ?? "")) ||
      (r.kind === "recuperacion" &&
        (r.data.fisico == null || r.data.fisico === "") &&
        has("planta.registrar") &&
        ["CREADOR", "PRODUCCIÓN"].includes(snapshot?.perfil ?? "")) ||
      (r.kind === "ot" && has("planta.registrar")) ||
      (r.kind === "caso" &&
        has(control ? "control.seguimiento" : "planta.registrar"))
    )
      result.push("seguimiento");
    if (
      ["caso", "cierre", "garantia"].includes(r.kind) &&
      r.author !== snapshot?.persona &&
      [
        "CREADOR",
        "GERENTE",
        ...(r.kind === "garantia" ? ["GERENTE DE VENTAS"] : []),
      ].includes(snapshot?.perfil ?? "") &&
      has(control ? "control.aprobar" : "planta.registrar") &&
      (r.kind === "garantia" || has("control.aprobar"))
    )
      result.push("aprobar", "rechazar");
    return result;
  }
  return (
    <main className="plant-shell">
      <header>
        <a href="/">
          <ArrowLeft size={16} />
          <img
            src="/brand/trefielectric-logo.jpg"
            width="44"
            height="44"
            alt="TrefiElectric"
          />{" "}
          Trefil OS
        </a>
        <span>{snapshot?.nombre ?? "Acceso institucional"}</span>
      </header>
      <div className="plant-title">
        {control ? <LockKeyhole /> : <Factory />}
        <div>
          <small>MÓDULO {control ? "10" : "07"}</small>
          <h1>{control ? "Control Administrativo" : "Producción"}</h1>
        </div>
      </div>
      {error && (
        <p className="plant-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="plant-notice" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">Consultando tu sesión…</p>
      ) : !session ? (
        <form className="plant-editor plant-login" onSubmit={login}>
          <h2>Ingresar con mi cuenta de Equipo</h2>
          <label>
            Cédula o correo
            <input name="user" required autoComplete="username" />
          </label>
          <label>
            Contraseña
            <input
              name="pass"
              required
              type="password"
              autoComplete="current-password"
            />
          </label>
          <button className="button button-primary" disabled={!client || busy}>
            Ingresar
          </button>
        </form>
      ) : !snapshot ? (
        <button
          className="button button-secondary"
          onClick={() => void refresh()}
        >
          Volver a comprobar acceso
        </button>
      ) : (
        <>
          <div className="plant-layout">
            <nav aria-label="Apartados">
              {sectionsVisible.map((k) => (
                <button
                  key={k}
                  aria-current={current === k ? "page" : undefined}
                  onClick={() => {
                    setKind(k);
                    setEditor(null);
                    setSearch("");
                    setError("");
                    setNotice("");
                  }}
                >
                  {label(k)}
                </button>
              ))}
            </nav>
            <article>
              <div className="plant-heading">
                <h2>{label(current) || "Sin permisos asignados"}</h2>
                <div>
                  <button
                    aria-label="Actualizar"
                    onClick={() => void refresh()}
                  >
                    <RefreshCw size={16} />
                  </button>
                  {canCreate && !editor && (
                    <button
                      className="button button-primary"
                      onClick={() => edit({ action: "crear" })}
                    >
                      <Plus size={16} /> Nuevo registro
                    </button>
                  )}
                </div>
              </div>
              {editor && (
                <EditPanel
                  key={
                    editor.action + (editor.row?.id ?? editor.member?.id ?? "")
                  }
                  kind={current}
                  edit={editor}
                  snapshot={snapshot}
                  busy={busy}
                  save={save}
                  cancel={() => setEditor(null)}
                />
              )}
              {current === "personas" && (
                <a className="plant-link" href="/#equipo">
                  Administrar altas, contraseñas y estado de las cuentas en
                  Equipo
                </a>
              )}
              {current === "panel" && <PlantFinance />}
              {current === "informes" && <PlantReport />}
              {(current === "servicio" ||
                (current === "caso" && control && has("control.aprobar"))) && (
                <PlantSuppliers
                  write={!control && has("planta.registrar")}
                  approve={
                    control && ["GERENTE", "CREADOR"].includes(snapshot.perfil)
                  }
                  actor={snapshot.persona}
                  revision={snapshot.corte}
                />
              )}
              {["ficha", "entrega", "carreta", "conteo"].includes(current) && (
                <a className="plant-link" href="/inventario-central/">
                  Verificar códigos y existencias en Inventario central
                </a>
              )}
              {current === "revision" ? (
                <DocumentReview key={snapshot.persona} revision={snapshot.corte} />
              ) : current === "personas" ? (
                <>
                  {snapshot.personas.map((m) => (
                    <div className="plant-row" key={m.id}>
                      <div>
                        <strong>{m.nombre}</strong>
                        <small>
                          {m.perfil ?? "Sin perfil asignado"} ·{" "}
                          {m.activo ? "Activo" : "Inactivo"}
                        </small>
                      </div>
                      {m.perfil !== "CREADOR" &&
                        (snapshot.perfil === "CREADOR" ||
                          (m.id !== snapshot.persona &&
                            m.perfil &&
                            has("control.administrar_permisos") &&
                            !m.permisos?.includes(
                              "control.administrar_permisos",
                            ) &&
                            m.permisos?.every((p) => has(p)))) && (
                          <button
                            onClick={() =>
                              edit({ action: "acceso", member: m })
                            }
                          >
                            Funciones y roles
                          </button>
                        )}
                    </div>
                  ))}
                </>
              ) : current === "panel" ? (
                <>
                  <p>
                    Fuente: registros institucionales de Producción · Corte{" "}
                    {new Date(snapshot.corte).toLocaleString("es-CO", {
                      timeZone: "America/Bogota",
                    })}
                  </p>
                  <div className="plant-metrics">
                    {Object.entries(snapshot.panel ?? {}).map(([name, n]) => (
                      <div key={name}>
                        <small>{name}</small>
                        <strong>{n}</strong>
                      </div>
                    ))}
                  </div>
                </>
              ) : current === "auditoria" ? (
                <>
                  {snapshot.auditoria.length === 0 && (
                    <p>Aún no hay eventos registrados.</p>
                  )}
                  {snapshot.auditoria.map((ev) => (
                    <div className="plant-row" key={ev.seq}>
                      <div>
                        <strong>
                          {actionNames[ev.action] ?? ev.action} · {ev.actor}
                        </strong>
                        <small>
                          {ev.reason} ·{" "}
                          {new Date(ev.at_time).toLocaleString("es-CO")} ·{" "}
                          {ev.target}
                        </small>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                current &&
                current !== "informes" && (
                  <>
                    <label className="plant-search">
                      <Search size={16} />
                      <input
                        aria-label="Buscar registros"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar por referencia, nombre o estado"
                      />
                    </label>
                    {current === "caso" && (
                      <div className="plant-fields">
                        {Object.entries({
                          origen: "Módulo",
                          estado: "Estado",
                          importancia: "Importancia",
                          fecha: "Fecha",
                          responsable: "Responsable",
                          areaResponsable: "Área",
                        }).map(([key, name]) => (
                          <label key={key}>
                            {name}
                            <select
                              value={filters[key] ?? ""}
                              onChange={(e) =>
                                setFilters({
                                  ...filters,
                                  [key]: e.target.value,
                                })
                              }
                            >
                              <option value="">Todos</option>
                              {Array.from(
                                new Set(
                                  snapshot.registros
                                    .filter((r) => r.kind === "caso")
                                    .map((r) => incidentField(r, key))
                                    .filter(Boolean),
                                ),
                              )
                                .sort()
                                .map((v) => (
                                  <option key={v}>{v}</option>
                                ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    )}
                    {rows.length === 0 && (
                      <p className="plant-empty">
                        {search
                          ? "Sin coincidencias."
                          : "Aún no hay registros en este apartado."}
                      </p>
                    )}
                    {rows.map((r) => (
                      <details key={r.id} className="plant-item">
                        <summary>
                          <span>
                            <strong>{r.title}</strong>
                            <small>
                              {ref(r)} · v{r.version}
                            </small>
                          </span>
                          <span className="plant-state">{r.state}</span>
                        </summary>
                        {r.parent && (
                          <p>
                            Origen:{" "}
                            {snapshot.registros.find((s) => s.id === r.parent)
                              ?.title ?? r.parent}
                          </p>
                        )}
                        {r.kind === "ot" &&
                          materialsOf(r).some(
                            (m) => Number(m.faltante) > 0,
                          ) && (
                            <p className="plant-error">
                              Material pendiente de abastecer ·{" "}
                              {materialsOf(r)
                                .filter((m) => Number(m.faltante) > 0)
                                .map(
                                  (m) =>
                                    m.codigo +
                                    " · " +
                                    m.faltante +
                                    " " +
                                    m.unidad +
                                    " en " +
                                    m.bodega,
                                )
                                .join(", ")}
                            </p>
                          )}
                        {renderDetails(r.data)}
                        {r.kind === "costo" && <CostSimulation row={r} />}
                        {r.kind === "proyecto" && r.data.ejecutado != null && (
                          <p>
                            Saldo frente al presupuesto:{" "}
                            {Number(
                              Number(r.data.presupuesto) -
                                Number(r.data.ejecutado),
                            ).toLocaleString("es-CO")}{" "}
                            COP
                          </p>
                        )}
                        {r.kind === "carreta" && (
                          <p>
                            {(() => {
                              const cuts = snapshot.registros.filter(
                                (c) => c.kind === "corte" && c.parent === r.id,
                              );
                              const sent = cuts.reduce(
                                (n, c) => n + Number(c.data.despachado ?? 0),
                                0,
                              );
                              const reserved = cuts
                                .filter((c) => c.state !== "aceptado")
                                .reduce((n, c) => n + Number(c.data.metros), 0);
                              return (
                                "Físico: " +
                                (Number(r.data.metros) - sent).toLocaleString(
                                  "es-CO",
                                ) +
                                " m · Reservado: " +
                                reserved.toLocaleString("es-CO") +
                                " m · Disponible: " +
                                (
                                  Number(r.data.metros) -
                                  sent -
                                  reserved
                                ).toLocaleString("es-CO") +
                                " m"
                              );
                            })()}
                          </p>
                        )}
                        <button
                          onClick={() =>
                            void run(async () => {
                              if (!client) return;
                              const result = await client.rpc("plant_history", {
                                area,
                                item: r.id,
                              });
                              if (result.error)
                                throw new Error(result.error.message);
                              setHistory({ id: r.id, rows: result.data });
                            })
                          }
                        >
                          Ver historial
                        </button>
                        {history?.id === r.id &&
                          history.rows.map((h, i) => (
                            <details key={i}>
                              <summary>
                                {String(h.fecha).slice(0, 10)} ·{" "}
                                {textValue(h.acción)} ·{" "}
                                {textValue(h.responsable)}
                              </summary>
                              {renderDetails(h)}
                            </details>
                          ))}
                        <div className="plant-actions">
                          {actions(r).map((a) => (
                            <button
                              key={a}
                              onClick={() => edit({ action: a, row: r })}
                            >
                              {actionNames[a]}
                            </button>
                          ))}
                          {r.kind === "expediente" &&
                            has("archivo.descargar") &&
                            Array.from({ length: r.version }, (_, i) => (
                              <button
                                key={i}
                                onClick={() => void download(r, i + 1)}
                              >
                                Descargar PDF v{i + 1}
                              </button>
                            ))}
                        </div>
                      </details>
                    ))}
                  </>
                )
              )}
            </article>
          </div>
        </>
      )}
    </main>
  );
}

function CostSimulation({ row }: { row: Row }) {
  const [sale, setSale] = useState("");
  const [discount, setDiscount] = useState("0");
  const cost = Number(row.data.real),
    net = Number(sale) * (1 - Number(discount) / 100),
    profit = net - cost;
  const money = (n: number) =>
    n.toLocaleString("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 2,
    });
  return (
    <fieldset className="plant-editor">
      <legend>Simulación por la unidad de análisis</legend>
      <div className="plant-fields">
        <label>
          Precio de lista (COP)
          <input
            type="number"
            min="0"
            value={sale}
            onChange={(e) => setSale(e.target.value)}
          />
        </label>
        <label>
          Descuento (%)
          <input
            type="number"
            min="0"
            max="100"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </label>
      </div>
      {sale &&
        Number(sale) >= 0 &&
        Number(discount) >= 0 &&
        Number(discount) <= 100 && (
          <p>
            Precio neto {money(net)} · Utilidad {money(profit)} · Margen sobre
            venta {net ? ((100 * profit) / net).toFixed(2) + " %" : "Sin base"}{" "}
            · Rentabilidad sobre costo{" "}
            {cost ? ((100 * profit) / cost).toFixed(2) + " %" : "Sin base"}
          </p>
        )}
    </fieldset>
  );
}
