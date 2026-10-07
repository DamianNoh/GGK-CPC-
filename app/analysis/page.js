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
const avgOf = (arr, f) => (arr.length ? arr.reduce((a, x) => a + f(x), 0) / arr.length : 0);

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

// 목표를 넘긴 날의 달성 요인 (월 평균 대비)
function winDayReason(raw, denom, avgRaw, avgDenom, denomLabel) {
  if (!avgRaw || !avgDenom) return '';
  const r = ((raw - avgRaw) / avgRaw) * 100;
  const d = ((denom - avgDenom) / avgDenom) * 100;
  let cause;
  if (r > 10 && d < -10) cause = `CPC 증가 + ${denomLabel} 절감이 함께 작용`;
  else if (r > 10 && d < 5) cause = 'CPC 금액 증가가 요인';
  else if (d < -10 && r > -5) cause = `${denomLabel} 절감이 요인`;
  else cause = '평소와 큰 차이 없이 목표 상회';
  return `CPC 금액 월평균 대비 ${sgn(r)}, ${denomLabel} ${sgn(d)} → ${cause}`;
}

// 미달 항목에 대한 데이터 기반 제안 (추정)
function buildSuggestions(c, winners, denomLabel, mode) {
  const out = [];
  const unit = mode === 'hours' ? '시간' : '명';
  if (c.curDen > 0 && c.target > 0) {
    const cut = c.curDen - c.curRaw / c.target;
    const add = c.target * c.curDen - c.curRaw;
    if (cut > 0) {
      out.push(`월 기준 대략 ${denomLabel}을 ${f0(cut)}${unit}(${((cut / c.curDen) * 100).toFixed(1)}%) 줄이거나, CPC 금액을 ${f0(add)} 늘리면 목표에 도달합니다.`);
    }
  }
  const hits = c.rows.filter((x) => x.value >= c.target);
  const miss = c.rows.filter((x) => x.value < c.target);
  if (!hits.length) {
    out.push('목표를 달성한 날이 없어 일자 간 비교가 불가능합니다. 전반적인 인력·물량 수준 조정이 필요합니다.');
  } else if (miss.length) {
    const hDen = avgOf(hits, (x) => x.den), mDen = avgOf(miss, (x) => x.den);
    const hRaw = avgOf(hits, (x) => x.raw), mRaw = avgOf(miss, (x) => x.raw);
    const d = hDen ? ((mDen - hDen) / hDen) * 100 : 0;
    const r = hRaw ? ((mRaw - hRaw) / hRaw) * 100 : 0;
    if (d > 8) {
      out.push(`달성한 ${hits.length}일은 미달일보다 ${denomLabel}이 평균 ${d.toFixed(1)}% 적었습니다 (${f1(hDen)} vs ${f1(mDen)}). 물량 대비 인력·연장근무 조정이 효과적일 수 있습니다.`);
    } else if (r < -8) {
      out.push(`달성한 ${hits.length}일은 미달일보다 CPC 금액이 평균 ${Math.abs(r).toFixed(1)}% 많았습니다 (${f0(hRaw)} vs ${f0(mRaw)}). 물량이 적은 날 인력을 탄력 운영하면 도움이 될 수 있습니다.`);
    } else {
      out.push('달성일과 미달일의 인력·물량 차이가 크지 않습니다. 작업 구성(주요 디스크립션)이나 시간대별 생산성 확인이 필요합니다.');
    }
  }
  if (c.wdc) {
    const worstWd = c.wdc.map((x, i) => ({ ...x, i })).filter((x) => x.total >= 2 && x.miss >= 2 && x.miss / x.total >= 0.6)
      .sort((a, b) => b.miss / b.total - a.miss / a.total)[0];
    if (worstWd) out.push(`${WEEKDAYS_KO[worstWd.i]}요일에 미달이 집중됩니다 (${worstWd.miss}/${worstWd.total}일). 해당 요일의 인력 배치와 물량을 점검해보세요.`);
  }
  const hints = winners
    .map((w) => {
      const wh = w.rows.filter((x) => x.value >= w.target), wm = w.rows.filter((x) => x.value < w.target);
      if (!wh.length || !wm.length) return null;
      const d = ((avgOf(wm, (x) => x.den) - avgOf(wh, (x) => x.den)) / avgOf(wh, (x) => x.den)) * 100;
      return d > 8 ? `${w.name.split(' · ')[1] || w.name}` : null;
    })
    .filter(Boolean);
  if (hints.length) out.push(`달성 센터(${hints.join(', ')})도 ${denomLabel}이 적은 날 목표를 달성하는 패턴이 있어, 같은 방식의 인력 운영을 참고해볼 만합니다.`);
  return out;
}

// 일별 그래프: 목표선 + 달성일(초록) / 미달일(빨강) 표시
function DayChart({ series, target, color, denomLabel }) {
  const W = 1000, H = 300, L = 52, R = 18, T = 18, B = 46;
  const n = series.length;
  const vals = series.filter((s) => s.active).map((s) => s.value);
  const yMax = Math.max(target, ...(vals.length ? vals : [0])) * 1.12 || 1;
  const x = (i) => (n <= 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (1 - v / yMax) * (H - T - B);
  const pts = series.map((s, i) => ({ ...s, i, px: x(i), py: y(s.value) }));
  const act = pts.filter((p) => p.active);
  const path = act.map((p, k) => `${k ? 'L' : 'M'}${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth="1" />
          <text x={L - 8} y={y(t) + 4} fontSize="11" textAnchor="end" fill="#767b8a">{t.toFixed(0)}</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={y(target)} y2={y(target)} stroke="#334155" strokeWidth="1.6" strokeDasharray="6 4" />
      <text x={W - R} y={y(target) - 6} fontSize="12" textAnchor="end" fill="#334155" fontWeight="700">목표 {target.toFixed(1)}</text>
      <path d={path} fill="none" stroke={color || '#64748b'} strokeWidth="2" opacity="0.55" />
      {pts.map((p) => {
        const dow = new Date(p.date).getUTCDay();
        const wkColor = dow === 0 ? '#dc2626' : dow === 6 ? '#2563eb' : '#767b8a';
        return (
          <g key={p.i}>
            <text x={p.px} y={H - 26} fontSize="10.5" textAnchor="middle" fill="#475569">{Number(p.date.slice(8, 10))}</text>
            <text x={p.px} y={H - 12} fontSize="10" textAnchor="middle" fill={wkColor}>{WEEKDAYS_KO[dow]}</text>
            {p.active ? (
              <circle cx={p.px} cy={p.py} r="6" fill={p.value >= target ? '#22c55e' : '#ef4444'} stroke="#fff" strokeWidth="1.5">
                <title>{`${p.date} (${WEEKDAYS_KO[dow]}) · ${p.value.toFixed(1)} · ${p.value >= target ? '목표 달성 +' + (p.value - target).toFixed(1) : '목표 미달 -' + (target - p.value).toFixed(1)}`}</title>
              </circle>
            ) : (
              <text x={p.px} y={y(0) - 4} fontSize="11" textAnchor="middle" fill="#cbd5e1">·<title>{`${p.date} · ${denomLabel} 데이터 없음`}</title></text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function MeetingPage() {
  const [month, setMonth] = useState(defaultMonth());
  const [mode, setMode] = useState('hours');
  const [data, setData] = useState(null);
  const [prev, setPrev] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

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
        const rows = active.map((d) => ({ date: d.date, value: d[def.key] || 0, raw: d[def.raw] || 0, den: d[def.den] || 0 }));
        card.rows = rows;
        card.series = daily.map((d) => ({ date: d.date, value: d[def.key] || 0, active: (d[def.den] || 0) > 0 }));
        card.wins = rows
          .filter((x) => x.value >= def.target)
          .map((x) => ({
            ...x, name: def.name, color: def.color, target: def.target,
            surplus: x.value - def.target, surplusPct: ((x.value - def.target) / def.target) * 100,
            why: winDayReason(x.raw, x.den, avgRaw, avgDen, denomLabel)
          }))
          .sort((a, b) => b.surplusPct - a.surplusPct);
        const wdc = WEEKDAYS_KO.map(() => ({ miss: 0, total: 0 }));
        rows.forEach((x) => {
          const w = new Date(x.date).getUTCDay();
          wdc[w].total += 1;
          if (x.value < def.target) wdc[w].miss += 1;
        });
        card.wdc = wdc;
      }
      return card;
    });

    const withTarget = cards.filter((c) => c.target != null);
    const achievedCnt = withTarget.filter((c) => c.achieved).length;

    const wcCards = withTarget.filter((c) => !c.isTotal);
    const allMisses = wcCards.flatMap((c) => c.misses || []).sort((a, b) => b.gapPct - a.gapPct);
    const worst = allMisses.slice(0, 3);

    const totalCard = cards.find((c) => c.isTotal);
    const worstTotal = totalCard?.misses?.[0] || null;

    const byWd = WEEKDAYS_KO.map((label, idx) => ({ label, idx, miss: 0, hit: 0, total: 0, gapSum: 0 }));
    wcCards.forEach((c) => {
      daily.forEach((d) => {
        if ((d[c.den] || 0) <= 0) return;
        const w = new Date(d.date).getUTCDay();
        byWd[w].total += 1;
        const v = d[c.key] || 0;
        if (v < c.target) {
          byWd[w].miss += 1;
          byWd[w].gapSum += ((c.target - v) / c.target) * 100;
        } else {
          byWd[w].hit += 1;
        }
      });
    });
    const wdWorst = [...byWd].filter((x) => x.total > 0).sort((a, b) => b.miss / b.total - a.miss / a.total)[0];

    const bests = wcCards.flatMap((c) => c.wins || []).sort((a, b) => b.surplusPct - a.surplusPct).slice(0, 3);

    const winners = wcCards.filter((c) => c.achieved);
    withTarget.filter((c) => !c.achieved).forEach((c) => {
      c.suggestions = buildSuggestions(c, winners, denomLabel, mode);
    });

    return { cards, withTarget, achievedCnt, worst, worstTotal, byWd, wdWorst, bests };
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
        .mt-w.mt-b{border-color:#bbf7d0;background:#f3fdf6}
        .mt-w.mt-b .rk{color:#15803d}
        .mt-wdbar{display:flex}
        .mt-sg{margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.6;color:#334155}
        .mt-sg li{margin-bottom:6px}
        .mt-click{cursor:pointer;transition:box-shadow .15s}
        .mt-click:hover{box-shadow:0 2px 10px rgba(0,0,0,.1)}
        .mt-card.sel{outline:2px solid #1e293b}
        .mt-chartbox{border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;background:#fff}
        .mt-close{margin-left:auto;font:inherit;font-size:12px;padding:3px 10px;border:1px solid #d5d8e0;border-radius:6px;background:#fff;cursor:pointer}
        .mt-legend{display:flex;gap:16px;font-size:12px;color:#475569;margin-bottom:6px}
        .mt-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:middle}
        .mt-foot{font-size:12px;color:#767b8a;margin-top:18px}
        @media print{.mt-tools{display:none}.mt-wrap{padding:0}.mt-card,.mt-w{break-inside:avoid}.mt-close{display:none}}
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
            <h2>1. 워크센터별 달성 현황 및 원인 <span style={{ fontSize: 12, fontWeight: 500, color: '#767b8a' }}>(카드를 누르면 일별 그래프가 나옵니다)</span></h2>
            <div className="mt-grid">
              {report.withTarget.map((c) => (
                <div
                  key={c.key}
                  className={'mt-card mt-click ' + (c.achieved ? 'good' : 'bad') + (selected === c.key ? ' sel' : '')}
                  onClick={() => setSelected(selected === c.key ? null : c.key)}
                  title="클릭하면 일별 그래프를 볼 수 있습니다"
                >
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
                  <div className="mt-note"><b>{c.achieved ? '달성 요인: ' : '미달 원인: '}</b>{c.reason.text}</div>
                  <div className="mt-note" style={{ color: '#767b8a' }}>
                    미달일 {c.misses.length}/{c.activeDays}일 (근무 데이터 있는 날 기준)
                  </div>
                </div>
              ))}
            </div>
          </div>

          {(() => {
            const sc = report.withTarget.find((c) => c.key === selected);
            if (!sc) return null;
            const hit = sc.series.filter((s) => s.active && s.value >= sc.target).length;
            const miss = sc.series.filter((s) => s.active && s.value < sc.target).length;
            return (
              <div className="mt-sec mt-chartbox">
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="mt-dot" style={{ background: sc.color }} />
                  {sc.name} 일별 그래프
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#475569' }}>
                    · 달성 {hit}일 / 미달 {miss}일 · 목표 {f1(sc.target)}
                  </span>
                  <button className="mt-close" onClick={() => setSelected(null)}>닫기 ✕</button>
                </h2>
                <div className="mt-legend">
                  <span><i style={{ background: '#22c55e' }} /> 목표 달성일</span>
                  <span><i style={{ background: '#ef4444' }} /> 목표 미달일</span>
                  <span><i style={{ background: '#334155', height: 2, borderRadius: 0 }} /> 목표선</span>
                </div>
                <DayChart series={sc.series} target={sc.target} color={sc.color} denomLabel={denomLabel} />
              </div>
            );
          })()}

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
            <h2>3. 목표를 가장 크게 넘긴 날 TOP 3 (달성 요인)</h2>
            {report.bests.length === 0 ? (
              <div className="mt-note">목표를 달성한 날이 없습니다.</div>
            ) : (
              <div className="mt-worst">
                {report.bests.map((w, i) => (
                  <div className="mt-w mt-b" key={i}>
                    <div className="rk">#{i + 1} · {w.name}</div>
                    <div className="dt">{w.date} ({wd(w.date)})</div>
                    <div className="ds">
                      실제 {f1(w.value)} / 목표 {f1(w.target)} → <b>+{f1(w.surplus)} ({w.surplusPct.toFixed(1)}% 초과)</b><br />
                      CPC 금액 {f0(w.raw)} · {denomLabel} {f1(w.den)}<br />
                      {w.why}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-sec">
            <h2>4. 요일별 달성/미달 패턴 (워크센터 × 일자 기준)</h2>
            {report.byWd.map((x) => {
              const hitRate = x.total ? (x.hit / x.total) * 100 : 0;
              const missRate = x.total ? (x.miss / x.total) * 100 : 0;
              return (
                <div className="mt-wdrow" key={x.idx}>
                  <span className="l">{x.label}</span>
                  <div className="mt-wdbar">
                    <div style={{ width: hitRate.toFixed(0) + '%', background: '#4ade80' }} />
                    <div style={{ width: missRate.toFixed(0) + '%' }} />
                  </div>
                  <span className="v">{x.total ? `달성 ${x.hit} / 미달 ${x.miss}건` : '데이터 없음'}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-sec">
            <h2>5. 미달 항목 개선 제안 (데이터 기반 추정)</h2>
            {report.withTarget.filter((c) => !c.achieved).length === 0 ? (
              <div className="mt-note">미달 항목이 없습니다.</div>
            ) : (
              <div className="mt-grid">
                {report.withTarget.filter((c) => !c.achieved).map((c) => (
                  <div key={c.key} className="mt-card bad">
                    <div className="nm"><span className="mt-dot" style={{ background: c.color }} />{c.name}</div>
                    <ul className="mt-sg">
                      {(c.suggestions || []).map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-foot">
            * 실제 평균은 대시보드와 동일하게 일별 값의 평균입니다. 원인 분석은 전월 대비(월 단위), 월 평균 대비(일 단위) 변화율로 자동 계산한 참고용 추정입니다. 개선 제안은 인력·물량 데이터에서 도출한 추정이며, 실제 작업 방식 변경 등 현장 요인은 데이터에 없으므로 회의에서 보충이 필요합니다.
          </div>
        </>
      )}
    </div>
  );
}
