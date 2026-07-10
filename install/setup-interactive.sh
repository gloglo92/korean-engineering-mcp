#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_OUT="${KOREAN_ENGINEERING_MCP_ENV:-$HOME/.korean-engineering-mcp.env}"
REPO_SPEC="github:sonmeggy/korean-engineering-mcp"

usage() {
  cat <<'USAGE'
Usage: setup-interactive.sh [--client claude|hermes|openclaw|antigravity|vscode|generic]

비대화형(AI 에이전트/CI) 실행 시에는 --client 옵션 또는 CLIENT 환경변수와 함께
KCSC_API_KEY, LAW_API_KEY 환경변수를 미리 설정하고 실행하세요:

  CLIENT=claude KCSC_API_KEY=... LAW_API_KEY=... ./install/setup-interactive.sh
  ./install/setup-interactive.sh --client claude   # 키는 환경변수로 주입
USAGE
}

CLIENT="${CLIENT:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --client) CLIENT="${2:-}"; shift 2 ;;
    --client=*) CLIENT="${1#--client=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

printf 'Korean Engineering MCP + Skill installer\n'
printf '=========================================\n\n'

# 터미널이 아닌 곳(에이전트/CI)에서 실행되면 프롬프트 없이 진행하고,
# 필수값이 없으면 즉시 명확한 오류를 낸다.
INTERACTIVE=0
if [ -t 0 ]; then
  INTERACTIVE=1
fi

if [ -z "$CLIENT" ]; then
  if [ "$INTERACTIVE" = "1" ]; then
    printf 'Client type [claude/hermes/openclaw/antigravity/vscode/generic] (default: generic): '
    read -r CLIENT || true
  fi
  CLIENT="${CLIENT:-generic}"
fi

if [ "$INTERACTIVE" = "1" ]; then
  if [ -z "${KCSC_API_KEY:-}" ]; then
    printf 'KCSC_API_KEY 입력: '
    read -rs KCSC_API_KEY
    printf '\n'
  fi
  if [ -z "${LAW_API_KEY:-}" ]; then
    printf 'LAW_API_KEY 입력: '
    read -rs LAW_API_KEY
    printf '\n'
  fi
  if [ -z "${REFERENCE_DIR:-}" ]; then
    printf 'REFERENCE_DIR 입력(선택, 없으면 Enter): '
    read -r REFERENCE_DIR || true
  fi
fi

if [ -z "${KCSC_API_KEY:-}" ] || [ -z "${LAW_API_KEY:-}" ]; then
  echo 'ERROR: KCSC_API_KEY와 LAW_API_KEY는 필수입니다.' >&2
  if [ "$INTERACTIVE" = "0" ]; then
    echo '비대화형 실행에서는 환경변수로 미리 설정한 뒤 실행하세요. (--help 참고)' >&2
  fi
  exit 1
fi

# dotenv 호환 형식으로 기록 (작은따옴표 안의 작은따옴표는 이스케이프)
env_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

umask 077
{
  printf 'KCSC_API_KEY=%s\n' "$(env_quote "$KCSC_API_KEY")"
  printf 'LAW_API_KEY=%s\n' "$(env_quote "$LAW_API_KEY")"
  if [ -n "${REFERENCE_DIR:-}" ]; then
    printf 'REFERENCE_DIR=%s\n' "$(env_quote "$REFERENCE_DIR")"
  fi
} > "$ENV_OUT"
chmod 600 "$ENV_OUT"

install_skill() {
  local target="$1"
  "$ROOT_DIR/install/install-skill.sh" "$target"
}

case "$CLIENT" in
  claude)
    install_skill claude || true
    if command -v claude >/dev/null 2>&1; then
      echo 'Claude Code MCP 등록을 시도합니다.'
      if [ -n "${REFERENCE_DIR:-}" ]; then
        claude mcp add korean-engineering-mcp \
          -e KCSC_API_KEY="$KCSC_API_KEY" \
          -e LAW_API_KEY="$LAW_API_KEY" \
          -e REFERENCE_DIR="$REFERENCE_DIR" \
          -- npx -y "$REPO_SPEC"
      else
        claude mcp add korean-engineering-mcp \
          -e KCSC_API_KEY="$KCSC_API_KEY" \
          -e LAW_API_KEY="$LAW_API_KEY" \
          -- npx -y "$REPO_SPEC"
      fi
    else
      echo 'claude 명령을 찾지 못했습니다. 아래 Generic MCP JSON을 사용하세요.'
    fi
    ;;
  hermes)
    install_skill hermes || true
    echo 'Hermes MCP 설정은 사용 중인 Hermes 버전에 맞춰 아래 Generic MCP JSON 또는 hermes mcp add 명령으로 등록하세요.'
    ;;
  openclaw)
    echo 'OpenClaw는 사용 중인 MCP 설정 파일/명령이 배포판별로 다를 수 있습니다. 아래 Generic MCP JSON을 등록하세요.'
    ;;
  antigravity)
    install_skill antigravity || true
    echo 'Antigravity MCP 설정에 아래 Generic MCP JSON을 등록하세요.'
    ;;
  vscode)
    install_skill vscode || true
    echo 'VS Code 계열 확장(Copilot/Cline/Cursor 등)의 MCP 설정에 아래 Generic MCP JSON을 등록하세요.'
    ;;
  generic)
    echo 'Generic client mode: 아래 MCP JSON을 사용하세요.'
    ;;
  *)
    echo "알 수 없는 client type: $CLIENT" >&2
    exit 2
    ;;
esac

cat <<EOF

설정 파일이 생성되었습니다: $ENV_OUT
- API 키 값은 화면에 다시 표시하지 않습니다.
- 이 파일은 백업/참고용입니다. 셸에서 'set -a; . $ENV_OUT; set +a'로 불러오거나,
  MCP 클라이언트 설정의 env 항목에 동일한 값을 넣으세요.
- REFERENCE_DIR은 선택사항입니다. 상수도/하수도 설계기준 해설편 Markdown 파일이 있으면 지정하세요.

Generic MCP JSON:
{
  "mcpServers": {
    "korean-engineering-mcp": {
      "command": "npx",
      "args": ["-y", "$REPO_SPEC"],
      "env": {
        "KCSC_API_KEY": "<입력한 KCSC_API_KEY>",
        "LAW_API_KEY": "<입력한 LAW_API_KEY>",
        "REFERENCE_DIR": "${REFERENCE_DIR:-}"
      }
    }
  }
}

설치 후 확인 질문 예시:
  하수도 기술진단 주기와 근거를 찾아서 답해줘
EOF
