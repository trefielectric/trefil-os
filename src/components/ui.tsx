'use client';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export const MutationFeedbackContext=createContext<{message:string;clear:()=>void}>({message:'',clear:()=>{}});

export function Modal({ title, subtitle, children, onClose, wide=false }: { title:string; subtitle?:string; children:ReactNode; onClose:()=>void; wide?:boolean }) {
  const feedback=useContext(MutationFeedbackContext);
  const clearFeedback=useRef(feedback.clear); clearFeedback.current=feedback.clear;
  const ref=useRef<HTMLDialogElement>(null);
  const closeRef=useRef(onClose); closeRef.current=onClose;
  useEffect(()=>{
    clearFeedback.current();
    const el=ref.current; el?.showModal();
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    return ()=>{el?.close();document.body.style.overflow=previous;};
  },[]);
  return <dialog ref={ref} className={`modal ${wide?'modal-wide':''}`} aria-labelledby="dialog-title" onCancel={e=>{e.preventDefault();closeRef.current();}} onClick={e=>{if(e.target===ref.current)closeRef.current();}}>
    <div className="modal-content"><div className="modal-header"><div><div className="eyebrow">TREFIL OS · FINANZAS</div><h2 id="dialog-title">{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button" aria-label="Cerrar ventana" onClick={onClose}><X size={20}/></button></div>{feedback.message&&<p className="form-error" role="alert">{feedback.message}</p>}{children}</div>
  </dialog>;
}
export function Field({label,children,hint,full=false}:{label:string;children:ReactNode;hint?:string;full?:boolean}) {return <label className={`field ${full?'full':''}`}><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'green'|'orange'|'red'|'blue'}) {return <span className={`badge badge-${tone}`}><i/>{children}</span>;}
export function Empty({title,description,action}:{title:string;description:string;action?:ReactNode}) {return <div className="empty-state"><span className="empty-mark">↗</span><h3>{title}</h3><p>{description}</p>{action}</div>;}
export function MiniTrend({up=true}:{up?:boolean}) {return <svg className="mini-trend" width="80" height="28" viewBox="0 0 80 28" aria-hidden="true"><path d={up?'M1 23L12 19L21 22L32 12L42 16L51 9L61 11L72 3L79 5':'M1 5L12 9L21 7L32 17L42 13L51 20L61 16L72 24L79 22'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
