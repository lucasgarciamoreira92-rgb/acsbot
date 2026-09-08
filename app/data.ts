export type Model = {
  id: string; brand: string; name: string; type: "Roteador" | "ONU"; firmware: string;
  group: string; loginPath: string; acsPath: string; userSelector: string;
  passwordSelector: string; submitSelector: string; acsSelector: string; saveSelector: string;
  ready: boolean; example?: boolean; scheme?: "http" | "https"; allowSelfSigned?: boolean;
  successSelector?: string; failureSelector?: string; lockoutSelector?: string; identitySelector?: string; identityText?: string;
  firmwareSelector?: string; serialSelector?: string; acsUsernameSelector?: string; acsPasswordSelector?: string;
  enabledSelector?: string; periodicSelector?: string; intervalSelector?: string; frameSelector?: string; navigation?: string[];
};
export type Credential = { id: string; label: string; username: string; password: string; hasPassword?: boolean };
export type Group = { id: string; name: string; attempts: number; cooldown: number; entries: Credential[] };
export type Device = { id: string; name: string; ip: string; port: number; model: string; status: string; example?: boolean; acsId?: string; validation?: { serial:string; modelHash:string; endpoint:string; validatedAt:string } };
export type ACS = { name: string; url: string; username: string; password: string; interval: number; enabled: boolean; hasPassword?: boolean; verifier?: "manual"|"genieacs"; nbiUrl?:string; nbiToken?:string; hasNbiToken?:boolean };
export type RunResult = { id: string; device: string; ip: string; model: string; status: string; message: string; credential?: string };
export type Run = { id: string; name: string; mode: string; acs: string; date: string; results: RunResult[]; cursor: number; state: "running" | "paused" | "finished" | "cancelled" };

export const initialGroups: Group[] = [
  { id: "g1", name: "Padrão • roteadores", attempts: 3, cooldown: 60, entries: [
    { id: "c1", label: "Instalações atuais", username: "operador", password: "exemplo-atual" },
    { id: "c2", label: "Instalações anteriores", username: "suporte", password: "exemplo-anterior" },
    { id: "c3", label: "Lote legado", username: "gestao", password: "exemplo-legado" },
  ] },
  { id: "g2", name: "Operação • fibra", attempts: 2, cooldown: 120, entries: [
    { id: "c4", label: "Provisionamento fibra", username: "operador", password: "exemplo-fibra" },
    { id: "c5", label: "Instalações anteriores", username: "suporte", password: "exemplo-fibra-legado" },
  ] },
  { id: "g3", name: "Parque legado", attempts: 2, cooldown: 120, entries: [
    { id: "c6", label: "Operação legado", username: "gestao", password: "exemplo-legado" },
  ] },
];
const flow = { loginPath: "/", acsPath: "/exemplo/tr069", userSelector: "#usuario-exemplo", passwordSelector: "#senha-exemplo", submitSelector: "#entrar-exemplo", acsSelector: "#acs-url-exemplo", saveSelector: "#salvar-exemplo" };
// All profiles are illustrative, not certified device adapters.
export const initialModels: Model[] = [
  { ...flow, id: "m1", brand: "TP-Link", name: "Archer C5", type: "Roteador", firmware: "Firmware de exemplo A", group: "g1", ready: true },
  { ...flow, id: "m2", brand: "Huawei", name: "HG8245H", type: "ONU", firmware: "Firmware de exemplo B", group: "g2", ready: true },
  { ...flow, id: "m3", brand: "ZTE", name: "F670L", type: "ONU", firmware: "Firmware de exemplo C", group: "g2", ready: true },
  { ...flow, id: "m4", brand: "Intelbras", name: "RG 1200", type: "Roteador", firmware: "Firmware de exemplo D", group: "g1", ready: true },
  { ...flow, id: "m5", brand: "FiberHome", name: "AN5506-04", type: "ONU", firmware: "A definir", group: "g3", ready: false },
  { ...flow, id: "m6", brand: "Nokia", name: "G-1425G-A", type: "ONU", firmware: "A definir", group: "g2", ready: false },
];
export const initialDevices: Device[] = Array.from({ length: 24 }, (_, i) => ({
  id: `d${i + 1}`, name: `${i % 6 === 0 || i % 6 === 3 ? "CPE" : "ONU"}-${String(i + 1).padStart(4, "0")}`,
  ip: `192.0.2.${i + 11}`, port: 80, model: `m${i % 6 + 1}`,
  status: i < 8 ? "Confirmado no ACS" : i % 6 >= 4 ? "Revisar modelo" : "Pendente",
}));
export const initialACS: ACS = { name: "ACS principal", url: "https://acs.exemplo.invalid/cwmp", username: "cpe-exemplo", password: "exemplo-acs", interval: 300, enabled: true };

export function parseDelimited(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const delimiter = first.includes(";") ? ";" : ",";
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === delimiter && !quoted) { row.push(field.trim()); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (quoted) throw new Error("Há aspas não fechadas no CSV.");
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function previewCSV(input: string, models: Model[], existing: Device[]) {
  const rows = parseDelimited(input);
  if (rows.length < 2) throw new Error("O CSV precisa de um cabeçalho e pelo menos um equipamento.");
  const header = rows[0].map(x => x.toLowerCase());
  if (!["nome", "ip", "porta", "modelo"].every(k => header.includes(k))) throw new Error("Use as colunas nome, ip, porta e modelo.");
  const devices: Device[] = [], errors: string[] = [];
  const seen = new Set(existing.map(d => `${d.ip}:${d.port}`));
  rows.slice(1).forEach((row, i) => {
    const get = (key: string) => row[header.indexOf(key)] || "";
    const name = get("nome"), ip = get("ip"), port = Number(get("porta"));
    const matches = models.filter(m => (m.id === get("modelo") || m.name.toLowerCase() === get("modelo").toLowerCase()) && (!get("firmware") || m.firmware === get("firmware")));
    if(matches.length > 1) { errors.push(`Linha ${i + 2}: há mais de um firmware deste modelo. Informe a coluna firmware ou use o ID do modelo.`); return; }
    const model = matches[0];
    if (!name || name.length > 100) { errors.push(`Linha ${i + 2}: informe um nome com até 100 caracteres.`); return; }
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split(".").some(n => Number(n) > 255)) { errors.push(`Linha ${i + 2}: IPv4 inválido.`); return; }
    if (!Number.isInteger(port) || port < 1 || port > 65535) { errors.push(`Linha ${i + 2}: porta inválida.`); return; }
    if (!model) { errors.push(`Linha ${i + 2}: modelo “${get("modelo")}” não cadastrado.`); return; }
    if (seen.has(`${ip}:${port}`)) { errors.push(`Linha ${i + 2}: endereço e porta duplicados.`); return; }
    seen.add(`${ip}:${port}`);
    devices.push({ id: `import-${i}-${Date.now()}`, name, ip, port, model: model.id, status: model.ready ? "Pendente" : "Revisar modelo", example: false, acsId: get("acs_id") });
  });
  return { devices, errors };
}

export function simulateResults(devices: Device[], models: Model[], groups: Group[], mode: string): RunResult[] {
  return devices.map((d, i) => {
    const m = models.find(m => m.id === d.model), g = groups.find(g => g.id === m?.group);
    const base = { id: d.id, device: d.name, ip: d.ip, model: m?.name || "Não identificado" };
    if (!m?.ready) return { ...base, status: "Revisar modelo", message: "Roteiro incompleto. Nenhuma tentativa simulada." };
    if (!g?.entries.length) return { ...base, status: "Sem credencial", message: "Associe uma lista com credenciais a este modelo." };
    if (i % 7 === 5) return { ...base, status: "Sem acesso", message: "Cenário de exemplo: a interface web não respondeu." };
    const required = i % 3 + 1, allowed = Math.min(g.attempts, g.entries.length);
    if (required > allowed) return { ...base, status: "Falha de login", message: `Cenário de exemplo: ${allowed} tentativa(s), sem correspondência. Pausa de ${g.cooldown}s prevista; sem nova tentativa automática.` };
    const credential = g.entries[required - 1].label;
    if (mode === "validate") return { ...base, status: "Acesso validado", credential, message: `Login simulado na tentativa ${required}. Configuração apenas lida.` };
    if (d.status === "Confirmado no ACS") return { ...base, status: "Já configurado", credential, message: "Cenário de exemplo: valores já correspondem ao ACS. Nenhuma alteração." };
    if (i % 4 === 3) return { ...base, status: "Aguardando ACS", credential, message: "Gravação simulada. A confirmação do ACS ainda está pendente." };
    return { ...base, status: "Confirmado no ACS", credential, message: "Cenário de exemplo: parâmetros gravados e nova comunicação recebida pelo ACS." };
  });
}
