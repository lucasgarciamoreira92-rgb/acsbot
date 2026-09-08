import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

test('persistent API, encrypted packages, agent contract and signed result import', async (t) => {
 const temp = await mkdtemp(path.join(tmpdir(),'acs-api-'));
 const db = new DatabaseSync(':memory:');
 db.exec(await readFile('drizzle/0000_uneven_namor.sql','utf8'));
 class Statement {
  constructor(sql,values=[]) {this.sql=sql;this.values=values;}
  bind(...values){return new Statement(this.sql,values);}
  async first(){return db.prepare(this.sql).get(...this.values)||null;}
  async all(){return{results:db.prepare(this.sql).all(...this.values)};}
  async run(){const r=db.prepare(this.sql).run(...this.values);return{meta:{changes:Number(r.changes)}};}
 }
 const database={prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const origin='https://acs.test';
 globalThis.__acsTestEnv={DB:database,VAULT_KEY:Buffer.alloc(32,7).toString('base64'),APP_ORIGIN:origin};
 const shim=path.join(temp,'worker-env.mjs');await writeFile(shim,'export const env=globalThis.__acsTestEnv;');
 await build({entryPoints:{state:'app/api/state/route.ts',jobs:'app/api/jobs/route.ts',results:'app/api/results/route.ts'},outdir:temp,bundle:true,platform:'node',format:'esm',splitting:true,logLevel:'silent',plugins:[{name:'test-environment',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:shim}));}}]});
 const stateAPI=await import(path.join(temp,'state.js'));
 const jobsAPI=await import(path.join(temp,'jobs.js'));
 const resultsAPI=await import(path.join(temp,'results.js'));
 const request=(url,method='GET',body,owner='user-1',requestOrigin=origin)=>new Request(origin+url,{method,headers:{'oai-authenticated-user-id':owner,'origin':requestOrigin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 let current;
 try{
 await t.test('rejects missing identity and wrong origin',async()=>{
  assert.equal((await stateAPI.GET(new Request(origin+'/api/state'))).status,401);
  assert.equal((await stateAPI.PUT(request('/api/state','PUT',{},'user-1','https://other.test'))).status,403);
 });
 await t.test('initial state has no plaintext credential response and is owner-scoped',async()=>{
  current=await (await stateAPI.GET(request('/api/state'))).json();assert.equal(current.revision,1);assert.equal(current.state.models.length,6);assert.equal(current.state.acs.password,'');
  assert.equal((await jobsAPI.POST(request('/api/jobs','POST',{name:'Demo',mode:'validate',deviceIds:['d1']}))).status,400);
 });
 await t.test('stores secrets encrypted, preserves redacted secrets and detects stale revision',async()=>{
  const model={id:'model-lab',brand:'LAB',name:'LAB ROUTER',type:'Roteador',firmware:'1.0',group:'g1',scheme:'http',loginPath:'/',acsPath:'/acs',userSelector:'#user',passwordSelector:'#password',submitSelector:'#login',acsSelector:'#acs',saveSelector:'#save',ready:true,successSelector:'#success',failureSelector:'#failure',lockoutSelector:'#locked',identitySelector:'#model',identityText:'LAB ROUTER',firmwareSelector:'#firmware',serialSelector:'#serial',acsUsernameSelector:'#acs-user',acsPasswordSelector:'#acs-pass',enabledSelector:'#enabled',periodicSelector:'#periodic',intervalSelector:'#interval'};
  current.state.models.push(model);current.state.groups[0].entries.push({id:'cred-1',label:'Test credential',username:'operator',password:'correct-test-password'});
  current.state.devices.push({id:'device-lab',name:'LAB',ip:'127.0.0.1',port:80,model:'model-lab',status:'Pendente'});
  current.state.acs={...current.state.acs,url:'https://acs.test/cwmp',username:'new',password:'ACS-test-secret'};
  assert.equal((await stateAPI.PUT(request('/api/state','PUT',current))).status,200);
  assert.equal((await stateAPI.PUT(request('/api/state','PUT',current))).status,409);
  const raw=db.prepare('SELECT encrypted FROM workspaces WHERE owner=?').get('user-1').encrypted;assert.ok(!raw.includes('correct-test-password'));assert.ok(!raw.includes('ACS-test-secret'));
  current=await(await stateAPI.GET(request('/api/state'))).json();assert.equal(current.state.groups[0].entries[0].password,'');assert.equal(current.state.groups[0].entries[0].hasPassword,true);
  current.state.models.find(m=>m.id==='model-lab').name='LAB ROUTER';assert.equal((await stateAPI.PUT(request('/api/state','PUT',current))).status,200);
  const other=await(await stateAPI.GET(request('/api/state','GET',undefined,'user-2'))).json();assert.ok(!other.state.models.some(m=>m.id==='model-lab'));
 });
 let validationPacket;
 await t.test('requires read-only validation before provisioning and prevents overlapping exports',async()=>{
  assert.equal((await jobsAPI.POST(request('/api/jobs','POST',{name:'Premature',mode:'provision',deviceIds:['device-lab']}))).status,400);
  const r=await jobsAPI.POST(request('/api/jobs','POST',{name:'Validate',mode:'validate',deviceIds:['device-lab']}));assert.equal(r.status,201);validationPacket=await r.json();assert.ok(!JSON.stringify(validationPacket.envelope).includes('correct-test-password'));
  assert.equal((await jobsAPI.POST(request('/api/jobs','POST',{name:'Overlap',mode:'validate',deviceIds:['device-lab']}))).status,409);
 });
 const execute=(packet)=>{const r=spawnSync('python3',['agent/contract_harness.py'],{input:JSON.stringify(packet),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
 await t.test('JS package decrypts in Python; validation report imports with replay protection',async()=>{
  const output=execute(validationPacket);assert.equal(output.saves,0);assert.equal(output.logins,1);
  assert.equal((await resultsAPI.POST(request('/api/results','POST',output.report,'user-2'))).status,404);
  const altered={...output.report,payload:Buffer.from('{}').toString('base64')};assert.equal((await resultsAPI.POST(request('/api/results','POST',altered))).status,400);
  const r=await resultsAPI.POST(request('/api/results','POST',output.report));assert.equal(r.status,200);const data=await r.json();assert.equal(data.state.devices.find(d=>d.id==='device-lab').validation.serial,'LAB-001');
  const repeat=await(await resultsAPI.POST(request('/api/results','POST',output.report))).json();assert.equal(repeat.alreadyImported,true);
 });
 await t.test('provisioning changes the fixture once and imports waiting-for-ACS status without exposing secrets',async()=>{
  const r=await jobsAPI.POST(request('/api/jobs','POST',{name:'Provision',mode:'provision',deviceIds:['device-lab']}));assert.equal(r.status,201);const packet=await r.json();const output=execute(packet);assert.equal(output.saves,1);
  const reportJSON=Buffer.from(output.report.payload,'base64').toString();assert.ok(!reportJSON.includes('correct-test-password'));assert.ok(!reportJSON.includes('ACS-test-secret'));
  const imported=await resultsAPI.POST(request('/api/results','POST',output.report));assert.equal(imported.status,200);const data=await imported.json();assert.equal(data.state.devices.find(d=>d.id==='device-lab').status,'Aguardando ACS');
  const listed=await(await jobsAPI.GET(request('/api/jobs'))).json();assert.equal(listed.jobs.length,2);assert.equal(listed.jobs[0].state,'completed');assert.ok(!JSON.stringify(listed).includes('resultKey'));
 });
 await t.test('changing the profile invalidates the earlier validation',async()=>{
  const state=await(await stateAPI.GET(request('/api/state'))).json();state.state.models.find(m=>m.id==='model-lab').firmware='2.0';assert.equal((await stateAPI.PUT(request('/api/state','PUT',state))).status,200);
  assert.equal((await jobsAPI.POST(request('/api/jobs','POST',{name:'Changed firmware',mode:'provision',deviceIds:['device-lab']}))).status,400);
 });
 }finally{db.close();await rm(temp,{recursive:true,force:true});delete globalThis.__acsTestEnv;}
});
