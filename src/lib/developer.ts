import type { SupabaseClient } from "@supabase/supabase-js";

export interface DeveloperScope {
  code: string;
  name: string;
  description: string;
  module: "system"|"workforce"|"finance"|"cash"|"inventory"|"sales"|"debts"|"audit";
  access: "read"|"write";
  implemented: boolean;
  sort_order: number;
}
export interface DeveloperKey {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  rate_limit_per_minute: number;
  created_at: string;
  expires_at: string|null;
  last_used_at: string|null;
  revoked_at: string|null;
  calls_24h: number;
}
export interface DeveloperSnapshot {
  me: { id:string;full_name:string;job_title:string;area:string;access_role:string };
  endpoint: string;
  scopes: DeveloperScope[];
  keys: DeveloperKey[];
}

export class DeveloperError extends Error { constructor(message:string,readonly code?:string){super(message);} }
export async function developerRpc<T>(client:SupabaseClient,name:string,parameters:Record<string,unknown>={}){
  const {data,error}=await client.rpc(name,parameters);
  if(error){
    const message=error.code==='42501'?'Necesitas una sesión verificada y permiso para administrar integraciones.':
      error.code==='23505'?'La clave coincide con otra existente. Intenta crearla de nuevo.':
      error.code==='22023'||error.code==='23514'?'Revisa la configuración de la clave.':'No pudimos conectar con el centro de desarrolladores.';
    throw new DeveloperError(message,error.code);
  }
  return data as T;
}
function base64Url(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
async function digest(value:string){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function createDeveloperCredential(){
  const id=crypto.randomUUID();
  const prefix=`tos_${id.replaceAll('-','').slice(0,8)}`;
  const random=crypto.getRandomValues(new Uint8Array(32));
  const token=`${prefix}.${base64Url(random)}`;
  return {id,prefix,token,hash:await digest(token)};
}
