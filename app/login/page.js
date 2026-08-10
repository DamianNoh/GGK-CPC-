'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.');
        setLoading(false);
        return;
      }
      router.push(params.get('next') || '/dashboard');
      router.refresh();
    } catch (err) {
      setError('네트워크 오류가 발생했습니다.');
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form
        onSubmit={onSubmit}
        style={{
          background: '#fff', padding: '36px 32px', borderRadius: 16,
          boxShadow: '0 8px 24px rgba(20,20,43,0.08)', width: 320
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>GGK CPC 대시보드</div>
        <div style={{ fontSize: 12.5, color: '#767b8a', marginBottom: 20 }}>사내 공용 비밀번호를 입력하세요.</div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          autoFocus
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #ecedf1', fontSize: 14, marginBottom: 12 }}
        />
        {error && <div style={{ color: '#dc2626', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
        <button
          type="submit"
          disabled={loading}
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: 'none', background: '#1a1d29', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          {loading ? '확인 중...' : '로그인'}
        </button>
      </form>
    </div>
  );
}
