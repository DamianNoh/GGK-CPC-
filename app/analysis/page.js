'use client';
import { useEffect, useMemo, useState } from 'react';

const TARGETS = { '베버리지': 43.3, '헤드셋': 63, '컨테이너': 25.2, 'OAL': 41.9 };
const TOTAL_TARGET = 42;
const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

function findTarget(name) {
  const hit = Object.entries(TARGETS).find(([k]) => name.includes(k));
  return hit ? hit[1] : null;
}
function monthRange(m) {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { start: `${m}-01`, end: `${m}-${String(last).padStart(2, '0')}` };
}
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function defaultMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}
const wd = (s) => WEEKDAYS_KO[new Date(s).getUTCDay()];
const f1 = (v) => (Number(v) || 0).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f0 = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR');
const sum = (arr, k) => arr.reduce((a, d) => a + (d[k] || 0), 0);
const pct = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null);
const sgn = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

// 월 전체 원인 분석 (전월 대비)
function monthReason(curRaw, curDenom, prevRaw, prevDenom, denomLabel, achieved) {
  const r = pct(curRaw, prevRaw);
  const d = pct(curDenom, prevDenom);
  if (r == null || d == null) return { text: '전월 데이터가 없어 비교할 수 없습니다. (신규 항목)', r: null, d: null };
  let cause;
  if (achieved) {
    if (d < -5 && r > -5) cause = `${denomLabel}이 줄어 목표를 달성했습니다.`;
    else if (r > 5 && d < 5) cause = 'CPC 금액이 늘어 목표를 달성했습니다.';
    else if (d < -5 && r > 5) cause = `${denomLabel} 감소와 CPC 금액 증가가 함께 작용했습니다.`;
    else cause = '전월과 비슷한 수준으로 목표를 유지했습니다.';
  } else if (d > 5 && r > -5) cause = `${denomLabel}이 늘어난 것이 주된 원인입니다.`;
  else if (r < -5 && d < 5) cause = 'CPC 금액이 줄어든 것이 주된 원인입니다.';
  else if (d > 5 && r < -5) cause = `${denomLabel} 증가와 CPC 금액 감소가 함께 작용했습니다.`;
  else cause = '전월과 큰 차이가 없어 다른 요인 확인이 필요합니다.';
  return { text: cause, r, d };
}

// 특정 일자의 미달 원인 (월 평균 대비)
function dayReason(raw, denom, avgRaw, avgDenom, denomLabel) {
  if (!denom) return '근무 데이터 없음';
  if (!avgRaw || !avgDenom) return '';
  const r = ((raw - avgRaw) / avgRaw) * 100;
  const d = ((denom - avgDenom) / avgDenom) * 100;
  const rt = `CPC 금액 월평균 대비 ${sgn(r)}`;
  const dt = `${denomLabel} ${sgn(d)}`;
  let cause;
  if (r < -10 && d > -5) cause = 'CPC 금액 감소가 원인';
  else if (d > 10 && r > -5) cause = `${denomLabel} 과다가 원인`;
  else if (r < -10 && d > 10) cause = `CPC 감소 + ${denomLabel} 증가`;
  else cause = '평소와 큰 차이 없음 (전반적 저조)';
  return `${rt}, ${dt} → ${cause}`;
}

export default function MeetingPage() {
  const [month, setMonth] = useState(defaultMonth());
  const [mode, setMode] = useState('hours');
  const [data, setData] = useState(null);
  const [prev, setPrev] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const cur = monthRange(month);
    const pr = monthRange(shiftMonth(month, -1));
    setLoading(true);
    setError('');
    Promise.all([
      fetch(`/api/dashboard?start=${cur.start}&end=${cur.end}&mode=${mode}`).then((r) => r.json()),
      fetch(`/api/dashboard?start=${pr.start}&end=${pr.end}&mode=${mode}`).then((r) => r.json()).catch(() => null)
    ])
      .then(([j, pj]) => {
        if (j.error) throw new Error(j.error);
        setData(j);
        setPrev(pj && !pj.error ? pj : null);
      })
      .catch((e) => setError(e.message || '데이터를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [month, mode]);

  const denomLabel = mode === 'hours' ? '근무시간' : '인원수';

  const report = useMemo(() => {
    if (!data || !data.daily?.length) return null;
    const daily = data.daily;
    const prevDaily = prev?.daily || [];
    const metas = data.series_meta || [];

    const defs = [
      { key: 'total_per_person', raw: 'total_raw', den: 'total_denom', name: '전체 1인당', color: '#334155', target: TOTAL_TARGET, isTotal: true },
      ...metas.map((m, i) => ({
        key: 'p' + (i + 1), raw: 'p' + (i + 1) + '_raw', den: 'p' + (i + 1) + '_denom',
        name: m.name, color: m.color, target: findTarget(m.name)
      }))
    ];

    const cards = defs.map((def) => {
      const vals = daily.map((d) => d[def.key] || 0);
      const actual = vals.reduce((a, b) => a + b, 0) / vals.length;
      const curRaw = sum(daily, def.raw), curDen = sum(daily, def.den);
      const prevRaw = sum(prevDaily, def.raw), prevDen = sum(prevDaily, def.den);
      const active = daily.filter((d) => (d[def.den] || 0) > 0);
      const avgRaw = active.length ? curRaw / active.length : 0;
      const avgDen = active.length ? curDen / active.length : 0;
      const card = { ...def, actual, curRaw, curDen };
      if (def.target != null) {
        card.achieved = actual >= def.target;
        card.diff = actual - def.target;
        card.reason = monthReason(curRaw, curDen, prevRaw, prevDen, denomLabel, card.achieved);
        card.misses = active
          .filter((d) => (d[def.key] || 0) < def.target)
          .map((d) => {
            const v = d[def.key] || 0;
            return {
              date: d.date, value: v, gap: def.target - v, gapPct: ((def.target - v) / def.target) * 100,
              raw: d[def.raw] || 0, den: d[def.den] || 0,
              why: dayReason(d[def.raw] || 0, d[def.den] || 0, avgRaw, avgDen, denomLabel),
              name: def.name, color: def.color
            };
          })
          .sort((a, b) => b.gapPct - a.gapPct);
        card.activeDays = active.length;
      }
      return card;
    });

    const withTarget = cards.filter((c) => c.target != null);
    const achievedCnt = withTarget.filter((c) => c.achieved).length;

    // 최악의 날 TOP 3 (전체 1인당 제외, 워크센터별 격차 %)
    const wcCards = withTarget.filter((c) => !c.isTotal);
    const allMisses = wcCards.flatMap((c) => c.misses || []).sort((a, b) => b.gapPct - a.gapPct);
    const worst = allMisses.slice(0, 3);

    // 전체 1인당 기준 최악의 날
    const totalCard = cards.find((c) => c.isTotal);
    const worstTotal = totalCard?.misses?.[0] || null;

    // 요일별 패턴 (워크센터 x 일자 단위 미달 건수)
    const byWd = WEEKDAYS_KO.map((label, idx) => ({ label, idx, miss: 0, total: 0, gapSum: 0 }));
    wcCards.forEach((c) => {
      daily.forEach((d) => {
        if ((d[c.den] || 0) <= 0) return;
        const w = new Date(d.date).getUTCDay();
        byWd[w].total += 1;
        const v = d[c.key] || 0;
        if (v < c.target) {
          byWd[w].miss += 1;
          byWd[w].gapSum += ((c.target - v) / c.target) * 100;
        }
      });
    });
    const wdWorst = [...byWd].filter((x) => x.total > 0).sort((a, b) => b.miss / b.total - a.miss / a.total)[0];

    return { cards, withTarget, achievedCnt, worst, worstTotal, byWd, wdWorst };
  }, [data, prev, mode]);

  return (
    <div className="mt-wrap">
      <style>{`
        .mt-wrap{max-width:1100px;margin:0 auto;padding:24px 20px 60px;font-family:inherit}
        .mt-head{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px;margin-bottom:14px}
        .mt-head h1{margin:0;font-size:26px}
        .mt-head p{margin:4px 0 0;font-size:13px;color:#767b8a}
        .mt-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:18px}
        .mt-tools input,.mt-tools button{font:inherit;padding:7px 12px;border:1px solid #d5d8e0;border-radius:8px;background:#fff;cursor:pointer}
        .mt-tools button.on{background:#1e293b;color:#fff;border-color:#1e293b}
        .mt-sum{border-radius:14px;padding:18px 22px;margin-bottom:18px;font-size:18px;font-weight:700;line-height:1.5;background:#f1f5f9;border:1px solid #e2e8f0}
        .mt-sum small{display:block;font-size:13px;font-weight:500;color:#475569;margin-top:6px}
        .mt-sec{margin-bottom:22px}
        .mt-sec h2{font-size:17px;margin:0 0 10px}
        .mt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
        .mt-card{border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;background:#fff}
        .mt-card.good{border-left:6px solid #22c55e}
        .mt-card.bad{border-left:6px solid #ef4444}
        .mt-card .nm{font-weight:700;font-size:15px;display:flex;align-items:center;gap:6px}
        .mt-dot{width:10px;height:10px;border-radius:50%;display:inline-block}
        .mt-card .row{display:flex;gap:18px;margin:8px 0;align-items:baseline;flex-wrap:wrap}
        .mt-card .big{font-size:26px;font-weight:800}
        .mt-card .lbl{font-size:12px;color:#767b8a}
        .mt-tag{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700}
        .mt-tag.good{background:#dcfce7;color:#166534}
        .mt-tag.bad{background:#fee2e2;color:#991b1b}
        .mt-note{font-size:13px;line-height:1.55;color:#334155;margin-top:6px}
        .mt-chg{font-size:12.5px;color:#475569}
        .mt-worst{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
        .mt-w{border:1px solid #fecaca;background:#fff7f7;border-radius:12px;padding:14px 16px}
        .mt-w .rk{font-size:12px;font-weight:700;color:#b91c1c}
        .mt-w .dt{font-size:20px;font-weight:800;margin:2px 0}
        .mt-w .ds{font-size:13px;color:#334155;line-height:1.55}
        .mt-wdrow{display:flex;align-items:center;gap:10px;margin:6px 0;font-size:13px}
        .mt-wdrow .l{width:28px;font-weight:700}
        .mt-wdbar{flex:1;height:14px;background:#f1f5f9;border-radius:7px;overflow:hidden}
        .mt-wdbar div{height:100%;background:#f87171}
        .mt-wdrow .v{width:150px;text-align:right;color:#475569}
        .mt-foot{font-size:12px;color:#767b8a;margin-top:18px}
        @media print{.mt-tools{display:none}.mt-wrap{padding:0}.mt-card,.mt-w{break-inside:avoid}}
      `}</style>

      <div className="mt-head">
        <div>
          <h1>CPC 상세 분석</h1>
          <p>{data ? data.range_label : '불러오는 중...'} · {mode === 'hours' ? '근무시간 기준' : '배치 인원수 기준'} · 목표는 하한선(실제 ≥ 목표 = 달성)</p>
        </div>
      </div>

      <div className="mt-tools">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button className={mode === 'hours' ? 'on' : ''} onClick={() => setMode('hours')}>근무시간 기준</button>
        <button className={mode === 'headcount' ? 'on' : ''} onClick={() => setMode('headcount')}>배치 인원수 기준</button>
        <button onClick={() => window.print()}>인쇄 / PDF 저장</button>
        {loading && <span style={{ fontSize: 12.5, color: '#767b8a' }}>불러오는 중...</span>}
      </div>

      {error && <div className="mt-card" style={{ color: '#dc2626' }}>{error}</div>}

      {!error && report && (
        <>
          <div className="mt-sum">
            목표 달성 {report.achievedCnt}/{report.withTarget.length} —{' '}
            {report.withTarget.filter((c) => c.achieved).map((c) => c.name.split(' · ')[1] || c.name).join('·') || '없음'} 달성
            {report.withTarget.some((c) => !c.achieved) && (
              <>, {report.withTarget.filter((c) => !c.achieved).map((c) => c.name.split(' · ')[1] || c.name).join('·')} 미달</>
            )}
            <small>
              {report.worstTotal
                ? `전체 1인당 기준 가장 저조했던 날: ${report.worstTotal.date} (${wd(report.worstTotal.date)}) · ${f1(report.worstTotal.value)} (목표 대비 -${f1(report.worstTotal.gap)})`
                : '전체 1인당 기준 목표 미달일이 없습니다.'}
              {report.wdWorst && report.wdWorst.miss > 0 && ` · 미달이 가장 잦은 요일: ${report.wdWorst.label}요일`}
            </small>
          </div>

          <div className="mt-sec">
            <h2>1. 워크센터별 달성 현황 및 원인</h2>
            <div className="mt-grid">
              {report.withTarget.map((c) => (
                <div key={c.key} className={'mt-card ' + (c.achieved ? 'good' : 'bad')}>
                  <div className="nm"><span className="mt-dot" style={{ background: c.color }} />{c.name}
                    <span className={'mt-tag ' + (c.achieved ? 'good' : 'bad')} style={{ marginLeft: 'auto' }}>
                      {c.achieved ? '달성' : '미달'}
                    </span>
                  </div>
                  <div className="row">
                    <div><div className="lbl">실제 평균</div><div className="big">{f1(c.actual)}</div></div>
                    <div><div className="lbl">목표</div><div className="big" style={{ color: '#64748b' }}>{f1(c.target)}</div></div>
                    <div><div className="lbl">차이</div><div className="big" style={{ color: c.achieved ? '#16a34a' : '#dc2626' }}>{c.diff >= 0 ? '+' : ''}{f1(c.diff)}</div></div>
                  </div>
                  {c.reason.r != null && (
                    <div className="mt-chg">전월 대비 CPC 금액 {sgn(c.reason.r)} · {denomLabel} {sgn(c.reason.d)}</div>
                  )}
                  <div className="mt-note">{c.reason.text}</div>
                  <div className="mt-note" style={{ color: '#767b8a' }}>
                    미달일 {c.misses.length}/{c.activeDays}일 (근무 데이터 있는 날 기준)
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-sec">
            <h2>2. 목표 미달이 가장 컸던 날 TOP 3 (워크센터별, 목표 대비 격차율 기준)</h2>
            {report.worst.length === 0 ? (
              <div className="mt-note">목표 미달일이 없습니다.</div>
            ) : (
              <div className="mt-worst">
                {report.worst.map((w, i) => (
                  <div className="mt-w" key={i}>
                    <div className="rk">#{i + 1} · {w.name}</div>
                    <div className="dt">{w.date} ({wd(w.date)})</div>
                    <div className="ds">
                      실제 {f1(w.value)} / 목표 {f1(w.value + w.gap)} → <b>-{f1(w.gap)} ({w.gapPct.toFixed(1)}% 부족)</b><br />
                      CPC 금액 {f0(w.raw)} · {denomLabel} {f1(w.den)}<br />
                      {w.why}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-sec">
            <h2>3. 요일별 미달 패턴 (워크센터 × 일자 기준)</h2>
            {report.byWd.map((x) => {
              const rate = x.total ? (x.miss / x.total) * 100 : 0;
              return (
                <div className="mt-wdrow" key={x.idx}>
                  <span className="l">{x.label}</span>
                  <div className="mt-wdbar"><div style={{ width: rate.toFixed(0) + '%' }} /></div>
                  <span className="v">{x.total ? `미달 ${x.miss}/${x.total}건 (${rate.toFixed(0)}%)` : '데이터 없음'}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-foot">
            * 실제 평균은 대시보드와 동일하게 일별 값의 평균입니다. 원인 분석은 전월 대비(월 단위), 월 평균 대비(일 단위) 변화율로 자동 계산한 참고용 추정이며, 정확한 원인은 현장 확인이 필요합니다.
          </div>
        </>
      )}
    </div>
  );
}
