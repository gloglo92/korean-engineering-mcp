#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const samples = [
  { domain: 'road', question: '도로 배수시설 설치기준과 관련 법령 검토' },
  { domain: 'railway', question: '철도 노반 배수 설계기준 검토' },
  { domain: 'urban_planning', question: '도시개발 기반시설 설치기준 검토' },
  { domain: 'river', question: '하천 제방 설계기준과 관련 법령 검토' },
  { domain: 'port', question: '항만 방파제 설계기준과 관련 법령 검토' },
  { domain: 'airport', question: '공항 활주로 안전구역 설치기준과 관련 법령 검토' },
  { domain: 'architecture', question: '건축물 내진설계 기준과 관련 법령 검토' },
  { domain: 'water_supply', question: '상수도 배수지 설계기준과 관련 법령 검토' },
  { domain: 'wastewater', question: '하수도 관로 설계기준과 관련 법령 검토' },
];

function parseArgs() {
  const selected = process.argv.slice(2);
  if (!selected.length || selected.includes('all')) return samples;
  const wanted = new Set(selected);
  const chosen = samples.filter((sample) => wanted.has(sample.domain));
  if (!chosen.length) {
    throw new Error(`지원 sample: ${samples.map((sample) => sample.domain).join(', ')}`);
  }
  return chosen;
}

function parseToolText(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error('MCP tool returned no text content');
  return JSON.parse(text);
}

if (!process.env.KCSC_API_KEY || !process.env.LAW_API_KEY) {
  console.error('KCSC_API_KEY and LAW_API_KEY are required. Values are never printed.');
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../index.js', import.meta.url))],
  env: { ...process.env, KOREAN_ENGINEERING_MCP_SKIP_AUTOSTART: '0' },
  stderr: 'pipe',
});
const client = new Client({ name: 'korean-engineering-mcp-live-smoke', version: '1.0.0' });
await client.connect(transport);

let failed = 0;
try {
  for (const sample of parseArgs()) {
    const started = Date.now();
    try {
      const result = await client.callTool({
        name: 'grounded_engineering_research',
        arguments: {
          question: sample.question,
          domain: sample.domain,
          max_evidence: 5,
          compact: true,
          include_local_standards: false,
        },
      });
      const payload = parseToolText(result);
      const summary = payload.evidence_summary || {};
      const detected = payload.domain_context?.detected_domains?.[0]?.key;
      const diagnostics = payload.search_diagnostics || {};
      const lawErrors = diagnostics.law_errors?.length || 0;
      const adminErrors = diagnostics.admin_rule_errors?.length || 0;
      const apiError = Boolean(diagnostics.standard_error || lawErrors || adminErrors);
      const domainOk = detected === sample.domain;
      const candidates = Number(summary.total_candidates || 0);
      const selectedCount = Number(summary.selected_count || 0);
      const budgetOk = selectedCount > 0 && selectedCount <= 5;
      const htmlOptInOk = payload.html_delivery?.optional === true
        && payload.html_delivery?.confirmation_required === true
        && payload.html_delivery?.confirmation_argument?.user_confirmed_html === true;
      const ok = domainOk && !apiError && candidates > 0 && budgetOk && htmlOptInOk;
      if (!ok) failed += 1;
      console.log(JSON.stringify({
        domain: sample.domain,
        detected,
        ok,
        evidence_status: payload.evidence_status,
        total_candidates: candidates,
        selected_count: selectedCount,
        max_evidence: Number(summary.max_evidence || 0),
        html_opt_in: htmlOptInOk,
        direct_standard_sections: summary.direct_standard_sections || 0,
        direct_law_articles: summary.direct_law_articles || 0,
        direct_admin_rule_articles: summary.direct_admin_rule_articles || 0,
        standard_error: diagnostics.standard_error || null,
        law_error_count: lawErrors,
        admin_rule_error_count: adminErrors,
        elapsed_ms: Date.now() - started,
      }));
    } catch (error) {
      failed += 1;
      console.log(JSON.stringify({ domain: sample.domain, ok: false, error: error.message, elapsed_ms: Date.now() - started }));
    }
  }
} finally {
  await client.close();
}

if (failed) process.exit(1);
