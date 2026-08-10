// 간단한 서명 세션 토큰 (Web Crypto API 기반, Edge/Node 런타임 양쪽에서 동작)
// 외부 인증 라이브러리 없이 "사내 공용 비밀번호 1개"로 로그인하는 내부용 게이트입니다.
// 더 강한 보안(개별 계정, SSO 등)이 필요하면 NextAuth 등으로 교체하세요.

const COOKIE_NAME = 'cpc_session';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Buffer 없이 동작 (Edge 런타임 호환) — btoa/atob + Uint8Array 사용
function bytesToBinaryString(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return binary;
}

function base64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  const b64 = btoa(bytesToBinaryString(bytes));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(subtle, secret) {
  const enc = new TextEncoder();
  return subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function createToken(subtle, secret, ttlMs = ONE_DAY_MS * 7) {
  const payload = JSON.stringify({ exp: Date.now() + ttlMs });
  const payloadB64 = base64url(payload);
  const key = await importKey(subtle, secret);
  const enc = new TextEncoder();
  const sig = await subtle.sign('HMAC', key, enc.encode(payloadB64));
  const sigB64 = base64url(new Uint8Array(sig));
  return `${payloadB64}.${sigB64}`;
}

async function verifyToken(subtle, secret, token) {
  if (!token || token.indexOf('.') === -1) return false;
  const [payloadB64, sigB64] = token.split('.');
  const key = await importKey(subtle, secret);
  const enc = new TextEncoder();
  const expectedSig = await subtle.sign('HMAC', key, enc.encode(payloadB64));
  const expectedSigB64 = base64url(new Uint8Array(expectedSig));
  if (expectedSigB64 !== sigB64) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(payloadB64)));
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

module.exports = { COOKIE_NAME, createToken, verifyToken };
