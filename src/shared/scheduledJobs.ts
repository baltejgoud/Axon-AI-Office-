import { coworkerById } from './coworkers';
export interface ScheduledJob {
  id: string; name: string; agentId: string; providerId: string; modelId: string;
  prompt: string; days: number[]; time: string; timezone: string; enabled: boolean;
  lastSlot?: string; lastRunAt?: number; conversationId?: string; status?: 'running'|'completed'|'failed'|'interrupted'; error?: string;
}
export function checkedJobs(value: unknown, prior: readonly ScheduledJob[] = []): ScheduledJob[] {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>20)throw new Error('Keep up to 20 recurring jobs.');
  const ids=new Set<string>();
  return value.map((j)=>{
    if(!j||typeof j.id!=='string'||j.id.length>80||!j.id||ids.has(j.id)||typeof j.name!=='string'||!j.name.trim()||j.name.length>100||!coworkerById(j.agentId)||typeof j.providerId!=='string'||typeof j.modelId!=='string'||typeof j.prompt!=='string'||!j.prompt.trim()||j.prompt.length>12000||!/^([01]\d|2[0-3]):[0-5]\d$/.test(j.time)||!Array.isArray(j.days)||!j.days.length||j.days.some((d:unknown)=>!Number.isInteger(d)||Number(d)<0||Number(d)>6)||typeof j.timezone!=='string'||j.timezone.length>100)throw new Error('Choose a coworker, model, prompt, days, valid time and timezone for each job.');
    new Intl.DateTimeFormat('en-US',{timeZone:j.timezone}).format(); ids.add(j.id);
    const old=prior.find(p=>p.id===j.id);
    return {id:j.id,name:j.name.trim(),agentId:j.agentId,providerId:j.providerId,modelId:j.modelId,prompt:j.prompt.trim(),days:[...new Set<number>(j.days)],time:j.time,timezone:j.timezone,enabled:j.enabled===true,
      ...(old?{lastSlot:old.lastSlot,lastRunAt:old.lastRunAt,conversationId:old.conversationId,status:old.status,error:old.error}:{})};
  });
}
export function dueSlot(job: ScheduledJob, now: number): string | null {
  if(!job.enabled||job.status==='running')return null;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:job.timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));
  const get=(type:string)=>parts.find(p=>p.type===type)?.value ?? '';
  const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
  const slot=`${get('year')}-${get('month')}-${get('day')} ${job.time}`;
  return job.days.includes(day)&&`${get('hour')}:${get('minute')}`===job.time&&job.lastSlot!==slot?slot:null;
}
