"use client";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";

type Entry = { id: string; folder: string; name: string; area: string; period: string; bytes: number; source: string; archive: string | null; copy: string | null; state: string; note: string };
type Result = { total: number; areas: string[]; counts: Record<string, number>; files: Entry[] };
const labels: Record<string,string> = { incorporado: "Con copia en el archivo", vinculado: "Original en SharePoint", pendiente: "Pendiente de clasificación" };

export function CompanyArchive({ revision }: { revision: string }) {
  const [query,setQuery] = useState("");
  const [area,setArea] = useState("");
  const [stage,setStage] = useState("");
  const [offset,setOffset] = useState(0);
  const [result,setResult] = useState<Result | null>(null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    const timer = setTimeout(async () => {
      try {
        const client = getSupabaseClient();
        if (!client) throw new Error("La conexión institucional no está disponible.");
        const response = await client.rpc("archive_search",{term:query.trim(),section:area,stage,position_from:offset});
        if (response.error) throw new Error(response.error.message);
        if (active) setResult(response.data);
      } catch (err) {
        if (active) { setResult(null); setError(err instanceof Error ? err.message : "No se pudo consultar el archivo."); }
      } finally { if (active) setLoading(false); }
    },180);
    return () => { active=false; clearTimeout(timer); };
  },[query,area,stage,offset,revision]);

  async function getCopy(file: Entry) {
    try {
      const client=getSupabaseClient();
      if (!client || !file.copy) return;
      const response=await client.rpc("imported_document",{item:file.copy});
      if (response.error) throw new Error(response.error.message);
      const bytes=Uint8Array.from(atob(response.data),ch=>ch.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes]));
      const link=document.createElement("a"); link.href=url; link.download=file.name; link.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),5000);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo descargar la copia."); }
  }

  return <section className="plant-editor">
    {result && <div className="plant-metrics">{Object.entries(labels).map(([key,name])=><div key={key}><small>{name}</small><strong>{(result.counts[key]??0).toLocaleString("es-CO")}</strong></div>)}</div>}
    <div className="plant-fields">
      <label>Buscar por archivo, carpeta o año<input type="search" value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}} /></label>
      <label>Área<select value={area} onChange={e=>{setArea(e.target.value);setOffset(0);}}><option value="">Todas</option>{result?.areas.map(a=><option key={a}>{a}</option>)}</select></label>
      <label>Ubicación y estado<select value={stage} onChange={e=>{setStage(e.target.value);setOffset(0);}}><option value="">Todos</option>{Object.entries(labels).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
    </div>
    {error && <p className="plant-error" role="alert">{error}</p>}
    {loading ? <p role="status">Consultando el archivo…</p> : result && <>
      <p>{result.total ? `Archivos ${offset+1} a ${Math.min(offset+40,result.total)} de ${result.total.toLocaleString("es-CO")}` : "Sin coincidencias."}</p>
      {result.files.map(f=><details className="plant-item" key={f.id}><summary><span><strong>{f.name}</strong><small>{f.area}{f.period && " · "+f.period}</small></span><span>{labels[f.state]}</span></summary>
        <p>{f.folder}</p>{f.note && <p>{f.note}</p>}
        <div className="plant-actions">
          {f.copy && <button onClick={()=>void getCopy(f)}>Descargar copia</button>}
          {f.archive && <a href={f.archive} target="_blank" rel="noreferrer">Abrir copia institucional</a>}
          <a href={f.source} target="_blank" rel="noreferrer">Ver origen en SharePoint</a>
        </div>
      </details>)}
      <div className="plant-actions"><button disabled={offset===0} onClick={()=>setOffset(n=>Math.max(0,n-40))}>Anterior</button><button disabled={offset+40>=result.total} onClick={()=>setOffset(n=>n+40)}>Siguiente</button></div>
    </>}
  </section>;
}
