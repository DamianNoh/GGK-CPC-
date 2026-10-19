import { NextResponse } from 'next/server';
import { listComments, createComment } from '../../../lib/comments';

export const dynamic = 'force-dynamic';

// GET /api/comments?start=YYYY-MM-DD&end=YYYY-MM-DD  (읽기: 누구나)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  try {
    const list = await listComments(searchParams.get('start'), searchParams.get('end'));
    return NextResponse.json(list);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// POST /api/comments  { authorId, code, date, target, body }  (쓰기: 개인 작성코드 필요)
export async function POST(req) {
  try {
    const body = await req.json();
    const r = await createComment(body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
    return NextResponse.json({ ok: true, id: r.id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
