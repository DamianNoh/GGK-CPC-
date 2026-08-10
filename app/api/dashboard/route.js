import { NextResponse } from 'next/server';
import { getDashboardData } from '../../../lib/reportCalc';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const mode = searchParams.get('mode') === 'hours' ? 'hours' : 'headcount';

  if (!start || !end) {
    return NextResponse.json({ error: 'start, end 쿼리 파라미터(YYYY-MM-DD)가 필요합니다.' }, { status: 400 });
  }

  try {
    const data = await getDashboardData({ start, end, mode });
    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: '대시보드 데이터를 불러오지 못했습니다.', detail: String(err) }, { status: 500 });
  }
}
