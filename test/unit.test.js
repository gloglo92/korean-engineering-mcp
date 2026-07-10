import test from 'node:test';
import assert from 'node:assert/strict';

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
} = await import('../index.js');

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
