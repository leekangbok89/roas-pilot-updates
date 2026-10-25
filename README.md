# roas-pilot-updates
ROAS Pilot Updates

## 상세페이지 분석

**상세페이지 분석** 메뉴는 위마망 상품 458의 콘텐츠 도달·화면 체류·영상 재생 분량을 기존 GA4 읽기 전용 연결로 조회합니다. Clarity 히트맵·녹화는 프로젝트 화면 링크로 연결합니다. Clarity Export API는 사진별 히트맵을 제공하지 않으며 이 기능에서 호출하지 않습니다.

1. **설치 · 연동 설정**에서 현재 측정 ID `G-RZF6S41CF0`와 선택한 Clarity 프로젝트 ID를 저장합니다. GA4 연결 속성에 해당 웹 스트림이 포함되는지 확인합니다.
2. 생성 코드를 카페24의 사용 중인 PC·모바일 상품 상세 스킨에 각각 한 번 설치합니다. 공통 레이아웃에 넣어도 `wemamang.com`, `www.wemamang.com`, `m.wemamang.com`의 지정 상품에서만 동작합니다. 기존 Google 태그·동의 설정을 유지합니다. 동의 관리 도구를 쓰면 해당 설정과 수집 시작/철회 신호를 연결해야 합니다.
3. GA4 **맞춤 정의**에서 `rp_product_id`, `rp_content_version`, `rp_content_id`, `rp_content_type`을 이벤트 범위의 맞춤 측정기준으로, `rp_visible_ms`를 이벤트 범위의 맞춤 측정항목(밀리초)으로 등록합니다.
4. GA4 실시간 또는 DebugView로 `rp_detail_view`, `rp_content_view` 수신을 확인합니다. 일반 보고서와 맞춤 정의 반영은 24~48시간이 걸릴 수 있습니다.

도달은 해당 구간의 절반 이상(뷰포트보다 긴 구간은 뷰포트 절반 이상)이 보인 시간이 누적 1초 이상인 페이지 조회입니다. 이미지는 원본 높이 1,000px 기준으로 최대 50구간으로 나누며 이미지 로딩 후 추적합니다. 체류는 숨겨진 탭과 화면 밖 시간을 제외한 구간별 시간입니다. 도달률의 분모는 추적 페이지 조회이며 사용자 수가 아닙니다. 여러 구간이 동시에 보일 수 있어 체류시간을 합쳐 페이지 전체 시간을 계산하지 않습니다.

MP4·YouTube 재생률은 화면에 보이는 동안 실제 재생한 고유 분량을 기준으로 25/50/75/100%를 기록하고, 98% 이상을 완료로 봅니다. 탐색 이동만으로 완료 처리하지 않습니다. YouTube iframe은 저장된 주소에 `enablejsapi=1`이 필요합니다. GIF는 이미지로 집계합니다. **구매/장바구니 버튼 클릭**은 페이지 조회당 1회이며 실제 결제 성공이나 구매 기여를 뜻하지 않습니다.

상세 구성이 달라지면 **상세페이지 버전**을 변경하고 사이트 설치코드도 교체합니다. 설치 전 데이터는 소급되지 않습니다. GA4 보고서는 선택 상품·버전·기간으로 격리하며 5분 캐시와 최대 93일 제한을 사용합니다. 인증정보는 기존 DPAPI 저장소를 공유하고 설치코드에는 포함하지 않습니다.

```sh
node scripts/bundle-ga4.cjs
node scripts/bundle-shell.cjs
npm test
ROAS_PLAYWRIGHT_MODULE=/path/to/playwright node scripts/smoke-detail-browser.cjs
```

## GA4 유입 분석

왼쪽 메뉴의 **GA4 유입 분석**에서 자사몰의 방문, 참여율, 광고 UTM과 방문 시작 페이지를 확인합니다.

### 처음 연결하기

1. Google Cloud 프로젝트에서 **Google Analytics Data API**를 사용 설정합니다.
2. 서비스 계정을 만들고, 그 이메일을 GA4 속성의 **뷰어**로 추가합니다. 구매매출을 조회하려면 수익 지표 접근 제한이 없어야 합니다.
3. 서비스 계정의 JSON 키를 내려받아 보관합니다.
4. ROAS Pilot → **GA4 유입 분석**에서 숫자형 **속성 ID**와 JSON 파일을 선택하고 **연결 확인 후 저장**을 누릅니다. 위마망 속성 ID는 `560644825`입니다.

`G-`로 시작하는 측정 ID는 이 연결에 사용하지 않습니다. 인증파일은 채팅이나 GitHub에 올릴 필요가 없습니다. Windows PC에서 실행 중인 `http://localhost:3000` 또는 `http://127.0.0.1:3000` 화면에서 등록합니다.

### 데이터 읽기

- **전체 유입 / Meta 유료 유입**을 선택할 수 있습니다. 한 번에 최대 93일이며, 같은 조회는 서버 메모리에 5분간 보관합니다. **새로 가져오기**는 이 캐시를 갱신합니다.
- 광고 UTM의 `utm_content`에 Meta 광고 ID를 넣으면, 선택 기간에 이 PC에 저장된 Meta 광고 기록의 이름과 연결합니다. 아직 저장하지 않은 광고는 원본 UTM을 표시합니다.
- 요약의 사용자 수·비율·평균은 별도 GA4 합계 조회 결과입니다. 여러 광고를 방문한 사용자가 중복될 수 있어 표의 사용자 수를 더하지 않습니다.
- 평균 세션 시간은 방문 전체의 시간입니다. 상세페이지의 특정 영역을 실제로 읽은 시간을 뜻하지 않습니다.
- 구매 이벤트 수신 검사는 **선택 기간의 속성 전체** 기준입니다. 수신이 확인되지 않으면 구매·매출을 **미확인**으로 표시합니다. 이벤트가 수신되어도 주문 누락·중복·금액 정확성은 주문 데이터와 대조해야 합니다.
- GA4 구매매출, Meta 광고 귀속 매출, 쇼핑몰 주문매출은 각각의 기준으로 표시합니다. 기존 매출·이익 계산에 GA4 매출을 더하지 않습니다.
- 표는 세션 수 기준 최대 5,000행을 받으며, 전체 행 수가 더 크거나 GA4가 표본·기준점·데이터 제한을 알려주면 보고서에 표시합니다.

새로 설치한 태그의 일반 보고서 반영에는 24~48시간이 걸릴 수 있습니다. 설치 이전 방문은 소급 수집되지 않습니다. Google 공식 안내: [데이터 최신성](https://support.google.com/analytics/answer/11198161?hl=ko), [Data API 시작하기](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart), [지표·차원 정의](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema).

### 인증정보와 업데이트

서비스 계정 키는 Windows DPAPI의 현재 사용자 범위로 암호화해 `.roas-private/ga4.dpapi`에 저장합니다. 원본 JSON이나 액세스 토큰을 브라우저 저장소·로그·배포물에 기록하지 않습니다. Google 읽기 전용 권한으로만 보고서를 요청하며, 연결 검사가 성공한 뒤 새 설정을 저장합니다. 실패하면 기존 설정을 유지합니다. **연결 해제**는 이 PC의 저장된 GA4 설정을 삭제하며 Google의 서비스 계정 키 자체를 폐기하지는 않습니다.

기존 버전의 업데이트 프로그램이 새 파일을 복사하지 못하는 경우를 위해 GA4 실행 코드와 화면을 `server.js`에도 포함합니다. 수정 후 다음 생성·검증을 실행합니다.

```sh
node scripts/bundle-shell.cjs
node scripts/bundle-ga4.cjs
node scripts/bundle-shell.cjs --check
node scripts/bundle-ga4.cjs --check
npm test
```

GA4 클라이언트의 편집 원본은 `integrations/ga4/client.cjs`, 화면 원본은 `public/ga4.html`, `public/ga4.js`, `public/ga4.css`입니다. 실제 인증키 없이 합성 키와 응답으로 인증·집계·실패 보존을 검증하며, `scripts/smoke-ga4-browser.cjs`가 브라우저 연결 흐름과 기존 버전 업데이트 경로를 확인합니다.
