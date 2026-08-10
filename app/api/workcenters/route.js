import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';

// 워크센터는 실데이터 대시보드(cpc-dashboard-app) 쪽에서만 추가/수정합니다.
// 이 프로젝트에서는 목록 조회만 제공합니다.
export async function GET() {
  const list = await prisma.workcenter.findMany({ orderBy: { sortOrder: 'asc' } });
  return NextResponse.json(list);
}
