// Verify actual runtime exports, including Chromium's PDF printer.
const {app}=require('electron');
app.on('window-all-closed',()=>{});
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,file);
const {documentBytes}=require('../src/main/documents.ts');
const output=path.resolve(__dirname,'../test-results/exports');fs.mkdirSync(output,{recursive:true});
const timer=setTimeout(()=>app.exit(1),60000);
app.whenReady().then(async()=>{try{
 const content='# Weekly report\nThe launch is ready for review.\n\n| Channel | Leads |\n| --- | --- |\n| Search | 42 |\n| Email | 25 |\n\n## Next steps\n- Review the results\n- Schedule the next report';
 for(const format of ['docx','pdf','xlsx']){
  const bytes=await documentBytes(format,'Axon weekly report',content,format==='xlsx'?[{name:'Leads',rows:[['Channel','Leads'],['Search',42],['Email',25],['Total',{formula:'SUM(B2:B3)'}]]}]:undefined);
  assert.ok(bytes.length>500);fs.writeFileSync(path.join(output,`weekly-report.${format}`),bytes);
  if(format==='pdf')assert.equal(bytes.subarray(0,4).toString(),'%PDF');
 }
 console.log('EXPORT DESKTOP PASSED: DOCX, PDF, XLSX');clearTimeout(timer);app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
