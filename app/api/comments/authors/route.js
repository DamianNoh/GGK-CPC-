import { NextResponse } from 'next/server';
import { listActiveAuthors } from '../../../../lib/comments';

export const dynamic = 'force-dynamic';

// 작성 화면의 "작성자 선택" 목록 (id + 이름만, 코드 정보는 절대 내려보내지 않음)
export async function GET() {
  try {
    const list = await listActiveAuthors();
    return NextResponse.json(list);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
