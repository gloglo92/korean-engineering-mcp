#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "korean-engineering-grounded-answer";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const DEFAULT_SOURCE = join(REPO_ROOT, "skills", SKILL_NAME);
const SUPPORTED_CLIENTS = new Set(["hermes", "claude", "antigravity"]);

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function assertDirectory(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`${label} 경로는 심볼릭 링크일 수 없습니다: ${path}`);
  if (!stat.isDirectory()) throw new Error(`${label} 경로는 디렉터리여야 합니다: ${path}`);
}

function filesInDirectory(root) {
  const files = [];
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`스킬 패키지의 심볼릭 링크는 허용되지 않습니다: ${path}`);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`지원하지 않는 스킬 항목입니다: ${path}`);
    }
  };
  walk(root);
  return files;
}

export function hashSkillDirectory(root) {
  assertDirectory(root, "스킬");
  const hash = createHash("sha256");
  for (const path of filesInDirectory(root)) {
    const rel = relative(root, path).split(sep).join("/");
    hash.update(rel, "utf8");
    hash.update("\0", "utf8");
    hash.update(readFileSync(path));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

export function readSkillVersion(root) {
  try {
    const skill = readFileSync(join(root, "SKILL.md"), "utf8");
    return skill.match(/^version:\s*["']?([^\s"']+)/m)?.[1] || "unknown";
  } catch {
    return "unknown";
  }
}

export function resolveSkillDestination(client, env = process.env) {
  if (!SUPPORTED_CLIENTS.has(client)) {
    throw new Error(`지원하지 않는 client입니다: ${client}. hermes, claude, antigravity 중 하나를 사용하세요.`);
  }
  const home = resolve(env.HOME || homedir());
  if (client === "hermes") {
    return join(resolve(env.HERMES_HOME || join(home, ".hermes")), "skills", SKILL_NAME);
  }
  if (client === "claude") return join(home, ".claude", "skills", SKILL_NAME);
  return join(home, ".gemini", "antigravity", "skills", SKILL_NAME);
}

function resolveBackupRoot(client, env = process.env) {
  const home = resolve(env.HOME || homedir());
  if (client === "hermes") {
    const hermesHome = resolve(env.HERMES_HOME || join(home, ".hermes"));
    return join(hermesHome, "backups", "korean-engineering-mcp", "skills", SKILL_NAME);
  }
  return join(home, ".korean-engineering-mcp", "backups", client, "skills", SKILL_NAME);
}

function uniquePath(path) {
  if (!existsSync(path)) return path;
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${path}-${index}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`백업 이름 충돌이 너무 많습니다: ${path}`);
}

/**
 * Synchronize the bundled managed skill into a supported client.
 * Existing differing content is backed up before replacement, then the
 * installed directory is re-hashed to verify the update.
 */
export function syncBundledSkill({
  client = "hermes",
  env = process.env,
  source = DEFAULT_SOURCE,
  dryRun = false,
  now = new Date(),
} = {}) {
  if (!SUPPORTED_CLIENTS.has(client)) {
    throw new Error(`지원하지 않는 client입니다: ${client}`);
  }
  const sourcePath = resolve(source);
  assertDirectory(sourcePath, "번들 스킬");
  const destination = resolveSkillDestination(client, env);
  const destinationParent = dirname(destination);
  const sourceHash = hashSkillDirectory(sourcePath);
  const sourceVersion = readSkillVersion(sourcePath);

  let previousHash = null;
  let previousVersion = null;
  if (existsSync(destination)) {
    assertDirectory(destination, "기존 설치 스킬");
    previousHash = hashSkillDirectory(destination);
    previousVersion = readSkillVersion(destination);
    if (previousHash === sourceHash) {
      return {
        status: "unchanged",
        client,
        destination,
        source_version: sourceVersion,
        installed_version: previousVersion,
        source_sha256: sourceHash,
        installed_sha256: previousHash,
        backup_path: null,
      };
    }
  }

  if (dryRun) {
    return {
      status: previousHash ? "would_update" : "would_install",
      client,
      destination,
      source_version: sourceVersion,
      installed_version: previousVersion,
      source_sha256: sourceHash,
      installed_sha256: previousHash,
      backup_path: null,
    };
  }

  mkdirSync(destinationParent, { recursive: true, mode: 0o700 });
  const nonce = `${process.pid}-${Date.now()}`;
  const staging = join(destinationParent, `.${SKILL_NAME}.staging-${nonce}`);
  const parked = join(destinationParent, `.${SKILL_NAME}.previous-${nonce}`);
  let backupPath = null;
  let parkedExisting = false;

  try {
    cpSync(sourcePath, staging, { recursive: true, errorOnExist: true, force: false });
    const stagedHash = hashSkillDirectory(staging);
    if (stagedHash !== sourceHash) throw new Error("스킬 staging 검증에 실패했습니다.");

    if (previousHash) {
      const backupRoot = resolveBackupRoot(client, env);
      mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
      backupPath = uniquePath(join(backupRoot, `${timestampForPath(now)}-v${previousVersion || "unknown"}`));
      cpSync(destination, backupPath, { recursive: true, errorOnExist: true, force: false });
      if (hashSkillDirectory(backupPath) !== previousHash) throw new Error("기존 스킬 백업 검증에 실패했습니다.");
      renameSync(destination, parked);
      parkedExisting = true;
    }

    renameSync(staging, destination);
    const installedHash = hashSkillDirectory(destination);
    if (installedHash !== sourceHash) throw new Error("설치 후 스킬 해시 검증에 실패했습니다.");
    if (parkedExisting) rmSync(parked, { recursive: true, force: true });

    return {
      status: previousHash ? "updated" : "installed",
      client,
      destination,
      source_version: sourceVersion,
      previous_version: previousVersion,
      installed_version: readSkillVersion(destination),
      source_sha256: sourceHash,
      previous_sha256: previousHash,
      installed_sha256: installedHash,
      backup_path: backupPath,
    };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (parkedExisting && existsSync(parked)) {
      rmSync(destination, { recursive: true, force: true });
      renameSync(parked, destination);
    }
    throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function usage() {
  return `Usage: korean-engineering-mcp-sync-skill [hermes|claude|antigravity|all] [--dry-run] [--json]\n\n기존 설치 스킬이 다르면 백업한 뒤 번들 버전으로 안전하게 동기화합니다.`;
}

function printResult(result) {
  const verb = {
    unchanged: "unchanged",
    installed: "installed",
    updated: "updated",
    would_install: "would install",
    would_update: "would update",
  }[result.status] || result.status;
  process.stdout.write(`skill ${verb}: ${result.destination}\n`);
  process.stdout.write(`version: ${result.previous_version || result.installed_version || "none"} -> ${result.source_version}\n`);
  process.stdout.write(`source sha256: ${result.source_sha256}\n`);
  if (result.installed_sha256) process.stdout.write(`installed sha256: ${result.installed_sha256}\n`);
  if (["installed", "updated", "unchanged"].includes(result.status)) {
    process.stdout.write(`hash match: ${result.source_sha256 === result.installed_sha256 ? "yes" : "no"}\n`);
  }
  if (result.backup_path) process.stdout.write(`backup: ${result.backup_path}\n`);
}

export function runSyncSkillCli(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const knownFlags = new Set(["--dry-run", "--json"]);
  const unknownFlags = argv.filter((arg) => arg.startsWith("--") && !knownFlags.has(arg));
  if (unknownFlags.length) throw new Error(`지원하지 않는 옵션입니다: ${unknownFlags.join(", ")}`);
  const dryRun = argv.includes("--dry-run");
  const asJson = argv.includes("--json");
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  if (positional.length > 1) throw new Error(`client는 하나만 지정하세요: ${positional.join(", ")}`);
  const target = positional[0] || "hermes";
  const clients = target === "all" ? [...SUPPORTED_CLIENTS] : [target];
  const results = clients.map((client) => syncBundledSkill({ client, env, dryRun }));
  if (asJson) {
    process.stdout.write(`${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n`);
  } else {
    for (const result of results) printResult(result);
  }
  return 0;
}

function isExecutedAsMain(argvPath) {
  if (!argvPath) return false;
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(resolve(SCRIPT_PATH));
  } catch {
    return resolve(argvPath) === resolve(SCRIPT_PATH);
  }
}

if (isExecutedAsMain(process.argv[1])) {
  try {
    process.exitCode = runSyncSkillCli();
  } catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
  }
}
