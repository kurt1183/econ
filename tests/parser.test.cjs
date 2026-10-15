'use strict';
// All workbook fixtures below are synthetic and contain no original market data.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
global.JSZip=require('../src/jszip.min.js');
require('../src/excel-import.js');
const {parse,dateValue,numberValue,colName}=global.ExcelImport;
const xmlEscape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const refs=[{key:'1',index:1,category:'RATE',id:'RATE_A',field:'Yield',unit:'%',mode:'bp',label:'Rate A'},{key:'2',index:2,category:'FX',id:'FX_B',field:'Spot',unit:'KRW',mode:'abs',label:'FX B'}];
const defaultColumns=[{category:'FX',id:'FX_B',field:'Spot'}, {category:'RATE',id:'RATE_A',field:'Yield'}, {category:'EXTRA',id:'EXTRA_C',field:'Value'}];
function cell(ref,value){
 if(value===null||value===undefined)return '';
 if(typeof value==='object'){const t=value.type?' t="'+xmlEscape(value.type)+'"':'';return '<c r="'+ref+'"'+t+'>'+(value.formula!==undefined?'<f>'+xmlEscape(value.formula)+'</f>':'')+(value.value!==undefined?'<v>'+xmlEscape(value.value)+'</v>':'')+'</c>';}
 if(typeof value==='number')return '<c r="'+ref+'"><v>'+value+'</v></c>';
 return '<c r="'+ref+'" t="inlineStr"><is><t>'+xmlEscape(value)+'</t></is></c>';
}
async function fixture({columns=defaultColumns,rows=[['2024-01-03',1300,4.2,9],['2024-01-02',1290,0,null]],date1904=false,alterHeaders={}}={}){
 const zip=new global.JSZip();zip.file('xl/workbook.xml','<workbook xmlns:r="urn:rel"><workbookPr date1904="'+(date1904?'1':'0')+'"/><sheets><sheet name="AFOSHEET" state="hidden" r:id="rId1"/><sheet name="DailyRate" r:id="rId2"/></sheets></workbook>');
 zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>');
 zip.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row r="10"><c r="A10" t="inlineStr"><is><t>hidden content must not be imported</t></is></c></row></sheetData></worksheet>');
 const headers={4:['End Date','2024-04-30',...columns.slice(1).map(()=>null)],5:['Category',...columns.map(c=>c.category)],6:['Ticker',...columns.map(c=>c.id)],7:['Notation',...columns.map(c=>c.id)],8:['DATES',...columns.map(c=>c.id)],9:['Field',...columns.map(c=>c.field)]};
 columns.forEach((c,i)=>{if(c.unit)headers[4][i+1]='단위:'+c.unit;});Object.assign(headers,alterHeaders);
 let xml='<worksheet><sheetData>';for(const [n,row] of Object.entries(headers))xml+='<row r="'+n+'">'+row.map((v,c)=>cell(colName(c)+n,v)).join('')+'</row>';
 rows.forEach((row,i)=>{const n=i+10;xml+='<row r="'+n+'">'+row.map((v,c)=>cell(colName(c)+n,v)).join('')+'</row>';});xml+='</sheetData></worksheet>';zip.file('xl/worksheets/sheet2.xml',xml);return zip.generateAsync({type:'nodebuffer'});
}
test('reorders original identities, appends every extra column, sorts dates, preserves zeros and nulls',async()=>{
 const data=await parse(await fixture(),refs);
 assert.deepEqual(data.dates,['2024-01-02','2024-01-03']);assert.deepEqual(data.sourceRows,[11,10]);
 assert.deepEqual(data.values,[[0,1290,null],[4.2,1300,9]]);assert.deepEqual(data.meta.map(m=>m.key),['1','2','3']);
 assert.deepEqual(data.meta.map(m=>m.column),['C','B','D']);assert.equal(data.meta[2].unit,'원자료');assert.equal(data.meta[2].mode,'abs');assert.equal(data.meta[0].zero_count,1);assert.equal(data.diagnostics.counts.extraCols,1);assert.equal(data.diagnostics.sortedRows,true);
});
test('numeric strings use strict decimal rules; errors, nonnumeric values and uncached formulas become diagnosed nulls',async()=>{
 const data=await parse(await fixture({rows:[['2024-01-02',' +1.3e3 ','4.2bad',{type:'e',value:'#N/A'}],['2024-01-03',1300,{formula:'1+2'},'1,000'],['2024-01-04',1300,{formula:'1+2',value:3},0],['2024-01-05',1300,{type:'b',value:'1'},{type:'e',formula:'1/0',value:'#DIV/0!'}]]}),refs);
 assert.deepEqual(data.values,[[null,1300,null],[null,1300,null],[3,1300,0],[null,1300,null]]);
 assert.equal(data.diagnostics.counts.numericStrings,1);assert.equal(data.diagnostics.counts.invalidNumbers,3);assert.equal(data.diagnostics.counts.errorCells,2);assert.equal(data.diagnostics.counts.formulaMissingCache,1);assert.equal(data.diagnostics.counts.formulaErrorCaches,1);assert.equal(data.diagnostics.samples.invalidNumbers[0].cell,'C10');assert.equal(data.diagnostics.samples.formulaMissingCache[0].cell,'C11');
});
test('extra units are explicit only and duplicate ids are disambiguated by field',async()=>{
 const columns=[...defaultColumns.slice(0,2),{category:'OTHER',id:'NEW',field:'A',unit:'억원'},{category:'OTHER',id:'NEW',field:'B'}];
 const data=await parse(await fixture({columns,rows:[['2024-01-02',1300,4,1,2]]}),refs);
 assert.deepEqual(data.meta.slice(2).map(m=>[m.label,m.unit,m.mode]),[['NEW · A','억원','abs'],['NEW · B','원자료','abs']]);
});
test('invalid dates are aggregated, sampled and reject the whole upload',async()=>{
 const rows=Array.from({length:12},(_,i)=>['2024-01-02 garbage '+i,1300,4,2]);
 await assert.rejects(parse(await fixture({rows}),refs),e=>e.diagnostics?.counts.invalidDates===12&&e.diagnostics.samples.invalidDates.length===8&&e.diagnostics.samples.invalidDates[0].cell==='A10');
});
test('duplicate dates are rejected without averaging or keeping arbitrary rows',async()=>{
 await assert.rejects(parse(await fixture({rows:[['2024-01-02',1300,4,2],['2024-01-02',1301,5,3]]}),refs),e=>e.diagnostics?.counts.duplicateDates===1);
});
test('duplicate or incomplete metadata and required-column removal reject the upload',async()=>{
 await assert.rejects(parse(await fixture({columns:[...defaultColumns.slice(0,2),defaultColumns[1]]}),refs),/지표 정의가 누락되거나 중복/);
 await assert.rejects(parse(await fixture({columns:[...defaultColumns.slice(0,2),{category:'EXTRA',id:'EXTRA_C',field:''}]}),refs),/지표 정의가 누락되거나 중복/);
 await assert.rejects(parse(await fixture({columns:[defaultColumns[0],{category:'RATE',id:'RENAMED',field:'Yield'},defaultColumns[2]]}),refs),/필수 지표 1개/);
});
test('reference unit changes reject the upload',async()=>{
 const columns=defaultColumns.map(c=>({...c,unit:c.id==='RATE_A'?'bp':undefined}));await assert.rejects(parse(await fixture({columns}),refs),/단위가 기존 %와 다릅니다/);
});
test('date and number boundary cases are strict and deterministic',()=>{
 assert.equal(dateValue(1,false),'1900-01-01');assert.equal(dateValue(59,false),'1900-02-28');assert.equal(dateValue(60,false),null);assert.equal(dateValue(61,false),'1900-03-01');assert.equal(dateValue(0,true),'1904-01-01');
 assert.equal(dateValue('2024-02-29'),'2024-02-29');assert.equal(dateValue('2023-02-29'),null);assert.equal(dateValue('2024-01-01T23:59:59.123Z'),'2024-01-01');
 for(const value of ['2024-01-01Tgarbage','2024-01-01 junk','2024-01-01T24:00:00','2024-01/01','20240101x'])assert.equal(dateValue(value),null);
 for(const value of ['1,000','4.2abc','Infinity','NaN','0x10','1%','',true])assert.equal(numberValue(value),null);
 assert.equal(numberValue(' +1.25e2 '),125);assert.equal(numberValue('-.5'),-.5);assert.equal(numberValue('0'),0);
});
test('all original 260 reference keys remain stable, with extras starting at 261',async()=>{
 const original=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/reference-meta.json'),'utf8'));
 const columns=[...original.map(m=>({category:m.category,id:m.id,field:m.field})),{category:'TEST_ONLY',id:'EXTRA_SYNTHETIC',field:'Value'}];
 const data=await parse(await fixture({columns,rows:[['2024-01-02',...columns.map((_,i)=>i)]]}),original);
 assert.equal(data.meta.length,261);assert.equal(data.meta[260].key,'261');assert.equal(data.meta[260].index,261);assert.deepEqual(data.meta.slice(0,260).map(m=>[m.key,m.index]),original.map(m=>[m.key,m.index]));
});
