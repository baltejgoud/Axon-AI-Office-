const ts=require('typescript'), fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,resolveJsonModule:true}}).outputText,file);
const {test}=require('node:test'),assert=require('node:assert/strict');
const {documentBytes,documentHtml}=require('../src/main/documents.ts');
const {Project}=require('../src/main/project.ts');
const {checkedJobs,dueSlot,nextJobRun,nextWake}=require('../src/shared/scheduledJobs.ts');
const {checkedPreferences,preferenceBlock}=require('../src/shared/coworkerPreferences.ts');
const ExcelJS=require('exceljs'),mammoth=require('mammoth');
test('Word export contains the title, prose and actual table cells',async()=>{
 const bytes=await documentBytes('docx','Weekly report','# Results\nOur launch is ready.\n\n| Owner | Work |\n| --- | --- |\n| Ada | Review |');
 assert.equal(bytes.subarray(0,2).toString(),'PK');const text=(await mammoth.extractRawText({buffer:bytes})).value;
 for(const expected of ['Weekly report','Results','Our launch is ready.','Ada','Review'])assert.ok(text.includes(expected));
});
test('Excel export has real sheets, typed numbers and local formulas; raw text is not evaluated',async()=>{
 const bytes=await documentBytes('xlsx','Budget','',{sheets:[]}.sheets.concat([{name:'Budget',rows:[['Item','Value'],['Cost',25],['Total',{formula:'SUM(B2:B2)'}],['literal','=SUM(9,9)']]}]));
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);const sheet=wb.getWorksheet('Budget');
 assert.equal(sheet.getCell('B2').value,25);assert.equal(sheet.getCell('B3').value.formula,'SUM(B2:B2)');assert.equal(sheet.getCell('B4').value,'=SUM(9,9)');assert.equal(sheet.views[0].ySplit,1);
 await assert.rejects(()=>documentBytes('xlsx','x','',[{name:'Bad',rows:[[{formula:'WEBSERVICE("https://x")'}]]}]),/Cells must/);
});
test('PDF source escapes HTML and uses real tables with repeated headers',()=>{
 const html=documentHtml('A < B','<script>alert(1)</script>\n| Name | Count |\n| --- | --- |\n| A | 2 |');
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('<thead>'));assert.ok(html.includes('A &lt; B'));
});
test('document output stays inside the project and refuses secret names and junctions',async(t)=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'axon-doc-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const p=new Project();await p.choose(root);
 assert.equal(await p.safe('reports/a.docx',true,true),path.join(root,'reports/a.docx'));
 for(const name of ['../out.pdf','.env.docx','.git/x.pdf'])await assert.rejects(()=>p.safe(name,true,true));
 await assert.rejects(()=>p.safe('reports/a.docx',true));
});
const job={id:'j1',name:'Weekly',agentId:'designer',providerId:'p1',modelId:'m1',prompt:'Draft a report',days:[1],time:'09:00',timezone:'Asia/Kolkata',enabled:true};
test('recurring jobs use the selected timezone, weekday and minute, without duplicate runs',()=>{
 const now=Date.parse('2026-10-12T03:30:20Z');assert.equal(dueSlot(job,now),'2026-10-12 09:00');
 assert.equal(dueSlot({...job,lastSlot:'2026-10-12 09:00'},now),null);
 assert.equal(dueSlot({...job,status:'running'},now),null);assert.equal(dueSlot({...job,enabled:false},now),null);
 assert.equal(dueSlot(job,Date.parse('2026-10-13T03:30:20Z')),null);assert.equal(dueSlot(job,now+60000),null);
});
test('a launch by the wake task may catch a slot up to its grace, once, and never one older',()=>{
 const late=Date.parse('2026-10-12T03:42:00Z');// 09:12 in Kolkata
 assert.equal(dueSlot(job,late),null,'the ordinary tick only takes the minute itself');
 assert.equal(dueSlot(job,late,15*60_000),'2026-10-12 09:00');
 assert.equal(dueSlot({...job,lastSlot:'2026-10-12 09:00'},late,15*60_000),null);
 assert.equal(dueSlot(job,Date.parse('2026-10-12T03:46:00Z'),15*60_000),null,'16 minutes late is skipped');
});
test('the next run is the earliest future slot across the week, in the job timezone',()=>{
 // Monday 12 Oct 2026, 08:00 in Kolkata: today's 09:00 is next.
 assert.equal(nextJobRun(job,Date.parse('2026-10-12T02:30:00Z')),Date.parse('2026-10-12T03:30:00Z'));
 // After today's slot ran, the next Monday.
 assert.equal(nextJobRun({...job,lastSlot:'2026-10-12 09:00'},Date.parse('2026-10-12T03:30:20Z')),Date.parse('2026-10-19T03:30:00Z'));
 // During the slot minute, before it is claimed, the slot itself.
 assert.equal(nextJobRun(job,Date.parse('2026-10-12T03:30:40Z')),Date.parse('2026-10-12T03:30:00Z'));
 assert.equal(nextJobRun({...job,enabled:false},Date.parse('2026-10-12T02:30:00Z')),null);
 // New York leaves daylight saving on 1 Nov 2026: 09:00 is 13:00Z before, 14:00Z after.
 const ny={...job,days:[0,1,2,3,4,5,6],timezone:'America/New_York'};
 assert.equal(nextJobRun(ny,Date.parse('2026-10-31T14:00:00Z')),Date.parse('2026-11-01T14:00:00Z'));
 // A time that does not exist that day (the spring-forward gap) moves to the next day that has it.
 const gap={...ny,time:'02:30'};
 assert.equal(nextJobRun(gap,Date.parse('2027-03-14T05:00:00Z')),Date.parse('2027-03-15T06:30:00Z'));
 assert.equal(nextWake([{...job,enabled:false},job,{...job,id:'j2',time:'08:30'}],Date.parse('2026-10-12T02:00:00Z')),Date.parse('2026-10-12T03:00:00Z'));
 assert.equal(nextWake([],Date.now()),null);
});
test('job settings cannot forge completed runs and validate bounded configs',()=>{
 assert.equal(checkedJobs([{...job,status:'completed',lastSlot:'fake'}])[0].status,undefined);
 assert.equal(checkedJobs([job],[{...job,status:'failed',lastSlot:'real'}])[0].lastSlot,'real');
 for(const bad of [{...job,time:'99:00'},{...job,days:[]},{...job,agentId:'fake'},{...job,timezone:'fake'}])assert.throws(()=>checkedJobs([bad]));
});
test('preferences are scoped to real coworkers and retained as quoted user settings',()=>{
 assert.deepEqual(checkedPreferences({designer:' Short posts ', 'backend-developer':''}),{designer:'Short posts'});
 assert.throws(()=>checkedPreferences({unknown:'x'}));assert.throws(()=>checkedPreferences({designer:'x'.repeat(4001)}));
 assert.ok(preferenceBlock('No emojis').includes('current request takes priority'));assert.equal(preferenceBlock(undefined),'');
});
