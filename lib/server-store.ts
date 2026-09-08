import { env } from "cloudflare:workers";
import { encrypt, decrypt, type Envelope } from "./vault-crypto";
import { initialWorkspace, type Workspace } from "./state-schema";
export interface Statement { bind(...values: unknown[]): Statement; first<T=Record<string,unknown>>(): Promise<T|null>; all<T=Record<string,unknown>>(): Promise<{results:T[]}>; run(): Promise<{meta:{changes:number}}> }
export interface Database { prepare(sql:string):Statement; batch(items:Statement[]):Promise<{meta:{changes:number}}[]> }
type Bindings = { DB?: Database; VAULT_KEY?: string; APP_ORIGIN?: string };
export class APIError extends Error { constructor(public status:number,message:string) { super(message); } }
export function runtime() { const b=env as unknown as Bindings; if (!b.DB || !b.VAULT_KEY || !b.APP_ORIGIN) throw new APIError(503,"Serviço de cadastros indisponível. Tente novamente mais tarde."); return {db:b.DB,key:b.VAULT_KEY,origin:b.APP_ORIGIN}; }
export function owner(request:Request, write=false) { const id=request.headers.get("oai-authenticated-user-id"); if(!id) throw new APIError(401,"Entre na sua conta para continuar."); if(write){ const origin=request.headers.get("origin"); if(origin!==runtime().origin) throw new APIError(403,"Origem da solicitação inválida."); if(!request.headers.get("content-type")?.startsWith("application/json")) throw new APIError(415,"Envie JSON."); } return id; }
export async function body(request:Request) { const raw=await request.text(); if(raw.length>4_000_000) throw new APIError(413,"Arquivo grande demais."); try{return JSON.parse(raw)}catch{throw new APIError(400,"JSON inválido.");} }
export function reply(data:unknown,status=200) { return Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}}); }
export function failure(error:unknown) { if(error instanceof APIError) return reply({error:error.message},error.status); if(error instanceof Error && error.name==="ZodError") return reply({error:"Confira os campos obrigatórios, limites e formatos do cadastro."},400); console.error("ACS Pilot request failed",error instanceof Error?error.name:"UnknownError"); return reply({error:"Não foi possível concluir. Seus dados na tela foram preservados."},500); }
export async function readState(id:string) {
 const {db,key}=runtime();
 let row=await db.prepare("SELECT encrypted, revision FROM workspaces WHERE owner = ?").bind(id).first<{encrypted:string;revision:number}>();
 if(!row) {const state=initialWorkspace(); const encrypted=JSON.stringify(await encrypt(state,key,`workspace:${id}`)); await db.prepare("INSERT OR IGNORE INTO workspaces (owner, encrypted, revision, updated) VALUES (?, ?, 1, ?)").bind(id,encrypted,new Date().toISOString()).run(); row=await db.prepare("SELECT encrypted, revision FROM workspaces WHERE owner = ?").bind(id).first<{encrypted:string;revision:number}>();}
 if(!row) throw new APIError(503,"Cadastro temporariamente indisponível.");
 return {state:await decrypt<Workspace>(JSON.parse(row.encrypted) as Envelope,key,`workspace:${id}`),revision:row.revision};
}
export async function writeState(id:string,state:Workspace,revision:number) {
 if(JSON.stringify(state).length>1_000_000)throw new APIError(413,"O cadastro atingiu o limite desta versão. Reduza o arquivo importado.");
 const {db,key}=runtime(), encrypted=JSON.stringify(await encrypt(state,key,`workspace:${id}`));
 const r=await db.prepare("UPDATE workspaces SET encrypted = ?, revision = revision + 1, updated = ? WHERE owner = ? AND revision = ?").bind(encrypted,new Date().toISOString(),id,revision).run();
 if(r.meta.changes!==1) throw new APIError(409,"Os cadastros foram atualizados em outra aba. Recarregue os dados antes de salvar novamente."); return revision+1;
}
export async function auditEvent(id:string,event:string,summary:string){ const{db}=runtime();await db.prepare("INSERT INTO audit (id, owner, event, summary, created) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(),id,event,summary,new Date().toISOString()).run(); }
