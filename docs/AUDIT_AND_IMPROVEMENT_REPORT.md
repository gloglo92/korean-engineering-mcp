# korean-engineering-mcp v1.3.1 감사 및 개선 보고서

## 1. 검토 대상과 결론

- 저장소: `sonmeggy/korean-engineering-mcp`
- 기준 커밋: `ceeb811809f6322da89be62703633fe8945b7d44`
- 개선 브랜치: `feat/full-engineering-html-output`
- 검토 결론: 상하수도 중심 구조를 한국 엔지니어링 전 분야 검색 구조로 확장하고, 사용자의 명시적 요청 또는 답변 후 동의를 확인한 경우에만 최종 답변과 동일한 Markdown을 복사·인쇄 친화 HTML 보고서로 내보내는 기능을 구현했다.
- 품질 상태: 단위·MCP stdio·보안·패키징·설치·실제 KCSC/법제처 API·브라우저 렌더링 검증을 통과했다.

“전 분야 지원”은 모든 분야에 동일한 직접 KDS/KCS가 존재한다는 의미가 아니다. 공항·항만·도시·환경·건설사업관리처럼 기준이 소관기관에 분산된 분야는 `partial`로 표시하고 법령·행정규칙 및 기관 최신 기준 추가 확인을 요구한다.

## 2. 기존 구조에서 확인한 한계

1. 로컬 참고자료가 상수도·하수도 해설편 파일에 고정돼 있었다.
2. 분야 분류체계·동의어·KDS/KCS 코드 계열·법령 검색 힌트의 공통 레지스트리가 없었다.
3. 복합 질문을 한 분야로만 취급해 도로 배수, 철도역사, 공항터미널 같은 인터페이스 문제를 충분히 표현하기 어려웠다.
4. `max_evidence`가 출처별 상한처럼 작동할 수 있어 결과 크기를 예측하기 어려웠다.
5. 검색 후보와 조문·절까지 조회한 직접 근거의 상태 구분이 약했다.
6. 기준검색의 `ALL`에 기관·지자체 기준이 혼입될 수 있었다.
7. 최종 답변을 동일 내용의 보고용 HTML 파일로 제공하는 기능이 없었다.
8. 분야별 실제 검색 가용성을 `configured/indexed/partial/unavailable`로 보여주지 못했다.

## 3. 적용한 개선

### 3.1 전 분야 레지스트리와 검색 계획

- `data/engineering-domains.json`에 25개 분야와 별칭, KDS/KCS 코드 계열, 법령·행정규칙 검색 힌트, coverage 한계를 정의했다.
- `src/domains.js`에 자동 분류와 명시적 분야 검증, 복수 분야 검색계획을 구현했다.
- `list_engineering_domains`와 `classify_engineering_domain` 도구를 추가했다.
- `list_engineering_domains`는 제공자 및 분야별 coverage 상태를 반환한다.

### 3.2 전 분야 로컬 참고자료

- `REFERENCE_DIR` 아래 `.md`, `.markdown`, `.txt` 파일을 제한된 깊이·개수·크기로 색인한다.
- 문서별 `domain_key`를 유지하면서 `domain_keys`와 `domain_labels`를 추가해 복합 분야 문서를 지원한다.
- 결과는 `local_reference_unverified`로 표시하며 법령·KDS/KCS보다 우선하지 않는다.
- 원문 파일 경로를 도구 입력으로 받지 않고 색인 루트 내부의 메타데이터만 반환한다.

### 3.3 근거 묶음과 하위호환

- `grounded_engineering_research`에 분야 자동분류와 전 분야 로컬자료를 연결했다.
- `max_evidence`를 법령·행정규칙·KDS/KCS·해석례·로컬자료를 합산한 전역 상한으로 적용했다.
- 출처 다양성을 유지하는 round-robin budget을 사용하고, 직접 절이 있는 건설기준을 우선 정렬한다.
- 공통 근거 필드 `source_kind`, `result_stage`, `authority_tier`를 추가했다.
- 기존 도구명·텍스트 JSON 응답을 유지하고 `structuredContent`를 추가했다.
- 기존 `design_manual_commentary` 응답 필드는 별칭으로 유지했다.
- `search_standards`의 기본 `ALL`은 KDS+KCS로 한정하고, 기관·지자체 기준은 `include_local_standards=true`일 때만 포함한다.

### 3.4 HTML 보고서

- `src/html-renderer.js`와 `templates/engineering-report.html`을 추가했다.
- HTML은 선택사항이며 일반 답변 직후 자동 생성하지 않는다.
- 사용자가 현재 요청에서 HTML을 명시적으로 요구했거나 답변 후 생성 제안에 동의한 경우에만 `user_confirmed_html=true`로 `render_engineering_answer_html`을 호출한다.
- `user_confirmed_html=false`이면 `user_confirmation_required` 오류를 반환하고 파일을 쓰지 않는다.
- `render_engineering_answer_html` 도구가 확인된 최종 답변 Markdown을 전용 출력 디렉터리에 단일 HTML로 저장한다.
- 결과에는 `answer_markdown_sha256`와 `html_sha256`가 포함되고, 실제 렌더링된 엔지니어링 Markdown 본문 해시는 HTML 메타에도 기록된다.
- 디자인은 엔지니어링 검토보고서용 네이비·청록 팔레트, 제목·메타정보·표·목록·인용문·코드·A4 인쇄·Word 복사에 최적화했다.
- 브라우저의 `보고서 복사` 버튼은 지원 환경에서 HTML과 plain text를 함께 복사한다.

### 3.5 HTML 및 파일 보안

- raw HTML 비활성화
- `https:` 링크만 활성화
- 외부 이미지는 대체텍스트로 변환
- CSP, referrer 차단, iframe/object/form/base/connect 차단
- Markdown 최대 120,000자, HTML 최대 2 MiB
- 파일명 정규화와 출력 루트 범위 확인
- 기존 파일 덮어쓰기 금지 및 순번 파일명 사용
- 출력 디렉터리 `0700`, 파일 `0600`
- 비밀값을 결과·HTML·문서·로그에 포함하지 않음

## 4. 검증 결과

### 4.1 자동 테스트

- 명령: `npm run verify`
- 결과: 28 tests / 28 passed / 0 failed
- 검사: 구문, 단위, MCP stdio discovery/call, 보안, 패키징, 운영 의존성 audit
- `npm audit --omit=dev --audit-level=moderate`: 취약점 0건
- `npm pack --dry-run`: 런타임 소스·도메인 데이터·Skill·문서·스크립트·HTML 템플릿 포함 확인

### 4.2 Node.js 호환성

동일한 28개 테스트를 다음 런타임에서 각각 통과했다.

- Node.js 18.20.8
- Node.js 20.20.2
- Node.js 22.23.1

### 4.3 실제 외부 API 스모크

실제 KCSC와 법제처 Open API를 사용해 다음 대표 분야를 검증했다.

- 도로
- 철도
- 도시계획
- 하천
- 항만
- 공항
- 건축
- 상수도
- 하수도

결과:

- 9/9 분야 분류 일치
- 9/9 근거 후보 검색 성공
- API 오류 0건
- 각 분야 `selected_count <= max_evidence(5)` 확인
- 법령·행정규칙 직접 조문 또는 건설기준 직접 절의 존재 여부를 별도 집계

### 4.4 설치 스모크

격리된 임시 HOME/HERMES_HOME에서 검증했다.

- 대화형 설치 스크립트의 비대화형 실행 성공
- 환경파일 필수·선택 필드 생성 확인
- 환경파일 권한 `0600` 확인
- Hermes Skill 설치 성공
- Hermes 전용 설치 스크립트 성공

### 4.5 HTML 시각·인쇄 검증

- Chromium headless로 실제 보고서를 렌더링했다.
- 1440×1800 PNG 스크린샷 생성 성공
- PDF 생성 성공, 2페이지 확인
- 한글·표·목록·인용문·메타정보의 겹침과 잘림 없음
- 최초 QA에서 헤더 제목 대비 부족을 발견해 흰색으로 수정하고 재검증했다.

## 5. 주요 파일

- `index.js`: MCP 도구 등록과 근거 검색 orchestration
- `data/engineering-domains.json`: 전 분야 레지스트리
- `src/domains.js`: 분야 분류와 검색계획
- `src/references.js`: 전 분야 로컬자료 색인·검색
- `src/html-renderer.js`: HTML 렌더링·보안·출력
- `templates/engineering-report.html`: 보고서 디자인 템플릿
- `scripts/smoke-live.mjs`: 실제 API 분야별 스모크
- `docs/DOMAIN_COVERAGE.md`: 분야·코드 계열·coverage 유지관리 문서
- `skills/korean-engineering-grounded-answer/SKILL.md`: 근거 기반 답변·HTML 제공 정책

## 6. 운영상 한계와 후속 권고

1. 검색 결과는 근거 후보이며 최종 설계·법적 판단 전 시행일과 직접 조문·기준 절을 확인해야 한다.
2. 항만·공항 등 기관 기준은 KCSC만으로 완전하지 않을 수 있으므로 최신 소관기관 원문을 추가 확인해야 한다.
3. 로컬 참고자료의 저작권·배포권·기밀등급은 운영자가 관리해야 하며 저장소에 원문을 커밋하지 않는다.
4. 향후 각 분야의 실제 프로젝트 fixture와 기관별 기준 provider를 추가할 때에도 coverage를 과장하지 않는다.
5. 응답 스키마를 크게 변경할 경우 기존 도구를 유지하고 versioned 신규 도구 또는 schema version을 사용한다.
