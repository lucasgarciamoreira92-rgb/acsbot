import { z } from "zod";
import { initialModels, initialDevices, initialGroups, initialACS } from "@/app/data";
const str = z.string().max(500);
const id = z.string().min(1).max(120);
const path = str.refine(s => !s || (s.startsWith("/") && !s.startsWith("//") && !s.includes("\\")), "Use um caminho relativo iniciado por /.");
export const modelSchema = z.object({
 id, brand: str.min(1), name: str.min(1), type: z.enum(["Roteador", "ONU"]), firmware: str.min(1), group: id,
 loginPath: path, acsPath: path, userSelector: str, passwordSelector: str, submitSelector: str, acsSelector: str, saveSelector: str, ready: z.boolean(),
 example: z.boolean().optional(), scheme: z.enum(["http", "https"]).default("http"), allowSelfSigned: z.boolean().default(false),
 successSelector: str.default(""), failureSelector: str.default(""), lockoutSelector: str.default(""),
 identitySelector: str.default(""), identityText: str.default(""), firmwareSelector: str.default(""), serialSelector: str.default(""),
 acsUsernameSelector: str.default(""), acsPasswordSelector: str.default(""), enabledSelector: str.default(""), periodicSelector: str.default(""), intervalSelector: str.default(""),
 frameSelector: str.default(""), navigation: z.array(str.min(1)).max(10).default([]),
});
const credential = z.object({ id, label: str.min(1), username: str.min(1), password: z.string().max(512), hasPassword: z.boolean().optional() });
const groupSchema = z.object({ id, name: str.min(1), attempts: z.number().int().min(1).max(5), cooldown: z.number().int().min(30).max(86400), entries: z.array(credential).max(50) });
const ipv4 = z.string().refine(s => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split(".").every(n => Number(n) <= 255));
const validation = z.object({ serial: str.min(1), modelHash: str.min(1), endpoint: str.min(1), validatedAt: str });
export const deviceSchema = z.object({ id, name: str.min(1), ip: ipv4, port: z.number().int().min(1).max(65535), model: id, status: str, example: z.boolean().optional(), acsId: str.default(""), validation: validation.optional() });
const httpURL = str.refine(s => { try { const u = new URL(s); return ["http:","https:"].includes(u.protocol) && !u.username && !u.password; } catch { return false; } });
export const acsSchema = z.object({ name: str.min(1), url: httpURL, username: str, password: z.string().max(512), hasPassword: z.boolean().optional(), interval: z.number().int().min(1).max(604800), enabled: z.boolean(), verifier: z.enum(["manual", "genieacs"]).default("manual"), nbiUrl: str.default(""), nbiToken: z.string().max(2048).default(""), hasNbiToken: z.boolean().optional() });
export const workspaceSchema = z.object({ models: z.array(modelSchema).max(500), groups: z.array(groupSchema).min(1).max(100), devices: z.array(deviceSchema).max(10000), acs: acsSchema });
export type Workspace = z.infer<typeof workspaceSchema>;
export function initialWorkspace(): Workspace { return workspaceSchema.parse({ models: initialModels.map(m => ({ ...m, example: true })), groups: initialGroups.map(g => ({ ...g, entries: [] })), devices: initialDevices.map(d => ({ ...d, example: true, status: "Exemplo" })), acs: { ...initialACS, username: "", password: "" } }); }
export function validateRelations(w: Workspace) {
 for (const collection of [w.models,w.groups,w.devices]) if (new Set(collection.map(v=>v.id)).size !== collection.length) throw new Error("IDs duplicados no cadastro.");
 const allCreds = w.groups.flatMap(g => g.entries); if (new Set(allCreds.map(c=>c.id)).size !== allCreds.length) throw new Error("IDs de credenciais duplicados.");
 if (new Set(w.devices.map(d=>`${d.ip}:${d.port}`)).size !== w.devices.length) throw new Error("Endereços e portas duplicados.");
 if (w.models.some(m=>!w.groups.some(g=>g.id===m.group))) throw new Error("Um modelo referencia uma lista de credenciais inexistente.");
 if (w.devices.some(d=>!w.models.some(m=>m.id===d.model))) throw new Error("Um equipamento referencia um modelo inexistente.");
 if (w.acs.verifier === "genieacs") httpURL.parse(w.acs.nbiUrl);
}
export function redacted(w: Workspace): Workspace {
 const safe = structuredClone(w);
 for (const g of safe.groups) for (const c of g.entries) { c.hasPassword = !!c.password; c.password = ""; }
 safe.acs.hasPassword = !!safe.acs.password; safe.acs.password = "";
 safe.acs.hasNbiToken = !!safe.acs.nbiToken; safe.acs.nbiToken = "";
 return safe;
}
export function mergeSecrets(next: Workspace, old: Workspace): Workspace {
 for (const g of next.groups) for (const c of g.entries) {
  const existing = old.groups.flatMap(g=>g.entries).find(e=>e.id===c.id);
  if (!c.password && existing) c.password=existing.password;
  if (!c.password) throw new Error("Informe a senha de cada nova credencial.");
 }
 if (!next.acs.password) next.acs.password=old.acs.password;
 if (!next.acs.nbiToken) next.acs.nbiToken=old.acs.nbiToken;
 for (const d of next.devices) { const prev=old.devices.find(x=>x.id===d.id); d.validation=prev?.validation; d.status=prev?.status || "Pendente"; d.example=prev?.example || false; }
 for (const m of next.models) m.example=old.models.find(x=>x.id===m.id)?.example || false;
 return next;
}
export function profileCanonical(model: Workspace["models"][number]) {
 const { id, group, ready, example, ...profile }=model; void id; void group; void ready; void example;
 return JSON.stringify(profile, Object.keys(profile).sort());
}
