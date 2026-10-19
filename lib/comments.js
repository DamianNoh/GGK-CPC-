// 현장 코멘트 + 작성자(개인 작성코드) 로직
// - 작성자: 이름 + 개인 작성코드(scrypt 해시로 저장). 틀린 코드 5회 연속 입력 시 10분간 잠금.
// - 코멘트: 날짜 + 대상(워크센터 코드 또는 'ALL') + 내용 + 작성자(이름 자동 기록)
// - 테이블은 최초 호출 시 CREATE TABLE IF NOT EXISTS 로 자동 생성합니다.
//   (두 대시보드가 같은 DB를 공유하므로 prisma db push 를 쓰지 않고 raw SQL 로 만듭니다.)
const { prisma } = require('./db');
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const MAX_FAILS = 5;
const LOCK_MINUTES = 10;
const MIN_CODE_LEN = 6;

let ready = null;
async function ensureTables() {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS comment_authors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        code_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        failed_count INTEGER NOT NULL DEFAULT 0,
        locked_until TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS day_comments (
        id TEXT PRIMARY KEY,
        comment_date DATE NOT NULL,
        target TEXT NOT NULL,
        body TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS day_comments_date_idx ON day_comments (comment_date)'
      );
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

async function hashCode(code, salt) {
  const buf = await scrypt(String(code), salt, 32);
  return buf.toString('hex');
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---------- 작성자 ----------
async function listActiveAuthors() {
  await ensureTables();
  return prisma.$queryRaw`SELECT id, name FROM comment_authors WHERE active = TRUE ORDER BY name`;
}

async function listAuthorsAdmin() {
  await ensureTables();
  const rows = await prisma.$queryRaw`
    SELECT a.id, a.name, a.active, a.failed_count AS "failedCount", a.locked_until AS "lockedUntil",
           a.created_at AS "createdAt",
           (SELECT COUNT(*)::int FROM day_comments c WHERE c.author_id = a.id) AS "commentCount"
    FROM comment_authors a ORDER BY a.name`;
  return rows;
}

async function createAuthor(name, code) {
  await ensureTables();
  const n = String(name || '').trim();
  if (!n || n.length > 30) return { ok: false, status: 400, error: '이름은 1~30자로 입력해 주세요.' };
  if (String(code || '').length < MIN_CODE_LEN) {
    return { ok: false, status: 400, error: `작성코드는 ${MIN_CODE_LEN}자리 이상으로 입력해 주세요.` };
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashCode(code, salt);
  const id = crypto.randomUUID();
  try {
    await prisma.$executeRaw`INSERT INTO comment_authors (id, name, code_hash, salt) VALUES (${id}, ${n}, ${hash}, ${salt})`;
  } catch (e) {
    if (String(e.message || e).includes('Unique') || String(e.message || e).includes('unique') || String(e.message || e).includes('23505')) {
      return { ok: false, status: 409, error: '이미 등록된 이름입니다.' };
    }
    throw e;
  }
  return { ok: true, id };
}

async function updateAuthor(id, { active, code }) {
  await ensureTables();
  if (typeof active === 'boolean') {
    await prisma.$executeRaw`UPDATE comment_authors SET active = ${active} WHERE id = ${id}`;
  }
  if (code !== undefined && code !== null && code !== '') {
    if (String(code).length < MIN_CODE_LEN) {
      return { ok: false, status: 400, error: `작성코드는 ${MIN_CODE_LEN}자리 이상으로 입력해 주세요.` };
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await hashCode(code, salt);
    await prisma.$executeRaw`UPDATE comment_authors SET code_hash = ${hash}, salt = ${salt}, failed_count = 0, locked_until = NULL WHERE id = ${id}`;
  }
  if (active === true) {
    await prisma.$executeRaw`UPDATE comment_authors SET failed_count = 0, locked_until = NULL WHERE id = ${id}`;
  }
  return { ok: true };
}

// 개인 작성코드 확인 (틀리면 횟수 누적, 5회 연속 실패 시 10분 잠금)
async function verifyAuthor(authorId, code) {
  await ensureTables();
  const rows = await prisma.$queryRaw`
    SELECT id, name, code_hash, salt, active, failed_count, locked_until
    FROM comment_authors WHERE id = ${String(authorId || '')}`;
  const a = rows[0];
  if (!a || !a.active) return { ok: false, status: 403, error: '등록되지 않았거나 비활성화된 작성자입니다.' };

  const now = Date.now();
  if (a.locked_until && new Date(a.locked_until).getTime() > now) {
    const mins = Math.ceil((new Date(a.locked_until).getTime() - now) / 60000);
    return { ok: false, status: 429, error: `작성코드를 여러 번 틀려 잠겼습니다. 약 ${mins}분 후 다시 시도해 주세요.` };
  }

  const hash = await hashCode(code || '', a.salt);
  if (!safeEqualHex(hash, a.code_hash)) {
    const nf = (a.failed_count || 0) + 1;
    if (nf >= MAX_FAILS) {
      const until = new Date(now + LOCK_MINUTES * 60000);
      await prisma.$executeRaw`UPDATE comment_authors SET failed_count = 0, locked_until = ${until}::timestamptz WHERE id = ${a.id}`;
      return { ok: false, status: 429, error: `작성코드를 ${MAX_FAILS}번 틀려 ${LOCK_MINUTES}분 동안 잠겼습니다.` };
    }
    await prisma.$executeRaw`UPDATE comment_authors SET failed_count = ${nf} WHERE id = ${a.id}`;
    return { ok: false, status: 401, error: `작성코드가 올바르지 않습니다. (${MAX_FAILS - nf}회 더 틀리면 ${LOCK_MINUTES}분간 잠깁니다)` };
  }

  if ((a.failed_count || 0) > 0 || a.locked_until) {
    await prisma.$executeRaw`UPDATE comment_authors SET failed_count = 0, locked_until = NULL WHERE id = ${a.id}`;
  }
  return { ok: true, author: { id: a.id, name: a.name } };
}

// ---------- 코멘트 ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function listComments(start, end) {
  await ensureTables();
  if (!DATE_RE.test(start || '') || !DATE_RE.test(end || '')) return [];
  return prisma.$queryRaw`
    SELECT id, to_char(comment_date, 'YYYY-MM-DD') AS date, target, body,
           author_id AS "authorId", author_name AS "authorName",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM day_comments
    WHERE comment_date BETWEEN ${start}::date AND ${end}::date
    ORDER BY comment_date, created_at`;
}

async function listRecentComments(limit = 100) {
  await ensureTables();
  return prisma.$queryRaw`
    SELECT id, to_char(comment_date, 'YYYY-MM-DD') AS date, target, body,
           author_name AS "authorName", created_at AS "createdAt"
    FROM day_comments ORDER BY created_at DESC LIMIT ${Number(limit)}`;
}

function cleanBody(body) {
  const b = String(body || '').trim();
  if (!b) return { error: '코멘트 내용을 입력해 주세요.' };
  if (b.length > 500) return { error: '코멘트는 500자 이내로 입력해 주세요.' };
  return { body: b };
}

async function createComment({ authorId, code, date, target, body }) {
  if (!DATE_RE.test(date || '')) return { ok: false, status: 400, error: '날짜 형식이 올바르지 않습니다.' };
  const cb = cleanBody(body);
  if (cb.error) return { ok: false, status: 400, error: cb.error };
  const tgt = String(target || 'ALL').slice(0, 100);
  const v = await verifyAuthor(authorId, code);
  if (!v.ok) return v;
  const id = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO day_comments (id, comment_date, target, body, author_id, author_name)
    VALUES (${id}, ${date}::date, ${tgt}, ${cb.body}, ${v.author.id}, ${v.author.name})`;
  return { ok: true, id };
}

async function updateComment({ id, authorId, code, body }) {
  const cb = cleanBody(body);
  if (cb.error) return { ok: false, status: 400, error: cb.error };
  const v = await verifyAuthor(authorId, code);
  if (!v.ok) return v;
  const n = await prisma.$executeRaw`
    UPDATE day_comments SET body = ${cb.body}, updated_at = NOW()
    WHERE id = ${String(id)} AND author_id = ${v.author.id}`;
  if (!n) return { ok: false, status: 403, error: '본인이 작성한 코멘트만 수정할 수 있습니다.' };
  return { ok: true };
}

async function deleteComment({ id, authorId, code }) {
  const v = await verifyAuthor(authorId, code);
  if (!v.ok) return v;
  const n = await prisma.$executeRaw`
    DELETE FROM day_comments WHERE id = ${String(id)} AND author_id = ${v.author.id}`;
  if (!n) return { ok: false, status: 403, error: '본인이 작성한 코멘트만 삭제할 수 있습니다.' };
  return { ok: true };
}

async function adminDeleteComment(id) {
  await ensureTables();
  await prisma.$executeRaw`DELETE FROM day_comments WHERE id = ${String(id)}`;
  return { ok: true };
}

// 관리자 코드 확인 (환경변수 COMMENT_ADMIN_CODE)
function checkAdmin(req) {
  const expected = process.env.COMMENT_ADMIN_CODE || '';
  if (!expected) {
    return { ok: false, status: 500, error: '서버에 COMMENT_ADMIN_CODE 환경변수가 설정되어 있지 않습니다.' };
  }
  const given = req.headers.get('x-admin-code') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: '관리자 코드가 올바르지 않습니다.' };
  }
  return { ok: true };
}

module.exports = {
  ensureTables,
  listActiveAuthors,
  listAuthorsAdmin,
  createAuthor,
  updateAuthor,
  verifyAuthor,
  listComments,
  listRecentComments,
  createComment,
  updateComment,
  deleteComment,
  adminDeleteComment,
  checkAdmin
};
