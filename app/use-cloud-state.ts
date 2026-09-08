"use client";
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { initialModels, initialDevices, initialGroups, initialACS, type Model, type Device, type Group, type ACS } from "./data";
export type PlatformState={models:Model[];devices:Device[];groups:Group[];acs:ACS};
export async function api(path:string,init?:RequestInit){const response=await fetch(path,{...init,headers:{"Content-Type":"application/json",...init?.headers},credentials:"same-origin",cache:"no-store"});let data;try{data=await response.json();}catch{throw new Error("Não foi possível acessar os cadastros. Confira se você está conectado à sua conta.");}if(!response.ok)throw new Error(data.error||"Não foi possível concluir a operação.");return data;}
export function useCloudState(){
 const[state,setState]=useState<PlatformState>({models:initialModels,devices:initialDevices,groups:initialGroups,acs:initialACS});
 const[loaded,setLoaded]=useState(false),[status,setStatus]=useState("Carregando cadastros…"),[error,setError]=useState("");
 const revision=useRef(0),ack=useRef(""),desired=useRef(""),active=useRef<Promise<void>|null>(null),initialized=useRef(false);
 const reload=useCallback(async()=>{try{const data=await api("/api/state");revision.current=data.revision;ack.current=JSON.stringify(data.state);desired.current=ack.current;setState(data.state);initialized.current=true;setLoaded(true);setError("");setStatus("Cadastros salvos");}catch(e){setError(e instanceof Error?e.message:"Não foi possível carregar.");setStatus("Falha ao carregar");}},[]);
 useEffect(()=>{void reload();},[reload]);
 const update=useCallback(<K extends keyof PlatformState>(key:K,value:SetStateAction<PlatformState[K]>)=>{
  setState(s=>{const next={...s,[key]:typeof value==="function"?(value as (p:PlatformState[K])=>PlatformState[K])(s[key]):value};desired.current=JSON.stringify(next);return next;});setStatus("Alterações pendentes");
 },[]);
 const flush=useCallback(async()=>{
  if(active.current)return active.current;
  if(!initialized.current)throw new Error("Aguarde o carregamento dos cadastros.");
  if(desired.current===ack.current)return;
  const task=(async()=>{try{while(desired.current!==ack.current){setStatus("Salvando…");const sent=desired.current;const data=await api("/api/state",{method:"PUT",body:JSON.stringify({state:JSON.parse(sent),revision:revision.current})});revision.current=data.revision;ack.current=sent;}setError("");setStatus("Cadastros salvos");}catch(e){setError(e instanceof Error?e.message:"Falha ao salvar.");setStatus("Não salvo");throw e;}finally{active.current=null;}})();active.current=task;return task;
 },[]);
 useEffect(()=>{if(!loaded||JSON.stringify(state)===ack.current)return;const timer=setTimeout(()=>{void flush().catch(()=>{});},600);return()=>clearTimeout(timer);},[state,loaded,flush]);
 useEffect(()=>{const guard=(e:BeforeUnloadEvent)=>{if(initialized.current&&desired.current!==ack.current){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[]);
 return{state,update,loaded,status,error,flush,reload};
}
