import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { OFFICE_AGENTS } from '../features/office/data/officeAgents';
import { useOfficeStore } from '../features/office/store/officeStore';
import { Button } from '../ui';
import { SettingsGroup } from './controls';
import type { ScheduledJob } from '../../../shared/scheduledJobs';
import './jobs.css';
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export function JobsSection() {
  const data=useApp(s=>s.data);
  const wakes=!!data?.startWithWindowsAvailable&&data.settings.wakeForJobs!==false;
  const [editing,setEditing]=useState<ScheduledJob|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const timer=setInterval(()=>void useApp.getState().refresh(),5000);return()=>clearInterval(timer);},[]);
  if(!data)return null;
  const jobs=data.settings.scheduledJobs??[];
  const models=data.providers.filter(p=>p.enabled).flatMap(p=>p.models.map(m=>({id:`${p.id}::${m.id}`,label:`${p.name} · ${m.displayName}`})));
  const save=async(next:ScheduledJob[])=>{setBusy(true);setError('');try {await window.axon.settingsSave({...useApp.getState().data!.settings,scheduledJobs:next});await useApp.getState().refresh();setEditing(null);}catch(e){setError(String(e));}finally{setBusy(false);}};
  const add=()=>{const [providerId,...model]=models[0].id.split('::');setEditing({id:crypto.randomUUID(),name:'Weekly draft',agentId:'marketing-strategist',providerId,modelId:model.join('::'),prompt:'',days:[1],time:'09:00',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,enabled:false});};
  return <SettingsGroup title="Recurring work">
    <div className="jobs-info"><p>{wakes?'Axon runs these tasks in the tray. If it is closed when one is due, Windows opens it to do the job, as long as you are signed in to this computer. A time more than 15 minutes late (the computer was off or asleep) is skipped.':'Axon runs these tasks while it is open, including in the tray. Missed times while the app is closed are skipped.'} Files and external actions keep their normal approval checks.</p><Button size="sm" onClick={add} disabled={!models.length||busy}>New recurring job</Button>{error&&<p role="alert">{error}</p>}</div>
    {jobs.map(j=><article className="job-row" key={j.id}><strong>{j.name}</strong><p>{OFFICE_AGENTS.find(a=>a.id===j.agentId)?.name} · {j.days.map(d=>DAYS[d]).join(', ')} at {j.time} ({j.timezone}) · {j.enabled?'Enabled':'Paused'}</p><p>{j.status??'Not run yet'}{j.error?` · ${j.error}`:''}</p><div>
      <Button size="sm" variant="ghost" onClick={()=>setEditing({...j})}>Edit</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={()=>void save(jobs.map(x=>x.id===j.id?{...x,enabled:!x.enabled}:x))}>{j.enabled?'Pause':'Enable'}</Button>
      <Button size="sm" variant="ghost" disabled={j.status==='running'} onClick={()=>void window.axon.jobRun(j.id).then(()=>useApp.getState().refresh()).catch(e=>setError(String(e)))}>Run now</Button>
      {j.conversationId&&<Button size="sm" variant="ghost" onClick={()=>{useOfficeStore.getState().openOverlay(null);useOfficeStore.getState().focusOn({agentId:j.agentId,conversationId:j.conversationId});}}>Open result</Button>}
      <Button size="sm" variant="ghost" disabled={busy||j.status==='running'} onClick={()=>void save(jobs.filter(x=>x.id!==j.id))}>Delete</Button>
    </div></article>)}
    {editing&&<form className="job-editor" onSubmit={e=>{e.preventDefault();void save([...jobs.filter(j=>j.id!==editing.id),editing]);}}>
      <label>Name<input className="input" value={editing.name} maxLength={100} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
      <label>Coworker<select className="input" value={editing.agentId} onChange={e=>setEditing({...editing,agentId:e.target.value})}>{OFFICE_AGENTS.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
      <label>Model<select className="input" value={`${editing.providerId}::${editing.modelId}`} onChange={e=>{const[p,...m]=e.target.value.split('::');setEditing({...editing,providerId:p,modelId:m.join('::')});}}>{models.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      <label>Task<textarea className="input" rows={4} maxLength={12000} value={editing.prompt} onChange={e=>setEditing({...editing,prompt:e.target.value})}/></label>
      <fieldset><legend>Days</legend>{DAYS.map((d,i)=><label key={d}><input type="checkbox" checked={editing.days.includes(i)} onChange={e=>setEditing({...editing,days:e.target.checked?[...editing.days,i]:editing.days.filter(x=>x!==i)})}/>{d}</label>)}</fieldset>
      <label>Time<input type="time" className="input" value={editing.time} onChange={e=>setEditing({...editing,time:e.target.value})}/></label>
      <label>Timezone<input className="input" value={editing.timezone} onChange={e=>setEditing({...editing,timezone:e.target.value})}/></label>
      <label><input type="checkbox" checked={editing.enabled} onChange={e=>setEditing({...editing,enabled:e.target.checked})}/>Enable this job</label>
      <div><Button size="sm" type="submit" disabled={busy||!editing.prompt.trim()||!editing.days.length}>Save job</Button><Button size="sm" variant="ghost" onClick={()=>setEditing(null)}>Cancel</Button></div>
    </form>}
  </SettingsGroup>;
}
