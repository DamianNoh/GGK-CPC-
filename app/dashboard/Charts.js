'use client';
import { useMemo, useRef, useState } from 'react';

export function fmt(n) {
  return Math.round(n || 0).toLocaleString('ko-KR');
}
export function fmt1(n) {
  return (n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

// 외부 차트 라이브러리 없이 순수 SVG로 그리는 라인 차트 (오프라인/네트워크 제한 환경에서도 항상 렌더링됨)
export function LineChart({ labels, series, height = 300 }) {
  const width = 1000;
  const padL = 54, padR = 16, padT = 16, padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const n = labels.length;
  const svgRef = useRef(null);
  const [hoverIdx, setHoverIdx] = useState(null);

  const { minV, maxV } = useMemo(() => {
    const all = series.flatMap((s) => s.data);
    let mn = Math.min(...all), mx = Math.max(...all);
    const range = mx - mn || 1;
    mn = Math.max(0, mn - range * 0.18);
    mx = mx + range * 0.12;
    return { minV: mn, maxV: mx };
  }, [series]);

  const xStep = n > 1 ? plotW / (n - 1) : 0;
  const xScale = (i) => padL + i * xStep;
  const yScale = (v) => padT + plotH - ((v - minV) / (maxV - minV || 1)) * plotH;

  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => minV + ((maxV - minV) * i) / tickCount);
  const showEvery = Math.max(1, Math.ceil(n / 10));

  function handleMove(e) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = width / rect.width;
    const xPix = (e.clientX - rect.left) * scaleX;
    let idx = xStep > 0 ? Math.round((xPix - padL) / xStep) : 0;
    idx = Math.max(0, Math.min(n - 1, idx));
    setHoverIdx(idx);
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={yScale(v)} y2={yScale(v)} stroke="#ecedf1" strokeWidth="1" />
            <text x={padL - 8} y={yScale(v) + 4} textAnchor="end" fontSize="11" fill="#767b8a">{fmt(v)}</text>
          </g>
        ))}
        {labels.map((lab, i) =>
          i % showEvery === 0 || i === n - 1 ? (
            <text key={i} x={xScale(i)} y={height - 8} textAnchor="middle" fontSize="11" fill="#767b8a">{lab}</text>
          ) : null
        )}
        {series.map((s, si) => {
          const linePts = s.data.map((v, i) => `${xScale(i)},${yScale(v)}`).join(' ');
          const areaPts = `${xScale(0)},${yScale(minV)} ${linePts} ${xScale(n - 1)},${yScale(minV)}`;
          return (
            <g key={si}>
              <polyline points={areaPts} fill={s.color} opacity="0.09" stroke="none" />
              <polyline points={linePts} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {hoverIdx !== null && (
          <line x1={xScale(hoverIdx)} x2={xScale(hoverIdx)} y1={padT} y2={height - padB} stroke="#cbd0da" strokeWidth="1" strokeDasharray="3,3" />
        )}
        {hoverIdx !== null &&
          series.map((s, si) => (
            <circle key={si} cx={xScale(hoverIdx)} cy={yScale(s.data[hoverIdx])} r="4" fill={s.color} stroke="#fff" strokeWidth="2" />
          ))}
      </svg>
      {hoverIdx !== null && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(880, xScale(hoverIdx)) / width * 100 + '%',
            top: 4,
            background: '#1a1d29',
            color: '#fff',
            padding: '8px 11px',
            borderRadius: 8,
            fontSize: 12,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            lineHeight: 1.6
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{labels[hoverIdx]}</div>
          {series.map((s, i) => (
            <div key={i}><span style={{ color: s.color }}>●</span> {s.name}: <b>{fmt1(s.data[hoverIdx])}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DonutChart({ data, labels, colors }) {
  const total = data.reduce((a, b) => a + b, 0) || 1;
  const size = 220, cx = size / 2, cy = size / 2, r = 78, strokeW = 26;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = data.map((v, i) => {
    const dash = (v / total) * circumference;
    const arc = { dash, gap: circumference - dash, offset };
    offset += dash;
    return arc;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: 210 }}>
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={colors[i] || '#334155'}
            strokeWidth={strokeW}
            strokeDasharray={`${a.dash} ${a.gap}`}
            strokeDashoffset={-a.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="19" fontWeight="800" fill="#1a1d29">{fmt(total)}</text>
        <text x={cx} y={cy + 17} textAnchor="middle" fontSize="11" fill="#767b8a">총 CPC</text>
      </svg>
      <div style={{ width: '100%' }}>
        {labels.map((l, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, fontWeight: 600, color: '#767b8a', padding: '4px 0' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: colors[i] || '#334155', display: 'inline-block' }} />
              {l}
            </span>
            <span style={{ color: '#1a1d29', fontWeight: 800 }}>{((data[i] / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
