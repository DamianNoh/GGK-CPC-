import { NextResponse } from 'next/server';
import { updateComment, deleteComment } from '../../../../lib/comments';

export const dynamic = 'force-dynamic';

// PUT /api/comments/:id  { authorId, code, body }  (본인 코멘트만 수정)
export async function PUT(req, { params }) {
  try {
    const b = await req.json();
    const r = await updateComment({ id: params.id, authorId: b.authorId, code: b.code, body: b.body });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// DELETE /api/comments/:id  { authorId, code }  (본인 코멘트만 삭제)
export async function DELETE(req, { params }) {
  try {
    const b = await req.json();
    const r = await deleteComment({ id: params.id, authorId: b.authorId, code: b.code });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
