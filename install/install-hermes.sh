#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT_DIR/install/install-skill.sh" hermes

cat <<'MSG'
✅ korean-engineering-grounded-answer skill installed/updated and hash-verified for Hermes.

Next, add the MCP server to your MCP-capable client.
Do not paste real API keys into shared chat. Set them as environment variables or client-side secrets.

Generic MCP command:
  npx -y github:sonmeggy/korean-engineering-mcp

Required env:
  KCSC_API_KEY
  LAW_API_KEY

Optional env:
  REFERENCE_DIR=/absolute/path/to/engineering/references
  ENGINEERING_OUTPUT_DIR=/absolute/path/to/engineering/outputs
  ENGINEERING_TIMEZONE=Asia/Seoul

Hermes MCP example:
  hermes mcp add korean-engineering-mcp --command npx \
    --env KCSC_API_KEY="$KCSC_API_KEY" LAW_API_KEY="$LAW_API_KEY" \
    --args -y github:sonmeggy/korean-engineering-mcp

Claude Code example:
  claude mcp add korean-engineering-mcp \
    -e KCSC_API_KEY="$KCSC_API_KEY" \
    -e LAW_API_KEY="$LAW_API_KEY" \
    -e REFERENCE_DIR="$REFERENCE_DIR" \
    -e ENGINEERING_OUTPUT_DIR="$ENGINEERING_OUTPUT_DIR" \
    -e ENGINEERING_TIMEZONE="Asia/Seoul" \
    -- npx -y github:sonmeggy/korean-engineering-mcp
MSG
