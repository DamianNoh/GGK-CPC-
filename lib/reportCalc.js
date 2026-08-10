// CPC 보고용 대시보드 집계 로직
// 실데이터 대시보드(lib/calc.js)와 계산 공식은 완전히 동일하지만, 근무시간 산출 방식만 다릅니다.
//   - 실데이터: 시프트 코드(AA/AS/A/AN/N/P/D)마다 다른 근무시간
//   - 보고용: AM/PM 두 시프트만 있고, 둘 다 순 근무시간(휴게 1시간 제외) 8시간으로 고정 + 연장근무 합계시간 별도 입력
// CPC 금액(CpcEntry)은 실데이터 대시보드와 동일한 테이블을 그대로 씁니다.
const { prisma } = require('./db');

const SHIFT_HOURS = 8; // AM/PM 공통 순 근무시간 (9시간 - 휴게 1시간)

function toDateStr(d) {
  const dt = new Date(d);
  return dt.toISOString().slice(0, 10);
}

function daysInRange(startStr, endStr) {
  const out = [];
  let cur = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  while (cur <= end) {
    out.push(toDateStr(cur));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.start  'YYYY-MM-DD'
 * @param {string} opts.end    'YYYY-MM-DD'
 * @param {'headcount'|'hours'} opts.mode
 */
async function getDashboardData({ start, end, mode = 'headcount' }) {
  const rangeStart = new Date(start + 'T00:00:00Z');
  const rangeEnd = new Date(end + 'T00:00:00Z');

  const workcenters = await prisma.workcenter.findMany({ orderBy: { sortOrder: 'asc' } });
  const cpcEntries = await prisma.cpcEntry.findMany({
    where: { date: { gte: rangeStart, lte: rangeEnd } }
  });
  const shiftCounts = await prisma.reportShiftCount.findMany({
    where: { date: { gte: rangeStart, lte: rangeEnd } }
  });
  const overtimeEntries = await prisma.reportOvertimeEntry.findMany({
    where: { date: { gte: rangeStart, lte: rangeEnd } }
  });
  const overheadShiftCounts = await prisma.reportOverheadShiftCount.findMany({
    where: { date: { gte: rangeStart, lte: rangeEnd } }
  });
  const overheadEntries = await prisma.reportOverheadEntry.findMany({
    where: { date: { gte: rangeStart, lte: rangeEnd } }
  });

  // key: 'YYYY-MM-DD|workcenterId' -> { headcount, hours }
  const denomByDateWc = new Map();
  for (const sc of shiftCounts) {
    const key = toDateStr(sc.date) + '|' + sc.workcenterId;
    const cur = denomByDateWc.get(key) || { headcount: 0, hours: 0 };
    cur.headcount += sc.headcount;
    cur.hours += sc.headcount * SHIFT_HOURS;
    denomByDateWc.set(key, cur);
  }
  for (const ot of overtimeEntries) {
    const key = toDateStr(ot.date) + '|' + ot.workcenterId;
    const cur = denomByDateWc.get(key) || { headcount: 0, hours: 0 };
    cur.hours += ot.hours || 0;
    denomByDateWc.set(key, cur);
  }

  // 날짜별 관리 인력 (워크센터 구분 없음, AM/PM 인원수 + 연장근무 합계)
  const overheadByDate = new Map(); // dateStr -> { headcount, hours }
  for (const osc of overheadShiftCounts) {
    const key = toDateStr(osc.date);
    const cur = overheadByDate.get(key) || { headcount: 0, hours: 0 };
    cur.headcount += osc.headcount;
    cur.hours += osc.headcount * SHIFT_HOURS;
    overheadByDate.set(key, cur);
  }
  for (const oh of overheadEntries) {
    const key = toDateStr(oh.date);
    const cur = overheadByDate.get(key) || { headcount: 0, hours: 0 };
    cur.hours += oh.hours || 0;
    overheadByDate.set(key, cur);
  }

  // 날짜별/워크센터별 raw CPC 합계
  const rawByDateWc = new Map();
  const wcTotals = {};
  for (const wc of workcenters) wcTotals[wc.id] = 0;

  for (const entry of cpcEntries) {
    const dateStr = toDateStr(entry.date);
    const key = dateStr + '|' + entry.workcenterId;
    rawByDateWc.set(key, (rawByDateWc.get(key) || 0) + entry.totalCpc);
    wcTotals[entry.workcenterId] = (wcTotals[entry.workcenterId] || 0) + entry.totalCpc;
  }

  const dates = daysInRange(start, end);
  const daily = dates.map((dateStr) => {
    const row = { date: dateStr, day: Number(dateStr.slice(8, 10)) };
    let totalRaw = 0;
    let totalDenom = 0;
    workcenters.forEach((wc, idx) => {
      const key = dateStr + '|' + wc.id;
      const raw = rawByDateWc.get(key) || 0;
      totalRaw += raw;

      const denomInfo = denomByDateWc.get(key) || { headcount: 0, hours: 0 };
      const denom = mode === 'hours' ? denomInfo.hours : denomInfo.headcount;
      totalDenom += denom;
      const perUnit = denom > 0 ? raw / denom : 0;
      row['p' + (idx + 1)] = perUnit;
      row['p' + (idx + 1) + '_raw'] = raw;
      row['p' + (idx + 1) + '_denom'] = denom;
    });
    const overhead = overheadByDate.get(dateStr) || { headcount: 0, hours: 0 };
    totalDenom += mode === 'hours' ? overhead.hours : overhead.headcount;
    row.total_raw = totalRaw;
    row.total_denom = totalDenom;
    row.total_per_person = totalDenom > 0 ? totalRaw / totalDenom : 0;
    return row;
  });

  const wcTotalsLabeled = {};
  workcenters.forEach((wc) => {
    wcTotalsLabeled[wc.code] = wcTotals[wc.id] || 0;
  });

  // 디스크립션 TOP N (월간 누계)
  const descTotals = new Map();
  const wcById = new Map(workcenters.map((wc) => [wc.id, wc]));
  for (const entry of cpcEntries) {
    const wc = wcById.get(entry.workcenterId);
    const key = (wc ? wc.code : entry.workcenterId) + '||' + entry.description;
    descTotals.set(key, (descTotals.get(key) || 0) + entry.totalCpc);
  }
  const topDesc = Array.from(descTotals.entries())
    .map(([key, total]) => {
      const [workcenter, description] = key.split('||');
      return { workcenter, description, total: Math.round(total * 100) / 100 };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  const seriesMeta = workcenters.map((wc, idx) => {
    const match = /P\s*-?\s*(\d+)/i.exec(wc.code);
    const num = match ? match[1] : String(idx + 1);
    return { name: `P${num} · ${wc.label}`, code: wc.code, color: wc.color };
  });

  return {
    mode,
    range_label: `${start} ~ ${end}`,
    daily,
    wc_totals: wcTotalsLabeled,
    top_desc: topDesc,
    series_meta: seriesMeta
  };
}

module.exports = { getDashboardData, daysInRange, toDateStr, SHIFT_HOURS };
