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
const MINUTE=60_000, DAY=86_400_000;
const clocks=new Map<string,Intl.DateTimeFormat>();
/** The wall clock in `timezone` at `at`: date, weekday (0 = Sunday) and HH:MM. */
function wallClock(timezone: string, at: number) {
  let format=clocks.get(timezone);
  if(!format){format=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});clocks.set(timezone,format);}
  const parts=format.formatToParts(new Date(at));
  const get=(type:string)=>parts.find(p=>p.type===type)?.value ?? '';
  return {date:`${get('year')}-${get('month')}-${get('day')}`,weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday')),time:`${get('hour')}:${get('minute')}`};
}
/**
 * The slot to run now, if any. `lateMs` lets a launch by the recurring-work task take a slot that began
 * up to that long ago (Axon starting, or the computer waking just after); the ordinary tick takes only the minute itself.
 */
export function dueSlot(job: ScheduledJob, now: number, lateMs = 0): string | null {
  if(!job.enabled||job.status==='running')return null;
  for(let back=0;back<=lateMs;back+=MINUTE) {
    const clock=wallClock(job.timezone,now-back), slot=`${clock.date} ${job.time}`;
    if(job.days.includes(clock.weekday)&&clock.time===job.time)return job.lastSlot!==slot?slot:null;
  }
  return null;
}
/** The instant of `date` (YYYY-MM-DD) at `time` in `timezone`, or null where that wall time does not exist (a daylight-saving gap). */
function zonedInstant(date: string, time: string, timezone: string): number | null {
  const [y,m,d]=date.split('-').map(Number), [h,min]=time.split(':').map(Number);
  const wall=Date.UTC(y,m-1,d,h,min);
  let at=wall;
  // The zone's offset at a guess, applied twice so a guess on the far side of a change settles.
  for(let i=0;i<2;i++){const c=wallClock(timezone,at);const [cy,cm,cd]=c.date.split('-').map(Number),[ch,cmin]=c.time.split(':').map(Number);at-= Date.UTC(cy,cm-1,cd,ch,cmin)-wall;}
  const check=wallClock(timezone,at);
  return check.date===date&&check.time===time?at:null;
}
/** When the job next runs: its earliest slot from this minute on that has not run yet, or null when paused. */
export function nextJobRun(job: ScheduledJob, now: number): number | null {
  if(!job.enabled)return null;
  const from=Math.floor(now/MINUTE)*MINUTE;
  let best: number | null=null;
  // Nine days cover a full week from any zone, with room for a day that lacks the time.
  for(let d=0;d<9;d++) {
    const clock=wallClock(job.timezone,from+d*DAY);
    const at=zonedInstant(clock.date,job.time,job.timezone);
    if(at===null||at<from||job.lastSlot===`${clock.date} ${job.time}`)continue;
    if(!job.days.includes(wallClock(job.timezone,at).weekday))continue;
    if(best===null||at<best)best=at;
  }
  return best;
}
/** The earliest next run across jobs: when Windows should open Axon, or null when nothing is scheduled. */
export function nextWake(jobs: readonly ScheduledJob[], now: number): number | null {
  return jobs.reduce<number|null>((best,job)=>{const at=nextJobRun(job,now);return at!==null&&(best===null||at<best)?at:best;},null);
}
