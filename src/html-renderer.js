import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import MarkdownIt from "markdown-it";

const DEFAULT_TEMPLATE = new URL("../templates/engineering-report.html", import.meta.url);
const DEFAULT_OUTPUT_DIR = join(homedir(), ".korean-engineering-mcp", "outputs");
const MAX_MARKDOWN_CHARS = 120_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const UNSAFE_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
});

md.validateLink = (value) => {
  try {
    return new URL(String(value)).protocol === "https:";
  } catch {
    return false;
  }
};

md.renderer.rules.image = (tokens, index) => {
  const alt = md.renderer.renderInlineAsText(tokens[index].children || [], {}, {});
  return `<span class="image-alt">[이미지: ${md.utils.escapeHtml(alt || "설명 없음")}]</span>`;
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function assertSafeText(name, value, maxLength) {
  const text = String(value ?? "");
  if (UNSAFE_CONTROL_CHARS.test(text)) {
    throw new Error(`${name}에 허용되지 않는 제어문자가 포함되어 있습니다.`);
  }
  if (text.length > maxLength) {
    throw new Error(`${name}은 ${maxLength.toLocaleString("en-US")}자 이하여야 합니다.`);
  }
  return text;
}

function cleanMetadata(value, fallback = "-", maxLength = 200) {
  const validated = assertSafeText("metadata", value ?? "", maxLength);
  const text = validated.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return text || fallback;
}

export function sanitizeHtmlFilename(value, fallback = "engineering-report") {
  const raw = String(value || fallback)
    .normalize("NFKC")
    .replace(/\.(?:html?|xhtml)$/i, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.\.+/g, ".")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 100);
  const safe = raw || fallback;
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe) ? `report-${safe}` : safe;
  return `${reserved}.html`;
}

function formatKoreanTimestamp(value) {
  if (value) return cleanMetadata(value);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: process.env.ENGINEERING_TIMEZONE || "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function metaItem(label, value) {
  return `<div class="meta-item"><span class="meta-label">${escapeHtml(label)}</span><span class="meta-value">${escapeHtml(value)}</span></div>`;
}

function replaceTemplate(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, String(value));
  }
  return out;
}

export function renderEngineeringAnswerHtml(options = {}) {
  const title = cleanMetadata(options.title, "엔지니어링 검토 답변", 160);
  const answerMarkdown = assertSafeText(
    "answer_markdown",
    options.answerMarkdown || options.answer_markdown || "",
    MAX_MARKDOWN_CHARS,
  ).trim();
  if (!answerMarkdown) throw new Error("answer_markdown은 비어 있을 수 없습니다.");

  const domainLabel = cleanMetadata(options.domainLabel || options.domain_label, "공통·융합", 120);
  const documentStatus = cleanMetadata(options.documentStatus || options.document_status, "검토용", 50);
  const author = cleanMetadata(options.author, "AI 지원 작성", 80);
  const projectName = cleanMetadata(options.projectName || options.project_name, "일반 검토", 120);
  const documentId = cleanMetadata(options.documentId || options.document_id, "-", 80);
  const preparedAt = formatKoreanTimestamp(options.preparedAt || options.prepared_at);
  const generatorLabel = cleanMetadata(options.generatorLabel || options.generator_label, "korean-engineering-mcp");
  const bodyHtml = md.render(answerMarkdown);
  const answerSha256 = createHash("sha256").update(answerMarkdown, "utf8").digest("hex");
  const template = readFileSync(options.templatePath || DEFAULT_TEMPLATE, "utf8");
  const metaItems = [
    metaItem("작성일", preparedAt),
    metaItem("프로젝트", projectName),
    metaItem("작성", author),
    metaItem("문서번호", documentId),
  ].join("\n");

  const html = replaceTemplate(template, {
    TITLE: escapeHtml(title),
    DOMAIN_LABEL: escapeHtml(domainLabel),
    DOCUMENT_STATUS: escapeHtml(documentStatus),
    META_ITEMS: metaItems,
    BODY_HTML: bodyHtml,
    GENERATOR_LABEL: escapeHtml(generatorLabel),
    ANSWER_SHA256: answerSha256,
  });
  const htmlBytes = Buffer.byteLength(html, "utf8");
  if (htmlBytes > MAX_HTML_BYTES) {
    throw new Error(`생성된 HTML은 ${MAX_HTML_BYTES.toLocaleString("en-US")}바이트 이하여야 합니다.`);
  }

  return {
    html,
    answer_markdown_sha256: answerSha256,
    html_sha256: createHash("sha256").update(html, "utf8").digest("hex"),
    size_bytes: htmlBytes,
    prepared_at: preparedAt,
  };
}

function safeOutputPath(outputDir, filename) {
  const root = resolve(outputDir);
  const target = resolve(root, sanitizeHtmlFilename(filename));
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("출력 파일 경로가 허용된 디렉터리를 벗어났습니다.");
  }
  return { root, target };
}

function uniqueOutputPath(target) {
  if (!existsSync(target)) return target;
  const extension = extname(target);
  const stem = target.slice(0, -extension.length);
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error("동일한 이름의 출력 파일이 너무 많습니다. 다른 filename을 사용하세요.");
}

export function writeEngineeringAnswerHtml(options = {}) {
  const outputDir = options.outputDir || options.output_dir || process.env.ENGINEERING_OUTPUT_DIR || DEFAULT_OUTPUT_DIR;
  const rendered = renderEngineeringAnswerHtml(options);
  const defaultName = `${options.title || "engineering-report"}-${Date.now()}`;
  const { root, target } = safeOutputPath(outputDir, options.filename || defaultName);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const finalPath = uniqueOutputPath(target);
  writeFileSync(finalPath, rendered.html, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return {
    output_path: finalPath,
    filename: basename(finalPath),
    output_directory: root,
    file_url: pathToFileURL(finalPath).href,
    size_bytes: rendered.size_bytes,
    answer_markdown_sha256: rendered.answer_markdown_sha256,
    html_sha256: rendered.html_sha256,
    prepared_at: rendered.prepared_at,
    template: "engineering-report",
    copy_ready: true,
    print_ready: true,
    path_scope: relative(root, finalPath),
    html: options.includeHtml || options.include_html ? rendered.html : undefined,
  };
}
