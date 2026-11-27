'use client';

import { useContext, useCallback, useEffect, useState } from 'react';
import { PublicWorkspace } from "@/lib/jornada-permissions";
import { Archive, ChevronLeft, ChevronRight, LockKeyhole, PackageSearch, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { getSupabaseClient, publicSupabaseConfiguration } from '@/lib/supabase/client';
import styles from './alegra-view.module.css';

type Kind='contacts'|'products'|'invoices';
type Batch={id:string;source:string;contacts:number;products:number;invoices:number;invoice_date_min:string;invoice_date_max:string;completed_at:string};
type Summary={ready:boolean;kind:'summary';batch?:Batch};
type PageResult={ready:boolean;kind:Kind;page:number;page_size:number;total:number;items:Record<string,unknown>[]};

const labels:Record<Kind,string>={contacts:'Clientes y contactos',products:'Productos',invoices:'Facturas'};
const money=new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
const date=new Intl.DateTimeFormat('es-CO',{dateStyle:'medium',timeZone:'UTC'});

function formatDate(value:unknown){return typeof value==='string'&&value?date.format(new Date(`${value}T12:00:00Z`)):'—';}
function formatMoney(value:unknown){const numeric=typeof value==='string'?Number(value):NaN;return Number.isFinite(numeric)?money.format(numeric):'—';}
function text(value:unknown){return typeof value==='string'&&value.trim()?value:'—';}

async function snapshot<T>(kind:'summary'|Kind,search='',page=1):Promise<T>{
  const client=getSupabaseClient();
  if(!client)throw new Error('La conexión institucional no está disponible.');
  const {data,error}=await client.rpc('alegra_snapshot',{p_kind:kind,p_search:search,p_page:page,p_page_size:50});
  if(error)throw new Error(error.message);
  return data as T;
}

export function AlegraView(){
  const guest=useContext(PublicWorkspace);
  const configured=publicSupabaseConfiguration().configured;
  const [summary,setSummary]=useState<Summary|null>(null);
  const [kind,setKind]=useState<Kind>('invoices');
  const [result,setResult]=useState<PageResult|null>(null);
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(1);
  const [screen,setScreen]=useState<'loading'|'signin'|'ready'|'blocked'>('loading');
  const [error,setError]=useState('');

  const loadSummary=useCallback(async()=>{
    const client=getSupabaseClient();
    if(!client){setScreen('signin');return;}
    const {data:{session}}=await client.auth.getSession();
    if(!session){setScreen('signin');return;}
    setScreen('loading');setError('');
    try{const next=await snapshot<Summary>('summary');setSummary(next);setScreen('ready');}
    catch(reason){setError(reason instanceof Error?reason.message:'No se pudo abrir el histórico de Alegra.');setScreen('blocked');}
  },[]);

  useEffect(()=>{if(guest)return;void loadSummary();const client=getSupabaseClient();if(!client)return;let timer:ReturnType<typeof setTimeout>|undefined;const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>{if(session)void loadSummary();else{setSummary(null);setResult(null);setScreen('signin');}},0);});return()=>{subscription.unsubscribe();if(timer)clearTimeout(timer);};},[loadSummary,guest]);
  useEffect(()=>{if(guest||screen!=='ready'||!summary?.ready)return;let active=true;const timer=setTimeout(()=>{setError('');void snapshot<PageResult>(kind,query,page).then(data=>{if(active)setResult(data);}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'No se pudo consultar Alegra.');});},250);return()=>{active=false;clearTimeout(timer);};},[guest,kind,page,query,screen,summary?.ready]);
  const pages=Math.max(1,Math.ceil((result?.total??0)/50));

  if(!guest&&!configured)return <AccessState title="Conexión institucional pendiente" text="Supabase debe estar configurado para proteger la información importada de Alegra."/>;
  if(!guest&&screen==='loading')return <div className={styles.loading}><RefreshCw className={styles.spin} size={18}/>Cargando el histórico de Alegra…</div>;
  if(!guest&&screen==='signin')return <AccessState title="Inicia sesión para consultar Alegra" text="Este histórico contiene datos comerciales y solo se muestra según las funciones y permisos asignados en Equipo." action={<a className="button button-primary" href="/acceso/"><LockKeyhole size={16}/>Iniciar sesión</a>}/>;
  if(!guest&&screen==='blocked')return <AccessState title="Acceso restringido" text={error||'Tu rol no tiene permiso para consultar Alegra.'} action={<a className="button button-secondary" href="/equipo/"><ShieldCheck size={16}/>Revisar funciones y permisos</a>}/>;
  if(!guest&&!summary?.ready)return <AccessState title="Importación preparada" text="La estructura segura está lista, pero todavía no existe un lote reconciliado de Alegra."/>;
  const batch=guest?{contacts:0,products:0,invoices:0,invoice_date_min:"",invoice_date_max:""}:summary!.batch!;

  return <div className={styles.shell}>
    <div className={styles.notice}><Archive size={20}/><div><strong>{guest?"Histórico de Alegra · vista pública":"Histórico importado · solo lectura"}</strong><p>Estos clientes, productos y facturas conservan lo registrado en Alegra. No crean movimientos en Caja, asientos contables ni cambios de inventario.</p></div></div>
    <section className={styles.stats} aria-label="Resumen de la importación">
      <Stat label="Clientes y contactos" value={batch.contacts}/><Stat label="Productos" value={batch.products}/><Stat label="Facturas" value={batch.invoices} detail={`${formatDate(batch.invoice_date_min)} – ${formatDate(batch.invoice_date_max)}`}/>
    </section>
    <div className={styles.toolbar}><nav className={styles.tabs} aria-label="Datos importados">{(Object.keys(labels) as Kind[]).map(id=><button key={id} aria-current={kind===id?'page':undefined} onClick={()=>{setKind(id);setPage(1);setQuery('');}}>{labels[id]}</button>)}</nav><label className={styles.search}><Search size={16}/><input value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}} placeholder={`Buscar en ${labels[kind].toLowerCase()}…`} aria-label={`Buscar en ${labels[kind]}`}/></label></div>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    <section className={styles.panel}><header className={styles.panelHeader}><h2>{labels[kind]}</h2><span>{result?.total??0} registros</span></header>{guest||result?<DataTable kind={kind} rows={guest?[]:result!.items}/>:<div className={styles.loading}><RefreshCw className={styles.spin} size={17}/>Consultando…</div>}<footer className={styles.pager}><span>Página {page} de {pages}</span><button aria-label="Página anterior" disabled={page<=1} onClick={()=>setPage(value=>value-1)}><ChevronLeft size={16}/></button><button aria-label="Página siguiente" disabled={page>=pages} onClick={()=>setPage(value=>value+1)}><ChevronRight size={16}/></button></footer></section>
  </div>;
}

function Stat({label,value,detail}:{label:string;value:number;detail?:string}){return <article className={styles.stat}><span>{label}</span><strong>{new Intl.NumberFormat('es-CO').format(value)}</strong>{detail&&<small>{detail}</small>}</article>;}
function AccessState({title,text:description,action}:{title:string;text:string;action?:React.ReactNode}){return <section className={styles.login}><PackageSearch size={28}/><h2>{title}</h2><p>{description}</p>{action}</section>;}

function DataTable({kind,rows}:{kind:Kind;rows:Record<string,unknown>[]}){
  if(!rows.length)return <div className={styles.empty}><PackageSearch size={30}/><h2>Sin resultados</h2><p>No encontramos registros con esa búsqueda.</p></div>;
  if(kind==='contacts')return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Nombre</th><th>Identificación</th><th>Ubicación</th><th>Contacto</th><th>Estado</th></tr></thead><tbody>{rows.map(row=><tr key={String(row.id)}><td><strong>{text(row.full_name)}</strong><br/><span className={styles.muted}>{text(row.person_type)}</span></td><td>{text(row.identification)}<br/><span className={styles.muted}>{text(row.identification_type)}</span></td><td>{text(row.municipality)}<br/><span className={styles.muted}>{text(row.department)}</span></td><td>{text(row.mobile)}<br/><span className={styles.muted}>{text(row.email)}</span></td><td><span className={styles.status}>{text(row.status)}</span></td></tr>)}</tbody></table></div>;
  if(kind==='products')return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Código</th><th>Producto</th><th>Categoría</th><th>Unidad</th><th>Costo histórico</th></tr></thead><tbody>{rows.map(row=><tr key={String(row.id)}><td><strong>{text(row.source_code)}</strong></td><td>{text(row.name)}<br/><span className={styles.muted}>{text(row.reference)}</span></td><td>{text(row.category)}</td><td>{text(row.unit)}</td><td>{formatMoney(row.unit_cost)}</td></tr>)}</tbody></table></div>;
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Factura</th><th>Cliente</th><th>Emisión</th><th>Vencimiento</th><th>Total</th><th>Saldo</th><th>Estado</th></tr></thead><tbody>{rows.map(row=><tr key={String(row.id)}><td><strong>{text(row.number)}</strong></td><td>{text(row.customer)}</td><td>{formatDate(row.issued_on)}</td><td>{formatDate(row.due_on)}</td><td>{formatMoney(row.total)}</td><td>{formatMoney(row.balance)}</td><td><span className={`${styles.status} ${row.status==='Cobrada'?styles.statusPaid:row.status==='Por cobrar'?styles.statusOpen:''}`}>{text(row.status)}</span></td></tr>)}</tbody></table></div>;
}
