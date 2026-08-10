import { NextResponse } from 'next/server';
import { COOKIE_NAME, verifyToken } from './lib/session';

// 로그인 없이 접근 가능한 경로
const PUBLIC_PATHS = ['/login', '/api/auth/login'];

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
  const valid = token ? await verifyToken(globalThis.crypto.subtle, secret, token) : false;

  if (!valid) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
