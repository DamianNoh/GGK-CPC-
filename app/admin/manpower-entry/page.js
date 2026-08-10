'use client';
import { useEffect, useState } from 'react';

const SHIFT_HOURS = 8; // AM/PM 공통 순 근무시간 (9시간 - 휴게 1시간), 계산은 서버(lib/reportCalc.js)와 동일

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function monthRangeOf(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

const PAGE_SIZE = 50;

function Pager({ page, setPage, total }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
      <button className="btn ghost" type="button" disabled={page <= 0} onClick={() => setPage(page - 1)}>이전</button>
      <span style={{ fontSize: 12.5, color: '#767b8a' }}>{page + 1} / {totalPages} 페이지 (총 {total}건)</span>
      <button className="btn ghost" type="button" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>다음</button>
    </div>
  );
}

export default function ManpowerEntryPage() {
  const [workcenters, setWorkcenters] = useState([]);
  const [workcenterId, setWorkcenterId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [counts, setCounts] = useState({ AM: '', PM: '' });
  const [overtimeHours, setOvertimeHours] = useState('0');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState([]);
  const [hasExisting, setHasExisting] = useState(false);

  const [overheadCounts, setOverheadCounts] = useState({ AM: '', PM: '' });
  const [overheadOvertimeHours, setOverheadOvertimeHours] = useState('0');
  const [overheadMsg, setOverheadMsg] = useState('');
  const [overheadSaving, setOverheadSaving] = useState(false);
  const [overheadSummary, setOverheadSummary] = useState([]);
  const [hasExistingOverhead, setHasExistingOverhead] = useState(false);

  const defaultRange = monthRangeOf(todayStr());
  const [summaryStart, setSummaryStart] = useState(defaultRange.start);
  const [summaryEnd, setSummaryEnd] = useState(defaultRange.end);
  const [summaryWcFilter, setSummaryWcFilter] = useState('');
  const [summaryPage, setSummaryPage] = useState(0);
  const [overheadPage, setOverheadPage] = useState(0);

  async function loadWorkcenters() {
    const wcs = await fetch('/api/workcenters').then((r) => r.json());
    setWorkcenters(wcs);
    if (!workcenterId && wcs[0]) setWorkcenterId(wcs[0].id);
  }

  async function loadEntry() {
    if (!workcenterId || !date) return;
    const json = await fetch(`/api/report-entries?date=${date}&workcenterId=${workcenterId}`).then((r) => r.json());
    const next = { AM: '', PM: '' };
    (json.shiftCounts || []).forEach((sc) => { next[sc.shift] = String(sc.headcount || ''); });
    setCounts(next);
    setOvertimeHours(String(json.overtimeHours || 0));
    const hasData = (json.shiftCounts || []).some((sc) => sc.headcount > 0) || (json.overtimeHours || 0) > 0;
    setHasExisting(hasData);
  }

  async function loadSummary() {
    if (!summaryStart || !summaryEnd) return;
    const list = await fetch(`/api/report-entries?start=${summaryStart}&end=${summaryEnd}`).then((r) => r.json());
    setSummary(list);
  }

  async function loadOverhead() {
    if (!date) return;
    const json = await fetch(`/api/report-overhead-entries?date=${date}`).then((r) => r.json());
    const next = { AM: '', PM: '' };
    (json.shiftCounts || []).forEach((sc) => { next[sc.shift] = String(sc.headcount || ''); });
    setOverheadCounts(next);
    setOverheadOvertimeHours(String(json.overtimeHours || 0));
    const hasData = (json.shiftCounts || []).some((sc) => sc.headcount > 0) || (json.overtimeHours || 0) > 0;
    setHasExistingOverhead(hasData);
  }

  async function loadOverheadSummary() {
    if (!summaryStart || !summaryEnd) return;
    const list = await fetch(`/api/report-overhead-entries?start=${summaryStart}&end=${summaryEnd}`).then((r) => r.json());
    setOverheadSummary(list);
  }

  useEffect(() => { loadWorkcenters(); }, []); // eslint-disable-line
  useEffect(() => { loadEntry(); }, [workcenterId, date]); // eslint-disable-line
  useEffect(() => { loadOverhead(); }, [date]); // eslint-disable-line
  useEffect(() => { loadSummary(); loadOverheadSummary(); }, [summaryStart, summaryEnd]); // eslint-disable-line
  useEffect(() => { setSummaryPage(0); }, [summaryStart, summaryEnd, summaryWcFilter]);
  useEffect(() => { setOverheadPage(0); }, [summaryStart, summaryEnd]);

  const filteredSummary = summaryWcFilter ? summary.filter((s) => s.workcenterId === summaryWcFilter) : summary;
  const pagedSummary = filteredSummary.slice(summaryPage * PAGE_SIZE, summaryPage * PAGE_SIZE + PAGE_SIZE);
  const pagedOverheadSummary = overheadSummary.slice(overheadPage * PAGE_SIZE, overheadPage * PAGE_SIZE + PAGE_SIZE);

  async function save(e) {
    e.preventDefault();
    if (hasExisting && !confirm('이미 입력된 내용이 있습니다. 수정하시겠습니까?')) return;
    setSaving(true);
    setMsg('');
    const res = await fetch('/api/report-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        workcenterId,
        counts: { AM: Number(counts.AM || 0), PM: Number(counts.PM || 0) },
        overtimeHours: Number(overtimeHours || 0)
      })
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json();
      setMsg(j.error || '저장 실패');
      return;
    }
    setMsg('저장했습니다.');
    setHasExisting(true);
    loadSummary();
  }

  async function saveOverhead(e) {
    e.preventDefault();
    if (hasExistingOverhead && !confirm('이미 입력된 관리 인력 내용이 있습니다. 수정하시겠습니까?')) return;
    setOverheadSaving(true);
    setOverheadMsg('');
    const res = await fetch('/api/report-overhead-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        counts: { AM: Number(overheadCounts.AM || 0), PM: Number(overheadCounts.PM || 0) },
        overtimeHours: Number(overheadOvertimeHours || 0)
      })
    });
    setOverheadSaving(false);
    if (!res.ok) {
      const j = await res.json();
      setOverheadMsg(j.error || '저장 실패');
      return;
    }
    setOverheadMsg('저장했습니다.');
    setHasExistingOverhead(true);
    loadOverheadSummary();
  }

  const totalHeadcount = (Number(counts.AM) || 0) + (Number(counts.PM) || 0);
  const totalShiftHours = totalHeadcount * SHIFT_HOURS;
  const totalHours = totalShiftHours + (Number(overtimeHours) || 0);

  const overheadTotalHeadcount = (Number(overheadCounts.AM) || 0) + (Number(overheadCounts.PM) || 0);
  const overheadTotalShiftHours = overheadTotalHeadcount * SHIFT_HOURS;
  const overheadTotalHours = overheadTotalShiftHours + (Number(overheadOvertimeHours) || 0);

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>AM/PM 인원 입력</h1>
          <p>날짜 · 워크센터별로 AM/PM 인원 수와 그날의 연장근무 합계 시간을 입력합니다. AM/PM 모두 순 근무시간(휴게 1시간 제외) 8시간으로 고정 계산됩니다.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar" style={{ marginBottom: 20 }}>
          <select value={workcenterId} onChange={(e) => setWorkcenterId(e.target.value)}>
            {workcenters.map((wc) => <option key={wc.id} value={wc.id}>{wc.label} ({wc.code})</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {workcenters.length === 0 && (
          <div style={{ color: '#767b8a', fontSize: 13 }}>워크센터가 아직 없습니다. 실데이터 대시보드(cpc-dashboard-app)에서 먼저 워크센터/CPC 데이터를 등록해주세요.</div>
        )}

        {workcenters.length > 0 && (
          <form onSubmit={save}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(110px, 1fr))`, gap: 10, marginBottom: 16, maxWidth: 340 }}>
              {['AM', 'PM'].map((shift) => (
                <label key={shift} style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: '#767b8a', fontWeight: 600, minWidth: 0 }}>
                  {shift}조 (8시간)
                  <input
                    type="number"
                    min="0"
                    value={counts[shift] ?? ''}
                    onChange={(e) => setCounts({ ...counts, [shift]: e.target.value })}
                    placeholder="0"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid #ecedf1' }}
                  />
                </label>
              ))}
            </div>
            <div className="form-grid" style={{ maxWidth: 260, marginBottom: 16 }}>
              <label>연장근무 합계 시간
                <input type="number" step="0.5" min="0" value={overtimeHours} onChange={(e) => setOvertimeHours(e.target.value)} />
              </label>
            </div>
            <div style={{ fontSize: 12.5, color: '#767b8a', marginBottom: 14 }}>
              합계 인원 <b style={{ color: '#1a1d29' }}>{totalHeadcount}명</b> · 합계 근무시간 <b style={{ color: '#1a1d29' }}>{totalHours}시간</b> (AM/PM {totalShiftHours}시간 + 연장 {Number(overtimeHours) || 0}시간)
            </div>
            <button className="btn" type="submit" disabled={saving}>{saving ? '저장 중...' : '저장'}</button>
            {msg && <span style={{ marginLeft: 12, fontSize: 12.5, color: '#16a34a' }}>{msg}</span>}
          </form>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">관리 인력 입력</div>
        <div className="card-desc">SPVR + Floor Manager를 합산해서 워크센터 구분 없이 날짜별 AM/PM 인원수로 입력합니다. 대시보드의 "전체 1인당 CPC"에 반영됩니다.</div>
        <div className="badge" style={{ display: 'inline-block', marginBottom: 16 }}>선택한 날짜: {date} (위 날짜 선택과 동일하게 적용됩니다)</div>

        <form onSubmit={saveOverhead}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(110px, 1fr))`, gap: 10, marginBottom: 16, maxWidth: 340 }}>
            {['AM', 'PM'].map((shift) => (
              <label key={shift} style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: '#767b8a', fontWeight: 600, minWidth: 0 }}>
                {shift}조 (8시간)
                <input
                  type="number"
                  min="0"
                  value={overheadCounts[shift] ?? ''}
                  onChange={(e) => setOverheadCounts({ ...overheadCounts, [shift]: e.target.value })}
                  placeholder="0"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid #ecedf1' }}
                />
              </label>
            ))}
          </div>
          <div className="form-grid" style={{ maxWidth: 260, marginBottom: 16 }}>
            <label>연장근무 합계 시간
              <input type="number" step="0.5" min="0" value={overheadOvertimeHours} onChange={(e) => setOverheadOvertimeHours(e.target.value)} />
            </label>
          </div>
          <div style={{ fontSize: 12.5, color: '#767b8a', marginBottom: 14 }}>
            합계 인원 <b style={{ color: '#1a1d29' }}>{overheadTotalHeadcount}명</b> · 합계 근무시간 <b style={{ color: '#1a1d29' }}>{overheadTotalHours}시간</b> (AM/PM {overheadTotalShiftHours}시간 + 연장 {Number(overheadOvertimeHours) || 0}시간)
          </div>
          <button className="btn" type="submit" disabled={overheadSaving}>{overheadSaving ? '저장 중...' : '저장'}</button>
          {overheadMsg && <span style={{ marginLeft: 12, fontSize: 12.5, color: '#16a34a' }}>{overheadMsg}</span>}
        </form>
      </div>

      <div className="card">
        <div className="card-title">입력 내역 조회</div>
        <div className="card-desc">조회 기간과 워크센터를 골라서 이미 입력된 내역을 확인합니다.</div>
        <div className="toolbar" style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 12.5, color: '#767b8a', fontWeight: 600 }}>시작일</span>
          <input type="date" value={summaryStart} onChange={(e) => setSummaryStart(e.target.value)} />
          <span style={{ fontSize: 12.5, color: '#767b8a', fontWeight: 600 }}>종료일</span>
          <input type="date" value={summaryEnd} onChange={(e) => setSummaryEnd(e.target.value)} />
          <select value={summaryWcFilter} onChange={(e) => setSummaryWcFilter(e.target.value)}>
            <option value="">전체 워크센터</option>
            {workcenters.map((wc) => <option key={wc.id} value={wc.id}>{wc.label} ({wc.code})</option>)}
          </select>
        </div>

        <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>워크센터별 입력 내역</div>
        <div className="table-scroll" style={{ marginBottom: 24 }}>
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                <th>워크센터</th>
                <th className="num">합계 인원</th>
                <th className="num">합계 근무시간</th>
                <th className="num">연장근무</th>
              </tr>
            </thead>
            <tbody>
              {pagedSummary.map((s, i) => (
                <tr key={i}>
                  <td>{s.date}</td>
                  <td>{s.workcenterLabel}</td>
                  <td className="num">{s.totalHeadcount}명</td>
                  <td className="num">{s.totalHours}시간</td>
                  <td className="num">{s.overtimeHours}시간</td>
                </tr>
              ))}
              {filteredSummary.length === 0 && <tr><td colSpan={5} style={{ color: '#767b8a' }}>선택한 기간에 입력 내역이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={summaryPage} setPage={setSummaryPage} total={filteredSummary.length} />

        <div className="card-title" style={{ fontSize: 13, marginBottom: 8, marginTop: 24 }}>관리 인력 입력 내역</div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                <th className="num">합계 인원</th>
                <th className="num">합계 근무시간</th>
                <th className="num">연장근무</th>
              </tr>
            </thead>
            <tbody>
              {pagedOverheadSummary.map((o, i) => (
                <tr key={i}>
                  <td>{o.date}</td>
                  <td className="num">{o.totalHeadcount}명</td>
                  <td className="num">{o.totalHours}시간</td>
                  <td className="num">{o.overtimeHours}시간</td>
                </tr>
              ))}
              {overheadSummary.length === 0 && <tr><td colSpan={4} style={{ color: '#767b8a' }}>선택한 기간에 입력 내역이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={overheadPage} setPage={setOverheadPage} total={overheadSummary.length} />
      </div>
    </div>
  );
}
