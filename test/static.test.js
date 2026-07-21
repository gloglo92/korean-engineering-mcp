import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const skill = readFileSync(new URL('../skills/korean-engineering-grounded-answer/SKILL.md', import.meta.url), 'utf8');
const domains = readFileSync(new URL('../data/engineering-domains.json', import.meta.url), 'utf8');
const htmlRenderer = readFileSync(new URL('../src/html-renderer.js', import.meta.url), 'utf8');
const mathRenderer = readFileSync(new URL('../src/math-renderer.js', import.meta.url), 'utf8');
const htmlTemplate = readFileSync(new URL('../templates/engineering-report.html', import.meta.url), 'utf8');
const skillSync = readFileSync(new URL('../scripts/sync-skill.mjs', import.meta.url), 'utf8');
const guidedInstaller = readFileSync(new URL('../install/setup-interactive.sh', import.meta.url), 'utf8');
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
  assert.match(index, /confirmation_required:\s*true/);
  assert.match(index, /동일 내용의 HTML 보고서도 생성할까요/);
  assert.match(index, /confirmation_prompt는 대화 제어문/);
  assert.match(index, /실제 렌더링 엔지니어링 Markdown 본문/);
});

test('skill enforces evidence-first and citation-first answers', () => {
  assert.match(skill, /Do \*\*not\*\* answer from general knowledge alone/);
  assert.match(skill, /Source hierarchy/);
  assert.match(skill, /Required answer format/);
  assert.match(skill, /근거 불충분/);
  assert.match(skill, /HTML is \*\*optional\*\*/);
  assert.match(skill, /user_confirmed_html=true/);
  assert.match(skill, /ask once.*identical HTML report/);
  assert.match(skill, /Never append that prompt to the engineering answer body/);
  assert.match(skill, /excluding the opt-in question/);
  assert.match(skill, /offline MathML/);
});

test('README documents MCP plus skill installation', () => {
  assert.match(readme, /MCP server/);
  assert.match(readme, /Skill package/);
  assert.match(readme, /AGENT_INSTALL\.md/);
  assert.match(readme, /setup-interactive\.sh/);
  assert.match(readme, /docs\/INSTALLATION\.md/);
  assert.match(readme, /korean-engineering-mcp-sync-skill hermes/);
  assert.match(readme, /\/reload-skills/);
  assert.match(readme, /\/reload-mcp/);
  assert.match(readme, /확인 질문은 대화 제어문/);
  assert.match(readme, /HTML 본문에서 제거/);
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
  assert.match(index, /user_confirmed_html/);
  assert.match(index, /user_confirmation_required/);
  assert.match(readme, /HTML은 기본 자동생성하지 않습니다/);
  assert.match(htmlRenderer, /html:\s*false/);
  assert.match(htmlRenderer, /linkify:\s*false/);
  assert.match(htmlRenderer, /protocol === "https:"/);
  assert.match(htmlRenderer, /MAX_MARKDOWN_CHARS = 120_000/);
  assert.match(htmlRenderer, /ENGINEERING_OUTPUT_DIR/);
  assert.match(htmlRenderer, /answer_markdown_sha256/);
  assert.match(mathRenderer, /output:\s*"mathml"/);
  assert.match(mathRenderer, /trust:\s*false/);
  assert.match(mathRenderer, /maxExpand:\s*1_000/);
  assert.match(htmlTemplate, /Content-Security-Policy/);
  assert.match(htmlTemplate, /보고서 복사/);
  assert.match(htmlTemplate, /인쇄 \/ PDF/);
  assert.match(htmlTemplate, /@page \{ size: A4/);
  assert.match(htmlTemplate, /\.math-display/);
  assert.match(htmlTemplate, /reportPlainText/);
});

test('npm package includes runtime source, domain data, HTML template, and managed skill updater', () => {
  for (const entry of ['src/', 'data/', 'templates/', 'scripts/']) {
    assert.ok(packageJson.files.includes(entry), entry);
  }
  assert.equal(packageJson.dependencies['@modelcontextprotocol/sdk'], '^1.29.0');
  assert.equal(packageJson.dependencies.katex, '^0.17.0');
  assert.equal(packageJson.bin['korean-engineering-mcp-sync-skill'], './scripts/sync-skill.mjs');
  assert.match(skillSync, /backup_path/);
  assert.match(skillSync, /installed_sha256/);
  assert.doesNotMatch(guidedInstaller, /install_skill\s+(?:hermes|claude|antigravity)\s*\|\|\s*true/);
});
