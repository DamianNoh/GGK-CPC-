'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { LineChart, DonutChart, fmt, fmt1 } from './Charts';

function monthRange(monthStr) {
  // monthStr: 'YYYY-MM'
  const [y, m] = monthStr.split('-').map(Number);
  const start = `${monthStr}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${monthStr}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function defaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
function weekdayLabel(dateStr) {
  return WEEKDAYS_KO[new Date(dateStr).getUTCDay()];
}

// 워크센터별 목표 CPC 수치 (근무시간당). 워크센터 이름(라벨)에 포함된 텍스트로 매칭합니다.
// 목표는 하한선입니다 (실제 값이 목표보다 높아야 좋음).
const TARGETS = { '베버리지': 43.3, '헤드셋': 63, '컨테이너': 25.2 };
function findTarget(name) {
  const hit = Object.entries(TARGETS).find(([k]) => name.includes(k));
  return hit ? hit[1] : null;
}

function sumField(arr, field) {
  return arr.reduce((a, d) => a + (d[field] || 0), 0);
}

// 목표 미달 원인을 전월 대비 CPC 금액 변화 / 근무시간(인원) 변화로 간단히 분석합니다.
function buildReason(curRaw, curDenom, prevRaw, prevDenom, mode) {
  const denomLabel = mode === 'hours' ? '근무시간' : '인원수';
  if (!prevRaw || !prevDenom) return '전월 비교 데이터가 부족해 원인 분석이 어렵습니다.';
  const rawChangePct = ((curRaw - prevRaw) / prevRaw) * 100;
  const denomChangePct = ((curDenom - prevDenom) / prevDenom) * 100;
  const rawTxt = `CPC 금액 ${rawChangePct >= 0 ? '+' : ''}${rawChangePct.toFixed(1)}%`;
  const denomTxt = `${denomLabel} ${denomChangePct >= 0 ? '+' : ''}${denomChangePct.toFixed(1)}%`;
  let cause;
  if (denomChangePct > 5 && rawChangePct > -5) cause = `${denomLabel}이 평소보다 많아 목표 미달로 보입니다.`;
  else if (rawChangePct < -5 && denomChangePct < 5) cause = 'CPC 금액이 평소보다 줄어 목표 미달로 보입니다.';
  else if (denomChangePct > 5 && rawChangePct < -5) cause = `${denomLabel} 증가와 CPC 금액 감소가 함께 작용한 것으로 보입니다.`;
  else cause = '전월과 큰 차이는 없어 다른 요인을 확인해볼 필요가 있습니다.';
  return `전월 대비 ${rawTxt}, ${denomTxt} — ${cause}`;
}

function formatDateShort(dateStr) {
  return `${dateStr.slice(5).replace('-', '/')}(${weekdayLabel(dateStr)})`;
}

export default function DashboardPage() {
  const [month, setMonth] = useState(defaultMonth());
  const [tableDetail, setTableDetail] = useState(false);
  const [mode, setMode] = useState('hours');
  const [data, setData] = useState(null);
  const [prevData, setPrevData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const { start, end } = monthRange(month);
    const prevRange = monthRange(shiftMonth(month, -1));
    setLoading(true);
    setError('');
    Promise.all([
      fetch(`/api/dashboard?start=${start}&end=${end}&mode=${mode}`).then((r) => r.json()),
      fetch(`/api/dashboard?start=${prevRange.start}&end=${prevRange.end}&mode=${mode}`)
        .then((r) => r.json())
        .catch(() => null)
    ])
      .then(([json, prevJson]) => {
        if (json.error) throw new Error(json.error);
        setData(json);
        setPrevData(prevJson && !prevJson.error ? prevJson : null);
      })
      .catch((e) => setError(e.message || '데이터를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [month, mode]);

  const daily = data?.daily || [];
  const seriesMeta = data?.series_meta || [];
  const labels = daily.map((d) => d.day + '일');
  const totalRaw = daily.map((d) => d.total_raw || 0);
  const totalPerPerson = daily.map((d) => d.total_per_person || 0);

  const seriesForChart = seriesMeta.map((meta, i) => ({
    name: meta.name,
    color: meta.color,
    data: daily.map((d) => d['p' + (i + 1)] || 0)
  }));

  const kpis = useMemo(() => {
    if (!daily.length) return [];
    const sum = (arr) => arr.reduce((a, b) => a + b, 0);
    const avg = (arr) => sum(arr) / arr.length;
    const totalSum = sum(totalRaw);
    const totalAvg = avg(totalRaw);
    const totalPerPersonAvg = avg(daily.map((d) => d.total_per_person || 0));
    const base = [
      { label: '일일 합계 CPC (월 누계)', color: 'var(--total)', value: fmt(totalSum), sub: `${data.range_label} 합산` },
      { label: '일평균 합계 CPC', color: 'var(--total)', value: fmt1(totalAvg), sub: '1일 평균' },
      { label: '전체 1인당 CPC 평균', color: 'var(--total)', value: fmt1(totalPerPersonAvg), sub: mode === 'hours' ? '전체 근무시간당 (P1+P3+P4+관리인력)' : '전체 인원 1인당 (P1+P3+P4+관리인력)' }
    ];
    const prevDaily = prevData?.daily || [];
    seriesForChart.forEach((s, idx) => {
      const actual = avg(s.data);
      const target = findTarget(s.name);
      const entry = { label: s.name + ' 평균', color: s.color, value: fmt1(actual), rawValue: actual, sub: mode === 'hours' ? '근무시간당' : '배치 인원 1인당', target };
      if (target != null) {
        const missedDays = daily.filter((d) => (d['p' + (idx + 1)] || 0) < target).map((d) => d.date);
        if (missedDays.length > 0) {
          entry.missedDays = missedDays;
          entry.missedTotal = daily.length;
        }
        if (actual < target) {
          const curRaw = sumField(daily, 'p' + (idx + 1) + '_raw');
          const curDenom = sumField(daily, 'p' + (idx + 1) + '_denom');
          const prevRaw = sumField(prevDaily, 'p' + (idx + 1) + '_raw');
          const prevDenom = sumField(prevDaily, 'p' + (idx + 1) + '_denom');
          entry.reason = buildReason(curRaw, curDenom, prevRaw, prevDenom, mode);
        }
      }
      base.push(entry);
    });
    return base;
  }, [daily, seriesForChart, mode, prevData]);

  const wcTotals = data?.wc_totals || {};
  const wcKeys = Object.keys(wcTotals);
  const wcLabels = seriesMeta.map((m) => m.name.split(' · ')[1] || m.code);
  const wcValues = seriesMeta.map((m) => wcTotals[m.code] || 0);
  const wcColors = seriesMeta.map((m) => m.color);

  const topDesc = (data?.top_desc || []).slice(0, 10);
  const maxTop = Math.max(1, ...topDesc.map((d) => d.total));
  const colorByWc = {};
  seriesMeta.forEach((m) => { colorByWc[m.code] = m.color; });

  const denomLabel = mode === 'hours' ? '근무시간' : '인원수';

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>GGK CPC 대시보드</h1>
          <p>월별 워크센터별 CPC 추이 · AM/PM 인원 + 연장근무 기준으로 계산합니다.</p>
        </div>
        <div className="badge">{data ? `${data.range_label} · ${daily.length}일` : '불러오는 중...'}</div>
      </div>

      <div className="toolbar">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <div className="seg">
          <button className={mode === 'hours' ? 'active' : ''} onClick={() => setMode('hours')}>근무시간 기준</button>
          <button className={mode === 'headcount' ? 'active' : ''} onClick={() => setMode('headcount')}>배치 인원수 기준</button>
        </div>
        {loading && <span style={{ fontSize: 12.5, color: '#767b8a' }}>불러오는 중...</span>}
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, color: '#dc2626' }}>
          {error} — 워크센터/CPC 데이터가 아직 등록되지 않았을 수 있습니다. 실데이터 대시보드에서 먼저 CPC 데이터를 업로드했는지, AM/PM 인원을 입력했는지 확인해주세요.
        </div>
      )}

      {!error && (
        <>
          <div className="kpi-grid">
            {kpis.map((k, i) => (
              <div className="kpi" key={i}>
                <div className="kpi-top">
                  <div className="kpi-main">
                    <div className="label"><span className="dot" style={{ background: k.color }} />{k.label}</div>
                    <div className="value">{k.value}</div>
                    <div className="sub">{k.sub}</div>
                  </div>
                  {k.target != null && (
                    <div className={'kpi-target-box ' + (k.rawValue >= k.target ? 'good' : 'bad')}>
                      <div className="kpi-target-label">목표</div>
                      <div className="kpi-target-value">{fmt1(k.target)}</div>
                      <div className="kpi-target-badge">{k.rawValue >= k.target ? '달성' : `-${fmt1(k.target - k.rawValue)}`}</div>
                    </div>
                  )}
                </div>
                {k.reason && <div className="kpi-reason">{k.reason}</div>}
                {k.missedDays && (
                  <div className="kpi-days">
                    목표 미달일 {k.missedDays.length}/{k.missedTotal}일 · {k.missedDays.map(formatDateShort).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="grid-main">
            <div className="card">
              <div className="card-title">일자별 워크센터별 CPC 추이</div>
              <div className="card-desc">{mode === 'hours' ? '근무시간(AM/PM 배치시간 + 연장근무) 당 CPC' : '배치 인원 1인당 CPC'}</div>
              <div className="legend-row">
                {seriesMeta.map((m, i) => (
                  <div className="legend-item" key={i}>
                    <span className="legend-swatch" style={{ background: m.color }} />{m.name}
                  </div>
                ))}
              </div>
              <div className="chart-box">
                {daily.length > 0 && <LineChart labels={labels} series={seriesForChart} height={300} />}
              </div>
            </div>

            <div className="card">
              <div className="card-title">워크센터별 월간 합계 비중</div>
              <div className="card-desc">선택한 월 Total CPC 구성비</div>
              {wcValues.some((v) => v > 0) && <DonutChart data={wcValues} labels={wcLabels} colors={wcColors} />}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">전체 1인당 CPC 추이</div>
            <div className="card-desc">{mode === 'hours' ? '전체 근무시간(워크센터+관리인력) 당 CPC' : '전체 인원(워크센터+관리인력) 1인당 CPC'} · 일 단위</div>
            <div className="chart-box">
              {daily.length > 0 && (
                <LineChart labels={labels} series={[{ name: '전체 1인당', color: '#334155', data: totalPerPerson }]} height={340} />
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
              <div>
                <div className="card-title">일자별 상세 데이터</div>
                <div className="card-desc" style={{ margin: 0 }}>
                  {tableDetail
                    ? `${mode === 'hours' ? '근무시간 기준' : '배치 인원수 기준'} 워크센터별 CPC 합계 · ${denomLabel} · 1인당 및 일일 합계`
                    : `${mode === 'hours' ? '근무시간 기준' : '배치 인원수 기준'} 워크센터별 CPC 및 일일 합계`}
                </div>
              </div>
              <div className="seg">
                <button className={!tableDetail ? 'active' : ''} onClick={() => setTableDetail(false)}>간단히 보기</button>
                <button className={tableDetail ? 'active' : ''} onClick={() => setTableDetail(true)}>상세히 보기</button>
              </div>
            </div>
            <div className="table-scroll" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  {tableDetail ? (
                    <>
                      <tr>
                        <th rowSpan={2} className="detail-date-col">날짜</th>
                        {seriesMeta.map((m, i) => (
                          <th key={i} colSpan={3} style={{ textAlign: 'center', borderLeft: '1px solid var(--line)' }}>{m.name}</th>
                        ))}
                        <th rowSpan={2} className="num" style={{ borderLeft: '1px solid var(--line)' }}>일일 합계</th>
                        <th rowSpan={2} className="num">전체 {denomLabel}</th>
                        <th rowSpan={2} className="num">전체 1인당</th>
                      </tr>
                      <tr>
                        {seriesMeta.map((m, i) => (
                          <Fragment key={i}>
                            <th className="num" style={{ borderLeft: '1px solid var(--line)' }}>CPC합계</th>
                            <th className="num">{denomLabel}</th>
                            <th className="num">1인당</th>
                          </Fragment>
                        ))}
                      </tr>
                    </>
                  ) : (
                    <tr>
                      <th className="detail-date-col">날짜</th>
                      {seriesMeta.map((m, i) => <th className="num" key={i}>{m.name}</th>)}
                      <th className="num">일일 합계</th>
                      <th className="num">전체 1인당</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {daily.map((d, i) => (
                    <tr key={i}>
                      <td className="detail-date-col">{d.date} ({weekdayLabel(d.date)})</td>
                      {tableDetail
                        ? seriesMeta.map((m, si) => (
                            <Fragment key={si}>
                              <td className="num" style={{ borderLeft: '1px solid var(--line)' }}>{fmt(d['p' + (si + 1) + '_raw'] || 0)}</td>
                              <td className="num">{fmt1(d['p' + (si + 1) + '_denom'] || 0)}</td>
                              <td className="num">{fmt1(d['p' + (si + 1)] || 0)}</td>
                            </Fragment>
                          ))
                        : seriesMeta.map((m, si) => <td className="num" key={si}>{fmt1(d['p' + (si + 1)] || 0)}</td>)}
                      <td className="num" style={tableDetail ? { borderLeft: '1px solid var(--line)' } : undefined}>{fmt(d.total_raw)}</td>
                      {tableDetail && <td className="num">{fmt1(d.total_denom || 0)}</td>}
                      <td className="num">{fmt1(d.total_per_person || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">디스크립션 TOP 10 (월간 누계)</div>
            <div className="card-desc">Total CPC 기준 상위 항목</div>
            <div>
              {topDesc.map((d, i) => {
                const color = colorByWc[d.workcenter] || '#334155';
                return (
                  <div style={{ marginBottom: 11 }} key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '85%' }} title={d.description}>{d.description}</span>
                      <span style={{ fontWeight: 700, color }}>{fmt(d.total)}</span>
                    </div>
                    <div className="bar-bg"><div className="bar-fill" style={{ width: (d.total / maxTop * 100).toFixed(1) + '%', background: color }} /></div>
                  </div>
                );
              })}
              {topDesc.length === 0 && <div style={{ fontSize: 12.5, color: '#767b8a' }}>데이터가 없습니다.</div>}
            </div>
          </div>
        </>
      )}

      <div className="footer">계산법: 일일 CPC ÷ {mode === 'hours' ? '일 근무시간(AM/PM 배치시간 8시간 + 연장근무)' : '일 배치 인원수(AM+PM)'}</div>
    </div>
  );
}
