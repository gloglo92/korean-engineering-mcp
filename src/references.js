import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { classifyEngineeringDomains, getEngineeringDomain, meaningfulKeywords } from "./domains.js";

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

export function parseReferenceSections(content) {
  const lines = String(content || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const sections = [];
  let title = "(서두)";
  let body = [];
  let started = false;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (started || body.some((item) => item.trim())) {
        sections.push({ title, content: body.join("\n").trim() });
      }
      title = line.replace(/^#+\s*/, "").trim();
      body = [];
      started = true;
    } else {
      body.push(line);
    }
  }
  if (started || body.some((item) => item.trim())) {
    sections.push({ title, content: body.join("\n").trim() });
  }
  return sections.filter((section) => section.title || section.content);
}

function compact(value, max = 700) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function walk(root, current, depth, maxDepth, files) {
  if (depth > maxDepth) return;
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, fullPath, depth + 1, maxDepth, files);
    } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
}

export function discoverReferenceDocuments(referenceDir, options = {}) {
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles) || 50, 500));
  const maxBytes = Math.max(1024, Math.min(Number(options.maxBytes) || 5 * 1024 * 1024, 50 * 1024 * 1024));
  const maxDepth = Math.max(0, Math.min(Number(options.maxDepth) || 3, 8));
  const root = resolve(String(referenceDir || ""));
  if (!referenceDir || !existsSync(root)) return [];
  try {
    if (!statSync(root).isDirectory()) return [];
  } catch {
    return [];
  }

  const files = [];
  walk(root, root, 0, maxDepth, files);
  const documents = [];
  for (const filePath of files.sort().slice(0, maxFiles)) {
    try {
      const stat = statSync(filePath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) continue;
      const raw = readFileSync(filePath, "utf8");
      const rel = relative(root, filePath).replace(/\\/g, "/");
      const sections = parseReferenceSections(raw);
      const firstHeading = sections.find((section) => section.title !== "(서두)")?.title;
      const domainMatches = classifyEngineeringDomains(`${rel} ${firstHeading || ""} ${raw.slice(0, 1200)}`, 3);
      const primaryDomain = domainMatches[0];
      documents.push({
        id: rel,
        title: firstHeading || basename(filePath, extname(filePath)),
        relative_path: rel,
        domain_key: primaryDomain.key,
        domain_label: primaryDomain.label,
        domain_keys: domainMatches.map((domain) => domain.key),
        domain_labels: domainMatches.map((domain) => domain.label),
        size_bytes: stat.size,
        sections,
      });
    } catch {
      // 개별 참고문서 오류는 전체 MCP 시작을 막지 않는다.
    }
  }
  return documents;
}

function countOccurrences(text, term) {
  if (!term) return 0;
  return String(text).split(term).length - 1;
}

export function searchReferenceDocuments(documents, query, options = {}) {
  const maxResults = Math.max(1, Math.min(Number(options.maxResults) || 5, 20));
  const requestedDomain = String(options.domain || "auto");
  const keywords = meaningfulKeywords(query);
  const explicitDomain = requestedDomain === "auto" ? null : getEngineeringDomain(requestedDomain);
  const inferred = explicitDomain
    ? [{ ...explicitDomain, score: 100, matched_terms: [explicitDomain.label] }]
    : classifyEngineeringDomains(query, 2);
  const domainKeys = new Set(inferred.map((item) => item.key));
  const results = [];

  for (const doc of documents || []) {
    const docDomainKeys = doc.domain_keys || [doc.domain_key];
    if (requestedDomain !== "auto" && !docDomainKeys.some((key) => domainKeys.has(key))) continue;
    for (const section of doc.sections || []) {
      const text = `${section.title}\n${section.content}`;
      const keywordScore = keywords.reduce((score, keyword) => score + countOccurrences(text, keyword), 0);
      const domainBoost = docDomainKeys.some((key) => domainKeys.has(key)) ? 2 : 0;
      const titleBoost = keywords.some((keyword) => String(section.title).includes(keyword)) ? 3 : 0;
      const score = keywordScore + domainBoost + titleBoost;
      if (score <= 0) continue;
      results.push({
        source_type: "local_reference_document",
        trust_level: "local_reference_unverified",
        document_id: doc.id,
        document_title: doc.title,
        relative_path: doc.relative_path,
        domain_key: doc.domain_key,
        domain_label: doc.domain_label,
        domain_keys: docDomainKeys,
        domain_labels: doc.domain_labels || [doc.domain_label],
        section: section.title,
        quote: compact(section.content || section.title, options.compact === false ? 1400 : 700),
        relevance_score: score,
        citation_note: "로컬 참고자료입니다. 발행기관·판·개정일과 원문을 별도 확인한 뒤 공식 근거로 사용하세요.",
      });
    }
  }
  return results
    .sort((a, b) => b.relevance_score - a.relevance_score || a.document_title.localeCompare(b.document_title, "ko"))
    .slice(0, maxResults);
}
