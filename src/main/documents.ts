import { BrowserWindow } from 'electron';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType } from 'docx';
import ExcelJS from 'exceljs';

export type DocumentFormat = 'md' | 'txt' | 'docx' | 'pdf' | 'xlsx';
export interface DocumentSheet { name: string; rows: (string | number | boolean | { formula: string })[][] }
const LOCAL_FUNCTIONS=new Set('SUM AVERAGE MIN MAX IF IFS IFERROR AND OR NOT COUNT COUNTA COUNTBLANK COUNTIF COUNTIFS SUMIF SUMIFS ROUND ROUNDUP ROUNDDOWN ABS MOD INT SQRT POWER MEDIAN STDEV STDEV.S VAR VAR.S CONCAT CONCATENATE LEFT RIGHT MID LEN TRIM UPPER LOWER TEXT DATE YEAR MONTH DAY TODAY NOW VLOOKUP HLOOKUP XLOOKUP INDEX MATCH'.split(' '));
export function checkedSheets(value: unknown): DocumentSheet[] | undefined {
  if(value===undefined)return undefined;
  if(!Array.isArray(value)||value.length>30)throw new Error('A workbook may contain up to 30 sheets.');
  let cells=0;const names=new Set<string>();
  for(const sheet of value) {
    if(!sheet||typeof sheet.name!=='string'||!sheet.name.trim()||/[\\/*?:\[\]\x00-\x1f]|^'|'$/.test(sheet.name)||sheet.name.length>31||names.has(sheet.name.toLowerCase())||!Array.isArray(sheet.rows)||sheet.rows.length>10000)throw new Error('Use unique valid sheet names and up to 10,000 rows.');
    names.add(sheet.name.toLowerCase());
    for(const row of sheet.rows) {
      if(!Array.isArray(row)||row.length>100||(cells+=row.length)>100000)throw new Error('Workbook data is too large.');
      for(const cell of row) {
        if(typeof cell==='string'&&cell.length<=32000||typeof cell==='boolean'||typeof cell==='number'&&Number.isFinite(cell))continue;
        if(!cell||typeof cell!=='object'||typeof cell.formula!=='string'||!cell.formula||cell.formula.length>1000||/[^A-Za-z0-9_$+\-*/^%(),.: "<>=&]|https?:|file:/i.test(cell.formula)||[...cell.formula.matchAll(/\b([A-Z_][A-Z0-9_.]*)\s*\(/gi)].some(m=>!LOCAL_FUNCTIONS.has(m[1].toUpperCase())))throw new Error('Cells must be text, numbers, booleans or a supported local formula.');
      }
    }
  }
  return value as DocumentSheet[];
}
export function sheetPreview(value: unknown): string {
  return (checkedSheets(value)??[]).map(s=>`${s.name}: ${s.rows.length} rows, ${Math.max(0,...s.rows.map(r=>r.length))} columns, ${s.rows.flat().filter(c=>typeof c==='object').length} formulas\n${JSON.stringify(s.rows.slice(0,5)).slice(0,1500)}`).join('\n\n');
}
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '');
type Block = { kind: 'text' | 'heading' | 'bullet' | 'code'; text: string; level?: number } | { kind: 'table'; rows: string[][] };
export function documentBlocks(content: string): Block[] {
  const result: Block[] = [];
  const lines = content.replace(/\r\n/g,'\n').split('\n');
  let code = false;
  for (let i=0; i<lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { code=!code; continue; }
    if (code) { result.push({ kind:'code',text:line }); continue; }
    if (/^\s*\|/.test(line) && /^\s*\|?[ :|-]+\|[ :|-]*$/.test(lines[i+1] ?? '')) {
      const rows = [line]; i++;
      while (/^\s*\|/.test(lines[i+1] ?? '')) rows.push(lines[++i]);
      result.push({kind:'table',rows:rows.map((row)=>row.trim().replace(/^\||\|$/g,'').split('|').map((c)=>plain(c.trim())))}); continue;
    }
    const heading=/^(#{1,6})\s+(.+)$/.exec(line), bullet=/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/.exec(line);
    if (heading) result.push({kind:'heading',level:heading[1].length,text:plain(heading[2])});
    else if(bullet)result.push({kind:'bullet',text:plain(bullet[1])});
    else if(line.trim())result.push({kind:'text',text:plain(line)});
  }
  return result;
}
export function documentHtml(title: string, content: string): string {
  const blocks=documentBlocks(content);
  return `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:11pt Arial,sans-serif;color:#111;line-height:1.5;margin:32px}h1{font-size:22pt}h2{font-size:17pt}h3{font-size:14pt}h1,h2,h3{break-after:avoid;color:#111}p{margin:0 0 8pt;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:12pt 0;font-size:10pt}th,td{border:1px solid #bbb;padding:7px;text-align:left;overflow-wrap:anywhere}th{background:#eef2f7}tr{break-inside:avoid}.code{font:9pt Consolas,monospace;white-space:pre-wrap}.bullet{margin-left:15pt}thead{display:table-header-group}</style><h1>${escape(title)}</h1>`+blocks.map((b)=>b.kind==='table'?`<table><thead><tr>${b.rows[0].map(c=>`<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.slice(1).map(row=>`<tr>${row.map(c=>`<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:b.kind==='heading'?`<h${Math.min(3,b.level!)+1}>${escape(b.text)}</h${Math.min(3,b.level!)+1}>`:`<p class="${b.kind}">${b.kind==='bullet'?'• ':''}${escape(b.text)}</p>`).join('');
}
export async function pdfDocument(title: string, content: string): Promise<Buffer> {
  const win = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,javascript:false}});
  try { await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(documentHtml(title,content))); return await win.webContents.printToPDF({pageSize:'A4',printBackground:true}); }
  finally { win.destroy(); }
}
export async function documentBytes(format: DocumentFormat, title: string, content: string, sheets?: DocumentSheet[]): Promise<Buffer> {
  sheets=checkedSheets(sheets);
  if (!['md','txt','docx','pdf','xlsx'].includes(format) || typeof content!=='string' || content.length>1_000_000) throw new Error('Choose a supported format and content under 1 MB.');
  if(format==='pdf') return pdfDocument(title,content);
  if(format==='md'||format==='txt')return Buffer.from(content,'utf8');
  const blocks=documentBlocks(content);
  if(format==='docx') {
    const children: (Paragraph|Table)[] = [new Paragraph({text:title,heading:HeadingLevel.TITLE})];
    for(const b of blocks) {
      if(b.kind==='table')children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:b.rows.map(row=>new TableRow({children:row.map(c=>new TableCell({children:[new Paragraph(c)]}))}))}));
      else children.push(new Paragraph({children:[new TextRun({text:b.text,...(b.kind==='code'?{font:'Consolas',size:18}:{})})],...(b.kind==='heading'?{heading:b.level===1?HeadingLevel.HEADING_1:HeadingLevel.HEADING_2}:{}),...(b.kind==='bullet'?{bullet:{level:0}}:{})}));
    }
    const doc=new Document({styles:{default:{document:{run:{font:'Arial',size:22,color:'111111'},paragraph:{spacing:{after:120}}},title:{run:{color:'000000',size:44,bold:true}},heading1:{run:{color:'000000',size:32,bold:true}},heading2:{run:{color:'000000',size:26,bold:true}}}},sections:[{children}]});
    return Packer.toBuffer(doc);
  }
  const wb=new ExcelJS.Workbook(); wb.creator='Axon';
  const input = sheets ?? blocks.filter((b): b is Extract<Block,{kind:'table'}>=>b.kind==='table').map((b,i)=>({name:`Table ${i+1}`,rows:b.rows}));
  if(input.length>30)throw new Error('A workbook may contain up to 30 sheets.');
  const actual = input.length?input:[{name:'Report',rows:[[title],...blocks.flatMap(b=>'text' in b?[[b.text]]:[])]}];
  const names=new Set<string>(); let cells=0;
  for(const sheet of actual) {
    if(!sheet || typeof sheet.name!=='string'||!sheet.name.trim()||/[\\/*?:\[\]]/.test(sheet.name)||sheet.name.length>31||names.has(sheet.name.toLowerCase())||!Array.isArray(sheet.rows)||sheet.rows.length>10000)throw new Error('Use unique valid sheet names and up to 10,000 rows.');
    names.add(sheet.name.toLowerCase()); const ws=wb.addWorksheet(sheet.name);
    for(const row of sheet.rows) {
      if(!Array.isArray(row)||row.length>100||(cells+=row.length)>100000)throw new Error('Workbook data is too large.');
      ws.addRow(row.map(cell=>{
        if(typeof cell==='string'||typeof cell==='boolean'||(typeof cell==='number'&&Number.isFinite(cell)))return cell;
        if(cell&&typeof cell==='object'&&typeof cell.formula==='string'&&cell.formula.length<1000&&!/[\[\]]|https?:|file:|WEBSERVICE|HYPERLINK/i.test(cell.formula))return {formula:cell.formula.replace(/^=/,'')};
        throw new Error('Cells must be text, numbers, booleans or a local formula.');
      }));
    }
    ws.views=[{state:'frozen',ySplit:1}]; ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
    ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF233858'}};
    ws.columns.forEach(col=>{col.width=28;col.alignment={wrapText:true,vertical:'top'};});
  }
  wb.calcProperties.fullCalcOnLoad=true;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
