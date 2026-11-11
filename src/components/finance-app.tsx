'use client';
import { getDebtCalendar, getRecurringBillBalance, getDebtModuleState } from '@/lib/debts/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Package, LayoutDashboard, ArrowRightLeft, Wallet, Landmark, CheckCheck, ShieldCheck, Bell, Activity, Settings, Search, ChevronDown, ChevronRight, Plus, Download, ArrowUpRight, ArrowDownLeft, ArrowRight, Building2, Menu, X, HardDrive, Check, LockKeyhole, Users, ShoppingCart, Code2 } from 'lucide-react';
import { createEmptyState, formatCOP, getAccountBalance, getDebtBalance, deriveAlerts, toCents, fromCents, add } from '@/lib/finance';
import type { State, Actor, Transaction } from '@/lib/finance';
import { LOCAL_STORAGE_KEY, LOCAL_WRITER_LOCK, initializeLocalStateStorage, decodeDemoState, inspectDemoState, holdDemoWriterLease } from '@/lib/demo-state';
import { Badge, Empty, MutationFeedbackContext } from './ui';
import { Brand, MobileBrand } from './brand';
import { TransactionDetail, TransactionsView } from './transaction-view';
import { ReconciliationsView, ApprovalsView, AlertsView, AuditView, SettingsView } from './operations-view';
import { DebtsModule } from './debts-module';
import { DebtsInventoryIntegrations } from './debts-inventory-integrations';
import { DebtReportsView } from './debts-reports-view';
import { InventoryView } from './inventory-view';
import { InventoryCashLinks, InventorySupplierOffsets } from './inventory-integrations-view';
import { InventoryReportsView } from './inventory-reports-view';
import { CashModule, type CashModuleTab } from './cash-module';
import { SalesModule } from './sales-module';
import { type View, type Mutation, type ViewProps, visibleAccounts, periodTotals, cashSeries, obligations, kindLabels, roleLabels, dateLabel, canWrite, WORKSPACE_DATE as DEMO_DATE } from './view-helpers';

const STORAGE_KEY=LOCAL_STORAGE_KEY;
const reportPeriods=Array.from({length:3},(_,offset)=>{
  const date=new Date(Date.UTC(Number(DEMO_DATE.slice(0,4)),Number(DEMO_DATE.slice(5,7))-1-offset,1));
  return {value:date.toISOString().slice(0,7),label:new Intl.DateTimeFormat('es-CO',{month:'long',year:'numeric',timeZone:'UTC'}).format(date)};
});
const navItems = [
  {id:'overview',label:'Resumen general',icon:LayoutDashboard},
  {id:'transactions',label:'Movimientos',icon:ArrowRightLeft},
  {id:'accounts',label:'Caja y cuentas',icon:Wallet},
  {id:'inventory',label:'Inventarios',icon:Package},
  {id:'sales',label:'Ventas',icon:ShoppingCart},
  {id:'debts',label:'Deudas',icon:Landmark},
  {id:'reconciliations',label:'Conciliaciones',icon:CheckCheck},
  {id:'approvals',label:'Aprobaciones',icon:ShieldCheck},
  {id:'alerts',label:'Centro de alertas',icon:Bell},
  {id:'audit',label:'Auditoría',icon:Activity},
  {id:'settings',label:'Configuración',icon:Settings},
] as const;
const titles:Record<View,{title:string;subtitle:string}> = {
  sales:{title:'Cada venta, con su historia.',subtitle:'Clientes, cotizaciones, pedidos, facturación y cartera sin duplicar Caja ni Inventarios.'},
  inventory:{title:'Cada existencia, con su historia.',subtitle:'Cinco inventarios, dos bodegas y una trazabilidad compartida con Caja.'},
  overview:{title:'Tu operación, en perspectiva.',subtitle:'Cada cuenta, cada movimiento. El control empieza aquí.'},
  transactions:{title:'Cada movimiento cuenta.',subtitle:'Registra, consulta y da trazabilidad al dinero de la empresa.'},
  accounts:{title:'Tu dinero, en un solo lugar.',subtitle:'Saldos calculados desde el libro de tesorería.'},
  debts:{title:'Obligaciones bajo control.',subtitle:'Entidades, inversionistas, proveedores y pagos recurrentes con una historia clara.'},
  reconciliations:{title:'Las cuentas claras.',subtitle:'Contrasta el libro con los saldos de tus extractos.'},
  approvals:{title:'Decisiones con respaldo.',subtitle:'Un segundo par de ojos para cada operación sensible.'},
  alerts:{title:'Lo importante, a tiempo.',subtitle:'Detecta diferencias y resuelve pendientes con evidencia.'},
  audit:{title:'Una historia verificable.',subtitle:'Quién hizo qué, cuándo y por qué.'},
  settings:{title:'Una base para crecer.',subtitle:'Empresa, equipo, seguridad y continuidad de la operación.'},
};

export function FinanceApp() {
  const [state,setState]=useState<State|null>(null);
  const current=useRef<State|null>(null);
  const [actorId,setActorId]=useState('');
  const [view,setView]=useState<View>('overview');
  const [cashTab,setCashTab]=useState<CashModuleTab>('operations');
  const [location,setLocation]=useState('all');
  const [period,setPeriod]=useState(DEMO_DATE.slice(0,7));
  const [search,setSearch]=useState('');
  const [toast,setToast]=useState('');
  const [error,setError]=useState('');
  const [actionError,setActionError]=useState('');
  const clearActionError=useCallback(()=>setActionError(''),[]);
  const [profileOpen,setProfileOpen]=useState(false);
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const [detail,setDetail]=useState<Transaction|null>(null);
  const searchRef=useRef<HTMLInputElement>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const canPersist=useRef(false);
  const hasWriterLock=useRef(false);
  const lastSnapshot=useRef<string|null>(null);
  const readOnlyReason=useRef('Esperando el control de escritura del espacio local.');
  const notify=useCallback((message:string)=>{setToast(message);if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(''),5500);},[]);
  useEffect(()=>{
    const navigate=()=>{const [section,tab]=window.location.hash.slice(1).split('/');if(section==='caja'){setView('accounts');if(['operations','accounts','statements','reports'].includes(tab))setCashTab(tab as CashModuleTab);}else if(section==='inventarios'){setView('inventory');}else if(section==='ventas'){setView('sales');}else if(section==='deudas'){setView('debts');}else if(navItems.some(item=>item.id===section)){setView(section as View);}};
    navigate();window.addEventListener('hashchange',navigate);return()=>window.removeEventListener('hashchange',navigate);
  },[]);
  useEffect(()=>{
    let disposed=false;
    const show=(snapshot:State,resetActor=false)=>{
      current.current=snapshot;setState(snapshot);
      if(resetActor)setActorId(snapshot.members.find(member=>member.role==='owner'&&member.active)?.id??snapshot.members.find(member=>member.active)?.id??'');
    };
    const stopWriting=(message:string)=>{hasWriterLock.current=false;canPersist.current=false;readOnlyReason.current=message;setError(message);};
    const readSnapshot=(initialize=false):State=>{
      let snapshot=createEmptyState();canPersist.current=true;
      try{
        if(initialize){
          snapshot=initializeLocalStateStorage(localStorage);
          lastSnapshot.current=localStorage.getItem(STORAGE_KEY);
          return snapshot;
        }
        const raw=localStorage.getItem(STORAGE_KEY);lastSnapshot.current=raw;
        if(raw!==null){
          const checked=decodeDemoState(raw);
          if(checked.ok&&checked.state.organization.id==='local-trefil-electric')snapshot=checked.state;
          else stopWriting((checked.ok?'La copia no pertenece al espacio local.':checked.error)+' La copia original se conservó. Se muestra una vista vacía de solo lectura; revisa la copia antes de registrar operaciones.');
        }
      }catch{stopWriting('No se pudo leer, validar o guardar el espacio local. Esta vista es de solo lectura y conserva la copia anterior. Revisa el almacenamiento antes de registrar operaciones.');}
      return snapshot;
    };
    show(readSnapshot(),true);
    let lockManager:typeof navigator.locks|undefined;
    try{lockManager=navigator.locks;}catch{/* A restricted browser remains read-only. */}
    const lease=holdDemoWriterLease(lockManager,{
      onWriter:()=>{
        if(disposed)return;
        // Re-read only after acquiring the lock, never from a stale boot snapshot.
        const fresh=readSnapshot(true);
        if(!canPersist.current){show(fresh,true);return;}
        // Opening a local page is not an authenticated sign-in or a financial event.
        hasWriterLock.current=true;readOnlyReason.current='';setError('');show(fresh,true);
      },
      onReadOnly:reason=>{
        if(disposed)return;
        hasWriterLock.current=false;
        const message=reason==='busy'?'Otra pestaña controla la escritura. Esta pestaña es de solo lectura y recibe sus cambios. Cierra la pestaña que registra operaciones y recarga esta para tomar el control.':reason==='unsupported'?'Este navegador no ofrece el bloqueo de pestañas requerido. El espacio local es de solo lectura; abre la aplicación en un navegador compatible mediante HTTPS o localhost.':'No se pudo obtener el control de escritura. Esta vista es de solo lectura; cierra otras pestañas y recarga en un navegador compatible.';
        const detail=!canPersist.current&&readOnlyReason.current?readOnlyReason.current+' '+message:message;
        readOnlyReason.current=detail;setError(detail);
      },
    },LOCAL_WRITER_LOCK);
    const onKey=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key==='k'){event.preventDefault();searchRef.current?.focus();}};
    const onStorage=(event:StorageEvent)=>{
      try{if(event.storageArea!==localStorage)return;}catch{stopWriting('El almacenamiento dejó de estar disponible. Esta vista permanece en solo lectura; revisa la configuración del navegador y recarga.');return;}
      if(event.key!==STORAGE_KEY&&event.key!==null)return;
      if(hasWriterLock.current)stopWriting('La copia cambió fuera de la pestaña autorizada. Se detuvieron las escrituras para evitar sobrescribir operaciones. Conserva la copia y recarga después de cerrar otras versiones de la aplicación.');
      if(event.newValue===null){setError('El almacenamiento local cambió o fue eliminado fuera de esta pestaña. Se conserva la vista anterior en solo lectura; revisa la copia antes de recargar.');canPersist.current=false;return;}
      const checked=decodeDemoState(event.newValue);
      if(checked.ok&&checked.state.organization.id==='local-trefil-electric'){lastSnapshot.current=event.newValue;show(checked.state);notify('Datos locales actualizados desde la pestaña que controla la escritura.');}
      else{canPersist.current=false;setError((checked.ok?'La copia no pertenece al espacio local.':checked.error)+' Se conservó la última vista válida y no se sobrescribió la copia. Revisa la copia antes de registrar operaciones.');}
    };
    window.addEventListener('keydown',onKey);window.addEventListener('storage',onStorage);
    return()=>{disposed=true;hasWriterLock.current=false;lease.release();window.removeEventListener('keydown',onKey);window.removeEventListener('storage',onStorage);if(timer.current)clearTimeout(timer.current);};
  },[notify]);
  const mutate:Mutation=(operation,message)=>{
    setActionError('');
    const fail=(message:string)=>{setActionError(message);notify(message);return false;};
    if(!current.current)return fail('El espacio local todavía no está listo.');
    if(!hasWriterLock.current||!canPersist.current)return fail(readOnlyReason.current||'El espacio local está en solo lectura. Cierra otras pestañas y recarga para volver a registrar.');
    try{
      if(localStorage.getItem(STORAGE_KEY)!==lastSnapshot.current){
        hasWriterLock.current=false;canPersist.current=false;
        readOnlyReason.current='La copia guardada cambió fuera de esta pestaña. Se bloqueó el registro para conservar todas las operaciones; cierra otras versiones y recarga después de revisar la copia.';
        setError(readOnlyReason.current);return fail(readOnlyReason.current);
      }
      const next=operation(current.current);
      const checked=inspectDemoState(next);
      if(!checked.ok)return fail(checked.error+' La operación no se guardó y la copia anterior permanece intacta.');
      const serialized=JSON.stringify(next);
      try{localStorage.setItem(STORAGE_KEY,serialized);}catch{
        canPersist.current=false;hasWriterLock.current=false;readOnlyReason.current='No se pudo guardar la operación. La copia anterior permanece intacta. Exporta la vista disponible y revisa el almacenamiento antes de volver a registrar.';
        setError(readOnlyReason.current);return fail(readOnlyReason.current);
      }
      lastSnapshot.current=serialized;current.current=next;setState(next);notify(message);return true;
    }catch(e){return fail(e instanceof Error?e.message:'No se pudo completar la operación.');}
  };
  if(!state)return <div className="boot-screen"><Brand/><span className="loading-line"/><p>Preparando tu centro de operaciones…</p></div>;
  const actor:Actor=state.members.find(m=>m.id===actorId&&m.active)??state.members.find(m=>m.active)??{id:'readonly',name:'Sin acceso',role:'auditor'};
  const alerts=deriveAlerts(state,DEMO_DATE);
  const openAlerts=alerts.filter(a=>a.status!=='resolved');
  const pending=state.transactions.filter(t=>t.status==='pending');
  const counts:Partial<Record<View,number>>={approvals:pending.length,alerts:openAlerts.length};
  const go=(id:View)=>{setView(id);setSearch('');setSidebarOpen(false);window.history.replaceState(null,'',id==='accounts'?'#caja/'+cashTab:id==='inventory'?'#inventarios':id==='sales'?'#ventas':id==='debts'?'#deudas':'#'+id);};
  const openCash=(tab:CashModuleTab)=>{setCashTab(tab);setView('accounts');setSearch('');setSidebarOpen(false);window.history.replaceState(null,'','#caja/'+tab);};
  const props:ViewProps={state,actor,location,mutate,notify};
  const hasAccounts=visibleAccounts(state,location).some(account=>account.active);
  const exportReport=()=>openCash('reports');
  return <MutationFeedbackContext.Provider value={{message:actionError,clear:clearActionError}}><div className="app-shell">
    {sidebarOpen&&<button className="mobile-overlay" aria-label="Cerrar menú" onClick={()=>setSidebarOpen(false)}/>}
    <aside className={'sidebar '+(sidebarOpen?'sidebar-open':'')}>
      <Brand/><button className="workspace-switch" onClick={()=>go('settings')}><span className="company-icon"><Building2 size={18}/></span><span><strong>Trefil Electric</strong><small>Espacio empresarial</small></span><ChevronDown size={14}/></button>
      <div className="nav-label">ESPACIO DE TRABAJO</div>
      <nav aria-label="Navegación principal">{navItems.slice(0,8).map(({id,label,icon:Icon})=><button key={id} onClick={()=>go(id)} className={'nav-item '+(view===id?'active':'')} aria-current={view===id?'page':undefined}><Icon size={18}/><span>{label}</span>{Boolean(counts[id])&&<b>{counts[id]}</b>}</button>)}</nav>
      <div className="nav-label control-label">CONTROL Y GESTIÓN</div><nav aria-label="Control y gestión">{navItems.slice(8).map(({id,label,icon:Icon})=><button key={id} onClick={()=>go(id)} className={'nav-item '+(view===id?'active':'')} aria-current={view===id?'page':undefined}><Icon size={18}/><span>{label}</span>{Boolean(counts[id])&&<b className={id==='alerts'?'alert-count':''}>{counts[id]}</b>}</button>)}<a className="nav-item" href="/equipo/"><Users size={18}/><span>Equipo</span></a><a className="nav-item" href="/desarrolladores/"><Code2 size={18}/><span>Desarrolladores</span></a></nav>
      <div className="sidebar-bottom"><div className="phase-card"><span className="phase-icon">↗</span><strong>Hecho para tu operación.</strong><p>Una base financiera.<br/>Todo un ecosistema por delante.</p><button onClick={()=>go('settings')}>Ver hoja de ruta <ArrowUpRight size={14}/></button></div><button className="backup-sidebar" onClick={()=>go('settings')}><HardDrive size={16}/><span>Respaldo sin verificar</span><i/></button><div className="sidebar-divider"/><button className="profile-button" onClick={()=>setProfileOpen(!profileOpen)} aria-expanded={profileOpen}><span className="avatar">TE</span><span><strong>{roleLabels[actor.role]}</strong><small>Perfil local · Sin autenticar</small></span><ChevronDown size={14}/></button></div>
      {profileOpen&&<div className="profile-menu"><div className="eyebrow">ESPACIO LOCAL</div><p className="local-profile-note">Este perfil identifica cambios en el navegador. El acceso institucional con usuarios personales sigue pendiente.</p><button onClick={()=>{go('settings');setProfileOpen(false);}}><span>Ver configuración</span><Settings size={15}/></button><a className="text-button" href="/acceso/"><LockKeyhole size={15}/> Acceso institucional</a></div>}

    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Abrir menú" onClick={()=>setSidebarOpen(true)}><Menu size={21}/></button><MobileBrand/><span className="workspace-breadcrumb">Espacio de trabajo</span><ChevronRight size={13}/><strong>{navItems.find(i=>i.id===view)?.label}</strong></div><div className="topbar-actions"><div className="global-search"><Search size={16}/><input ref={searchRef} placeholder="Buscar movimientos…" aria-label="Buscar movimientos" value={search} onChange={e=>{setSearch(e.target.value);setView('transactions');}}/><kbd>⌘ K</kbd></div><span className="topbar-separator"/><button className="notification-button icon-button" aria-label={'Ver '+openAlerts.length+' alertas'} onClick={()=>go('alerts')}><Bell size={20}/>{openAlerts.length>0&&<i/>}</button><span className="avatar avatar-small">TE</span></div></header>
      <main id="main-content">
        <div className="demo-bar"><span><i/> ESPACIO LOCAL <b>Guardado en este navegador · Conexión institucional pendiente</b></span><button onClick={()=>go('settings')}>Estado de implementación <ArrowRight size={13}/></button></div>
        {error&&<div className="error-banner" role="alert">{error}<button aria-label="Cerrar aviso de almacenamiento" onClick={()=>setError('')}><X size={16}/></button></div>}
        <section className="page-heading"><div><div className="eyebrow">{view==='inventory'||view==='sales'?'OPERACIÓN':'FINANZAS'} <span>/</span> {view==='overview'?'VISTA GENERAL':navItems.find(i=>i.id===view)?.label.toUpperCase()}</div><h1>{titles[view].title.replace(/\.$/,'')}<span className="heading-dot">.</span></h1><p>{titles[view].subtitle}</p></div><div className="heading-buttons">{view!=='inventory'&&view!=='sales'&&view!=='debts'&&<button className="button button-secondary" onClick={exportReport}><Download size={16}/><span>Exportar reporte</span></button>}{canWrite(actor)&&view!=='accounts'&&view!=='inventory'&&view!=='sales'&&view!=='debts'&&<button className="button button-primary" onClick={()=>openCash(hasAccounts?'operations':'accounts')}><Plus size={18}/>{hasAccounts?'Ir a Caja':'Crear primera cuenta'}</button>}</div></section>
        <div className="context-bar"><div className="context-date"><CalendarIcon/><span>Al <strong>{new Intl.DateTimeFormat('es-CO',{dateStyle:'long',timeZone:'America/Bogota'}).format(new Date(DEMO_DATE+'T12:00:00Z'))}</strong></span><span className="context-dot">·</span><span>COP <span className="muted">/</span> Bogotá</span></div><div className="context-filters"><label><Building2 size={14}/><select aria-label="Filtrar por sede" value={location} onChange={e=>setLocation(e.target.value)}><option value="all">Todas las sedes</option>{state.locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>{['overview','transactions'].includes(view)&&<label><select aria-label="Período del reporte" value={period} onChange={e=>setPeriod(e.target.value)}>{reportPeriods.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}</div></div>
        {view==='overview'&&<Overview {...props} period={period} go={go} onDetail={setDetail}/>}
        {view==='transactions'&&<TransactionsView {...props} period={period} search={search} onSearch={setSearch} onDetail={setDetail} onCreate={()=>openCash('operations')}/>}
        {view==='accounts'&&<CashModule {...props} tab={cashTab} onTabChange={openCash}/>}
        {view==='inventory'&&<InventoryView {...props} onOpenCash={()=>openCash('operations')} cashLinks={<InventoryCashLinks {...props}/>} supplierOffset={<InventorySupplierOffsets {...props}/>} reports={<InventoryReportsView {...props}/>}/>}
        {view==='sales'&&<SalesModule {...props}/>} 
        {view==='debts'&&<DebtsModule {...props} integrations={<><DebtsInventoryIntegrations {...props}/><InventorySupplierOffsets {...props} offsetOnly/></>} reports={<DebtReportsView {...props}/>} onOpenCash={()=>openCash('operations')}/>}
        {view==='reconciliations'&&<ReconciliationsView {...props}/>}
        {view==='approvals'&&<ApprovalsView {...props} onDetail={setDetail}/>}
        {view==='alerts'&&<AlertsView {...props}/>}
        {view==='audit'&&<AuditView {...props}/>}
        {view==='settings'&&<SettingsView {...props}/>}
        <footer className="page-footer"><span><ShieldCheck size={13}/> Trefil Electric · Trazabilidad en cada decisión</span><span>Fase 01 <i/> Finanzas y control</span></footer>
      </main>
    </div>
    {detail&&<TransactionDetail {...props} transaction={state.transactions.find(t=>t.id===detail.id)??detail} onClose={()=>setDetail(null)}/>}
    {toast&&<div className="toast" role="status"><span className="toast-icon"><Check size={17}/></span><p>{toast}</p><button className="icon-button" aria-label="Cerrar notificación" onClick={()=>setToast('')}><X size={15}/></button></div>}
  </div></MutationFeedbackContext.Provider>;
}
function CalendarIcon(){return <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M6 2v4M14 2v4M3 8h14" stroke="currentColor" strokeWidth="1.4"/></svg>;}

function Overview(props:ViewProps&{period:string;go:(v:View)=>void;onDetail:(t:Transaction)=>void}){
  const {state,location,period,go,onDetail}=props;
  const totals=periodTotals(state,location,period,DEMO_DATE);
  const debts=state.debts.filter(d=>location==='all'||d.locationId===location);
  const debtTotal=add(...debts.map(d=>getDebtBalance(state,d.id)),...getDebtModuleState(state).recurringBills.filter(bill=>location==='all'||getDebtModuleState(state).recurringTemplates.find(template=>template.id===bill.templateId)?.locationId===location).map(bill=>getRecurringBillBalance(state,bill.id)));
  const accounts=visibleAccounts(state,location);
  const alerts=deriveAlerts(state,DEMO_DATE).filter(a=>a.status!=='resolved');
  const latest=state.transactions.filter(t=>t.kind!=='opening'&&(location==='all'||t.locationId===location)&&t.date.startsWith(period)).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)).slice(0,5);
  const official=getDebtCalendar(state,DEMO_DATE,location==='all'?{}:{locationId:location}).filter(row=>row.remaining!=='0.00');const officialDebtIds=new Set(official.map(row=>row.debtId));
  const upcoming=[...official.map(row=>({id:row.id,creditor:row.creditor,date:row.dueDate,amount:row.remaining,description:row.concept})),...obligations(state,location,DEMO_DATE).filter(row=>!officialDebtIds.has(row.debt.id)).map(row=>({id:`legacy:${row.debt.id}:${row.row.period}`,creditor:row.debt.creditor,date:row.row.date,amount:row.remaining,description:`Cuota proyectada ${row.row.period}`}))].sort((a,b)=>a.date.localeCompare(b.date)).slice(0,3);
  return <>
    <section className="stat-grid" aria-label="Indicadores financieros">
      <div className="stat-card stat-featured"><div className="stat-top"><span>Dinero disponible</span><Wallet size={17}/></div><div className="metric-value">{formatCOP(totals.available)}</div><div className="stat-bottom"><span><i/>{accounts.filter(account=>account.active).length} cuentas activas</span><span className="metric-unit">COP</span></div><div className="featured-pattern" aria-hidden="true"/></div>
      <div className="stat-card"><div className="stat-top"><span>Ingresos del período</span><span className="metric-icon green"><ArrowDownLeft size={17}/></span></div><div className="metric-value">{formatCOP(totals.income)}</div><div className="stat-bottom"><span className="green-text">Ingresos registrados</span><span className="metric-unit">COP</span></div></div>
      <div className="stat-card"><div className="stat-top"><span>Gastos del período</span><span className="metric-icon coral"><ArrowUpRight size={17}/></span></div><div className="metric-value">{formatCOP(totals.expenses)}</div><div className="stat-bottom"><span className="muted">Egresos operativos</span><span className="metric-unit">COP</span></div></div>
      <div className="stat-card"><div className="stat-top"><span>Obligaciones por pagar</span><span className="metric-icon neutral"><Landmark size={17}/></span></div><div className="metric-value">{formatCOP(debtTotal)}</div><div className="stat-bottom"><span className="muted">{debts.filter(debt=>toCents(getDebtBalance(state,debt.id))>0n).length} obligaciones activas</span><button className="text-button" aria-label="Ver deudas" onClick={()=>go('debts')}><ArrowUpRight size={16}/></button></div></div>
    </section>
    <div className="overview-middle"><CashChart {...props}/><section className="panel accounts-panel"><div className="panel-header"><div><h2>Caja y cuentas <span className="count-tag">{accounts.length}</span></h2><p>Disponibilidad por cuenta</p></div><button className="icon-button" aria-label="Ver todas las cuentas" onClick={()=>go('accounts')}><ArrowUpRight size={18}/></button></div><div className="account-list">{!accounts.length&&<Empty title="Sin cuentas registradas" description="Crea tus cajas y cuentas. Empezarán con saldo cero." action={<button className="button button-secondary" onClick={()=>go('accounts')}>Configurar cuentas <ArrowRight size={14}/></button>}/>} {accounts.map((a,index)=><button className="account-list-row" key={a.id} onClick={()=>go('accounts')}><span className={'bank-mark bank-'+index}>{a.kind==='cash'?<Wallet size={19}/>:a.kind==='personal'?<Building2 size={18}/>:a.kind==='wallet'?'N':'B'}</span><span className="account-name"><strong>{a.name}</strong><small>{a.kind==='personal'?'Uso empresarial temporal':a.lastFour?'•••• '+a.lastFour:'Efectivo · Sede principal'}</small></span><span className="account-value">{formatCOP(getAccountBalance(state,a.id))}</span></button>)}</div><div className="panel-total"><span>Saldo consolidado</span><strong>{formatCOP(totals.available)}</strong></div></section></div>
    <div className="overview-lower"><section className="panel recent-panel"><div className="panel-header"><div><h2>Últimos movimientos</h2><p>El pulso de tu tesorería</p></div><button className="text-button" onClick={()=>go('transactions')}>Ver todos <ArrowRight size={15}/></button></div>{latest.length?<div className="table-scroll"><table className="data-table compact-table"><thead><tr><th>Movimiento</th><th>Fecha</th><th>Estado</th><th className="align-right">Valor</th></tr></thead><tbody>{latest.map(t=><tr key={t.id}><td><button className="transaction-title" onClick={()=>onDetail(t)}><MovementIcon kind={t.kind}/><span><strong>{t.description}</strong><small>{t.party+' · '+kindLabels[t.kind]}</small></span></button></td><td className="muted nowrap">{dateLabel(t.date,true)}</td><td><Badge tone={t.status==='posted'?'green':t.status==='pending'?'orange':'red'}>{t.reversedBy?'Reversado':t.status==='posted'?'Registrado':t.status==='pending'?'Por aprobar':'Rechazado'}</Badge></td><td className={'align-right amount '+(t.kind==='income'?'green-text':'')}>{t.kind==='income'?'+ ':''}{formatCOP(t.amount)}</td></tr>)}</tbody></table></div>:<Empty title="Un período sin movimientos" description="Los registros de este período aparecerán aquí."/>}</section>
    <section className="panel obligations-panel"><div className="panel-header"><div><h2>Próximas obligaciones</h2><p>Vencimientos documentados y proyecciones identificadas</p></div><span className="small-icon"><Landmark size={17}/></span></div><div className="obligation-list">{!upcoming.length&&<Empty title="Sin obligaciones registradas" description="Las deudas e inversiones que registres aparecerán aquí."/>}{upcoming.map(o=><button key={o.id} onClick={()=>go('debts')} className="obligation-row"><span className="date-tile"><b>{o.date.slice(8)}</b><small>{dateLabel(o.date,true).replace(/^\d+\s*/,'').replace('.','').toUpperCase()}</small></span><span><strong>{o.creditor}</strong><small>{o.description}</small></span><b>{formatCOP(o.amount)}</b></button>)}</div><button className="panel-footer-link" onClick={()=>go('debts')}>Ver plan de obligaciones <ArrowRight size={15}/></button></section></div>
    <section className="attention-strip"><span className="attention-icon"><Bell size={19}/></span><div><strong>{state.transactions.length?'Tu operación necesita atención.':'Configuración pendiente.'}</strong><p>{alerts.length} avisos abiertos · Revisa respaldos, recuperación y los controles pendientes.</p></div><button className="button button-secondary" onClick={()=>go('alerts')}>Revisar alertas <ArrowRight size={15}/></button></section>
  </>;
}
export function MovementIcon({kind}:{kind:Transaction['kind']}){return <span className={'movement-icon '+(kind==='income'?'movement-income':kind==='transfer'?'movement-transfer':'movement-expense')}>{kind==='income'?<ArrowDownLeft size={17}/>:kind==='transfer'?<ArrowRightLeft size={16}/>:<ArrowUpRight size={17}/>}</span>;}
function CashChart({state,location,period}:ViewProps&{period:string}){
  const [mode,setMode]=useState<'balance'|'net'>('balance');
  const series=cashSeries(state,location,period,DEMO_DATE);
  const lastDay=series.lastDay;
  const currentDay=series.actualThrough;
  const values=(mode==='balance'?series.balances:series.net).map(toCents);
  // Conversion to Number is confined to chart pixel coordinates; ledger math remains BigInt.
  const display=values.map(v=>Number(v/100n));const min=Math.min(0,...display);const max=Math.max(1,...display)*1.12;const span=max-min;
  const x=(d:number)=>56+d/lastDay*640;const y=(n:number)=>195-(n-min)/span*160;
  const path=(start:number,end:number)=>display.slice(start,end+1).map((v,i)=>(i?'L':'M')+x(i+start).toFixed(1)+' '+y(v).toFixed(1)).join(' ');
  const actual=path(0,currentDay);const projected=path(currentDay,lastDay);const area=actual+' L'+x(currentDay)+' 195 L56 195 Z';
  const final=fromCents(values[values.length-1]);const actualValue=fromCents(values[currentDay]);
  if(!state.transactions.some(transaction=>transaction.status==='posted'&&(location==='all'||transaction.locationId===location)))return <section className="panel chart-panel"><div className="panel-header"><div><h2>Evolución de caja</h2><p>Saldo registrado: {formatCOP('0.00')}</p></div></div><Empty title="Tu historial empieza en cero" description="La gráfica se construirá a partir de tus movimientos registrados."/></section>;
  return <section className="panel chart-panel"><div className="panel-header"><div><h2>Evolución de caja</h2><p>El recorrido de tu liquidez</p></div><div className="chart-tabs"><button className={mode==='balance'?'selected':''} onClick={()=>setMode('balance')}>Saldo</button><button className={mode==='net'?'selected':''} onClick={()=>setMode('net')}>Flujo neto</button></div></div><div className="chart-value"><strong>{formatCOP(actualValue)}</strong><span><i/>Registrado <span className="chart-legend-dash"/> Proyectado</span></div><div className="cash-chart"><svg viewBox="0 0 720 235" role="img" aria-label={(mode==='balance'?'Saldo':'Flujo neto')+' al corte '+formatCOP(actualValue)+'. Proyección al cierre '+formatCOP(final)+', descontando obligaciones programadas.'}><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--brand-navy)" stopOpacity=".22"/><stop offset="100%" stopColor="var(--brand-navy)" stopOpacity=".015"/></linearGradient></defs>{[0,.25,.5,.75,1].map(r=>{const value=min+span*r;return <g key={r}><line x1="56" y1={y(value)} x2="696" y2={y(value)} stroke="#e6ebf2" strokeDasharray="3 5"/><text x="42" y={y(value)+4} textAnchor="end">{new Intl.NumberFormat('es-CO',{notation:'compact',maximumFractionDigits:0}).format(value)}</text></g>;})}<path d={area} fill="url(#chart-fill)"/><path d={actual} fill="none" stroke="var(--brand-navy)" strokeWidth="2.7" strokeLinejoin="round"/>{currentDay<lastDay&&<path d={projected} fill="none" stroke="#879bb8" strokeWidth="2" strokeDasharray="5 5"/>}<line x1={x(currentDay)} y1="20" x2={x(currentDay)} y2="195" stroke="#b7c5d8" strokeDasharray="3 4"/><circle cx={x(currentDay)} cy={y(display[currentDay])} r="5" fill="var(--brand-navy)" stroke="white" strokeWidth="3"/>{[1,5,10,15,20,25,lastDay].filter((d,i,a)=>a.indexOf(d)===i).map(d=><text key={d} x={x(d)} y="220" textAnchor="middle">{String(d).padStart(2,'0')+' '+(period.endsWith('11')?'nov':period.endsWith('10')?'oct':'sep')}</text>)}</svg></div><div className="chart-footnote"><span><i/>Proyección: solo cuotas futuras del mes, desde el corte.</span><span>Sin ingresos futuros estimados</span></div></section>;
}
