import { owner, reply, failure, body } from "@/lib/server-store";
import { importResult } from "@/lib/jobs";
export async function POST(r:Request){try{return reply(await importResult(owner(r,true),await body(r)));}catch(e){return failure(e);}}
