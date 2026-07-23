import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// index.js를 import해도 stdio 서버가 연결되지 않도록 가드
process.env.KOREAN_ENGINEERING_MCP_SKIP_AUTOSTART = '1';

const {
  parseDotEnv,
  parseSections,
  stripHtml,
  keywordsFrom,
  extractList,
  compactText,
  scoreText,
  escapeRegExp,
  normalizeLawArticles,
  normalizeAdminRuleArticles,
  buildDomainSearchPlan,
  classifyEngineeringDomains,
  resolveEngineeringDomains,
  renderEngineeringAnswerHtml,
  sanitizeHtmlFilename,
  writeEngineeringAnswerHtml,
  applyEvidenceBudget,
} = await import('../index.js');

const {
  discoverReferenceDocuments,
  searchReferenceDocuments,
} = await import('../src/references.js');

const {
  normalizeDateDigits,
  formatDateDigits,
  nameSimilarityScore,
  evaluateCitation,
} = await import('../src/citations.js');

const {
  hashSkillDirectory,
  syncBundledSkill,
} = await import('../scripts/sync-skill.mjs');

test('parseDotEnv parses key=value lines and ignores comments', () => {
  const parsed = parseDotEnv('# comment\nKCSC_API_KEY=abc123\nLAW_API_KEY="quoted value"\n\nBROKEN_LINE\n');
  assert.equal(parsed.KCSC_API_KEY, 'abc123');
  assert.equal(parsed.LAW_API_KEY, 'quoted value');
  assert.equal(Object.keys(parsed).length, 2);
});

test('parseSections splits markdown by headers without duplicating the title', () => {
  const sections = parseSections('서두 내용\n# 1장 총칙\n본문 A\n## 1.1 목적\n본문 B');
  assert.equal(sections.length, 3);
  assert.deepEqual(sections[0], { title: '(서두)', content: '서두 내용' });
  assert.deepEqual(sections[1], { title: '1장 총칙', content: '본문 A' });
  assert.deepEqual(sections[2], { title: '1.1 목적', content: '본문 B' });
});

test('stripHtml removes tags and decodes common entities', () => {
  assert.equal(stripHtml('<p>배수지&nbsp;용량은 &lt;표 1&gt; 참조</p>'), '배수지 용량은 <표 1> 참조');
  assert.equal(stripHtml(''), '');
});

test('keywordsFrom tokenizes multi-word queries and drops 1-char tokens', () => {
  assert.deepEqual(keywordsFrom('상수도 관로 경사'), ['상수도', '관로', '경사']);
  assert.deepEqual(keywordsFrom('"배수지" (용량)'), ['배수지', '용량']);
  assert.deepEqual(keywordsFrom('a 물'), []);
});

test('scoreText counts matched keywords', () => {
  assert.equal(scoreText('상수도 설계기준 관로', ['상수도', '관로']), 2);
  assert.equal(scoreText('하수도 시설', ['상수도']), 0);
});

test('extractList handles array, single object, and missing keys', () => {
  assert.deepEqual(extractList({ law: [{ a: 1 }] }, 'law'), [{ a: 1 }]);
  assert.deepEqual(extractList({ law: { a: 1 } }, 'law'), [{ a: 1 }]);
  assert.deepEqual(extractList({}, 'law'), []);
  assert.deepEqual(extractList(null, 'law'), []);
});

test('compactText truncates with ellipsis', () => {
  assert.equal(compactText('가나다라마', 3), '가나다…');
  assert.equal(compactText('  가나  다  ', 10), '가나 다');
});

test('escapeRegExp escapes regex metacharacters', () => {
  assert.equal(new RegExp(escapeRegExp('표 1.2(주)')).test('본문 표 1.2(주) 참조'), true);
});

test('normalizeLawArticles extracts scored article quotes from law detail JSON', () => {
  const detail = {
    법령: {
      기본정보: { 시행일자: '20240101' },
      조문: {
        조문단위: [
          { 조문번호: '1', 조문제목: '목적', 조문내용: '이 법은 상수도의 설치에 관한 사항을 규정한다.' },
          { 조문번호: '2', 조문제목: '정의', 조문내용: '하수도 용어 정의', 항: [{ 항내용: '항 내용', 호: [{ 호내용: '호 내용' }] }] },
        ],
      },
    },
  };
  const all = normalizeLawArticles(detail, '', 8);
  assert.equal(all.length, 2);
  assert.equal(all[0].effective_date, '20240101');
  const filtered = normalizeLawArticles(detail, '상수도', 8);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].article_number, '1');
  assert.match(filtered[0].quote, /상수도/);
  assert.equal('score' in filtered[0], false);
});

test('normalizeAdminRuleArticles extracts 조문 and 별표 items', () => {
  const detail = {
    AdmRulService: {
      기본정보: { 시행일자: '20230601' },
      조문: { 조문단위: [{ 조문번호: '3', 조문제목: '기술진단', 조문내용: '기술진단 주기는 5년으로 한다.' }] },
      별표: { 별표단위: [{ 별표번호: '1', 별표제목: '진단 항목', 별표내용: [['수질', '누수']] }] },
    },
  };
  const items = normalizeAdminRuleArticles(detail, '', 8);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.source_part).sort(), ['별표', '조문']);
  const filtered = normalizeAdminRuleArticles(detail, '기술진단', 8);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].source_part, '조문');
});

test('classifyEngineeringDomains covers the requested engineering sectors', () => {
  const cases = [
    ['상수도 배수지 용량 검토', 'water_supply'],
    ['하수도 관거 우수 배제', 'wastewater'],
    ['도로 포장과 배수시설', 'road'],
    ['철도 노반과 승강장', 'railway'],
    ['도시개발 지구단위계획', 'urban_planning'],
    ['하천 제방과 호안', 'river'],
    ['항만 방파제와 안벽', 'port'],
    ['공항 활주로와 유도로', 'airport'],
    ['건축물 구조와 피난', 'architecture'],
  ];
  for (const [question, expected] of cases) {
    assert.equal(classifyEngineeringDomains(question, 1)[0].key, expected, question);
  }
});

test('explicit domain keys and labels are accepted and bad keys are rejected', () => {
  assert.equal(resolveEngineeringDomains('일반 질문', 'urban_planning', 1)[0].key, 'urban_planning');
  assert.equal(resolveEngineeringDomains('일반 질문', '공항·항공', 1)[0].key, 'airport');
  assert.throws(() => resolveEngineeringDomains('일반 질문', 'unknown-domain', 1), /지원하지 않는/);
});

test('domain search plan adds law and admin-rule hints for fields with limited KCSC coverage', () => {
  const plan = buildDomainSearchPlan('공항 활주로 설치기준 검토', 'auto');
  assert.equal(plan.detected_domains[0].key, 'airport');
  assert.ok(plan.law_queries.includes('공항시설법'));
  assert.ok(plan.admin_rule_queries.some((query) => query.includes('공항')));
  assert.match(plan.detected_domains[0].coverage, /KCSC 직접 기준은 제한적/);
});

test('global evidence budget is enforced while preserving source diversity', () => {
  const groups = {
    laws: ['l1', 'l2', 'l3'],
    adminRules: ['a1', 'a2'],
    standards: ['s1', 's2', 's3', 's4'],
    manuals: ['m1', 'm2'],
    interpretations: ['i1', 'i2'],
  };
  const budgeted = applyEvidenceBudget(groups, 5);
  assert.equal(budgeted.selected_count, 5);
  assert.equal(budgeted.max_evidence, 5);
  assert.deepEqual(budgeted.laws, ['l1']);
  assert.deepEqual(budgeted.adminRules, ['a1']);
  assert.deepEqual(budgeted.standards, ['s1']);
  assert.deepEqual(budgeted.manuals, ['m1']);
  assert.deepEqual(budgeted.interpretations, ['i1']);
});

test('generic reference discovery and search work across engineering domains', () => {
  const root = mkdtempSync(join(tmpdir(), 'kemcp-ref-'));
  mkdirSync(join(root, '도로'), { recursive: true });
  mkdirSync(join(root, '공항'), { recursive: true });
  writeFileSync(join(root, '도로', '도로포장.md'), '# 도로포장 지침\n## 배수성 포장\n포장 배수와 미끄럼 저항을 검토한다.', 'utf8');
  writeFileSync(join(root, '공항', '활주로.txt'), '# 활주로 참고자료\n활주로 길이와 안전구역을 검토한다.', 'utf8');

  const docs = discoverReferenceDocuments(root, { maxFiles: 10, maxBytes: 1024 * 1024, maxDepth: 3 });
  assert.equal(docs.length, 2);
  assert.ok(docs.some((doc) => doc.domain_key === 'road'));
  assert.ok(docs.some((doc) => doc.domain_key === 'airport'));
  assert.ok(docs.every((doc) => Array.isArray(doc.domain_keys) && doc.domain_keys.length >= 1));

  const results = searchReferenceDocuments(docs, '포장 배수', { domain: 'road', maxResults: 5 });
  assert.ok(results.length >= 1);
  assert.equal(results[0].domain_key, 'road');
  assert.equal(results[0].trust_level, 'local_reference_unverified');
});

test('HTML renderer preserves report structure while escaping untrusted raw HTML and unsafe links', () => {
  const markdown = '## 결론\n- **조건부 가능**\n\n| 항목 | 내용 |\n|---|---|\n| 기준 | KDS 확인 |\n\n<script>alert(1)</script>\n\n[위험 링크](javascript:alert(1))\n\n[HTTP 링크](http://example.com)\n\n[공식 링크](https://www.kcsc.re.kr)\n\n![외부 추적 이미지](https://tracking.example/pixel.png)';
  const options = {
    title: '<검토서>',
    answer_markdown: markdown,
    domain_label: '도로·교통',
    prepared_at: '2026-07-15 10:00 KST',
  };
  const rendered = renderEngineeringAnswerHtml(options);
  const repeated = renderEngineeringAnswerHtml(options);
  assert.match(rendered.html, /<h2>결론<\/h2>/);
  assert.match(rendered.html, /<table>/);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(rendered.html, /href="javascript:/i);
  assert.doesNotMatch(rendered.html, /href="http:/i);
  assert.match(rendered.html, /href="https:\/\/www\.kcsc\.re\.kr"/);
  assert.doesNotMatch(rendered.html, /<img\b/i);
  assert.match(rendered.html, /\[이미지: 외부 추적 이미지\]/);
  assert.match(rendered.html, /engineering-answer-sha256/);
  assert.match(rendered.html, /보고서 복사/);
  assert.match(rendered.html, /@page \{ size: A4/);
  assert.equal(rendered.html, repeated.html);
  assert.equal(rendered.html_sha256, repeated.html_sha256);
  assert.throws(
    () => renderEngineeringAnswerHtml({ title: '제어문자', answer_markdown: '본문\u0000' }),
    /제어문자/,
  );
});

test('HTML renderer omits a trailing conversational HTML opt-in prompt', () => {
  const engineeringMarkdown = '## 결론\n연소방식 검토 본문입니다.';
  const sourceMarkdown = `${engineeringMarkdown}\n\n동일 내용의 HTML 보고서도 생성할까요?`;
  const rendered = renderEngineeringAnswerHtml({
    title: '하수처리시설 악취 탈취 검토',
    answer_markdown: sourceMarkdown,
    prepared_at: '2026-07-21 11:00 KST',
  });

  assert.match(rendered.html, /연소방식 검토 본문입니다/);
  assert.doesNotMatch(rendered.html, /동일 내용의 HTML 보고서도 생성할까요/);
  assert.equal(
    rendered.answer_markdown_sha256,
    createHash('sha256').update(engineeringMarkdown, 'utf8').digest('hex'),
  );
  assert.throws(
    () => renderEngineeringAnswerHtml({ answer_markdown: '동일 내용의 HTML 보고서도 생성할까요?' }),
    /엔지니어링 본문/,
  );

  const promptDiscussedInsideReport = renderEngineeringAnswerHtml({
    title: '보고서 생성 절차 설명',
    answer_markdown: '## 절차\n`동일 내용의 HTML 보고서도 생성할까요?`라는 질문은 별도로 보낸다.\n\n기술 본문 끝.',
    prepared_at: '2026-07-21 11:00 KST',
  });
  assert.match(promptDiscussedInsideReport.html, /동일 내용의 HTML 보고서도 생성할까요/);
});

test('HTML renderer converts inline and display TeX to offline MathML', () => {
  const markdown = [
    '## 수식 검토',
    '인라인 유량식 $Q = A v$를 적용한다.',
    '',
    '$$',
    String.raw`h_f = f \frac{L}{D} \frac{v^2}{2g}`,
    '$$',
    '',
    '코드 표기는 `$Q = A v$` 그대로 유지한다.',
    String.raw`금액 표기는 \$1,000처럼 이스케이프하면 수식으로 해석하지 않는다.`,
    '',
    String.raw`악성 명령은 실행하지 않는다: $\href{javascript:alert(1)}{x}$`,
  ].join('\n');
  const rendered = renderEngineeringAnswerHtml({
    title: '관로 손실수두 검토',
    answer_markdown: markdown,
    prepared_at: '2026-07-16 10:00 KST',
  });

  assert.match(rendered.html, /class="math-inline"/);
  assert.equal((rendered.html.match(/class="math-inline"/g) || []).length, 2);
  assert.match(rendered.html, /class="math-display"/);
  assert.match(rendered.html, /<math\b/);
  assert.match(rendered.html, /<mfrac>/);
  assert.match(rendered.html, /<msup>/);
  assert.match(rendered.html, /data-tex="Q = A v"/);
  assert.match(rendered.html, /<code>\$Q = A v\$<\/code>/);
  assert.match(rendered.html, /금액 표기는 \$1,000처럼/);
  assert.doesNotMatch(rendered.html, /href="javascript:/i);
  assert.doesNotMatch(rendered.html, /<script[^>]+(?:mathjax|katex)|https?:\/\/.*(?:mathjax|katex)/i);
  assert.match(rendered.html, /math-style: normal/);
});

test('managed skill sync updates an existing install with backup and hash verification', () => {
  const home = mkdtempSync(join(tmpdir(), 'kemcp-skill-home-'));
  const hermesHome = join(home, '.hermes');
  const destination = join(hermesHome, 'skills', 'korean-engineering-grounded-answer');
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, 'SKILL.md'), '---\nname: korean-engineering-grounded-answer\nversion: 1.1.0\n---\n\nOLD POLICY\n', 'utf8');
  writeFileSync(join(destination, 'local-note.md'), 'user customization', 'utf8');

  const env = { HOME: home, HERMES_HOME: hermesHome };
  const first = syncBundledSkill({ client: 'hermes', env, now: new Date('2026-07-16T00:00:00Z') });
  assert.equal(first.status, 'updated');
  assert.equal(first.previous_version, '1.1.0');
  assert.equal(first.installed_version, '1.3.1');
  assert.equal(first.source_sha256, first.installed_sha256);
  assert.equal(hashSkillDirectory(destination), first.source_sha256);
  assert.match(readFileSync(join(destination, 'SKILL.md'), 'utf8'), /동일 내용의 HTML 보고서도 생성할까요/);
  assert.match(readFileSync(join(destination, 'SKILL.md'), 'utf8'), /excluding the conversational HTML opt-in prompt/);
  assert.match(readFileSync(join(destination, 'SKILL.md'), 'utf8'), /offline MathML/);
  assert.ok(first.backup_path);
  assert.equal(readFileSync(join(first.backup_path, 'local-note.md'), 'utf8'), 'user customization');
  assert.match(readFileSync(join(first.backup_path, 'SKILL.md'), 'utf8'), /version: 1\.1\.0/);

  const backupCount = readdirSync(dirname(first.backup_path)).length;
  const second = syncBundledSkill({ client: 'hermes', env, now: new Date('2026-07-16T00:01:00Z') });
  assert.equal(second.status, 'unchanged');
  assert.equal(second.backup_path, null);
  assert.equal(readdirSync(dirname(first.backup_path)).length, backupCount);
});

test('skill sync CLI executes correctly through an npm-bin style symlink', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'kemcp-skill-bin-'));
  const home = join(root, 'home');
  const bin = join(root, 'korean-engineering-mcp-sync-skill');
  mkdirSync(home, { recursive: true });
  symlinkSync(fileURLToPath(new URL('../scripts/sync-skill.mjs', import.meta.url)), bin);
  const result = spawnSync(bin, ['hermes', '--dry-run', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, HERMES_HOME: join(home, '.hermes') },
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'would_install');
  assert.equal(payload.source_version, '1.3.1');
  assert.equal(payload.source_sha256.length, 64);

  const allResult = spawnSync(bin, ['all', '--dry-run', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, HERMES_HOME: join(home, '.hermes') },
  });
  assert.equal(allResult.status, 0, allResult.stderr);
  const allPayload = JSON.parse(allResult.stdout);
  assert.equal(allPayload.length, 3);
  assert.deepEqual(new Set(allPayload.map((item) => item.client)), new Set(['hermes', 'claude', 'antigravity']));
});

test('HTML output stays inside the configured directory and avoids overwriting', () => {
  const root = mkdtempSync(join(tmpdir(), 'kemcp-html-'));
  const options = {
    title: '도로 배수 검토',
    answer_markdown: '## 결론\n- 검토 완료',
    output_dir: root,
    filename: '../도로/검토서.html',
    prepared_at: '2026-07-15 10:00 KST',
  };
  const first = writeEngineeringAnswerHtml(options);
  const second = writeEngineeringAnswerHtml(options);
  assert.ok(first.output_path.startsWith(root));
  assert.ok(second.output_path.startsWith(root));
  assert.notEqual(first.output_path, second.output_path);
  assert.equal(sanitizeHtmlFilename('../도로/검토서.html'), '도로-검토서.html');
  assert.match(readFileSync(first.output_path, 'utf8'), /도로 배수 검토/);
  assert.equal(first.answer_markdown_sha256.length, 64);
});

test('normalizeDateDigits parses common Korean date notations to YYYYMMDD', () => {
  assert.equal(normalizeDateDigits('2024.12.23'), '20241223');
  assert.equal(normalizeDateDigits('2024-12-23'), '20241223');
  assert.equal(normalizeDateDigits('20241223'), '20241223');
  assert.equal(normalizeDateDigits('2024.2.3'), '20240203');
  assert.equal(normalizeDateDigits('2024년 2월 3일'), '20240203');
  assert.equal(normalizeDateDigits(''), '');
  assert.equal(normalizeDateDigits('모름'), '');
});

test('formatDateDigits renders YYYYMMDD as dotted date and passes through invalid input', () => {
  assert.equal(formatDateDigits('20241223'), '2024.12.23');
  assert.equal(formatDateDigits('bad'), 'bad');
});

test('nameSimilarityScore ranks exact, substring, and token-overlap matches', () => {
  assert.equal(nameSimilarityScore('예산군 하수도 사용 조례', '예산군 하수도 사용 조례'), 100);
  assert.equal(nameSimilarityScore('하수도 사용 조례', '예산군 하수도 사용 조례'), 70);
  assert.equal(nameSimilarityScore('전혀 다른 이름', '예산군 하수도 사용 조례'), 0);
});

test('evaluateCitation flags a region mismatch when the cited ordinance belongs to a different municipality', () => {
  // 실제로 발견된 사례를 재현: 예산군 사업 문서에 안동시 조례가 잘못 인용된 경우
  const citation = {
    kind: 'ordinance',
    name: '안동시 하수도 사용 조례 시행규칙',
    region: '예산군',
    claimed_date: '2024-12-23',
  };
  const candidates = [
    { title: '안동시 하수도 사용 조례 시행규칙', region: '경상북도 안동시', effective_date: '20200918', url: 'https://example.test/andong' },
  ];
  const result = evaluateCitation(citation, candidates);
  assert.equal(result.status, 'mismatch');
  assert.ok(result.reasons.some((r) => r.includes('지자체 불일치')));
  assert.ok(result.reasons.some((r) => r.includes('시행일자 불일치')));
});

test('evaluateCitation reports current when name, date, and issuer all match', () => {
  const citation = { kind: 'law', name: '하수도법', claimed_date: '2025.10.1', claimed_issuer: '기후에너지환경부' };
  const candidates = [
    { title: '하수도법', ministry: '기후에너지환경부', effective_date: '20251001', url: 'https://example.test/law' },
  ];
  const result = evaluateCitation(citation, candidates);
  assert.equal(result.status, 'current');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.matched.title, '하수도법');
});

test('evaluateCitation flags an issuer mismatch, e.g. after a ministry reorganization', () => {
  const citation = { kind: 'admin_rule', name: '하수도설계기준', claimed_issuer: '환경부' };
  const candidates = [
    { title: '하수도설계기준', agency: '기후에너지환경부', effective_date: '20251001', url: 'https://example.test/admrul' },
  ];
  const result = evaluateCitation(citation, candidates);
  assert.equal(result.status, 'mismatch');
  assert.ok(result.reasons.some((r) => r.includes('소관부처 불일치')));
});

test('evaluateCitation returns not_found for an empty candidate list', () => {
  const result = evaluateCitation({ kind: 'law', name: '존재하지않는법' }, []);
  assert.equal(result.status, 'not_found');
  assert.equal(result.matched, null);
});

test('evaluateCitation returns ambiguous when top candidates tie in score', () => {
  const citation = { kind: 'ordinance', name: '하수도 사용 조례', region: undefined };
  const candidates = [
    { title: '가나시 하수도 사용 조례', region: '가나시', effective_date: '20240101' },
    { title: '다라시 하수도 사용 조례', region: '다라시', effective_date: '20240101' },
  ];
  const result = evaluateCitation(citation, candidates);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.alternatives.length, 2);
});
