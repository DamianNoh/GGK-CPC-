import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { SHIFT_HOURS } from '../../../lib/reportCalc';

function toDateOnly(dateStr) {
  return new Date(dateStr + 'T00:00:00Z');
}
function dateKey(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// 관리 인력(SPVR + Floor Manager 합산) 전용 — 워크센터 구분 없이 날짜별 AM/PM 인원수 + 연장근무
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  if (date) {
    const d = toDateOnly(date);
    const [shiftCounts, overtime] = await Promise.all([
      prisma.reportOverheadShiftCount.findMany({ where: { date: d } }),
      prisma.reportOverheadEntry.findUnique({ where: { date: d } })
    ]);
    return NextResponse.json({
      shiftCounts: shiftCounts.map((sc) => ({ shift: sc.shift, headcount: sc.headcount })),
      overtimeHours: overtime ? overtime.hours : 0
    });
  }

  if (start && end) {
    const gte = toDateOnly(start);
    const lte = toDateOnly(end);
    const [shiftCounts, overtimeEntries] = await Promise.all([
      prisma.reportOverheadShiftCount.findMany({ where: { date: { gte, lte } } }),
      prisma.reportOverheadEntry.findMany({ where: { date: { gte, lte } } })
    ]);

    const byKey = new Map();
    for (const sc of shiftCounts) {
      const key = dateKey(sc.date);
      const cur = byKey.get(key) || { date: key, totalHeadcount: 0, totalHours: 0, overtimeHours: 0 };
      cur.totalHeadcount += sc.headcount;
      cur.totalHours += sc.headcount * SHIFT_HOURS;
      byKey.set(key, cur);
    }
    for (const ot of overtimeEntries) {
      const key = dateKey(ot.date);
      const cur = byKey.get(key) || { date: key, totalHeadcount: 0, totalHours: 0, overtimeHours: 0 };
      cur.overtimeHours += ot.hours;
      cur.totalHours += ot.hours;
      byKey.set(key, cur);
    }
    const list = Array.from(byKey.values()).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return NextResponse.json(list);
  }

  return NextResponse.json({ error: 'date 또는 start+end 파라미터가 필요합니다.' }, { status: 400 });
}

export async function POST(req) {
  const body = await req.json();
  const { date, counts, overtimeHours } = body;
  if (!date) {
    return NextResponse.json({ error: 'date는 필수입니다.' }, { status: 400 });
  }
  const d = toDateOnly(date);

  await prisma.$transaction(async (tx) => {
    for (const shift of ['AM', 'PM']) {
      const hc = Number((counts || {})[shift]) || 0;
      await tx.reportOverheadShiftCount.upsert({
        where: { date_shift: { date: d, shift } },
        update: { headcount: hc },
        create: { date: d, shift, headcount: hc }
      });
    }
    await tx.reportOverheadEntry.upsert({
      where: { date: d },
      update: { hours: Number(overtimeHours) || 0 },
      create: { date: d, hours: Number(overtimeHours) || 0 }
    });
  });

  return NextResponse.json({ ok: true });
}
