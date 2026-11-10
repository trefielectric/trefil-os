'use client';
import { Wallet, Landmark, FileBarChart2, CheckCheck } from 'lucide-react';
import { AccountsView } from './operations-view';
import { CashView } from './cash-view';
import { CashReportsView } from './cash-reports-view';
import { CashStatementsView } from './cash-statements-view';
import type { ViewProps } from './view-helpers';

export type CashModuleTab='operations'|'accounts'|'statements'|'reports';
export function CashModule(props:ViewProps&{tab:CashModuleTab;onTabChange:(tab:CashModuleTab)=>void}){
  const tabs=[{id:'operations',name:'Operación de caja',icon:Wallet},{id:'accounts',name:'Cuentas y pasarelas',icon:Landmark},{id:'statements',name:'Extractos y conciliación',icon:CheckCheck},{id:'reports',name:'Informes PDF y Excel',icon:FileBarChart2}] as const;
  return <div className="cash-module"><nav className="cash-module-nav" aria-label="Secciones del módulo de Caja">{tabs.map(({id,name,icon:Icon})=><button type="button" key={id} className={props.tab===id?'active':''} aria-current={props.tab===id?'page':undefined} onClick={()=>props.onTabChange(id)}><Icon size={17}/>{name}</button>)}</nav>
    {props.tab==='operations'&&<CashView {...props} onConfigureAccounts={()=>props.onTabChange('accounts')}/>}
    {props.tab==='accounts'&&<AccountsView {...props}/>}
    {props.tab==='statements'&&<CashStatementsView {...props}/>}
    {props.tab==='reports'&&<CashReportsView {...props}/>}
  </div>;
}
