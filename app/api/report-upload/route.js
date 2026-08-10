import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { prisma } from '../../../lib/db';

export const runtime = 'nodejs';

// "PNP INVOICE_..." 형식의 엑셀(예: "P&P" 시트)을 업로드하면 AM/PM 인원수 블록과
// 제목 없는 연장근무 블록을 찾아서 자동으로 워크센터별 AM/PM 인원수 + 연장근무로 반영합니다.
//
// 시트 구조: "Work Section" 이라는 헤더 행이 여러 번 반복되고, 그 두 행 위(헤더행-2)에
// 부서 목록의 제목("Number of Workers (AM)" / "(PM)" / 비어있으면 연장근무)과
// 월(예: "JUL"), 그리고 "Total Days" 열 위치에 연도가 들어있습니다.
// 헤더 행 아래로 부서별 행(예: "Beverages / Alcohol")이 이어지다가 "... Total" 행에서 끝납니다.

const MONTH_MAP = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, JUNE: 6, JULY: 7,
  AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12
};

function normalizeLabel(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

// 부서 라벨 -> 워크센터 코드('P1'|'P3'|'P4') 또는 관리 인력(overhead) 또는 제외(skip)
function classifyDept(label) {
  const norm = normalizeLabel(label);
  if (!norm) return null;
  if (norm.includes('OAL')) return { skip: true };
  if (norm.includes('BEVERAGE') || norm.includes('ALCOHOL')) return { pcode: 'P1' };
  if (norm.includes('HEADPHONE')) return { pcode: 'P3' };
  if (norm.includes('CONSUMABLE') || norm.includes('BULK') || norm.includes('VIDEO') || norm.includes('MENU')) {
    return { pcode: 'P4' };
  }
  if (norm.includes('SPVR') || norm.includes('FLOOR MANAGER')) return { overhead: true };
  return null; // 알 수 없는 부서명은 건너뜀 (리포트에 표시)
}

// 알려진 부서명 집합과 얼마나 겹치는지로 "AM/PM/연장근무 블록"인지 판별 (열1,열2... 같은 다른 표는 걸러냄)
const KNOWN_DEPT_HINTS = ['BEVERAGE', 'CONSUMABLE', 'HEADPHONE', 'OAL', 'VIDEO', 'MENU', 'SPVR', 'FLOOR MANAGER'];

function isDayNumber(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 31;
  if (typeof v === 'string' && /^\d{1,2}$/.test(v.trim())) {
    const n = Number(v.trim());
    return n >= 1 && n <= 31;
  }
  return false;
}

export async function POST(req) {
  try {
    return await handleUpload(req);
  } catch (err) {
    console.error('보고용 근무표 업로드 처리 중 오류:', err);
    return NextResponse.json(
      { error: '업로드 처리 중 서버 오류가 발생했습니다: ' + (err && err.message ? err.message : String(err)) },
      { status: 500 }
    );
  }
}

async function handleUpload(req) {
  const formData = await req.formData();
  const file = formData.get('file');
  if (!file) {
    return NextResponse.json({ error: '업로드할 엑셀 파일(file)이 없습니다.' }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'buffer', cellDates: false });

  const sheetName =
    workbook.SheetNames.find((n) => n.replace(/\s+/g, '').toUpperCase() === 'P&P') ||
    workbook.SheetNames.find((n) => n.toUpperCase().includes('P&P')) ||
    workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  if (!rows.length) {
    return NextResponse.json({ error: '엑셀에 데이터가 없습니다.' }, { status: 400 });
  }

  // 1) "Work Section" 헤더 행을 모두 찾는다 (0-based 인덱스)
  const headerRowIdxs = [];
  rows.forEach((row, i) => {
    if (row && String(row[1] || '').trim() === 'Work Section') headerRowIdxs.push(i);
  });

  if (!headerRowIdxs.length) {
    return NextResponse.json(
      { error: '"Work Section" 헤더 행을 찾지 못했습니다. P&P 시트 형식이 맞는지 확인해주세요.' },
      { status: 400 }
    );
  }

  const blockReport = []; // { label, type, deptCount }
  // key: bucket('P1'|'P3'|'P4'|'OVERHEAD') + '|' + dateStr + '|' + 'AM'|'PM' -> headcount 합계
  const shiftAgg = new Map();
  // key: bucket + '|' + dateStr -> 연장근무 시간 합계
  const overtimeAgg = new Map();
  const missingDeptLabels = new Set();
  const allDateStrs = new Set();

  for (const headerRowIdx of headerRowIdxs) {
    const headerRow = rows[headerRowIdx] || [];
    const titleRow = rows[headerRowIdx - 2] || [];

    // Total Days 열 위치 찾기 (그 열, titleRow에 연도가 들어있음)
    let totalDaysCol = -1;
    for (let c = 2; c < headerRow.length; c++) {
      if (String(headerRow[c] || '').trim() === 'Total Days') { totalDaysCol = c; break; }
    }

    const monthText = String(titleRow[1] || '').trim().toUpperCase();
    const monthNum = MONTH_MAP[monthText];
    const year = totalDaysCol >= 0 ? Number(titleRow[totalDaysCol]) : NaN;
    const blockTitle = String(titleRow[2] || '').trim();

    // 날짜 열 수집 (헤더 행에서 1~31 사이 숫자로 보이는 열만)
    const dayCols = [];
    for (let c = 2; c < headerRow.length; c++) {
      if (isDayNumber(headerRow[c])) {
        dayCols.push({ col: c, day: Number(String(headerRow[c]).trim()) });
      }
    }

    if (!monthNum || !year || dayCols.length === 0) continue; // 형식이 안 맞는 표는 건너뜀 (예: 열1,열2... 표)

    // 부서 행 수집 (헤더 다음 행부터 "... Total" 행 전까지)
    const deptRows = [];
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const label = String(row[1] ?? '').trim();
      if (!label) break;
      if (/total$/i.test(label)) break;
      deptRows.push({ rowIdx: r, label });
    }

    // 이 표가 실제로 알려진 부서명을 담고 있는지 확인 (열1,열2... 같은 무관한 표 배제)
    const matchCount = deptRows.filter((d) => {
      const n = normalizeLabel(d.label);
      return KNOWN_DEPT_HINTS.some((hint) => n.includes(hint));
    }).length;
    if (matchCount < 2) continue;

    let blockType = null;
    if (/\(AM\)/i.test(blockTitle)) blockType = 'AM';
    else if (/\(PM\)/i.test(blockTitle)) blockType = 'PM';
    else if (!blockTitle) blockType = 'OVERTIME';
    else continue; // NIGHT 등 처리 대상이 아닌 블록은 건너뜀

    blockReport.push({ label: blockTitle || '(제목없음 = 연장근무)', type: blockType, deptCount: deptRows.length });

    for (const { rowIdx, label } of deptRows) {
      const target = classifyDept(label);
      if (!target) {
        missingDeptLabels.add(label);
        continue;
      }
      if (target.skip) continue;
      const bucket = target.overhead ? 'OVERHEAD' : target.pcode;
      const row = rows[rowIdx] || [];

      for (const { col, day } of dayCols) {
        const raw = row[col];
        const value = typeof raw === 'number' ? raw : Number(raw);
        const v = isFinite(value) ? value : 0;
        const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        allDateStrs.add(dateStr);

        if (blockType === 'OVERTIME') {
          const key = bucket + '|' + dateStr;
          overtimeAgg.set(key, (overtimeAgg.get(key) || 0) + v);
        } else {
          const key = bucket + '|' + dateStr + '|' + blockType;
          shiftAgg.set(key, (shiftAgg.get(key) || 0) + v);
        }
      }
    }
  }

  if (shiftAgg.size === 0) {
    return NextResponse.json(
      { error: '인식된 AM/PM 인원 데이터가 없습니다. 파일 형식을 확인해주세요.' },
      { status: 400 }
    );
  }

  // 2) 워크센터 매핑 준비
  const workcenters = await prisma.workcenter.findMany();
  const wcByPCode = new Map();
  for (const wc of workcenters) {
    const m = /P\s*-?\s*(\d+)/i.exec(wc.code);
    if (m) wcByPCode.set('P' + m[1], wc.id);
  }

  const missingWc = [];
  const wcShiftRows = [];
  const wcOvertimeRows = [];
  const overheadShiftRows = [];
  const overheadOvertimeRows = [];

  for (const [key, headcount] of shiftAgg.entries()) {
    const [bucket, dateStr, shift] = key.split('|');
    const date = new Date(dateStr + 'T00:00:00Z');
    if (bucket === 'OVERHEAD') {
      overheadShiftRows.push({ date, shift, headcount });
    } else {
      const workcenterId = wcByPCode.get(bucket);
      if (!workcenterId) {
        if (!missingWc.includes(bucket)) missingWc.push(bucket);
        continue;
      }
      wcShiftRows.push({ date, workcenterId, shift, headcount });
    }
  }

  for (const [key, hours] of overtimeAgg.entries()) {
    const [bucket, dateStr] = key.split('|');
    const date = new Date(dateStr + 'T00:00:00Z');
    if (bucket === 'OVERHEAD') {
      overheadOvertimeRows.push({ date, hours });
    } else {
      const workcenterId = wcByPCode.get(bucket);
      if (!workcenterId) {
        if (!missingWc.includes(bucket)) missingWc.push(bucket);
        continue;
      }
      wcOvertimeRows.push({ date, workcenterId, hours });
    }
  }

  const allDates = Array.from(allDateStrs).sort();
  const rangeStart = allDates[0];
  const rangeEnd = allDates[allDates.length - 1];
  const rangeStartDate = new Date(rangeStart + 'T00:00:00Z');
  const rangeEndDate = new Date(rangeEnd + 'T00:00:00Z');
  const workcenterIdsInFile = Array.from(new Set(wcShiftRows.map((r) => r.workcenterId)));

  const result = await prisma.$transaction(
    async (tx) => {
      let deletedShift = 0, createdShift = 0, deletedOvertime = 0, createdOvertime = 0;
      let deletedOverheadShift = 0, createdOverheadShift = 0, deletedOverheadOvertime = 0, createdOverheadOvertime = 0;

      if (wcShiftRows.length) {
        const del = await tx.reportShiftCount.deleteMany({
          where: { date: { gte: rangeStartDate, lte: rangeEndDate }, workcenterId: { in: workcenterIdsInFile } }
        });
        deletedShift = del.count;
        const created = await tx.reportShiftCount.createMany({ data: wcShiftRows });
        createdShift = created.count;
      }

      if (wcOvertimeRows.length) {
        const del = await tx.reportOvertimeEntry.deleteMany({
          where: { date: { gte: rangeStartDate, lte: rangeEndDate }, workcenterId: { in: workcenterIdsInFile } }
        });
        deletedOvertime = del.count;
        const created = await tx.reportOvertimeEntry.createMany({ data: wcOvertimeRows });
        createdOvertime = created.count;
      }

      if (overheadShiftRows.length) {
        const del = await tx.reportOverheadShiftCount.deleteMany({
          where: { date: { gte: rangeStartDate, lte: rangeEndDate } }
        });
        deletedOverheadShift = del.count;
        const created = await tx.reportOverheadShiftCount.createMany({ data: overheadShiftRows });
        createdOverheadShift = created.count;
      }

      if (overheadOvertimeRows.length) {
        const del = await tx.reportOverheadEntry.deleteMany({
          where: { date: { gte: rangeStartDate, lte: rangeEndDate } }
        });
        deletedOverheadOvertime = del.count;
        const created = await tx.reportOverheadEntry.createMany({ data: overheadOvertimeRows });
        createdOverheadOvertime = created.count;
      }

      return {
        deletedShift, createdShift, deletedOvertime, createdOvertime,
        deletedOverheadShift, createdOverheadShift, deletedOverheadOvertime, createdOverheadOvertime
      };
    },
    { timeout: 30000, maxWait: 10000 }
  );

  return NextResponse.json({
    ok: true,
    sheetUsed: sheetName,
    rangeStart,
    rangeEnd,
    ...result,
    blockReport,
    missingWc,
    missingDeptLabels: Array.from(missingDeptLabels)
  });
}
