'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
require('../src/quant.js');
require('../src/spread-math.js');
require('../src/date-ranges.js');
const {Quant: Q, SpreadMath: S, DateRanges: D} = globalThis;
const close = (a, b, tolerance = 1e-11) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const closeArray = (a,b) => { assert.equal(a.length,b.length); a.forEach((v,i)=> b[i]===null ? assert.equal(v,null) : close(v,b[i])); };

test('sample statistics use n−1; one observation has no sample SD', () => {
  assert.deepEqual(Q.stats([]),{n:0,mean:null,sd:null,min:null,max:null});
  assert.deepEqual(Q.stats([7]),{n:1,mean:7,sd:null,min:7,max:7});
  const s=Q.stats([1,2,3,4,5]); assert.equal(s.n,5); close(s.mean,3); close(s.sd,Math.sqrt(2.5));
  assert.equal(s.min,1); assert.equal(s.max,5); assert.equal(Q.stats([0,0,0]).sd,0);
});

test('finite validation does not coerce missing, strings or infinities to zero',()=>{
  for(const v of [null,undefined,NaN,Infinity,-Infinity,'2']) assert.equal(Q.finite(v),false);
  assert.equal(Q.finite(0),true);
  for(const bad of [null,undefined,NaN,Infinity,'3']) assert.equal(Q.stats([1,2,bad]).n,0);
  assert.equal(Q.stats([1e308,1e308]).mean,null);
});

test('OLS and Pearson agree with hand-derived centered sums and identities',()=>{
  const x=[0,1,2,3], y=[1,2,2,4], f=Q.fit(x,y);
  // Means 1.5, 2.25; Sxx=5, Sxy=4.5, Syy=4.75.
  assert.equal(f.valid,true); close(f.beta,0.9); close(f.alpha,0.9);
  close(f.r,4.5/Math.sqrt(5*4.75)); close(f.sse,0.7); close(f.r2,1-0.7/4.75);
  close(f.r2,f.r*f.r); close(f.rmse,Math.sqrt(0.7/4)); close(f.residualSd,Math.sqrt(0.7/2));
  close(f.residuals.reduce((a,b)=>a+b,0),0); close(f.residuals.reduce((a,v,i)=>a+v*x[i],0),0);
  close(f.sse+f.beta*f.beta*5,4.75); close(f.alpha+f.beta*f.mx,f.my);
});

test('OLS handles insufficient pairs, missing values and constant X/Y explicitly',()=>{
  assert.equal(Q.fit([1,2],[3,4]).valid,false);
  assert.equal(Q.fit([1,2,3],[3,4]).valid,false);
  assert.equal(Q.fit([1,null,3],[3,4,5]).valid,false);
  assert.equal(Q.fit([2,2,2],[1,2,3]).valid,false);
  const f=Q.fit([1,2,3],[5,5,5]); assert.equal(f.valid,true); assert.equal(f.beta,0); assert.equal(f.alpha,5);
  assert.equal(f.r,null); assert.equal(f.r2,null); assert.equal(f.sse,0);
});

test('OLS perfect negative fit, translation and scale invariants',()=>{
  const x=[-3,-1,1,3], y=x.map(v=>4-2*v), f=Q.fit(x,y);
  close(f.beta,-2); close(f.alpha,4); close(f.r,-1); close(f.r2,1); close(f.sse,0);
  const g=Q.fit(x.map(v=>v+100),y.map(v=>v+7)); close(g.beta,f.beta); close(g.r,f.r); close(g.alpha,-2*-100+11);
  const h=Q.fit(x.map(v=>v*3),y.map(v=>v*2)); close(h.beta,f.beta*2/3); close(h.r,f.r);
});

test('transform preserves original row gaps and positive-price return requirements',()=>{
  closeArray(Q.transform([1,2,null,4,0,2],'level','bp'),[1,2,null,4,0,2]);
  closeArray(Q.transform([1,2,null,4,0,2],'auto','bp'),[null,100,null,null,-400,200]);
  closeArray(Q.transform([100,110,null,121,0,-1,2],'pct','pct'),[null,10,null,null,null,null,null]);
  closeArray(Q.transform([1,Math.E,Math.E*Math.E],'log','pct'),[null,100,100]);
  closeArray(Q.transform([3,1,0,-1],'diff','bp'),[null,-2,-1,-1]);
});

test('analysis uses pairwise complete dates for fit and valid Y for summary',()=>{
  const r=Q.analyze([1,2,null,4,5],[2,4,6,null,10],0,4,3);
  assert.deepEqual(r.pairs.map(p=>p.i),[0,1,4]); assert.equal(r.model.n,3); close(r.model.beta,2);
  assert.equal(r.summary.n,4); close(r.summary.mean,5.5);
  assert.deepEqual(r.corr,[null,null,null,null,null]);
  closeArray(r.vol,[null,null,2,null,null]);
});

test('moving analysis has pre-start warmup, original-row windows and no future leakage',()=>{
  const x=[1,2,3,4,5,6], y=[1,2,4,8,16,32];
  const full=Q.analyze(x,y,0,5,3), selected=Q.analyze(x,y,3,4,3);
  closeArray(selected.vol,full.vol.slice(3,5)); closeArray(selected.corr,full.corr.slice(3,5));
  close(selected.vol[0],Math.sqrt(28/3)); close(selected.z[0],(8-14/3)/Math.sqrt(28/3));
  const changed=Q.analyze(x,[1,2,4,8,16,999999],3,4,3); closeArray(changed.vol,selected.vol);
  assert.deepEqual(Q.analyze(x,y,0,1,3).vol,[null,null]);
});

test('spread subtraction uses the requested sign, bp factor, complete pairs and zero policy',()=>{
  const a=[4,0,null,3], b=[3,1,2,null]; closeArray(S.subtract(a,b),[100,-100,null,null]);
  closeArray(S.subtract(b,a),[-100,100,null,null]); closeArray(S.subtract(a,a),[0,0,null,0]);
  closeArray(S.subtract([0.2],[0.1],1),[0.1]); assert.throws(()=>S.subtract([1],[1,2]));
  assert.deepEqual(S.series([[0,3],[2,null],[null,4]],'1',false),[0,2,null]);
  assert.deepEqual(S.series([[0,3],[2,null],[null,4]],'1',true),[null,2,null]);
});

test('maturity recognizes fractional years and months without assuming a credit label',()=>{
  close(S.maturity('한국_3M'),0.25); close(S.maturity('Corp_AA_minus_1.5Y'),1.5);
  close(S.maturity('UST30Y'),30); assert.equal(S.maturity('US_IG_SP'),null);
});

test('benchmark exact and linear matching, partition of unity, no extrapolation',()=>{
  const curve=[{key:'3',years:5},{key:'1',years:2},{key:'2',years:3}];
  assert.deepEqual(S.benchmark(3,curve).legs,[{key:'2',weight:1}]);
  assert.ok(S.benchmark(4,curve).error); const b=S.benchmark(4,curve,'linear');
  assert.equal(b.interpolated,true); close(b.legs.reduce((s,p)=>s+p.weight,0),1);
  assert.deepEqual(b.legs,[{key:'2',weight:0.5},{key:'3',weight:0.5}]);
  closeArray(S.weighted([[2,3,5],[2,null,5],[0,0,5]],b.legs),[4,null,2.5]);
  assert.equal(S.weighted([[2,0,5]],b.legs,true)[0],null);
  assert.ok(S.benchmark(1,curve,'linear').error); assert.ok(S.benchmark(6,curve,'linear').error);
  assert.equal(S.benchmark(4,curve,'manual','2').mismatch,true);
  assert.ok(S.benchmark(4,curve,'manual','99').error);
});

test('spread moving average and volatility use distinct level and difference windows',()=>{
  const levels=[1,2,4,7,11,16], r=S.rolling(levels,3,4,3);
  closeArray(r.mean,[13/3,22/3]); closeArray(r.vol,[1,1]);
  close(r.z[0],(7-13/3)/Math.sqrt(19/3));
  assert.deepEqual(r.changes,[null,1,2,3,4,5]);
  const full=S.rolling(levels,0,5,3); closeArray(r.mean,full.mean.slice(3,5)); closeArray(r.vol,full.vol.slice(3,5));
  assert.equal(full.vol[2],null); close(full.mean[2],7/3);
});

test('spread missing rows are not bridged and constant windows have undefined Z',()=>{
  const r=S.rolling([1,null,4,7,11],0,4,3);
  assert.deepEqual(r.changes,[null,null,null,3,4]); assert.equal(r.mean[3],null); close(r.mean[4],22/3); assert.equal(r.vol[4],null);
  const c=S.rolling([0,0,0,0],0,3,3); assert.equal(c.z[3],null); assert.equal(c.vol[3],0); assert.equal(c.mean[3],0);
  assert.equal(S.change([1,null,4],2),null); assert.equal(S.change([1,null,4],2,2),3);
  assert.equal(S.change([1,2],0),null);
});

test('strict dates reject rollover, leap-century errors, locale syntax and missing dates',()=>{
  for(const s of ['2024-02-29','2000-02-29','2025-12-31','2026-01-01']) assert.equal(D.validDate(s),true,s);
  for(const s of ['2023-02-29','1900-02-29','2024-02-30','2024-13-01','2024-00-01','2024-1-01','2024/01/01','','10000-01-01']) assert.equal(D.validDate(s),false,s);
});

test('inclusive arbitrary date selection adjusts only to observed boundaries',()=>{
  const dates=['2023-12-29','2024-01-02','2024-02-28','2024-02-29','2024-03-04'];
  const r=D.resolve(dates,'2024-01-01','2024-03-03'); assert.deepEqual([r.begin,r.end,r.count],[1,3,3]);
  assert.equal(r.actualFrom,'2024-01-02'); assert.equal(r.actualTo,'2024-02-29'); assert.equal(r.adjusted,true);
  assert.deepEqual([D.resolve(dates,'2024-02-29','2024-02-29').begin,D.resolve(dates,'2024-02-29','2024-02-29').end],[3,3]);
  for(const [a,b] of [['2024-01-02','2024-01-01'],['2024-03-05','2024-03-06'],['2023-01-01','2023-01-02'],['2024-03-01','2024-03-03']]) assert.ok(D.resolve(dates,a,b).error);
  assert.ok(D.resolve([],'2024-01-01','2024-01-02').error);
});

test('calendar presets clamp month/year ends including leap days and year transition',()=>{
  assert.equal(D.subtractCalendar('2024-03-31','1M'),'2024-02-29');
  assert.equal(D.subtractCalendar('2023-03-31','1M'),'2023-02-28');
  assert.equal(D.subtractCalendar('2024-02-29','1Y'),'2023-02-28');
  assert.equal(D.subtractCalendar('2024-01-31','1M'),'2023-12-31');
  assert.equal(D.subtractCalendar('2024-12-31','6M'),'2024-06-30');
  assert.throws(()=>D.subtractCalendar('2024-02-30','1M'));
  assert.throws(()=>D.subtractCalendar('2024-01-01','1W'));
  const ds=['2023-12-29','2024-01-02','2024-02-29','2024-03-01'];
  assert.deepEqual(D.preset(ds,'ALL',2),{begin:0,end:2}); const p=D.preset(ds,'1M',2); assert.equal(p.begin,2);assert.equal(p.end,2);
});
