# FICC Monitor

Google Drive `AI_Credit` 폴더의 `FICC_Monitor.html` 화면과 `data_info.xlsx`의
`DailyRate` 저장값을 반영한 한국어 FICC 웹 대시보드입니다.

## 제공 기능

- 주요국 금리·수익률곡선, 크레딧, 외환·헤지, 채권 수급·선물
- 기간스프레드·크레딧스프레드, 만기 일치·선형 보간·기준금리 직접 선택
- 상관·절편 포함 OLS 회귀, 이동 상관·표준편차·Z-score
- 분석 시작일·종료일 설정, Excel 업로드, CSV 및 데이터 포함 HTML 저장
- 지표 검색 및 원본 열·필드·단위·결측 정보 확인

## 데이터 기준

2026-10-14에 읽은 원본의 2001-01-02~2026-10-13, 6,160개 날짜행과
302개 시계열을 사용합니다. 원본의 0과 결측을 구분하여 보존합니다.
기존 260개 지표의 식별 키를 유지하고 새로운 42개를 뒤에 추가했습니다.
열 위치가 바뀌어도 Category·DATES·필드 조합으로 연결합니다.

신규 42개 지표에는 원본의 단위 기재가 없어 `원자료` 단위와 절대 차분을
사용합니다. 단위를 확인하기 전에는 금리차 스프레드 후보에서 제외합니다.
기존 OAS 등의 단위 해석 및 0값 주의사항은 화면의 계산 기준에서 확인할 수 있습니다.
이전 HTML 대비 과거 8개 계열의 2,476개 값이 원본에서 개정되었습니다. 최신 Excel 저장값을 그대로 사용했습니다.
원본의 시장 정확성이나 미래 예측력을 검증한 도구는 아닙니다.

초기 데이터는 공개 홈페이지에 포함된 스냅샷입니다. Drive 자동 동기화와
실시간 시세 연결은 없습니다. 화면에서 선택한 Excel은 브라우저 안에서만
처리되며 서버나 GitHub에 전송되지 않습니다. 페이지를 새로고침하면 기본
스냅샷으로 돌아갑니다. 갱신본 보관은 `현재 데이터로 HTML 저장`을 사용하세요.

## 실행 및 배포

`index.html`은 CSS·JSZip·차트·압축 데이터를 포함한 단일 파일입니다.
외부 CDN이나 API 키 없이 최신 Chrome, Edge, Firefox, Safari에서 실행하도록
구성했습니다. 인터넷 연결 없이 내려받은 파일을 열어도 사용할 수 있습니다.

GitHub Pages는 `gh-pages` 브랜치의 루트를 게시합니다. 최초 자동 활성화가
되지 않는 경우 저장소 Settings → Pages에서 `Deploy from a branch`,
`gh-pages`, `/(root)`를 선택합니다.

## 데이터 재빌드

Python 3 표준 라이브러리만 사용하며 수식을 실행하지 않고 저장된 계산값을 읽습니다.
`scripts/reference-meta.json`은 식별 키와 단위 기준입니다. 새 지표의 단위는
확인 전까지 임의로 정하지 않습니다.

```bash
python scripts/update_data.py data_info.xlsx --reference scripts/reference-meta.json --output data.json --retrieved 2026-10-14
python scripts/build_site.py data.json
```

`template.html`은 데이터 삽입 전 개발용 원본이며, 홈페이지 진입 파일은
`index.html`입니다. 수정 후 동일한 `index.html`을 `main`과 `gh-pages`에 반영하세요.

## 검증 범위

원본 XLSX의 독립 읽기 경로 대조, 날짜·식별 키·결측 보존, JavaScript 구문,
금리차·보간·OLS·날짜 경계조건을 점검했습니다. 실제 브라우저의 전체 화면·
상호작용 검증과 외부 시세의 정확성 검증은 별도입니다.

JSZip 3.10.1의 MIT 라이선스 고지는 HTML 내부에 보존되어 있습니다.
