import { NextResponse } from 'next/server';
import { webcrypto } from 'crypto';
import { COOKIE_NAME, createToken } from '../../../../lib/session';

export async function POST(req) {
  const { password } = await req.json();
  const expected = process.env.APP_PASSWORD || '';

  if (!expected) {
    return NextResponse.json({ error: '서버에 APP_PASSWORD가 설정되어 있지 않습니다.' }, { status: 500 });
  }
  if (password !== expected) {
    return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }

  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
  const token = await createToken(webcrypto.subtle, secret);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7 // 7일
  });
  return res;
}
