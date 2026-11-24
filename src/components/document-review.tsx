"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";

type ImportedFile = { id: string; name: string; source: string; description: string; size: number };
type Decision = "aprobado" | "requiere ajustes";
type Batch = { id: string; path: string; imported: string; reviewed: string | null; status: "pendiente" | Decision; note: string; files: ImportedFile[] };

const statuses = { pendiente: "Pendiente de tu revisión", aprobado: "Aprobado", "requiere ajustes": "Requiere ajustes" };
const date = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { dateStyle: "long", timeZone: "America/Bogota" });

function FolderReview({ batch, reload }: { batch: Batch; reload: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download(file: ImportedFile) {
    const client = getSupabaseClient();
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.rpc("imported_document", { item: file.id });
      if (result.error) throw new Error(result.error.message);
      const bytes = Uint8Array.from(atob(result.data), ch => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo descargar el archivo.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: Decision) {
    const client = getSupabaseClient();
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.rpc("review_document_folder", { item: batch.id, decision, note });
      if (result.error) throw new Error(result.error.message);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la decisión.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="plant-editor">
    <h3>{batch.path.split("/").at(-1)}</h3>
    <p>{batch.path}</p>
    <p><strong>{statuses[batch.status]}</strong> · {batch.files.length} archivos · Importado el {date(batch.imported)}</p>
    {batch.files.map(file => <div key={file.id} className="plant-item">
      <strong>{file.name}</strong>
      <p>{file.description}</p>
      <div className="plant-actions">
        <button type="button" disabled={busy} onClick={() => void download(file)}>Descargar copia</button>
        <a href={file.source} target="_blank" rel="noreferrer">Ver en SharePoint</a>
      </div>
    </div>)}
    {error && <p role="alert" className="plant-error">{error}</p>}
    {batch.status === "pendiente" ? <>
      <label>Observaciones de revisión
        <textarea rows={2} maxLength={1500} value={note} onChange={e => setNote(e.target.value)} />
      </label>
      <div className="plant-actions">
        <button type="button" disabled={busy} onClick={() => void decide("aprobado")}>Aprobar apartado</button>
        <button type="button" disabled={busy || !note.trim()} onClick={() => void decide("requiere ajustes")}>Solicitar ajustes</button>
      </div>
    </> : <p>{batch.reviewed && "Revisado el " + date(batch.reviewed)}{batch.note && " · " + batch.note}</p>}
  </section>;
}

export function DocumentReview({ revision }: { revision: string }) {
  const [generation, setGeneration] = useState(0);
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const client = getSupabaseClient();
    if (!client) return;
    setError("");
    void (async () => {
      try {
        const result = await client.rpc("document_reviews");
        if (result.error) throw new Error(result.error.message);
        if (active) setBatches(result.data);
      } catch (err) {
        if (active) { setBatches(null); setError(err instanceof Error ? err.message : "No se pudo consultar la importación."); }
      }
    })();
    return () => { active = false; };
  }, [generation, revision]);
  if (error) return <p role="alert" className="plant-error">{error}</p>;
  if (!batches) return <p role="status">Cargando carpetas…</p>;
  if (!batches.length) return <p>Aún no hay carpetas importadas.</p>;
  return <>{batches.map(batch => <FolderReview key={batch.id} batch={batch} reload={() => setGeneration(n => n + 1)} />)}</>;
}
