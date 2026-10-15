(function(root){'use strict';
function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return false;const [y,m,d]=s.split('-').map(Number);if(y<1000||y>9999)return false;const t=new Date(Date.UTC(y,m-1,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d;}
function lower(dates,date){let l=0,r=dates.length;while(l<r){const m=(l+r)>>1;if(dates[m]<date)l=m+1;else r=m;}return l;}
function upper(dates,date){let l=0,r=dates.length;while(l<r){const m=(l+r)>>1;if(dates[m]<=date)l=m+1;else r=m;}return l;}
function resolve(dates,from,to){if(!validDate(from)||!validDate(to))return {error:'시작일과 종료일을 올바른 날짜로 입력하세요.'};if(from>to)return {error:'시작일은 종료일보다 늦을 수 없습니다.'};const begin=lower(dates,from),end=upper(dates,to)-1;if(begin>end||begin>=dates.length||end<0)return {error:'선택한 날짜 구간에 관측 데이터가 없습니다. 기존 분석기간을 유지합니다.'};return {begin,end,from,to,actualFrom:dates[begin],actualTo:dates[end],count:end-begin+1,adjusted:dates[begin]!==from||dates[end]!==to};}
function subtractCalendar(date,period){const p=/^(\d+)([MY])$/.exec(period);if(!p||!validDate(date))throw Error('지원하지 않는 빠른 기간입니다.');const [y,m,d]=date.split('-').map(Number),months=Number(p[1])*(p[2]==='Y'?12:1),t=new Date(Date.UTC(y,m-1-months,1)),last=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,0)).getUTCDate();t.setUTCDate(Math.min(d,last));return t.toISOString().slice(0,10);}
function preset(dates,period,endIndex){if(period==='ALL')return {begin:0,end:endIndex};return resolve(dates,subtractCalendar(dates[endIndex],period),dates[endIndex]);}
root.DateRanges={validDate,lower,upper,resolve,subtractCalendar,preset};
})(typeof globalThis!=='undefined'?globalThis:this);
