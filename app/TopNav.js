'use client';
import { usePathname, useRouter } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/admin/manpower-entry', label: 'AM/PM 인원 입력' },
  { href: '/admin/upload', label: '근무표 엑셀 업로드' }
];

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === '/login') return null;

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div className="topnav">
      <a href="/dashboard" className="brand" style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>GGK CPC 대시보드</a>
      <nav>
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} className={pathname.startsWith(l.href) ? 'active' : ''}>
            {l.label}
          </a>
        ))}
      </nav>
      <button className="logout" onClick={logout}>로그아웃</button>
    </div>
  );
}
