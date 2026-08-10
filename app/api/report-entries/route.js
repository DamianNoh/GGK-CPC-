import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { SHIFT_HOURS } from '../../../lib/reportCalc';

function toDateOnly(dateStr) {
  return new Date(dateStr + 'T00:00:00Z');
}
function dateKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const workcenterId = searchParams.get('workcenterId');
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  // 단일 날짜 + 워크센터 조회 (입력 폼 초기값용)
  if (date && workcenterId) {
    const d = toDateOnly(date);
    const [shiftCounts, overtime] = await Promise.all([
      prisma.reportShiftCount.findMany({ where: { date: d, workcenterId } }),
      prisma.reportOvertimeEntry.findUnique({ where: { date_workcenterId: { date: d, workcenterId } } })
    ]);
    return NextResponse.json({
      shiftCounts: shiftCounts.map((sc) => ({ shift: sc.shift, headcount: sc.headcount })),
      overtimeHours: overtime ? overtime.hours : 0
    });
  }

  // 기간 조회 (입력 내역 요약 테이블용)
  if (start && end) {
    const gte = toDateOnly(start);
    const lte = toDateOnly(end);
    const [shiftCounts, overtimeEntries] = await Promise.all([
      prisma.reportShiftCount.findMany({ where: { date: { gte, lte } }, include: { workcenter: true } }),
      prisma.reportOvertimeEntry.findMany({ where: { date: { gte, lte } }, include: { workcenter: true } })
    ]);

    const byKey = new Map();
    for (const sc of shiftCounts) {
      const key = dateKey(sc.date) + '|' + sc.workcenterId;
      const cur = byKey.get(key) || {
        date: dateKey(sc.date),
        workcenterId: sc.workcenterId,
        workcenterLabel: sc.workcenter.label,
        totalHeadcount: 0,
        totalHours: 0,
        overtimeHours: 0
      };
      cur.totalHeadcount += sc.headcount;
      cur.totalHours += sc.headcount * SHIFT_HOURS;
      byKey.set(key, cur);
    }
    for (const ot of overtimeEntries) {
      const key = dateKey(ot.date) + '|' + ot.workcenterId;
      const cur = byKey.get(key) || {
        date: dateKey(ot.date),
        workcenterId: ot.workcenterId,
        workcenterLabel: ot.workcenter.label,
        totalHeadcount: 0,
        totalHours: 0,
        overtimeHours: 0
      };
      cur.overtimeHours += ot.hours;
      cur.totalHours += ot.hours;
      byKey.set(key, cur);
    }
    const list = Array.from(byKey.values()).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return NextResponse.json(list);
  }

  return NextResponse.json({ error: 'date+workcenterId 또는 start+end 파라미터가 필요합니다.' }, { status: 400 });
}

export async function POST(req) {
  const body = await req.json();
  const { date, workcenterId, counts, overtimeHours } = body;
  if (!date || !workcenterId) {
    return NextResponse.json({ error: 'date, workcenterId는 필수입니다.' }, { status: 400 });
  }
  const d = toDateOnly(date);

  await prisma.$transaction(async (tx) => {
    for (const shift of ['AM', 'PM']) {
      const hc = Number((counts || {})[shift]) || 0;
      await tx.reportShiftCount.upsert({
        where: { date_workcenterId_shift: { date: d, workcenterId, shift } },
        update: { headcount: hc },
        create: { date: d, workcenterId, shift, headcount: hc }
      });
    }
    await tx.reportOvertimeEntry.upsert({
      where: { date_workcenterId: { date: d, workcenterId } },
      update: { hours: Number(overtimeHours) || 0 },
      create: { date: d, workcenterId, hours: Number(overtimeHours) || 0 }
    });
  });

  return NextResponse.json({ ok: true });
}
