/* Local-only OOXML reader for the data_info / DailyRate layout. No formula execution. */
(function(root){
'use strict';
const decode=s=>String(s??'').replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(_,h,d,n)=>h?String.fromCodePoint(parseInt(h,16)):d?String.fromCodePoint(+d):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[n.toLowerCase()]));
function attrs(s){const o={};for(const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))o[m[1]]=decode(m[2]??m[3]);return o;}
const colIndex=s=>[...s.toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
const colName=n=>{let s='';for(n++;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
function textRuns(xml){return [...xml.replace(/<(?:\w+:)?rPh\b[^>]*>[\s\S]*?<\/(?:\w+:)?rPh>/g,'').matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m=>decode(m[1])).join('');}
const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function numberValue(v){if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v!=='string'||!decimal.test(v.trim()))return null;const n=Number(v.trim());return Number.isFinite(n)?n:null;}
function dateValue(v,date1904){
 if(typeof v==='number'&&Number.isFinite(v)){
  let days=Math.floor(v);if(days<(date1904?0:1)||days>150000||(!date1904&&days===60))return null;
  const base=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,31);if(!date1904&&days>60)days--;
  return new Date(base+days*86400000).toISOString().slice(0,10);
 }
 if(typeof v!=='string')return null;
 const s=v.trim();let m=s.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/),parts;
 if(m)parts=[+m[1],+m[3],+m[4]];
 else if((m=s.match(/^(\d{4})(\d{2})(\d{2})$/)))parts=m.slice(1).map(Number);
 else if((m=s.match(/^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?Z?$/)))parts=m.slice(1,4).map(Number);
 if(!parts||parts[0]<1)return null;
 const [year,month,day]=parts,t=new Date(0);t.setUTCFullYear(year,month-1,day);t.setUTCHours(0,0,0,0);
 if(t.getUTCFullYear()!==year||t.getUTCMonth()!==month-1||t.getUTCDate()!==day)return null;
 return t.toISOString().slice(0,10);
}
const norm=s=>String(s??'').trim().replace(/\s+/g,' ').toUpperCase();
const identity=(category,id,field)=>[category,id,field].map(norm).join('\u001f');
const delay=()=>new Promise(resolve=>setTimeout(resolve,0));
const present=v=>v!==null&&v!==undefined&&!(typeof v==='string'&&v.trim()==='');
function diagnosticState(){return {sheet:'DailyRate',dataStartRow:10,sampleLimit:8,counts:{numericValues:0,missingValues:0,zeroValues:0,numericStrings:0,invalidNumbers:0,invalidDates:0,errorCells:0,formulaMissingCache:0,formulaErrorCaches:0,formulasWithCachedValue:0,blankRows:0,duplicateDates:0,invalidMetadata:0,extraCols:0},samples:{},policies:{
 dates:'Excel 1900/1904 일련번호(1900-02-29 제외), YYYY-MM-DD·YYYY/MM/DD·YYYY.MM.DD·YYYYMMDD 및 엄격한 ISO 일시를 허용합니다. 일시의 시각은 버리고 원문 달력 날짜를 사용합니다. 잘못된 날짜·중복 날짜는 전체 업로드를 거부합니다.',
 numbers:'앞뒤 공백을 제거한 부호·소수·지수 표기 숫자 문자열만 변환합니다. 쉼표·통화·% 기호·불리언·무한대·임의 문자는 숫자로 변환하지 않고 결측 처리합니다.',
 missing:'빈 셀·잘못된 수치·Excel 오류·계산 캐시가 없는 수식은 null입니다. 0은 유효한 원값으로 보존하며 보간·전방채움·중복 평균을 하지 않습니다.',
 formulas:'수식은 실행하지 않고 저장된 계산 결과만 읽습니다. 업로드 전에 원본 데이터 공급 도구 또는 Excel에서 갱신·재계산·저장해야 합니다.',
 metadata:'5행 Category, 8행 DATES, 9행 field의 복합키로 연결합니다. 기존 지표의 key/index를 유지하고 추가 열을 원본 순서로 붙입니다. 추가 열의 단위는 4행 단위: 명시값만 사용하며 미명시는 원자료입니다.',
 sheets:'DailyRate만 읽으며 숨김 시트·메모·작성자·연결정보는 가져오지 않습니다.'}};}
async function parse(buffer,reference,onProgress=()=>{}){
 if(!root.JSZip)throw new Error('엑셀 읽기 모듈을 찾을 수 없습니다.');
 if(!Array.isArray(reference))throw new Error('기준 지표 정의가 없습니다.');
 const diagnostics=diagnosticState();
 function issue(type,row,column,value){diagnostics.counts[type]=(diagnostics.counts[type]||0)+1;const list=diagnostics.samples[type]||(diagnostics.samples[type]=[]);if(list.length<diagnostics.sampleLimit)list.push({row,column:colName(column),cell:colName(column)+row,value:String(value??'').slice(0,100)});}
 function fail(message){const error=new Error(message);error.diagnostics=diagnostics;throw error;}
 onProgress('엑셀 압축을 여는 중…');
 let zip;try{zip=await root.JSZip.loadAsync(buffer);}catch(e){fail('파일을 읽을 수 없습니다. 암호가 없는 .xlsx 파일인지 확인하세요.');}
 const maxPart=180*1024*1024;
 async function read(path,required=true){const entry=zip.file(path);if(!entry){if(required)fail('엑셀 구조를 찾을 수 없습니다: '+path);return '';}
  if(entry._data?.uncompressedSize>maxPart)fail('엑셀 시트가 너무 큽니다. 한 시트의 압축 해제 크기는 180MB 이하여야 합니다.');
  const out=await entry.async('string');if(out.length>maxPart)fail('엑셀 시트가 너무 큽니다.');if(/<!DOCTYPE|<!ENTITY/i.test(out))fail('지원하지 않는 XML 선언이 포함된 파일입니다.');return out;
 }
 const workbook=await read('xl/workbook.xml'),rels=await read('xl/_rels/workbook.xml.rels');let sheet;
 for(const m of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?\s*>/g)){const a=attrs(m[1]);if(a.name==='DailyRate'){if(sheet)fail('DailyRate 시트 정의가 중복됩니다.');sheet=a;}}
 if(!sheet)fail('DailyRate 시트가 없습니다. data_info.xlsx와 같은 구조의 파일을 선택하세요.');
 let target;
 for(const m of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?\s*>/g)){const a=attrs(m[1]);if(a.Id===sheet['r:id']){if(a.TargetMode==='External')fail('외부 시트 참조는 지원하지 않습니다.');target=a.Target;}}
 if(!target)fail('DailyRate 시트 참조를 찾을 수 없습니다.');
 const path=target.startsWith('/')?target.slice(1):'xl/'+target,parts=[];
 for(const part of path.split('/')){if(part==='..'){if(!parts.length)fail('잘못된 시트 경로입니다.');parts.pop();}else if(part&&part!=='.')parts.push(part);}
 const sheetPath=parts.join('/'),wp=workbook.match(/<(?:\w+:)?workbookPr\b([^>]*)\/?\s*>/),date1904=!!(wp&&['1','true'].includes(attrs(wp[1]).date1904));diagnostics.dateSystem=date1904?'1904':'1900';
 let sharedXml=await read('xl/sharedStrings.xml',false),shared=[];
 for(const m of sharedXml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g))shared.push(textRuns(m[1]));sharedXml='';
 onProgress('DailyRate 데이터와 열 정보를 읽는 중…');
 const xml=await read(sheetPath),header={},observations=[],dataColumns=new Set(),seenRows=new Set();let rowCount=0;
 for(const rm of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)){
  const ra=attrs(rm[1]),rnum=+(ra.r||rowCount+1),cells=[],seenCells=new Set();let active=false;rowCount++;
  if(!Number.isInteger(rnum)||rnum<1||seenRows.has(rnum))fail('행 번호가 없거나 중복된 엑셀은 지원하지 않습니다.');seenRows.add(rnum);
  for(const cm of (rm[2]||'').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)){
   const ca=attrs(cm[1]),ref=ca.r?.match(/^([A-Za-z]+)(\d+)$/);if(!ref||+ref[2]!==rnum)fail('셀 좌표와 행 번호가 일치하지 않습니다.');
   const ci=colIndex(ref[1]);if(ci>2000)fail('열이 2,001개를 넘는 시트는 지원하지 않습니다.');if(seenCells.has(ci))fail(`${ca.r} 셀 정의가 중복됩니다.`);seenCells.add(ci);
   const body=cm[2]||'',vm=body.match(/<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/),raw=vm?decode(vm[1]):null,formula=/<(?:\w+:)?f\b/.test(body);let v=null;
   if(ca.t==='s'){if(raw!==null){if(!/^\d+$/.test(raw)||shared[+raw]===undefined)fail('공유 문자열 참조가 손상되었습니다.');v=shared[+raw];}}
   else if(ca.t==='inlineStr')v=textRuns(body);
   else if(ca.t==='str'||ca.t==='d')v=raw;
   else if(ca.t==='e'){issue('errorCells',rnum,ci,raw);if(formula)issue('formulaErrorCaches',rnum,ci,raw);}
   else if(ca.t==='b')v=raw==='1';
   else if(ca.t===undefined||ca.t==='n'){if(present(raw)){v=numberValue(raw);if(v===null)issue('invalidNumbers',rnum,ci,raw);}}
   else if(present(raw))issue('invalidNumbers',rnum,ci,raw);
   if(formula){if(!present(raw)&&!present(v)){issue('formulaMissingCache',rnum,ci,'계산 결과 없음');v=null;}else diagnostics.counts.formulasWithCachedValue++;}
   const nonempty=present(v)||present(raw)||formula;if(nonempty)active=true;
   if(rnum>=10&&ci>0){
    if(nonempty)dataColumns.add(ci);
    if(typeof v==='string'&&present(v)){const n=numberValue(v);if(n===null)issue('invalidNumbers',rnum,ci,v);else issue('numericStrings',rnum,ci,v);v=n;}
    else if(typeof v==='boolean'){issue('invalidNumbers',rnum,ci,v);v=null;}
   }
   cells[ci]=v;
  }
  if(rnum<=9)header[rnum]=cells;
  else {const date=dateValue(cells[0],date1904);if(date){if(observations.length>=20000)fail('최대 20,000개 날짜행까지 지원합니다.');observations.push({date,cells,sourceRow:rnum});}
   else if(active)issue('invalidDates',rnum,0,cells[0]);else diagnostics.counts.blankRows++;
  }
  if(rowCount%400===0){onProgress(`${rowCount.toLocaleString()}개 행 읽는 중…`);await delay();}
 }
 if(diagnostics.counts.invalidDates)fail(`날짜가 없거나 잘못된 데이터행 ${diagnostics.counts.invalidDates}개가 있습니다. 예: ${diagnostics.samples.invalidDates.map(s=>s.cell).join(', ')}. A열 날짜를 확인하세요.`);
 if(norm(header[5]?.[0])!=='CATEGORY'||norm(header[8]?.[0])!=='DATES')fail('5행 Category, 8행 DATES 메타데이터를 찾지 못했습니다. data_info 형식을 유지해주세요.');
 const found=new Map(),idCounts=new Map(),width=Math.max(...[5,6,7,8,9].map(r=>header[r]?.length||0),...Array.from(dataColumns,c=>c+1));
 for(let c=1;c<width;c++){
  const populated=[5,6,7,8,9].some(r=>present(header[r]?.[c]))||dataColumns.has(c);if(!populated)continue;
  if([5,8,9].some(r=>!present(header[r]?.[c]))){issue('invalidMetadata',8,c,'Category·DATES·field 누락');continue;}
  const k=identity(header[5][c],header[8][c],header[9][c]);
  if(found.has(k)){issue('invalidMetadata',8,c,'중복 복합키');continue;}
  found.set(k,c);const id=norm(header[8][c]);idCounts.set(id,(idCounts.get(id)||0)+1);
 }
 if(diagnostics.counts.invalidMetadata)fail(`지표 정의가 누락되거나 중복된 열 ${diagnostics.counts.invalidMetadata}개가 있습니다. 예: ${diagnostics.samples.invalidMetadata.map(s=>s.column).join(', ')}열. 5·8·9행을 확인하세요.`);
 const referenceIdentities=new Set(),mappings=reference.map(m=>{const k=identity(m.category,m.id,m.field);if(referenceIdentities.has(k))fail('기준 지표 정의의 복합키가 중복됩니다.');referenceIdentities.add(k);return found.get(k);}),missing=reference.filter((_,i)=>mappings[i]===undefined);
 if(missing.length)fail(`필수 지표 ${missing.length}개를 찾지 못했습니다: ${missing.slice(0,5).map(m=>m.id).join(', ')}. Category·DATES·필드(5·8·9행)가 원본과 같은지 확인하세요.`);
 const definitions=reference.map(m=>({...m}));let nextIndex=Math.max(0,...reference.map(m=>Number(m.index)||Number(m.key)||0))+1;
 for(const [k,c] of found){if(referenceIdentities.has(k))continue;const id=String(header[8][c]).trim(),field=String(header[9][c]).trim(),declared=typeof header[4]?.[c]==='string'?header[4][c].match(/^\s*단위\s*:\s*(\S.*?)\s*$/):null;
  definitions.push({index:nextIndex,key:String(nextIndex),category:String(header[5][c]).trim(),id,field,label:id+(idCounts.get(norm(id))>1?' · '+field:''),unit:declared?declared[1]:'원자료',mode:'abs',note:declared?'원본 4행 명시 단위':'추가 계열: 단위 미명시, 원자료 단위 확인 필요',added:true});mappings.push(c);nextIndex++;
 }
 diagnostics.counts.extraCols=definitions.length-reference.length;
 if(!observations.length)fail('10행 이후의 날짜·숫자 데이터를 찾지 못했습니다.');
 const wasSorted=observations.every((o,i)=>i===0||o.date>=observations[i-1].date);observations.sort((a,b)=>a.date.localeCompare(b.date));diagnostics.sortedRows=!wasSorted;
 for(let i=1;i<observations.length;i++)if(observations[i].date===observations[i-1].date)issue('duplicateDates',observations[i].sourceRow,0,observations[i].date);
 if(diagnostics.counts.duplicateDates)fail(`관측일이 중복된 행 ${diagnostics.counts.duplicateDates}개가 있습니다. 예: ${diagnostics.samples.duplicateDates.map(s=>s.value+' ('+s.cell+')').join(', ')}. 날짜당 한 행으로 정리해주세요.`);
 const dates=observations.map(o=>o.date),sourceRows=observations.map(o=>o.sourceRow),counts=definitions.map(()=>0),zeros=definitions.map(()=>0);
 const values=observations.map(o=>mappings.map((c,i)=>{const v=o.cells[c];if(typeof v==='number'&&Number.isFinite(v)){counts[i]++;diagnostics.counts.numericValues++;if(v===0){zeros[i]++;diagnostics.counts.zeroValues++;}return v;}diagnostics.counts.missingValues++;return null;}));
 if(!diagnostics.counts.numericValues)fail('유효한 숫자 데이터가 없습니다. 수식이 있다면 Excel에서 계산 후 저장해주세요.');
 const meta=definitions.map((m,i)=>{const c=mappings[i],declared=typeof header[4]?.[c]==='string'?header[4][c].match(/^\s*단위\s*:\s*(\S.*?)\s*$/):null;
  if(i<reference.length&&declared&&declared[1]!==m.unit)fail(`${m.id}의 단위가 기존 ${m.unit}와 다릅니다. 단위를 맞춘 후 업로드하세요.`);
  return {...m,column:colName(c),ticker:String(header[6]?.[c]??m.ticker??''),notation:String(header[7]?.[c]??m.notation??''),count:counts[i],zero_count:zeros[i],unitSource:declared?'원본 4행':'기존 정의'+(m.added?' 없음':''),unitExplicit:declared?declared[1]:null};
 });
 diagnostics.rows=dates.length;diagnostics.columns=meta.length;
 const warnings={cachedMissing:diagnostics.counts.formulaMissingCache,errors:diagnostics.counts.errorCells,textValues:diagnostics.counts.invalidNumbers,ignoredRows:diagnostics.counts.blankRows,extraCols:diagnostics.counts.extraCols,numericStrings:diagnostics.counts.numericStrings};
 onProgress('데이터 검증 완료');
 return {dates,values,meta,sourceRows,warnings,diagnostics,configuredEnd:dateValue(header[4]?.[1],date1904)};
}
root.ExcelImport={parse,dateValue,numberValue,identity,colIndex,colName};
})(typeof globalThis!=='undefined'?globalThis:this);
