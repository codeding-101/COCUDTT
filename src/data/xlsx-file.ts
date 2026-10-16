import { strToU8, zipSync } from 'fflate';
import { d } from '../domain/decimal.js';

export interface WorkbookCell { value: string; kind: 'text'|'decimal' }
export interface WorkbookSheet { name: string; headers: string[]; rows: WorkbookCell[][]; widths: number[]; freezeColumns?: number; rowSpacing?:'compact' }
export interface WorkbookSnapshot { audience: 'CUSTOMER'|'INTERNAL'; title: string; generatedAt: string; sheets: WorkbookSheet[] }
export const textCell = (value: string): WorkbookCell => ({ value, kind: 'text' });
export const decimalCell = (value: string): WorkbookCell => ({ value, kind: 'decimal' });
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
// Excel interprets _xHHHH_ escapes in strings; protect literal occurrences before encoding controls.
function xml(value: string): string {
  if (value.length > 32767) throw new Error('Excel 单元格超过 32767 字符，请缩短文本');
  return value.replace(/_x[0-9a-fA-F]{4}_/g, m => '_x005F_' + m.slice(1))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, c => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')}_`)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
export function excelDecimal(value: string): { value: string; numeric: boolean } {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error('Excel 金额不是有限十进制数');
  const number = d(value), canonical = number.toFixed();
  const numeric = number.sd() <= 15 && canonical.replace(/^-/, '').split('.')[0]!.length <= 15 && number.decimalPlaces() <= 12 && Number.isFinite(Number(canonical)) && (number.isZero() || Math.abs(Number(canonical)) >= 1e-307);
  return { value: canonical, numeric };
}
function column(index: number): string {
  let name = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
function cellXml(cell: WorkbookCell, reference: string, header = false): string {
  if (cell.kind === 'decimal') {
    const value = excelDecimal(cell.value);
    if (value.numeric) return `<c r="${reference}" s="2"><v>${value.value}</v></c>`;
    return `<c r="${reference}" s="3" t="inlineStr"><is><t xml:space="preserve">${xml(value.value)}</t></is></c>`;
  }
  // Explicit inline strings never become formulas, even when they begin with = + - @.
  return `<c r="${reference}" s="${header ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
}
function physicalRows(sheet: WorkbookSheet): WorkbookCell[][] {
  const rows: WorkbookCell[][] = [];
  for (const source of sheet.rows) {
    const chunks = source.map(cell => cell.kind === 'text' ? (cell.value.match(/[\s\S]{1,240}/gu) ?? ['']) : [cell.value]);
    const count = Math.max(1, ...chunks.map(c => c.length));
    for (let i = 0; i < count; i++) rows.push(source.map((cell, j) => i === 0 ? { ...cell, value: chunks[j]![0]! } : textCell(cell.kind === 'text' ? chunks[j]?.[i] ?? (j===0?'↳ 续行':'') : '')));
  }
  return rows;
}
function sheetXml(sheet: WorkbookSheet): string {
  if(sheet.rowSpacing!==undefined&&sheet.rowSpacing!=='compact')throw Error('Excel 行距版式无效');
  const rows = [sheet.headers.map(textCell), ...physicalRows(sheet)];
  if (rows.length > 100000 || !sheet.headers.length || sheet.headers.length > 64 || sheet.widths.length !== sheet.headers.length || sheet.widths.some(w=>!Number.isFinite(w)||w<8||w>120) || rows.some(r => r.length !== sheet.headers.length)) throw new Error('Excel 表格尺寸或列数无效');
  const y = 1, x = sheet.freezeColumns ?? 0;
  if(!Number.isInteger(x)||x<0||x>=sheet.headers.length)throw new Error('Excel 冻结列无效');
  const widths=[...sheet.widths];
  for(const row of rows)row.forEach((cell,i)=>{if(cell.kind==='decimal'&&excelDecimal(cell.value).numeric){const whole=cell.value.replace(/^-/, '').split('.')[0]!;widths[i]=Math.max(widths[i]!,cell.value.length+Math.floor(whole.length/3)+5);}});
  return XML_HEADER + `<worksheet xmlns="${NS}"><dimension ref="A1:${column(sheet.headers.length-1)}${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="${x}" ySplit="${y}" topLeftCell="${column(x)}2" activePane="${x ? 'bottomRight':'bottomLeft'}" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${widths.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((r,i)=>{
    const lines = Math.max(1,...r.map((c,j)=>c.value.split('\n').reduce((total,line)=>total+Math.max(1,Math.ceil(Array.from(line).reduce((n,ch)=>n+(ch.charCodeAt(0)>255?2:1),0)/(widths[j]!-2))),0)));
    const height = i === 0 ? (sheet.rowSpacing==='compact'?26:32) : Math.min(409,Math.max(sheet.rowSpacing==='compact'?20:24,lines*16+(sheet.rowSpacing==='compact'?4:8)));
    return `<row r="${i+1}" ht="${height}" customHeight="1">${r.map((c,j)=>cellXml(c,column(j)+(i+1),i===0)).join('')}</row>`;
  }).join('')}</sheetData><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

/** Snapshot only: no formulas, external links, comments, macros, hidden sheets or creator metadata. */
export function serializeWorkbook(snapshot: WorkbookSnapshot): Uint8Array<ArrayBuffer> {
  if (!snapshot.sheets.length || snapshot.sheets.length > 16 || new Set(snapshot.sheets.map(s=>s.name)).size !== snapshot.sheets.length || snapshot.sheets.some(s=>!s.name || s.name.length>31 || /[\\/\[\]:*?]/.test(s.name))) throw new Error('Excel 工作表名称无效');
  const files: Record<string,Uint8Array> = {};
  const add = (path:string,value:string) => { files[path] = strToU8(value); };
  add('[Content_Types].xml',XML_HEADER+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${snapshot.sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  add('_rels/.rels',XML_HEADER+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  add('xl/workbook.xml',XML_HEADER+`<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${snapshot.sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
  add('xl/_rels/workbook.xml.rels',XML_HEADER+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${snapshot.sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${snapshot.sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  add('xl/styles.xml',XML_HEADER+`<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00##########;[Red](#,##0.00##########);0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/><color rgb="FF162338"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF244469"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  snapshot.sheets.forEach((sheet,i)=>add(`xl/worksheets/sheet${i+1}.xml`,sheetXml(sheet)));
  return zipSync(files,{level:6,mtime:new Date('2000-01-01T00:00:00Z')});
}
