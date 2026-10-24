# 위마망 GA4 유입 분석 연결

이 기능은 ROAS Pilot에서 GA4 **세션 데이터**를 읽기 전용으로 조회합니다. 기존 메타 광고·카페24·네이버·원가 자료를 변경하지 않습니다.

## 연결 순서

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 만들거나 선택합니다.
2. **Google Analytics Data API**를 사용 설정합니다.
3. **IAM 및 관리자 → 서비스 계정**에서 새 계정을 만들고, 서비스 계정 JSON 키를 PC에 다운로드합니다.
4. [Google Analytics](https://analytics.google.com/) → 위마망 자사몰 → 관리 → **속성 액세스 관리**에서 해당 서비스 계정 이메일에 **뷰어(Viewer)** 권한을 부여합니다. 광고 계정이나 트루버 GA4 속성의 권한을 추가할 필요가 없습니다.
5. ROAS Pilot `http://127.0.0.1:3000` → **설정 관리 → GA4 유입 분석**에서 속성 ID `560644825` 확인 → JSON 키 파일 선택 → **Windows 암호화 저장**.
6. **GA4 연결 테스트·조회** 버튼으로 실제 권한을 검증합니다. UTM 광고 ID 별 세션이 표시될 수 있습니다.

> **보안:** JSON 키 파일이나 개인키를 GitHub, 채팅, 광고 설정에 붙여넣지 마세요. ROAS Pilot은 JSON을 로컬 Windows 사용자별 DPAPI로 암호화한 후 `.roas-private/ga4-service-account.dpapi`에 보관합니다. 브라우저에 키를 저장하지 않고, Google API에는 읽기 권한 `analytics.readonly`으로 접근합니다. 서비스 계정이 불필요해지면 GA4 뷰어 권한을 회수하고 Google Cloud에서 JSON 키를 폐기하세요.

## 데이터 해석

- 조회 지표는 **GA4 세션 / 참여 세션 / 페이지 조회**입니다. 구매·ROAS·수익·증대기여 지표가 아닙니다.
- 메타 광고의 `utm_content={{ad.id}}`가 **실제 숫자 광고 ID**로 전달되어야 GA4와 광고를 연결할 수 있습니다. `utm_medium=paid_social` 세션만 합산하며 UTM이 없는 방문은 '매칭 불가'로 구분합니다.
- 메타 링크 클릭 수와 GA4 방문 세션 수는 서로 다른 집계 방식이며 동일 수치를 보장하지 않습니다.
- GA4 신규 설치 이전의 방문 정보는 복원할 수 없습니다. 일반 보고서 반영에 지연이 있을 수 있습니다.
- 조회 범위는 한 번에 최대 90일, 결과는 10분간 메모리에 캐시되며 Google API의 쿼터를 고려해 최대 10,000행을 조회합니다. 행이 초과되면 일부 집계임을 표시합니다.
- **중요:** 현재 위마망 사이트의 GA4는 기본 방문자 추적만 설치됐고 `purchase` 이벤트의 정상 수신은 확인되지 않았습니다. 실제 주문 분석은 카페24/네이버 주문 API를 별도로 사용합니다.

## 구현 참고

- ROAS Pilot v2.8.81의 기본 업데이터 호환성을 위해 GA4 API 클라이언트는 `server.js`에도 내장되어 있습니다.
- 원본 코드 `integrations/ga4/data.js`를 수정하면 반드시 server.js의 `BEGIN GA4 READ-ONLY CLIENT`~`END GA4 READ-ONLY CLIENT` 구간을 일치시켜야 하며 `tests/ga4.test.js`에서 불일치 여부를 검사합니다.
- API: `GET /api/ga4/status`, `POST /api/ga4/settings`, `DELETE /api/ga4/settings`, `GET /api/ga4/report?since=YYYY-MM-DD&until=YYYY-MM-DD`
- 인증정보 저장·삭제는 Windows `127.0.0.1:3000`의 로컬 POST/DELETE 헤더 검사를 요구하며, report는 읽기 전용 API입니다.
