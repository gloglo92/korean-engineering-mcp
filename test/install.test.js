import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const setupScript = join(repoRoot, 'install', 'setup-interactive.sh');
const hermesScript = join(repoRoot, 'install', 'install-hermes.sh');
const skillName = 'korean-engineering-grounded-answer';

function seedOldSkill(hermesHome) {
  const skill = join(hermesHome, 'skills', skillName);
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '---\nname: korean-engineering-grounded-answer\nversion: 1.0.0\n---\n\nOLD HTML POLICY\n', 'utf8');
  writeFileSync(join(skill, 'custom-note.md'), 'preserve me in backup', 'utf8');
  return skill;
}

test('guided Hermes installer synchronizes an existing skill and does not reveal API keys', {
  skip: process.platform === 'win32',
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'kemcp-guided-update-'));
  const home = join(root, 'home');
  const hermesHome = join(home, '.hermes');
  const envPath = join(root, 'installer.env');
  const skill = seedOldSkill(hermesHome);
  const kcscKey = 'test-kcsc-key-not-a-real-secret';
  const lawKey = 'test-law-key-not-a-real-secret';

  const result = spawnSync('bash', [setupScript, '--client', 'hermes'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      HERMES_HOME: hermesHome,
      KOREAN_ENGINEERING_MCP_ENV: envPath,
      KCSC_API_KEY: kcscKey,
      LAW_API_KEY: lawKey,
      ENGINEERING_TIMEZONE: 'Asia/Seoul',
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /hash match: yes/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(`${kcscKey}|${lawKey}`));
  const installed = readFileSync(join(skill, 'SKILL.md'), 'utf8');
  assert.match(installed, /version: 1\.3\.1/);
  assert.match(installed, /동일 내용의 HTML 보고서도 생성할까요/);
  assert.match(installed, /Never append that prompt to the engineering answer body/);
  assert.match(installed, /offline MathML/);
  assert.equal(statSync(envPath).mode & 0o777, 0o600);

  const backupRoot = join(hermesHome, 'backups', 'korean-engineering-mcp', 'skills', skillName);
  const backups = readdirSync(backupRoot);
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(backupRoot, backups[0], 'custom-note.md'), 'utf8'), 'preserve me in backup');
});

test('Hermes installer fails closed instead of skipping a symlinked target skill', {
  skip: process.platform === 'win32',
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'kemcp-guided-symlink-'));
  const home = join(root, 'home');
  const hermesHome = join(home, '.hermes');
  const external = join(root, 'external-skill');
  const target = join(hermesHome, 'skills', skillName);
  mkdirSync(dirname(target), { recursive: true });
  mkdirSync(external, { recursive: true });
  writeFileSync(join(external, 'SKILL.md'), 'external content', 'utf8');
  symlinkSync(external, target);

  const result = spawnSync('bash', [hermesScript], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, HERMES_HOME: hermesHome },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /심볼릭 링크/);
  assert.equal(readFileSync(join(external, 'SKILL.md'), 'utf8'), 'external content');
});
