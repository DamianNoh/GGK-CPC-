'use client';
import { useState } from 'react';

export default function UploadPage() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState(null);

  async function upload(e) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setMsg('');
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/report-upload', { method: 'POST', body: fd });
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      if (!res.ok || !json || !json.ok) {
        setMsg((json && json.error) || '업로드 처리 중 오류가 발생했습니다.');
        return;
      }
      setMsg(
        `완료: ${json.rangeStart} ~ ${json.rangeEnd} 기간 · 워크센터 인원 ${json.deletedShift}건 교체 → ${json.createdShift}건, 워크센터 연장근무 ${json.deletedOvertime}건 교체 → ${json.createdOvertime}건, 관리인력 인원 ${json.deletedOverheadShift}건 교체 → ${json.createdOverheadShift}건, 관리인력 연장근무 ${json.deletedOverheadOvertime}건 교체 → ${json.createdOverheadOvertime}건`
      );
      setResult(json);
    } catch (err) {
      setMsg('업로드 처리 중 오류가 발생했습니다: ' + (err && err.message ? err.message : String(err)));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="wrap">
      <div className="header">
        <div>
          <h1>근무표 엑셀 업로드</h1>
          <p>회사에서 쓰는 "PNP INVOICE" 형식의 엑셀(P&P 시트)을 그대로 업로드하면 AM/PM 인원수와 연장근무 시간이 자동으로 반영됩니다.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">엑셀 업로드</div>
        <div className="card-desc">
          P&P 시트에서 "Number of Workers (AM)" / "(PM)" 인원수 블록과, 제목이 없는 연장근무 블록을 읽어 자동 반영합니다.
          부서 매핑: Beverages/Alcohol → P1, Consumable/Bulk·Video/Menu book → P4, Headphone → P3, SPVR·Floor Manager → 관리 인력. OAL은 제외됩니다.
          같은 기간의 기존 입력 내역은 새로 덮어쓰기 됩니다.
        </div>
        <form onSubmit={upload} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: msg ? 12 : 0 }}>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
          />
          <button className="btn" type="submit" disabled={!file || uploading}>
            {uploading ? '업로드 중...' : '업로드'}
          </button>
        </form>
        {msg && <div style={{ fontSize: 12.5, color: result ? '#16a34a' : '#dc2626', marginBottom: result ? 12 : 0 }}>{msg}</div>}

        {result && result.blockReport && result.blockReport.length > 0 && (
          <div className="table-scroll" style={{ maxHeight: 200, marginBottom: 12 }}>
            <table>
              <thead>
                <tr><th>인식된 블록</th><th>분류</th><th className="num">부서 수</th></tr>
              </thead>
              <tbody>
                {result.blockReport.map((b, i) => (
                  <tr key={i}><td>{b.label}</td><td>{b.type}</td><td className="num">{b.deptCount}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result && result.missingWc && result.missingWc.length > 0 && (
          <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>워크센터 매핑을 찾지 못한 코드: {result.missingWc.join(', ')}</div>
        )}
        {result && result.missingDeptLabels && result.missingDeptLabels.length > 0 && (
          <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>분류되지 않은 부서명: {result.missingDeptLabels.join(', ')} (코드에 매핑 규칙 추가 필요)</div>
        )}
      </div>
    </div>
  );
}
