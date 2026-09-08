import { z } from "zod";
import { runtime, APIError, readState } from "./server-store";
import { encrypt, decrypt, randomKey, hash, PACKAGE_AAD, verifyResult, unb64 } from "./vault-crypto";
import { profileCanonical, redacted, type Workspace } from "./state-schema";
export type Job = { version:1; id:string; name:string; mode:"validate"|"provision"; created:string; expires:string; resultKey:string; devices:(Workspace["devices"][number]&{profileHash:string})[]; models:Workspace["models"]; groups:Workspace["groups"]; acs:Workspace["acs"] };
type JobRow={id:string;encrypted:string;state:string;created:string;expires:string;result_digest:string|null;result:string|null};
const requestSchema=z.object({deviceIds:z.array(z.string()).min(1).max(100),mode:z.enum(["validate","provision"]),name:z.string().trim().min(1).max(100)});
export function endpoint(d:Workspace["devices"][number],m:Workspace["models"][number]) {return `${m.scheme}://${d.ip}:${d.port}`;}
export function requireProfile(m:Workspace["models"][number],mode:string,acs:Workspace["acs"]){
 if(m.example)throw new APIError(400,`${m.brand} ${m.name}: perfil ilustrativo. Cadastre o roteiro do firmware real.`);
 const required:[keyof typeof m,string][]=[["userSelector","campo de usuário"],["passwordSelector","campo de senha"],["submitSelector","botão de entrada"],["successSelector","indicador de login concluído"],["failureSelector","indicador de senha inválida"],["identitySelector","identificação do modelo"],["identityText","texto de identificação"],["firmwareSelector","versão do firmware"],["serialSelector","número de série"]];
 if(mode==="provision")required.push(["acsPath","página do ACS"],["acsSelector","URL do ACS"],["saveSelector","botão de salvar"],["enabledSelector","habilitação TR-069"],["periodicSelector","Inform periódico"],["intervalSelector","intervalo do Inform"]);
 if(mode==="provision")required.push(["acsUsernameSelector","usuário do ACS"]);
 if(mode==="provision")required.push(["acsPasswordSelector","senha do ACS"]);
 const missing=required.filter(([k])=>!m[k]).map(([,label])=>label);if(missing.length)throw new APIError(400,`${m.name}: complete ${missing.join(", ")}.`);
}
export async function createJob(owner:string,input:unknown){
 const args=requestSchema.parse(input), {db,key}=runtime(), {state}=await readState(owner);
 if(new Set(args.deviceIds).size!==args.deviceIds.length)throw new APIError(400,"Equipamentos duplicados no lote.");
 const selected=state.devices.filter(d=>args.deviceIds.includes(d.id));if(selected.length!==args.deviceIds.length)throw new APIError(400,"Há equipamentos que não estão no seu inventário.");
 const devices:Job["devices"]=[];
 for(const d of selected){const m=state.models.find(m=>m.id===d.model)!; if(d.example)throw new APIError(400,`${d.name} é um equipamento ilustrativo. Importe o inventário real.`);requireProfile(m,args.mode,state.acs);const group=state.groups.find(g=>g.id===m.group);if(!group?.entries.length)throw new APIError(400,`${m.name}: adicione credenciais à lista associada.`);const profileHash=await hash(profileCanonical(m));if(args.mode==="provision"&&(!d.validation||d.validation.modelHash!==profileHash||d.validation.endpoint!==endpoint(d,m)))throw new APIError(400,`${d.name}: valide o acesso e importe o relatório antes de implantar.`);devices.push({...d,profileHash});}
 if(args.mode==="provision"&&(!state.acs.enabled||new URL(state.acs.url).hostname.endsWith(".invalid")))throw new APIError(400,"Configure e habilite o endereço real do ACS antes de implantar.");
 const created=new Date().toISOString(),expires=new Date(Date.now()+12*3600_000).toISOString();
 const job:Job={version:1,id:crypto.randomUUID(),name:args.name,mode:args.mode,created,expires,resultKey:randomKey(),devices,models:state.models.filter(m=>devices.some(d=>d.model===m.id)),groups:state.groups.filter(g=>devices.some(d=>state.models.find(m=>m.id===d.model)?.group===g.id)),acs:state.acs};
 const encrypted=JSON.stringify(await encrypt(job,key,`job:${owner}:${job.id}`));
 await db.prepare("DELETE FROM job_targets WHERE owner = ? AND expires < ?").bind(owner,created).run();
 const pending=await db.prepare("SELECT device FROM job_targets WHERE owner = ?").bind(owner).all<{device:string}>();if(pending.results.some(r=>args.deviceIds.includes(r.device)))throw new APIError(409,"Há equipamento em um pacote ainda aberto. Importe o relatório ou aguarde a expiração antes de gerar outro lote.");
 try{await db.batch([
 db.prepare("INSERT INTO jobs (id, owner, encrypted, state, created, expires) VALUES (?, ?, ?, 'exported', ?, ?)").bind(job.id,owner,encrypted,created,expires),
 ...devices.map(d=>db.prepare("INSERT INTO job_targets (owner, device, job, expires) VALUES (?, ?, ?, ?)").bind(owner,d.id,job.id,expires)),
 db.prepare("INSERT INTO audit (id, owner, event, summary, created) VALUES (?, ?, 'job_exported', ?, ?)").bind(crypto.randomUUID(),owner,`${args.mode}: ${devices.length} equipamentos`,created)
 ]);}catch{throw new APIError(409,"O lote não foi criado. Confira se já existe um pacote para estes equipamentos.");}
 const unlockKey=randomKey(), envelope=await encrypt(job,unlockKey,PACKAGE_AAD);
 return {job:{id:job.id,name:job.name,mode:job.mode,count:devices.length,created,expires},envelope,unlockKey};
}
export async function listJobs(owner:string){const{db,key}=runtime();const rows=await db.prepare("SELECT id, encrypted, state, created, expires, result_digest, result FROM jobs WHERE owner = ? ORDER BY created DESC LIMIT 50").bind(owner).all<JobRow>();return await Promise.all(rows.results.map(async r=>{const job=await decrypt<Job>(JSON.parse(r.encrypted),key,`job:${owner}:${r.id}`);const result=r.result?await decrypt<Report>(JSON.parse(r.result),key,`result:${owner}:${r.id}`):null;return{id:r.id,name:job.name,mode:job.mode,state:r.state,count:job.devices.length,created:r.created,expires:r.expires,results:result?.results||[],finishedAt:result?.finishedAt};}));}
export const outcomeSchema=z.object({deviceId:z.string().max(120),status:z.enum(["validated","configured_waiting_acs","confirmed","already_configured","login_failed","locked","unreachable","profile_mismatch","configuration_failed","uncertain","not_run"]),message:z.string().max(1000),serial:z.string().max(500).optional(),credentialId:z.string().max(120).optional(),attempts:z.number().int().min(0).max(5),before:z.record(z.union([z.string().max(500),z.boolean(),z.number()])).optional(),after:z.record(z.union([z.string().max(500),z.boolean(),z.number()])).optional(),acsConfirmedAt:z.string().optional()});
const reportSchema=z.object({version:z.literal(1),jobId:z.string(),finishedAt:z.string().datetime(),results:z.array(outcomeSchema).max(100)});
type Report=z.infer<typeof reportSchema>;
export async function importResult(owner:string,input:unknown){
 const packet=z.object({jobId:z.string().max(120),payload:z.string().max(1_000_000),signature:z.string().max(200)}).parse(input),{db,key}=runtime();
 const row=await db.prepare("SELECT id, encrypted, state, created, expires, result_digest, result FROM jobs WHERE id = ? AND owner = ?").bind(packet.jobId,owner).first<JobRow>();if(!row)throw new APIError(404,"Lote não encontrado nesta conta.");
 const job=await decrypt<Job>(JSON.parse(row.encrypted),key,`job:${owner}:${row.id}`);
 if(!await verifyResult(packet.payload,packet.signature,job.resultKey))throw new APIError(400,"A assinatura do relatório não corresponde ao pacote exportado.");
 const digest=await hash(packet.payload);if(row.result_digest===digest){const current=await readState(owner);return{alreadyImported:true,...current,state:redacted(current.state)};}
 if(row.state==="completed")throw new APIError(409,"Este lote já foi concluído com outro relatório.");
 let report:Report;try{report=reportSchema.parse(JSON.parse(new TextDecoder().decode(unb64(packet.payload))));}catch{throw new APIError(400,"Formato do relatório inválido.");}
 if(report.jobId!==job.id||report.results.length!==job.devices.length||new Set(report.results.map(r=>r.deviceId)).size!==job.devices.length||report.results.some(r=>!job.devices.some(d=>d.id===r.deviceId)))throw new APIError(400,"Os equipamentos do relatório não correspondem ao lote.");
 if(row.result){const previous=await decrypt<Report>(JSON.parse(row.result),key,`result:${owner}:${row.id}`);for(const done of previous.results.filter(r=>r.status!=="not_run")){if(JSON.stringify(done)!==JSON.stringify(report.results.find(r=>r.deviceId===done.deviceId)))throw new APIError(400,"Uma retomada não pode alterar resultados já importados.");}}
 const current=await readState(owner), now=new Date().toISOString();
 const messages:Record<string,string>={validated:"Acesso validado",configured_waiting_acs:"Aguardando ACS",confirmed:"Confirmado no ACS",already_configured:"Já configurado",login_failed:"Falha de login",locked:"Login bloqueado",unreachable:"Sem acesso",profile_mismatch:"Revisar modelo",configuration_failed:"Falha na configuração",uncertain:"Resultado incerto"};
 for(const r of report.results){const jd=job.devices.find(d=>d.id===r.deviceId)!,m=job.models.find(m=>m.id===jd.model)!,d=current.state.devices.find(d=>d.id===r.deviceId);if(r.status==="not_run")continue;if(job.mode==="validate"&&["confirmed","configured_waiting_acs","already_configured"].includes(r.status))throw new APIError(400,"Relatório de validação contém uma alteração inesperada.");if(r.credentialId&&!job.groups.flatMap(g=>g.entries).some(c=>c.id===r.credentialId))throw new APIError(400,"Credencial não pertence ao pacote.");if(d&&d.ip===jd.ip&&d.port===jd.port&&d.model===jd.model){d.status=messages[r.status]||d.status;if(r.status==="validated"&&r.serial)d.validation={serial:r.serial,modelHash:jd.profileHash,endpoint:endpoint(jd,m),validatedAt:report.finishedAt};}}
 const encrypted=JSON.stringify(await encrypt(current.state,key,`workspace:${owner}`)), result=JSON.stringify(await encrypt(report,key,`result:${owner}:${row.id}`)), completed=report.results.every(r=>r.status!=="not_run");
 // NOT NULL guard makes the entire D1 batch fail if the revision or job changed.
 try{await db.batch([
 db.prepare("INSERT INTO audit (id, owner, event, summary, created) VALUES (?, (SELECT owner FROM workspaces WHERE owner = ? AND revision = ? AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND state != 'completed')), 'result_imported', ?, ?)").bind(crypto.randomUUID(),owner,current.revision,job.id,`${report.results.filter(r=>r.status!=="not_run").length} resultados recebidos`,now),
 db.prepare("UPDATE workspaces SET encrypted = ?, revision = revision + 1, updated = ? WHERE owner = ?").bind(encrypted,now,owner),
 db.prepare("UPDATE jobs SET state = ?, result_digest = ?, result = ? WHERE id = ? AND owner = ?").bind(completed?"completed":"partial",digest,result,job.id,owner),
 ...report.results.filter(r=>r.status!=="not_run").map(r=>db.prepare("DELETE FROM job_targets WHERE owner = ? AND device = ? AND job = ?").bind(owner,r.deviceId,job.id))
 ]);}catch{throw new APIError(409,"Os dados mudaram durante a importação. Atualize a tela e importe novamente.");}
 return{state:redacted(current.state),revision:current.revision+1,completed};
}
