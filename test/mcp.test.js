import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function withClient(fn) {
  const outputDir = mkdtempSync(join(tmpdir(), 'kemcp-mcp-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../index.js', import.meta.url).pathname],
    env: {
      ...process.env,
      KOREAN_ENGINEERING_MCP_SKIP_AUTOSTART: '0',
      ENGINEERING_OUTPUT_DIR: outputDir,
      ENGINEERING_TIMEZONE: 'Asia/Seoul',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'korean-engineering-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    await fn(client, outputDir);
  } finally {
    await client.close();
  }
}

function parseToolText(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  assert.ok(text, 'tool must return text content');
  return JSON.parse(text);
}

test('MCP stdio discovery exposes legacy and new tools', async () => {
  await withClient(async (client) => {
    const listed = await client.listTools();
    const names = new Set(listed.tools.map((tool) => tool.name));
    for (const name of [
      'search_standards',
      'get_standard_detail',
      'search_laws',
      'grounded_engineering_research',
      'list_engineering_domains',
      'classify_engineering_domain',
      'search_reference_documents',
      'render_engineering_answer_html',
    ]) {
      assert.ok(names.has(name), name);
    }
    assert.ok(names.size >= 14);
  });
});

test('MCP domain catalogue reports provider and per-domain coverage states', async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: 'list_engineering_domains',
      arguments: { include_search_hints: false, include_coverage: true },
    });
    const payload = parseToolText(result);
    assert.equal(payload.schema_version, '1.3');
    assert.ok(['configured', 'unavailable'].includes(payload.providers.kcsc));
    const airport = payload.domains.find((domain) => domain.key === 'airport');
    assert.ok(airport);
    assert.ok(['partial', 'unavailable'].includes(airport.coverage_status.kcsc_standards));
    assert.deepEqual(result.structuredContent, payload);
  });
});

test('MCP domain classifier returns airport law search hints without external API calls', async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: 'classify_engineering_domain',
      arguments: { question: '공항 활주로 안전구역 설치기준 검토', domain: 'auto' },
    });
    const payload = parseToolText(result);
    assert.equal(payload.detected_domains[0].key, 'airport');
    assert.ok(payload.law_queries.includes('공항시설법'));
    assert.deepEqual(result.structuredContent, payload);
  });
});

test('MCP HTML tool writes a real safe report artifact', async () => {
  await withClient(async (client, outputDir) => {
    const answer = '## 결론\n- **조건부 가능**\n\n## 확인 근거\n- KDS 원문 추가 확인 필요';
    const result = await client.callTool({
      name: 'render_engineering_answer_html',
      arguments: {
        title: '공항 활주로 기준 검토',
        answer_markdown: answer,
        domain: 'airport',
        document_status: '검토용',
        prepared_at: '2026-07-15 12:00 KST',
        filename: '../공항-검토서.html',
      },
    });
    const payload = parseToolText(result);
    assert.ok(payload.output_path.startsWith(outputDir));
    assert.ok(existsSync(payload.output_path));
    const html = readFileSync(payload.output_path, 'utf8');
    assert.match(html, /공항 활주로 기준 검토/);
    assert.match(html, /조건부 가능/);
    assert.match(html, /보고서 복사/);
    assert.equal(payload.answer_markdown_sha256.length, 64);
    assert.equal(payload.html_sha256.length, 64);
    assert.match(html, new RegExp(payload.answer_markdown_sha256));
    assert.deepEqual(result.structuredContent, payload);
  });
});
