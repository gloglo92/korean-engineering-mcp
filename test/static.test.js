import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const skill = readFileSync(new URL('../skills/korean-engineering-grounded-answer/SKILL.md', import.meta.url), 'utf8');
const domains = readFileSync(new URL('../data/engineering-domains.json', import.meta.url), 'utf8');
const htmlRenderer = readFileSync(new URL('../src/html-renderer.js', import.meta.url), 'utf8');
const htmlTemplate = readFileSync(new URL('../templates/engineering-report.html', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('does not ship a hard-coded LAW API key fallback', () => {
  assert.doesNotMatch(index, /dohwa3547/);
  assert.match(index, /const LAW_KEY\s*=\s*process\.env\.LAW_API_KEY\s*\|\|\s*""/);
});

test('provides grounded research and citation-detail tools', () => {
  assert.match(index, /grounded_engineering_research/);
  assert.match(index, /get_law_detail/);
  assert.match(index, /get_admin_rule_detail/);
  assert.match(index, /law_details/);
  assert.match(index, /admin_rule_details/);
  assert.match(index, /evidence_status/);
  assert.match(index, /source_hierarchy/);
  assert.match(index, /근거 불충분|직접 근거 미확인/);
});

test('skill enforces evidence-first and citation-first answers', () => {
  assert.match(skill, /Do \*\*not\*\* answer from general knowledge alone/);
  assert.match(skill, /Source hierarchy/);
  assert.match(skill, /Required answer format/);
  assert.match(skill, /근거 불충분/);
});

test('README documents MCP plus skill installation', () => {
  assert.match(readme, /MCP server/);
  assert.match(readme, /Skill package/);
  assert.match(readme, /AGENT_INSTALL\.md/);
  assert.match(readme, /setup-interactive\.sh/);
  assert.match(readme, /docs\/INSTALLATION\.md/);
});

test('ships a cross-domain registry for the requested engineering sectors', () => {
  const parsed = JSON.parse(domains);
  for (const key of ['water_supply', 'wastewater', 'road', 'railway', 'urban_planning', 'river', 'port', 'airport', 'architecture']) {
    assert.ok(parsed[key], key);
  }
  assert.match(index, /list_engineering_domains/);
  assert.match(index, /classify_engineering_domain/);
  assert.match(index, /domain_context/);
});

test('ships secure copy and print friendly HTML output', () => {
  assert.match(index, /render_engineering_answer_html/);
  assert.match(htmlRenderer, /html:\s*false/);
  assert.match(htmlRenderer, /linkify:\s*false/);
  assert.match(htmlRenderer, /protocol === "https:"/);
  assert.match(htmlRenderer, /MAX_MARKDOWN_CHARS = 120_000/);
  assert.match(htmlRenderer, /ENGINEERING_OUTPUT_DIR/);
  assert.match(htmlRenderer, /answer_markdown_sha256/);
  assert.match(htmlTemplate, /Content-Security-Policy/);
  assert.match(htmlTemplate, /보고서 복사/);
  assert.match(htmlTemplate, /인쇄 \/ PDF/);
  assert.match(htmlTemplate, /@page \{ size: A4/);
});

test('npm package includes runtime source, domain data, and HTML template', () => {
  for (const entry of ['src/', 'data/', 'templates/', 'scripts/']) {
    assert.ok(packageJson.files.includes(entry), entry);
  }
  assert.equal(packageJson.dependencies['@modelcontextprotocol/sdk'], '^1.29.0');
});
