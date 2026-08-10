# CPC 보고용 대시보드 (cpc-report-dashboard-app)

실데이터 대시보드(`cpc-dashboard-app`)와 **완전히 별도의 프로젝트/배포**입니다.
디자인과 계산 공식(일일 CPC ÷ 근무시간 또는 인원수)은 실데이터 대시보드와 동일하지만,
근무시간을 산출하는 방식만 다릅니다.

- 실데이터 대시보드: 시프트 코드(AA/AS/A/AN/N/P/D)마다 다른 근무시간
- 이 프로젝트: AM/PM 두 조만 사용, 둘 다 순 근무시간(휴게 1시간 제외) **8시간 고정** + 날짜별 연장근무 합계시간 별도 입력

## 중요 — 이 프로젝트의 DB는 실데이터 대시보드와 반드시 같은 DB(같은 DATABASE_URL)를 써야 합니다

CPC 금액 데이터(Workcenter, CpcEntry)는 새로 만들지 않고 실데이터 대시보드 프로젝트가 이미
쌓아놓은 데이터를 그대로 읽어옵니다. 그래야 실데이터 대시보드에 CPC 엑셀을 업로드하면
이 보고용 대시보드에도 자동으로 반영됩니다. 이 프로젝트가 새로 만드는 테이블은
AM/PM 인원수·연장근무 관련 테이블(ReportShiftCount 등) 뿐입니다.

---

## 1. 로컬에서 먼저 실행해보기

```bash
cd cpc-report-dashboard-app
npm install

cp .env.example .env
# DATABASE_URL 값은 cpc-dashboard-app의 .env에 있는 값과 "완전히 동일하게" 입력
# APP_PASSWORD, SESSION_SECRET은 이 프로젝트만의 값으로 새로 입력 (같아도 되고 달라도 됨)

# 이 프로젝트 전용 테이블만 새로 생성 (Workcenter/CpcEntry는 이미 있으므로 건드리지 않음)
npx prisma db push

npm run dev
# http://localhost:3000 접속 → 로그인 (APP_PASSWORD로 설정한 값)
```

접속하면 실데이터 대시보드에 이미 등록된 워크센터(P1/P3/P4)와 CPC 데이터가 그대로 보여야 합니다.
"AM/PM 인원 입력" 메뉴에서 날짜별로 입력하거나, "근무표 엑셀 업로드"에서 PNP INVOICE 형식 파일을
업로드하면 AM/PM 인원수와 연장근무가 자동으로 반영됩니다.

---

## 2. GitHub에 새 저장소로 올리기

실데이터 대시보드와는 **다른 저장소**여야 합니다.

```bash
cd cpc-report-dashboard-app
git init
git add .
git commit -m "Initial commit: CPC 보고용 대시보드"
git branch -M main
git remote add origin https://github.com/<사용자계정>/<새저장소이름>.git
git push -u origin main
```

(GitHub에서 새 저장소를 먼저 만들어두세요: https://github.com/new — Private 권장, 기존 cpc-dashboard-app 저장소와는 별개)

---

## 3. Vercel에 새 프로젝트로 배포

1. https://vercel.com 에서 "Add New Project" → 방금 만든 새 GitHub 저장소 선택 → Import
2. **Storage 탭에서 Postgres를 새로 추가하지 마세요.** 대신 **Settings → Environment Variables**에서
   `DATABASE_URL`을 직접 추가하고, cpc-dashboard-app 프로젝트의 `DATABASE_URL`과 **완전히 동일한 값**을 입력합니다.
   (cpc-dashboard-app의 Vercel 프로젝트 → Settings → Environment Variables에서 값을 복사해오면 됩니다.)
3. 같은 화면에서 추가:
   - `APP_PASSWORD` : 이 프로젝트 로그인 비밀번호
   - `SESSION_SECRET` : 임의의 긴 문자열 (`openssl rand -hex 32`로 생성)
4. **Deploy** 클릭

배포가 끝나면 실데이터 대시보드와는 다른 `https://<새프로젝트이름>.vercel.app` 링크가 생깁니다.

### 최초 배포 후 1회만 실행

로컬 `.env`가 Vercel과 같은 `DATABASE_URL`을 가리키는 상태에서 이미 1번에서 `npx prisma db push`를
실행했다면 별도 작업이 필요 없습니다 (같은 DB이므로 로컬에서 만든 테이블이 그대로 Vercel 배포에도 적용됩니다).

---

## 4. 사용 방법

| 메뉴 | 설명 |
|---|---|
| 대시보드 | 실데이터 대시보드와 동일한 화면/계산 공식. AM/PM 인원+연장근무 기준으로 계산 |
| AM/PM 인원 입력 | 워크센터별·관리인력별 날짜별 AM/PM 인원수 + 연장근무 합계시간 수동 입력 |
| 근무표 엑셀 업로드 | "PNP INVOICE" 형식 엑셀(P&P 시트)을 업로드하면 AM/PM 인원수 + 연장근무가 자동 반영 |

**부서 → 워크센터 매핑** (엑셀 업로드 시 자동 적용):

- Beverages / Alcohol → P1
- Consumable / Bulk, Video / Menu book → P4 (합산)
- Headphone → P3
- SPVR, Floor Manager → 관리 인력 (합산)
- OAL → 제외

**계산 공식** (실데이터 대시보드와 동일):

- 배치 인원수 기준: `그 날 raw CPC 합계 ÷ 그 날 그 워크센터의 AM+PM 인원수`
- 근무시간 기준: `그 날 raw CPC 합계 ÷ (AM 인원×8 + PM 인원×8 + 그 날 연장근무 합계시간)`

---

## 5. 보안 관련 참고

지금 구현은 "공용 비밀번호 1개"로만 접근을 제어하는 가벼운 방식입니다 (실데이터 대시보드와 동일한 방식).
