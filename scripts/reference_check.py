#!/usr/bin/env python3
"""Compare JS math against independent NumPy/SciPy calculations from a local XLSX.

No workbook data or results are bundled with the repository. The output directory
must be outside this repository. Requires: openpyxl, numpy, scipy, and Node.js.
Run: python scripts/reference_check.py --workbook /private/data_info.xlsx \
    --output /private/validation

Unit assumptions are inherited from the source dashboard: yield levels are
percentage points; US OAS values are bp. This verifies calculations, not provider
accuracy, instrument equivalence, or independently established economic units.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import math
import subprocess
from pathlib import Path
import numpy as np
import openpyxl
import scipy
from scipy import stats as scipy_stats

REPO = Path(__file__).resolve().parents[1]
ATOL = 1e-8
RTOL = 1e-10
NAMES = ['한국_3Y', '한국_10Y', 'UST2Y', 'UST10Y', 'CORP_AA_MINUS_3Y',
         'US_IG_SP', 'US_HY_SP', '한국_2Y', '한국_2.5Y', '한국_4Y']


def clean(value):
    if isinstance(value, np.ndarray):
        return [clean(x) for x in value.tolist()]
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(x) for x in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return float(value) if math.isfinite(value) else None
    return value


def reference_stats(a):
    a = np.asarray(a, dtype=float)
    if len(a) == 0 or not np.isfinite(a).all():
        return dict(n=0, mean=None, sd=None, min=None, max=None)
    return dict(n=len(a), mean=np.mean(a), sd=np.std(a, ddof=1) if len(a)>1 else None,
                min=np.min(a), max=np.max(a))


def reference_fit(x, y):
    x, y = np.asarray(x), np.asarray(y)
    n = len(x)
    if n < 3 or np.ptp(x) <= max(1e-12, np.finfo(float).eps*8*np.max(np.abs(x))):
        return dict(n=n, valid=False)
    if np.ptp(y) == 0:
        return dict(n=n, valid=True, beta=0.0, alpha=float(y[0]), r=None, r2=None,
                    sse=0.0, rmse=0.0, residualSd=0.0)
    model = scipy_stats.linregress(x, y)
    # SciPy and least-squares are separate formulations, not independent source data.
    design = np.column_stack([np.ones(n), x])
    least_squares = np.linalg.lstsq(design, y, rcond=None)[0]
    if not np.allclose(least_squares, [model.intercept, model.slope], rtol=RTOL, atol=ATOL):
        raise AssertionError('Reference linregress and lstsq disagree')
    residual = y - (model.intercept + model.slope*x)
    sse = np.dot(residual, residual)
    sst = np.dot(y-y.mean(), y-y.mean())
    return dict(n=n, valid=True, mx=x.mean(), my=y.mean(), beta=model.slope,
                alpha=model.intercept, r=scipy_stats.pearsonr(x,y).statistic,
                r2=1-sse/sst, sse=sse, rmse=np.sqrt(sse/n),
                residualSd=np.sqrt(sse/(n-2)))


def reference_analyze(x, y, begin, end, window):
    selected_x, selected_y = x[begin:end+1], y[begin:end+1]
    mask = np.isfinite(selected_x) & np.isfinite(selected_y)
    fit = reference_fit(selected_x[mask], selected_y[mask])
    summary = reference_stats(selected_y[np.isfinite(selected_y)])
    corr, vol, z = [], [], []
    for i in range(begin, end+1):
        if i-window+1 < 0:
            corr.append(None); vol.append(None); z.append(None); continue
        xx, yy = x[i-window+1:i+1], y[i-window+1:i+1]
        sd = np.std(yy, ddof=1) if len(yy)>1 and np.isfinite(yy).all() else np.nan
        vol.append(sd)
        z.append((y[i]-np.mean(yy))/sd if sd>0 else None)
        corr.append(scipy_stats.pearsonr(xx,yy).statistic
                    if window>=3 and np.isfinite(xx).all() and np.isfinite(yy).all()
                    and np.ptp(xx)>1e-12 and np.ptp(yy)>1e-12 else None)
    return dict(model=fit, summary=summary, corr=corr, vol=vol, z=z,
                pairIndices=(np.flatnonzero(mask)+begin).tolist())


def reference_roll(levels, begin, end, window):
    changes = np.concatenate([[np.nan], np.diff(levels)])
    mean, z, vol = [], [], []
    for i in range(begin, end+1):
        if i-window+1 < 0:
            mean.append(None); z.append(None); vol.append(None); continue
        a, d = levels[i-window+1:i+1], changes[i-window+1:i+1]
        if not np.isfinite(a).all():
            mean.append(None); z.append(None)
        else:
            m = np.mean(a); sd = np.std(a,ddof=1) if len(a)>1 else np.nan
            mean.append(m); z.append((levels[i]-m)/sd if sd>0 else None)
        vol.append(np.std(d,ddof=1) if len(d)>1 and np.isfinite(d).all() else None)
    return dict(mean=mean,z=z,vol=vol,changes=changes)


def read_original(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb['DailyRate']
    iterator = ws.iter_rows(values_only=True)
    header_rows = [next(iterator) for _ in range(9)]
    names = header_rows[7]
    locations = {}
    for name in NAMES:
        matches = [i for i,v in enumerate(names) if v==name]
        if len(matches)!=1:
            raise ValueError(f'Expected one exact row-8 identifier {name}; got {len(matches)}')
        locations[name] = matches[0]
    records, invalid_rows, nonnumeric = [], [], []
    for rownum,row in enumerate(iterator,10):
        date = row[0]
        if all(v is None for v in row):
            continue
        if not isinstance(date,(dt.datetime,dt.date)):
            invalid_rows.append(rownum); continue
        vals=[]
        for name in NAMES:
            v=row[locations[name]]
            if v is None:
                vals.append(np.nan)
            elif isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v):
                vals.append(float(v))
            else:
                vals.append(np.nan); nonnumeric.append(dict(row=rownum,identifier=name))
        records.append((date.date().isoformat() if isinstance(date,dt.datetime) else date.isoformat(), vals))
    wb.close()
    if invalid_rows or nonnumeric:
        raise ValueError(f'Unsupported original values: invalid date rows={invalid_rows[:10]}, numeric cells={nonnumeric[:10]}')
    if len({d for d,_ in records}) != len(records):
        raise ValueError('Duplicate source dates: explicit duplicate reconciliation is required before numeric comparison')
    source_sorted = all(records[i][0] < records[i+1][0] for i in range(len(records)-1))
    records.sort(key=lambda r:r[0])
    dates=[d for d,_ in records]
    matrix=np.asarray([v for _,v in records])
    audit={name:dict(excel_column=locations[name]+1,
                    category=header_rows[4][locations[name]],
                    source_field=header_rows[8][locations[name]],
                    finite=int(np.isfinite(matrix[:,i]).sum()),
                    missing=int((~np.isfinite(matrix[:,i])).sum()),
                    zero=int((matrix[:,i]==0).sum())) for i,name in enumerate(NAMES)}
    return dates,matrix,audit,source_sorted


JS = r'''
const fs=require('node:fs'), p=JSON.parse(fs.readFileSync(0,'utf8'));
require(p.repo+'/src/quant.js'); require(p.repo+'/src/spread-math.js'); require(p.repo+'/src/date-ranges.js');
const Q=globalThis.Quant,S=globalThis.SpreadMath,D=globalThis.DateRanges;
const series=Object.fromEntries(p.names.map((n,i)=>[n,S.series(p.rows,String(i+1))]));
const kr=S.subtract(series['한국_10Y'],series['한국_3Y']);
const us=S.subtract(series.UST10Y,series.UST2Y);
const credit=S.subtract(series.CORP_AA_MINUS_3Y,series['한국_3Y']);
const curve=[{key:'1',years:3},{key:'10',years:4},{key:'8',years:2},{key:'9',years:2.5}];
const benchmark=S.benchmark(3.5,curve,'linear');
const interpolated=S.weighted(p.rows,benchmark.legs);
const b=p.begin,e=p.rows.length-1,w=60;
const analyze=(x,y)=>{const a=Q.analyze(x,y,b,e,w);a.pairIndices=a.pairs.map(t=>t.i);delete a.pairs;delete a.model.residuals;return a;};
const output={
  spreads:{kr,us,credit,igOas:series.US_IG_SP,hyOas:series.US_HY_SP,interpolated},
  benchmark,
  models:{level:analyze(series.UST10Y,series['한국_10Y']),
    bp:analyze(Q.transform(series.UST10Y,'bp','bp'),Q.transform(series['한국_10Y'],'bp','bp')),
    spread:analyze(kr,credit),oas:analyze(series.US_IG_SP,series.US_HY_SP)},
  roll:S.rolling(credit,b,e,w),
  ranges:p.rangeCases.map(a=>D.resolve(p.dates,a[0],a[1])),
  transforms:{krBp:Q.transform(series['한국_10Y'],'bp','bp'),
    usPct:Q.transform(series.UST10Y,'pct','pct'),usLog:Q.transform(series.UST10Y,'log','pct')},
  zeroExclude:Object.fromEntries(p.names.map((n,i)=>[n,S.series(p.rows,String(i+1),true)]))
};
process.stdout.write(JSON.stringify(output));
'''


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--workbook',required=True,type=Path)
    ap.add_argument('--output',required=True,type=Path)
    args=ap.parse_args()
    output=args.output.resolve()
    if output==REPO or REPO in output.parents:
        raise SystemExit('Private numerical evidence must be written outside the repository.')
    output.mkdir(parents=True,exist_ok=True)
    dates,matrix,audit,source_sorted=read_original(args.workbook)
    s={name:matrix[:,i] for i,name in enumerate(NAMES)}
    begin=max(0,len(dates)-360)
    range_cases=[['2024-01-01','2024-12-31'],['2024-02-29','2024-02-29'],
                 ['2023-12-30','2024-01-01'],[dates[begin],dates[-1]],
                 ['1900-01-01','1900-01-02'],['2024-03-01','2024-02-28']]
    payload=dict(repo=str(REPO),names=NAMES,rows=matrix,dates=dates,begin=begin,rangeCases=range_cases)
    result=subprocess.run(['node','-e',JS],input=json.dumps(clean(payload)),text=True,capture_output=True,check=True)
    actual=json.loads(result.stdout)
    kr=(s['한국_10Y']-s['한국_3Y'])*100
    us=(s['UST10Y']-s['UST2Y'])*100
    credit=(s['CORP_AA_MINUS_3Y']-s['한국_3Y'])*100
    kbp=np.concatenate([[np.nan],np.diff(s['한국_10Y'])*100])
    ubp=np.concatenate([[np.nan],np.diff(s['UST10Y'])*100])
    p=s['UST10Y']; positive=(p[1:]>0)&(p[:-1]>0)
    pct=np.full(len(p),np.nan); log=np.full(len(p),np.nan)
    pct[1:][positive]=(p[1:][positive]/p[:-1][positive]-1)*100
    log[1:][positive]=np.log(p[1:][positive]/p[:-1][positive])*100
    expected=dict(spreads=dict(kr=kr,us=us,credit=credit,igOas=s['US_IG_SP'],
                  hyOas=s['US_HY_SP'],interpolated=(s['한국_3Y']+s['한국_4Y'])/2),
                  models=dict(level=reference_analyze(s['UST10Y'],s['한국_10Y'],begin,len(dates)-1,60),
                  bp=reference_analyze(ubp,kbp,begin,len(dates)-1,60),
                  spread=reference_analyze(kr,credit,begin,len(dates)-1,60),
                  oas=reference_analyze(s['US_IG_SP'],s['US_HY_SP'],begin,len(dates)-1,60)),
                  roll=reference_roll(credit,begin,len(dates)-1,60),
                  transforms=dict(krBp=kbp,usPct=pct,usLog=log),
                  zeroExclude={name:np.where(s[name]==0,np.nan,s[name]) for name in NAMES})
    expected=clean(expected)
    counters=dict(numeric=0,null=0,exact=0,max_absolute_error=0.0,max_relative_error=0.0)
    failures=[]
    groups={}
    def compare(a,b,path):
        group=path.split('.')[0]; groups.setdefault(group,dict(numeric=0,null=0,exact=0,max_absolute_error=0.0))
        if isinstance(b,dict):
            for key,val in b.items():
                if key not in a: failures.append(path+'.'+key+': missing')
                else: compare(a[key],val,path+'.'+key)
        elif isinstance(b,list):
            if len(a)!=len(b): failures.append(path+': length'); return
            for i,(av,bv) in enumerate(zip(a,b)): compare(av,bv,f'{path}[{i}]')
        elif b is None:
            counters['null']+=1;groups[group]['null']+=1
            if a is not None: failures.append(path+': expected null')
        elif isinstance(b,bool) or isinstance(b,str):
            counters['exact']+=1;groups[group]['exact']+=1
            if a!=b: failures.append(path+': exact mismatch')
        elif isinstance(b,(int,float)):
            counters['numeric']+=1;groups[group]['numeric']+=1
            if a is None or not isinstance(a,(int,float)): failures.append(path+': missing number');return
            error=abs(a-b);relative=error/max(abs(b),1e-300)
            counters['max_absolute_error']=max(counters['max_absolute_error'],error)
            counters['max_relative_error']=max(counters['max_relative_error'],relative)
            groups[group]['max_absolute_error']=max(groups[group]['max_absolute_error'],error)
            if not math.isclose(a,b,rel_tol=RTOL,abs_tol=ATOL): failures.append(f'{path}: absolute error {error:.5g}')
    for name in expected: compare(actual[name],expected[name],name)
    date_checks=[]
    for bounds,a in zip(range_cases,actual['ranges']):
        lo,hi=bounds
        idx=[i for i,d in enumerate(dates) if lo<=d<=hi] if lo<=hi else []
        success=bool(a.get('error')) if not idx else (
            a.get('begin')==idx[0] and a.get('end')==idx[-1] and a.get('count')==len(idx)
            and a.get('actualFrom')==dates[idx[0]] and a.get('actualTo')==dates[idx[-1]])
        date_checks.append(dict(requested=bounds,passed=success,expected_count=len(idx)))
        if not success: failures.append('ranges: '+str(bounds))
    # Independent normal-equation and variance decomposition checks on selected level fit.
    x=s['UST10Y'][begin:];y=s['한국_10Y'][begin:];valid=np.isfinite(x)&np.isfinite(y);x=x[valid];y=y[valid]
    m=actual['models']['level']['model'];res=y-(m['alpha']+m['beta']*x)
    identities=dict(residual_sum=float(np.sum(res)),residual_x_dot=float(np.dot(res,x)),
                    sst_minus_ssr_sse=float(np.sum((y-y.mean())**2)-np.sum((m['alpha']+m['beta']*x-y.mean())**2)-np.sum(res**2)),
                    r2_minus_r_squared=float(m['r2']-m['r']**2))
    if any(abs(v)>ATOL for v in identities.values()): failures.append('OLS identity exceeds absolute tolerance')
    report=dict(status='PASS' if not failures else 'FAIL',timestamp_utc=dt.datetime.now(dt.timezone.utc).isoformat(),
        source_sha256=hashlib.sha256(args.workbook.read_bytes()).hexdigest(),
        module_sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [REPO/'src/quant.js',REPO/'src/spread-math.js',REPO/'src/date-ranges.js']},
        versions=dict(numpy=np.__version__,scipy=scipy.__version__,openpyxl=openpyxl.__version__,node=subprocess.check_output(['node','--version'],text=True).strip()),
        source=dict(sheet='DailyRate',identifier_row=8,data_start_row=10,observations=len(dates),start=dates[0],end=dates[-1],already_sorted=source_sorted,columns=audit),
        analysis=dict(begin=dates[begin],end=dates[-1],rows=len(dates)-begin,window_rows=60,
          warmup='Uses rows before selected start; rolling changes additionally require the predecessor row.',
          missing='Pairwise complete dates for fit, valid Y for summary; strict complete original-row rolling windows; no forward fill.',
          zero='Retained by default; explicit exclusion branch compared independently.',
          units='Source dashboard assumption: yields in percentage points; differences ×100 to bp; OAS retained as bp without subtraction.'),
        tolerance=dict(absolute=ATOL,relative=RTOL),checks=counters,groups=groups,date_checks=date_checks,
        ols_identities=identities,failures=failures,
        limitations=['Source instrument units and provider economic accuracy have not been independently established.',
          'No browser rendering or upload-path verification is performed by this numeric script.',
          'SciPy/lstsq use the same raw source observations; they are independent calculation paths, not independent market data.',
          'Near-constant thresholds follow the documented implementation policy; synthetic tests cover exact constants.'])
    (output/'reference_check_report.json').write_text(json.dumps(clean(report),ensure_ascii=False,indent=2))
    (output/'reference_actual_private.json').write_text(json.dumps(actual,ensure_ascii=False,separators=(',',':')))
    (output/'reference_expected_private.json').write_text(json.dumps(expected,ensure_ascii=False,separators=(',',':')))
    print(json.dumps(dict(status=report['status'],numeric_checks=counters['numeric'],null_checks=counters['null'],date_checks=len(date_checks),failures=len(failures),max_absolute_error=counters['max_absolute_error'],output=str(output)),ensure_ascii=False))
    if failures: raise SystemExit(1)


if __name__=='__main__': main()
