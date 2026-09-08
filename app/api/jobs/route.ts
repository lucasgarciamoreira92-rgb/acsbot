import { owner, reply, failure, body } from "@/lib/server-store";
import { createJob, listJobs } from "@/lib/jobs";
export async function GET(r:Request){try{return reply({jobs:await listJobs(owner(r))});}catch(e){return failure(e);}}
export async function POST(r:Request){try{return reply(await createJob(owner(r,true),await body(r)),201);}catch(e){return failure(e);}}
