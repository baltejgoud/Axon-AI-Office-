// Run after npm run build. Real company UI and team execution with an isolated profile and mock model.
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../test-results/company');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = ms => new Promise(r => setTimeout(r, ms));
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const data = JSON.parse(body), system = data.messages.find(m => m.role === 'system')?.content ?? '';
    const tools = (data.tools ?? []).map(t => t.function.name);
    let delta = { content: 'Research and draft delivered for review.' };
    const call = (name, args) => ({ tool_calls: [{ index: 0, id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    if (tools.includes('propose_plan')) delta = call('propose_plan', { summary: 'Research the market, then draft outreach.', assignments: [
      { id: 't1', owner: 'Research Analyst', title: 'Market research', brief: 'Research Sanket audience' },
      { id: 't2', owner: 'Marketing Strategist', title: 'Outreach draft', brief: 'Draft outreach for review', depends_on: ['t1'] }
    ] });
    else if (system.includes('Review whether the assigned business task')) delta = { content: '{"complete":true,"blockers":[]}' };
    else if (system.includes('Your team has finished')) delta = { content: '## Executive summary\nThe research and outreach draft are ready.\n\n## Deliverables\nResearch Analyst: audience research. Marketing Strategist: outreach draft.\n\n## Next actions\nReview the draft before sending.' };
    else if (tools.includes('call_team_meeting') && data.messages.at(-1)?.role === 'user') delta = call('call_team_meeting', { goal: 'Research Sanket audience and draft outreach for review.', attendees: ['Research Analyst', 'Marketing Strategist'] });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
  });
});
const timeout = setTimeout(() => { console.error('COMPANY_TIMEOUT'); app.exit(1); }, 120000);
app.on('browser-window-created', (_, win) => {
  win.show = () => { win.setPosition(-2400, 0); win.showInactive(); };
  win.setContentSize(1400, 900); win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript(code);
    const wait = async (code, label) => { for (let i=0;i<300;i++) { if (await run(code)) return; await pause(100); } throw new Error('Timed out: '+label); };
    try {
      await wait(`!!document.querySelector('.office-company-link')`, 'company entry');
      await run(`window.axon.providerSave({id:'company-mock',name:'Mock',kind:'openai-compatible',baseUrl:'http://127.0.0.1:${server.address().port}/v1',models:[{id:'mock',displayName:'Mock',supportsTools:true}],enabled:true,createdAt:1,hasApiKey:false})`);
      await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
      await wait(`!!document.querySelector('.office-company-link')`, 'reloaded office');
      await run(`document.querySelector('.office-company-link').click()`);
      await wait(`!!document.querySelector('.company-operations')`, 'company panel');
      assert.equal(await run(`document.querySelector('.company-layout input').value`), 'Sanket');
      await run(`(() => {const el=document.querySelector('.company-layout section:nth-child(2) textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Research our audience and draft outreach for review.');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await wait(`document.querySelector('.company-layout section:nth-child(2) select').options.length>1`, 'model');
      await run(`(() => {const el=document.querySelector('.company-layout section:nth-child(2) select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'company-mock::mock');el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await pause(700);
      fs.writeFileSync(path.join(output,'brief.png'), (await win.webContents.capturePage()).toPNG());
      await run(`document.querySelector('.company-primary').click()`);
      await wait(`!!document.querySelector('.team-card.is-planned')`, 'team plan');
      const snapshot = await run(`window.axon.snapshot()`);
      assert.equal(snapshot.workspaces.find(w => w.company).name,'Sanket');
      assert.equal(snapshot.teams.length,1);
      await run(`document.querySelector('.team-card .team-button.primary').click()`);
      await wait(`!!document.querySelector('.team-card.is-done .team-report')`, 'completed report');
      await run(`document.querySelector('.team-report').scrollIntoView({block:'end'})`);
      await pause(700);
      fs.writeFileSync(path.join(output,'report.png'), (await win.webContents.capturePage()).toPNG());
      assert.ok(await run(`document.querySelector('.team-report').textContent.includes('Next actions')`));
      const saved = await run(`window.axon.snapshot()`);
      assert.ok(saved.teams[0].plan.assignments.every(a => a.status === 'done' && saved.conversations.find(c => c.id === a.conversationId).workspaceId === saved.workspaces.find(w => w.company).id));
      console.log('COMPANY_DESKTOP_OK'); clearTimeout(timeout); server.close(); app.exit(0);
    } catch (e) { console.error(e); fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG()); app.exit(1); }
  });
});
app.whenReady().then(() => server.listen(0,'127.0.0.1',() => require('../out/main/index.js')));
