# Cross-client installation guide

이 프로젝트는 두 계층을 함께 설치하는 것을 권장합니다.

- **MCP server**: 한국 엔지니어링 전 분야의 법령, 행정규칙, 해석례, KDS/KCS, 선택적 로컬 기술자료를 검색하고 HTML 보고서를 생성합니다.
- **Skill / instruction package**: 근거 우선, 출처 계층, 정확한 인용, 종합 판단, 근거 부족 시 단정 금지, 채팅/HTML 동일 내용 규칙을 적용합니다.

클라이언트가 MCP만 지원하면 MCP를 설치하고 `skills/korean-engineering-grounded-answer/SKILL.md`를 프로젝트/사용자 지침에 복사하세요.

## URL-only install request

직원은 AI 도구에 아래처럼 요청할 수 있습니다.

```text
https://github.com/sonmeggy/korean-engineering-mcp 설치해줘
```

설치 에이전트는 `AGENT_INSTALL.md`를 읽고 다음만 사용자에게 확인합니다.

- `KCSC_API_KEY`
- `LAW_API_KEY`
- 선택 `REFERENCE_DIR`: 전 분야 `.md/.markdown/.txt` 참고자료 루트
- 선택 `ENGINEERING_OUTPUT_DIR`: HTML 출력 폴더

키 값은 채팅에 다시 출력하지 않습니다.

## Minimal command

```bash
npx -y github:sonmeggy/korean-engineering-mcp
```

필수/선택 환경변수:

```dotenv
KCSC_API_KEY=...
LAW_API_KEY=...
REFERENCE_DIR=/absolute/path/to/engineering/references
ENGINEERING_OUTPUT_DIR=/absolute/path/to/engineering/outputs
ENGINEERING_TIMEZONE=Asia/Seoul
```

## Generic MCP JSON

```json
{
  "mcpServers": {
    "korean-engineering-mcp": {
      "command": "npx",
      "args": ["-y", "github:sonmeggy/korean-engineering-mcp"],
      "env": {
        "KCSC_API_KEY": "${KCSC_API_KEY}",
        "LAW_API_KEY": "${LAW_API_KEY}",
        "REFERENCE_DIR": "${REFERENCE_DIR}",
        "ENGINEERING_OUTPUT_DIR": "${ENGINEERING_OUTPUT_DIR}",
        "ENGINEERING_TIMEZONE": "Asia/Seoul"
      }
    }
  }
}
```

## Claude Code

```bash
claude mcp add korean-engineering-mcp \
  -e KCSC_API_KEY="$KCSC_API_KEY" \
  -e LAW_API_KEY="$LAW_API_KEY" \
  -e REFERENCE_DIR="$REFERENCE_DIR" \
  -e ENGINEERING_OUTPUT_DIR="$ENGINEERING_OUTPUT_DIR" \
  -e ENGINEERING_TIMEZONE="Asia/Seoul" \
  -- npx -y github:sonmeggy/korean-engineering-mcp
```

## Hermes

Skill 설치:

```bash
./install/install-hermes.sh
```

MCP 등록 명령 형식:

```bash
hermes mcp add korean-engineering-mcp \
  --command npx \
  --env KCSC_API_KEY="$KCSC_API_KEY" LAW_API_KEY="$LAW_API_KEY" REFERENCE_DIR="$REFERENCE_DIR" ENGINEERING_OUTPUT_DIR="$ENGINEERING_OUTPUT_DIR" ENGINEERING_TIMEZONE="Asia/Seoul" \
  --args -y github:sonmeggy/korean-engineering-mcp

hermes mcp test korean-engineering-mcp
```

설치된 도구 중 다음이 보여야 합니다.

- `list_engineering_domains`
- `classify_engineering_domain`
- `grounded_engineering_research`
- `search_reference_documents`
- `render_engineering_answer_html`

## OpenClaw / Antigravity / VS Code 계열

- OpenClaw: 배포판의 MCP 설정에 Generic JSON을 등록하고 Skill 본문을 agent/project instructions에 적용합니다.
- Antigravity: MCP 설정을 등록하고 지원되는 경우 `./install/install-skill.sh antigravity`를 사용합니다.
- VS Code/Copilot/Cline/Cursor: 확장이 MCP를 지원하면 Generic JSON을 등록합니다. 정식 Skill 기능이 없으면 `SKILL.md`를 `.github/copilot-instructions.md` 또는 확장별 rule 파일에 반영합니다.

Skill 설치 도우미:

```bash
./install/install-skill.sh hermes
./install/install-skill.sh claude
./install/install-skill.sh antigravity
./install/install-skill.sh vscode
```

`vscode` 모드는 기존 `.github/copilot-instructions.md`를 덮어쓰지 않습니다.

## Guided installer

```bash
./install/setup-interactive.sh --client hermes
```

비대화형 실행:

```bash
CLIENT=hermes \
KCSC_API_KEY="$KCSC_API_KEY" \
LAW_API_KEY="$LAW_API_KEY" \
REFERENCE_DIR="$REFERENCE_DIR" \
ENGINEERING_OUTPUT_DIR="$ENGINEERING_OUTPUT_DIR" \
./install/setup-interactive.sh
```

로컬 env 파일은 기본 `~/.korean-engineering-mcp.env`에 `0600` 권한으로 저장됩니다.

## Verification

1. MCP 연결/도구 목록:

```bash
hermes mcp test korean-engineering-mcp
```

2. 분야 분류 질문:

```text
공항 활주로 안전구역 기준을 검토하기 위한 분야와 검색 계획을 만들어줘.
```

3. 근거 조사 질문:

```text
도로 배수시설 설계기준과 관련 법령을 grounded_engineering_research로 확인해서 답해줘.
```

4. HTML 질문:

```text
답변과 동일한 내용의 HTML 엔지니어링 보고서도 생성해줘.
```

확인 항목:

- `output_path`가 설정한 `ENGINEERING_OUTPUT_DIR` 아래인지
- HTML에 제목, 본문, `보고서 복사`, `인쇄 / PDF`가 있는지
- `answer_markdown_sha256`과 HTML meta의 hash가 동일한지
- 같은 파일명 재생성 시 기존 파일을 덮어쓰지 않는지

## Reference directory policy

- `.md`, `.markdown`, `.txt`만 색인합니다.
- 심볼릭 링크는 따라가지 않습니다.
- 기본 제한: 50개 파일, 파일당 5 MiB, 깊이 3.
- 로컬 문서는 `local_reference_unverified`로 표시됩니다.
- 발행기관·판·개정일·원문을 확인하기 전에는 법령/KDS/KCS보다 우선하지 않습니다.

## Token minimization

- `grounded_engineering_research`를 먼저 사용하고 `max_evidence` 5~8을 권장합니다.
- 상세 조회는 상위 1~3개 기준/법령에 한정합니다.
- `render_engineering_answer_html.include_html`은 기본 `false`로 유지합니다.
- 파일 경로를 클라이언트가 사용할 수 없을 때만 `include_html=true`를 사용합니다.

## Required answer behavior

1. 질문 분야를 분류합니다.
2. 공식 근거를 먼저 검색합니다.
3. 검색결과 제목과 직접 조문/절을 구분합니다.
4. 출처 효력과 적용성을 종합해 결론을 냅니다.
5. 근거가 부족하면 `근거 불충분`으로 표시합니다.
6. HTML 요청 시 최종 Markdown과 동일한 본문을 렌더링합니다.
