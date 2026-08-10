// 엑셀 날짜 시리얼 번호 <-> JS 날짜 변환 공용 유틸.
// xlsx 라이브러리를 cellDates:false + sheet_to_json({raw:true})로 읽으면 날짜 셀도
// 항상 숫자(엑셀 시리얼 값)로 들어옵니다. 이 숫자를 서버/DB의 시간대와 무관하게
// 항상 같은 UTC 날짜로 변환합니다. 엑셀 시리얼 값이 부동소수점 오차로 정확한 정수가
// 아닌 경우가 있어(예: 46220.999999999996) Math.round로 보정합니다.
function excelSerialToUtcMs(serial) {
  const utcDays = Math.round(serial - 25569);
  return utcDays * 86400 * 1000;
}

function excelDateToJs(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  if (typeof value === 'number') {
    return new Date(excelSerialToUtcMs(value));
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function excelDateToStr(value) {
  const d = excelDateToJs(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

// 셀 값이 "그럴듯한 날짜 시리얼"인지 확인 (2015~2035년 사이). 시프트표처럼
// 날짜 열과 숫자 데이터 열이 섞여 있는 표에서 날짜 열의 경계를 찾을 때 사용합니다.
function looksLikeDateSerial(value) {
  if (value instanceof Date) return true;
  if (typeof value !== 'number') return false;
  return value > 42000 && value < 50000; // 대략 2015-01-01 ~ 2036-10-01
}

module.exports = { excelDateToJs, excelDateToStr, looksLikeDateSerial };
