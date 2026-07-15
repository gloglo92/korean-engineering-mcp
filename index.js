#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import {
  buildDomainSearchPlan,
  classifyEngineeringDomains,
  listEngineeringDomains,
  meaningfulKeywords,
  resolveEngineeringDomains,
  standardDomainBoost,
} from "./src/domains.js";
import {
  discoverReferenceDocuments,
  searchReferenceDocuments,
} from "./src/references.js";
import {
  renderEngineeringAnswerHtml,
  sanitizeHtmlFilename,
  writeEngineeringAnswerHtml,
} from "./src/html-renderer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));

// ── .env 로딩 (실행 디렉터리 기준, 이미 설정된 환경변수는 유지) ──
export function parseDotEnv(content) {
  const out = {};
  for (const rawLine of String(content).split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  try {
    const parsed = parseDotEnv(readFileSync(envPath, "utf-8"));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    // .env는 선택사항이므로 읽기 실패는 무시
  }
}
loadDotEnv();

const KCSC_KEY = process.env.KCSC_API_KEY || "";
const LAW_KEY  = process.env.LAW_API_KEY  || "";
const KCSC_BASE = "https://kcsc.re.kr/OpenApi";
const LAW_BASE  = "https://www.law.go.kr/DRF";
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 15000;

// ── 로컬 설계기준 해설편 ──────────────────────────────────────
const REFERENCE_DIR = process.env.REFERENCE_DIR || __dirname;

const REFERENCE_FILES = {
  상수도: join(REFERENCE_DIR, "상수도설계기준_해설편(2023).md"),
  하수도: join(REFERENCE_DIR, "하수도설계기준_해설편(2020).md"),
};

// 파일을 마크다운 헤더(#) 단위 섹션으로 분할
export function parseSections(content) {
  const lines = content.split("\n");
  const sections = [];
  let title = "(서두)";
  let body = [];
  let started = false;

  for (const line of lines) {
    if (/^#{1,4}\s/.test(line)) {
      if (started || body.some((l) => l.trim())) {
        sections.push({ title, content: body.join("\n").trim() });
      }
      title = line.replace(/^#+\s*/, "").trim();
      body = [];
      started = true;
    } else {
      body.push(line);
    }
  }
  if (started || body.some((l) => l.trim())) {
    sections.push({ title, content: body.join("\n").trim() });
  }
  return sections;
}

// 시작 시 파일 로딩 (없으면 빈 배열)
const referenceDocs = {};
for (const [name, filePath] of Object.entries(REFERENCE_FILES)) {
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, "utf-8");
    referenceDocs[name] = parseSections(raw);
  }
}

// REFERENCE_DIR이 명시된 경우 분야와 파일명이 고정되지 않은 Markdown/TXT 참고자료도
// 최대 파일 수·크기·탐색 깊이 제한 안에서 색인한다.
const referenceLibrary = process.env.REFERENCE_DIR
  ? discoverReferenceDocuments(REFERENCE_DIR, {
      maxFiles: Number(process.env.REFERENCE_MAX_FILES) || 50,
      maxBytes: Number(process.env.REFERENCE_MAX_FILE_BYTES) || 5 * 1024 * 1024,
      maxDepth: Number(process.env.REFERENCE_MAX_DEPTH) || 3,
    })
  : [];

async function fetchWithTimeout(url) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`외부 API 응답 시간 초과 (${FETCH_TIMEOUT_MS}ms)`);
    }
    throw error;
  }
}

// ── KCSC API ──────────────────────────────────────────────────
const CODELIST_CACHE_TTL_MS = 60 * 60 * 1000; // 1시간
let codeListCache = { data: null, fetchedAt: 0 };

async function fetchKCSC(path) {
  requireApiKey("KCSC_API_KEY", KCSC_KEY);
  const sep = path.includes("?") ? "&" : "?";
  const url = `${KCSC_BASE}${path}${sep}key=${encodeURIComponent(KCSC_KEY)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`KCSC API 오류: ${res.status}`);
  return res.json();
}

// 전체 기준 목록은 크고 자주 쓰이므로 TTL 캐시 적용
async function getCodeList() {
  const now = Date.now();
  if (codeListCache.data && now - codeListCache.fetchedAt < CODELIST_CACHE_TTL_MS) {
    return codeListCache.data;
  }
  const data = await fetchKCSC("/CodeList");
  const list = Array.isArray(data) ? data : [];
  codeListCache = { data: list, fetchedAt: now };
  return list;
}

// ── 법제처 API ────────────────────────────────────────────────
async function fetchLaw(endpoint, params = {}) {
  requireApiKey("LAW_API_KEY", LAW_KEY);
  const url = new URL(`${LAW_BASE}/${endpoint}`);
  url.searchParams.set("OC", LAW_KEY);
  url.searchParams.set("type", "JSON");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new Error(`법제처 API 오류: ${res.status}`);
  // 법제처는 OC 키가 잘못돼도 HTTP 200으로 HTML 오류 페이지를 반환할 수 있음
  const text = await res.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) {
    throw new Error("법제처 API가 JSON 대신 HTML을 반환했습니다. LAW_API_KEY(OC 인증키)가 유효한지, open.law.go.kr에서 해당 API 활용 신청이 승인됐는지 확인하세요.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("법제처 API 응답을 JSON으로 해석할 수 없습니다. 잠시 후 재시도하거나 검색어를 바꿔보세요.");
  }
}

export function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// 법제처 JSON 응답에서 배열 추출 (키 이름이 버전마다 다를 수 있음)
export function extractList(obj, ...keys) {
  for (const key of keys) {
    if (!obj) continue;
    const val = obj[key];
    if (Array.isArray(val)) return val;
    if (val && typeof val === "object") return [val];
  }
  return [];
}

function requireApiKey(name, value) {
  if (!value) throw new Error(`${name} 환경변수가 설정되지 않았습니다. .env 또는 MCP 설정 env에 값을 넣어주세요.`);
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function keywordsFrom(text) {
  return String(text || "")
    .replace(/["'“”‘’()[\]{}]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

export function compactText(text, max = 350) {
  const normalized = stripHtml(text).replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

export function scoreText(text, keywords) {
  const haystack = String(text || "");
  return keywords.reduce((score, kw) => score + (haystack.includes(kw) ? 1 : 0), 0);
}

function standardAuthorityRank(codeType) {
  const rank = { KDS: 1, KCS: 2, KWCS: 3, LHCS: 4, SMCS: 5, EXCS: 6, NHCS: 7, KRCCS: 8, KRACS: 9 };
  return rank[codeType] || 99;
}

function sourceUrlForStandard(item) {
  return item?.no ? `https://www.kcsc.re.kr/StandardCode/Viewer/${item.no}` : "https://www.kcsc.re.kr";
}

async function findStandardEvidence(query, {
  includeLocalStandards = false,
  maxStandards = 3,
  maxSectionsPerStandard = 2,
  detectedDomains = [],
} = {}) {
  requireApiKey("KCSC_API_KEY", KCSC_KEY);
  const list = await getCodeList();
  const keywords = meaningfulKeywords(query);
  const searchTerms = keywords.length ? keywords : keywordsFrom(query);
  const allowedTypes = includeLocalStandards ? null : new Set(["KDS", "KCS"]);
  const candidates = list
    .map((item) => {
      const keywordScore = scoreText(`${item.code || ""} ${item.fullCode || ""} ${item.name || ""}`, searchTerms);
      const domainBoost = standardDomainBoost(item, detectedDomains);
      return { item, score: keywordScore * 10 + domainBoost, keywordScore, domainBoost };
    })
    .filter(({ item, score }) => score > 0 && (!allowedTypes || allowedTypes.has(item.codeType)))
    .sort((a, b) => b.score - a.score || b.keywordScore - a.keywordScore || standardAuthorityRank(a.item.codeType) - standardAuthorityRank(b.item.codeType))
    .slice(0, maxStandards);

  // 상세 조회는 서로 독립적이므로 병렬 실행
  const entries = await Promise.all(candidates.map(async ({ item, score }) => {
    const entry = {
      source_type: item.codeType,
      source_kind: "construction_standard",
      standard_type: item.codeType,
      result_stage: "candidate",
      authority_tier: item.codeType === "KDS" ? 3 : item.codeType === "KCS" ? 4 : 6,
      title: item.name || "",
      code: item.code || "",
      full_code: item.fullCode || "",
      revision: item.version || "",
      updated_at: item.updateDate?.split("T")[0] || "",
      url: sourceUrlForStandard(item),
      relevance_score: score,
      sections: [],
    };
    if (["KDS", "KCS"].includes(item.codeType) && item.code) {
      try {
        const detail = await fetchKCSC(`/CodeViewer/${encodeURIComponent(item.codeType)}/${encodeURIComponent(item.code)}`);
        const detailItem = Array.isArray(detail) ? detail[0] : detail;
        const sections = detailItem?.list || [];
        entry.sections = sections
          .map((sec) => ({
            title: sec.title || "",
            level: sec.level || 1,
            quote: compactText(sec.contents || "", 420),
            score: scoreText(`${sec.title || ""} ${stripHtml(sec.contents || "")}`, keywords),
          }))
          .filter((sec) => sec.score > 0 && sec.quote)
          .sort((a, b) => b.score - a.score)
          .slice(0, maxSectionsPerStandard)
          .map(({ score, ...sec }) => sec);
        entry.result_stage = entry.sections.length ? "detail" : "candidate";
      } catch (error) {
        entry.detail_error = error.message;
      }
    }
    return entry;
  }));
  return entries.sort((a, b) =>
    (b.sections?.length || 0) - (a.sections?.length || 0)
    || b.relevance_score - a.relevance_score,
  );
}

function searchManualEvidence(query, { document = "전체", domain = "auto", maxResults = 3, compact = true } = {}) {
  if (referenceLibrary.length) {
    return searchReferenceDocuments(referenceLibrary, query, {
      domain,
      maxResults,
      compact,
    }).map((item) => ({
      source_type: "design_manual_or_local_reference",
      source_kind: "local_reference",
      result_stage: "detail",
      authority_tier: 7,
      trust_level: item.trust_level,
      document: item.document_title,
      document_id: item.document_id,
      domain_key: item.domain_key,
      domain_label: item.domain_label,
      section: item.section,
      quote: item.quote,
      relevance_score: item.relevance_score,
      citation_note: item.citation_note,
    }));
  }

  // 기존 상·하수도 고정 파일 방식과의 하위호환
  const keywords = keywordsFrom(query);
  const targets = document === "전체" ? Object.keys(referenceDocs) : [document].filter((d) => referenceDocs[d]);
  const results = [];
  for (const docName of targets) {
    for (const sec of referenceDocs[docName] || []) {
      const score = scoreText(`${sec.title}\n${sec.content}`, keywords);
      if (score > 0) {
        results.push({
          source_type: "design_manual_commentary",
          source_kind: "local_reference",
          result_stage: "detail",
          authority_tier: 7,
          trust_level: "local_reference_unverified",
          document: `${docName}설계기준 해설편`,
          domain_key: docName === "상수도" ? "water_supply" : "wastewater",
          domain_label: docName,
          section: sec.title,
          quote: compactText(sec.content, compact ? 420 : 1000),
          relevance_score: score,
          citation_note: "해설편의 발행기관·판·개정일과 원문을 확인한 뒤 사용하세요.",
        });
      }
    }
  }
  return results.sort((a, b) => b.relevance_score - a.relevance_score).slice(0, maxResults);
}

function lawEvidenceFromSearch(data) {
  const search = data?.LawSearch;
  return extractList(search, "law").map((law) => {
    const mst = law["법령일련번호"] || "";
    return {
      source_type: "law_search_result",
      source_kind: "law",
      result_stage: "candidate",
      authority_tier: 1,
      title: law["법령명한글"] || "",
      law_type: law["법령구분명"] || "",
      mst,
      law_id: law["법령ID"] || "",
      effective_date: law["시행일자"] || "",
      ministry: law["소관부처명"] || "",
      url: lawDetailUrl(mst),
      note: "조문 단위 판단 전 법령 본문/조문 상세 확인 필요",
    };
  });
}

function adminEvidenceFromSearch(data) {
  const search = data?.AdmRulSearch || data?.AdminRulSearch || data?.LawSearch;
  return extractList(search, "admrul").map((item) => {
    const id = item["행정규칙일련번호"] || "";
    return {
      source_type: "admin_rule_search_result",
      source_kind: "admin_rule",
      result_stage: "candidate",
      authority_tier: 2,
      title: item["행정규칙명"] || "",
      rule_type: item["행정규칙종류"] || item["행정규칙구분"] || "",
      id,
      admin_rule_id: item["행정규칙ID"] || "",
      effective_date: item["시행일자"] || "",
      issued_date: item["발령일자"] || "",
      agency: item["소관부처명"] || item["발령기관명"] || item["발령기관"] || "",
      url: adminRuleDetailUrl(id),
      note: "고시·예규·훈령·지침 본문 확인 후 보조/직접 근거 여부 판단 필요",
    };
  });
}

function interpretationEvidenceFromSearch(data) {
  const search = data?.InterpSearch || data?.LawSearch;
  return extractList(search, "interp", "expc").map((item) => ({
    source_type: "interpretation_search_result",
    source_kind: "interpretation",
    result_stage: "candidate",
    authority_tier: 5,
    title: item["해석례명"] || item["사건명"] || item.title || "",
    reply_date: item["회신일자"] || "",
    agency: item["회신기관명"] || item["회신기관"] || "",
    summary: compactText(item["질의요지"] || item["요지"] || "", 260),
    note: "사안 유사성 검토 후 적용 가능",
  }));
}

function evidenceIdentity(item) {
  return [item.mst, item.id, item.law_id, item.admin_rule_id, item.title, item.reply_date]
    .filter(Boolean)
    .join("|");
}

async function collectLawSearchEvidence(target, queries, maxItems = 5) {
  const uniqueQueries = [...new Set((queries || []).map((query) => String(query || "").trim()).filter(Boolean))];
  const settled = await Promise.allSettled(
    uniqueQueries.map((query) => fetchLaw("lawSearch.do", { target, query, display: Math.min(5, maxItems) })),
  );
  const items = [];
  const errors = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const searchQuery = uniqueQueries[index];
    if (result.status === "rejected") {
      errors.push({ query: searchQuery, error: result.reason?.message || String(result.reason) });
      continue;
    }
    let mapped = [];
    if (target === "law") mapped = lawEvidenceFromSearch(result.value);
    if (target === "admrul") mapped = adminEvidenceFromSearch(result.value);
    if (target === "expc") mapped = interpretationEvidenceFromSearch(result.value);
    for (const item of mapped) items.push({ ...item, search_query: searchQuery });
  }
  const deduped = [];
  const seen = new Set();
  for (const item of items) {
    const identity = evidenceIdentity(item);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    deduped.push(item);
  }
  return { items: deduped.slice(0, Math.max(1, maxItems)), errors };
}

export function applyEvidenceBudget(groups, maxEvidence) {
  const limit = Math.max(1, Number(maxEvidence) || 1);
  const priority = ["laws", "adminRules", "standards", "manuals", "interpretations"];
  const output = Object.fromEntries(priority.map((key) => [key, []]));
  const offsets = Object.fromEntries(priority.map((key) => [key, 0]));
  let selected = 0;
  let progressed = true;
  while (selected < limit && progressed) {
    progressed = false;
    for (const key of priority) {
      const source = Array.isArray(groups?.[key]) ? groups[key] : [];
      const offset = offsets[key];
      if (selected >= limit || offset >= source.length) continue;
      output[key].push(source[offset]);
      offsets[key] += 1;
      selected += 1;
      progressed = true;
    }
  }
  return { ...output, selected_count: selected, max_evidence: limit };
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function lawDetailUrl(mst) {
  return mst ? `${LAW_BASE}/lawService.do?target=law&MST=${encodeURIComponent(mst)}&type=HTML` : LAW_BASE;
}

function adminRuleDetailUrl(id) {
  return id ? `${LAW_BASE}/lawService.do?target=admrul&ID=${encodeURIComponent(id)}&type=HTML` : LAW_BASE;
}

export function normalizeLawArticles(lawDetail, keyword = "", maxArticles = 8) {
  const law = lawDetail?.["법령"] || lawDetail;
  const info = law?.["기본정보"] || {};
  const articles = asArray(law?.["조문"]?.["조문단위"]);
  const keywords = keywordsFrom(keyword);
  return articles
    .map((article) => {
      const paragraphs = asArray(article["항"]);
      const paragraphText = paragraphs.map((p) => {
        const ho = asArray(p?.["호"]).map((h) => h?.["호내용"] || "").filter(Boolean).join(" ");
        return [p?.["항내용"], ho].filter(Boolean).join(" ");
      }).filter(Boolean).join(" ");
      const text = [article["조문내용"], paragraphText].filter(Boolean).join(" ");
      return {
        article_number: article["조문번호"] || "",
        article_title: article["조문제목"] || "",
        effective_date: article["조문시행일자"] || info["시행일자"] || "",
        quote: compactText(text, 700),
        score: keywords.length ? scoreText(`${article["조문번호"] || ""} ${article["조문제목"] || ""} ${text}`, keywords) : 1,
      };
    })
    .filter((a) => a.quote && (!keywords.length || a.score > 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxArticles)
    .map(({ score, ...a }) => a);
}

export function normalizeAdminRuleArticles(detail, keyword = "", maxArticles = 8) {
  const root = detail?.AdmRulService || detail;
  const basic = root?.기본정보 || {};
  const jo = asArray(root?.조문?.조문단위 || root?.조문단위);
  const annex = asArray(root?.별표?.별표단위);
  const keywords = keywordsFrom(keyword);
  const articleItems = jo.map((article) => {
    const text = [article["조문내용"], article["항내용"]].filter(Boolean).join(" ");
    return {
      source_part: "조문",
      article_number: article["조문번호"] || "",
      article_title: article["조문제목"] || "",
      effective_date: article["조문시행일자"] || basic["시행일자"] || "",
      quote: compactText(text, 700),
      score: keywords.length ? scoreText(`${article["조문번호"] || ""} ${article["조문제목"] || ""} ${text}`, keywords) : 1,
    };
  });
  const annexItems = annex.map((item) => {
    const content = Array.isArray(item["별표내용"]) ? item["별표내용"].flat(Infinity).join(" ") : item["별표내용"];
    const text = [item["별표제목"], content].filter(Boolean).join(" ");
    return {
      source_part: "별표",
      article_number: item["별표번호"] || "",
      article_title: item["별표제목"] || "",
      effective_date: basic["시행일자"] || "",
      quote: compactText(text, 700),
      score: keywords.length ? scoreText(text, keywords) : 1,
    };
  });
  return [...articleItems, ...annexItems]
    .filter((a) => a.quote && (!keywords.length || a.score > 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxArticles)
    .map(({ score, ...a }) => a);
}

const server = new McpServer({ name: "korean-engineering-mcp", version: pkg.version });

// 단위 테스트와 외부 확장 코드에서 사용할 순수 헬퍼 재노출
export {
  buildDomainSearchPlan,
  classifyEngineeringDomains,
  listEngineeringDomains,
  renderEngineeringAnswerHtml,
  resolveEngineeringDomains,
  sanitizeHtmlFilename,
  searchReferenceDocuments,
  writeEngineeringAnswerHtml,
};

// ══════════════════════════════════════════════════════════════
// 분야 분류·문서 산출 도구
// ══════════════════════════════════════════════════════════════

server.tool(
  "list_engineering_domains",
  "지원하는 한국 엔지니어링 분야와 분야별 KDS/KCS·법령·행정규칙 검색 범위를 조회합니다. 상하수도뿐 아니라 도로, 철도, 도시, 하천, 항만, 공항, 건축, 구조, 지반 등 전 분야 검색 계획 수립에 사용합니다.",
  {
    include_search_hints: z.boolean().default(false).describe("법령/행정규칙 검색 힌트까지 포함할지 여부"),
    include_coverage: z.boolean().default(true).describe("분야별 configured/indexed/partial/unavailable 상태 포함"),
  },
  async ({ include_search_hints, include_coverage }) => {
    const domains = listEngineeringDomains().map((item) => {
      const indexedDocuments = referenceLibrary.filter((doc) =>
        (doc.domain_keys || [doc.domain_key]).includes(item.key),
      ).length;
      const base = include_search_hints
        ? { ...item }
        : {
            key: item.key,
            label: item.label,
            aliases: item.aliases,
            standard_prefixes: item.standard_prefixes,
            coverage: item.coverage,
          };
      if (include_coverage) {
        base.coverage_status = {
          classification: "configured",
          kcsc_standards: KCSC_KEY
            ? (item.standard_prefixes?.length ? "indexed" : "partial")
            : "unavailable",
          law_and_admin_rules: LAW_KEY ? "configured" : "unavailable",
          local_references: indexedDocuments > 0 ? "indexed" : "unavailable",
          local_document_count: indexedDocuments,
        };
      }
      return base;
    });
    const payload = {
      schema_version: "1.3",
      count: domains.length,
      providers: {
        kcsc: KCSC_KEY ? "configured" : "unavailable",
        law_open_api: LAW_KEY ? "configured" : "unavailable",
        local_references: referenceLibrary.length ? "indexed" : "unavailable",
      },
      domains,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
);

server.tool(
  "classify_engineering_domain",
  "엔지니어링 질문을 분야별로 분류하고 KDS/KCS·법령·행정규칙 검색 계획을 생성합니다.",
  {
    question: z.string().min(2).max(5000).describe("분류할 엔지니어링 질문"),
    domain: z.string().default("auto").describe("auto 또는 분야 key/한글명. 명시하면 해당 분야를 우선 적용"),
    law_query: z.string().optional().describe("별도 법령 검색어"),
  },
  async ({ question, domain, law_query }) => {
    const plan = buildDomainSearchPlan(question, domain, law_query || "");
    return {
      content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
      structuredContent: plan,
    };
  },
);

server.tool(
  "search_reference_documents",
  "REFERENCE_DIR에 등록한 전 분야 Markdown/TXT 참고자료를 분야·섹션 단위로 검색합니다. 로컬 자료는 보조 근거이며 발행기관·판·개정일을 확인해야 합니다.",
  {
    query: z.string().min(2).max(2000).describe("참고자료 검색어"),
    domain: z.string().default("auto").describe("auto 또는 분야 key/한글명"),
    max_results: z.number().int().min(1).max(20).default(5).describe("최대 결과 수"),
    compact: z.boolean().default(true).describe("짧은 인용문 중심으로 반환"),
  },
  async ({ query, domain, max_results, compact }) => {
    resolveEngineeringDomains(query, domain, 2); // 잘못된 분야 값 조기 검증
    const results = searchReferenceDocuments(referenceLibrary, query, {
      domain,
      maxResults: max_results,
      compact,
    });
    const payload = {
      reference_directory_configured: Boolean(process.env.REFERENCE_DIR),
      indexed_documents: referenceLibrary.length,
      query,
      domain,
      results,
      warning: "로컬 참고자료는 비공식·구판일 수 있으므로 법령/KDS/KCS보다 우선하지 말고 원문 메타데이터를 확인하세요.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
);

server.tool(
  "render_engineering_answer_html",
  "최종 엔지니어링 답변 Markdown과 동일한 내용을 오프라인·A4 인쇄·Word 복사에 적합한 HTML 보고서로 생성합니다. 원문 HTML은 비활성화하고 출력은 전용 디렉터리로 제한합니다.",
  {
    title: z.string().min(1).max(160).describe("문서 제목"),
    answer_markdown: z.string().min(1).max(120000).describe("최종 답변과 정확히 동일한 Markdown 본문"),
    domain: z.string().default("auto").describe("auto 또는 분야 key/한글명"),
    project_name: z.string().max(120).optional().describe("프로젝트명 또는 검토명"),
    document_id: z.string().max(80).optional().describe("문서번호"),
    author: z.string().max(80).optional().describe("작성자 표시"),
    document_status: z.string().max(50).default("검토용").describe("초안/검토용/확정 등 문서 상태"),
    prepared_at: z.string().max(100).optional().describe("표시할 작성 시각. 생략 시 Asia/Seoul 현재시각"),
    filename: z.string().max(150).optional().describe("파일명. 경로는 허용되지 않으며 .html은 자동 부여"),
    include_html: z.boolean().default(false).describe("파일 경로와 함께 HTML 원문도 반환할지 여부. 기본 false로 토큰 절감"),
  },
  async ({ title, answer_markdown, domain, project_name, document_id, author, document_status, prepared_at, filename, include_html }) => {
    const detected = resolveEngineeringDomains(`${title} ${answer_markdown.slice(0, 2000)}`, domain, 2);
    const result = writeEngineeringAnswerHtml({
      title,
      answer_markdown,
      domain_label: detected.map((item) => item.label).join(" · "),
      project_name,
      document_id,
      author,
      document_status,
      prepared_at,
      filename,
      include_html,
      generator_label: `korean-engineering-mcp v${pkg.version}`,
    });
    const payload = {
      ...result,
      domain: detected.map((item) => ({ key: item.key, label: item.label })),
      content_identity: "answer_markdown_sha256는 입력 Markdown 전체의 SHA-256이며 HTML meta에도 동일하게 기록됩니다.",
      usage: "최종 채팅 답변에는 입력한 answer_markdown을 그대로 사용하고, output_path의 HTML 파일을 함께 제공하세요.",
    };
    if (!include_html) delete payload.html;
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
);


// ══════════════════════════════════════════════════════════════
// 건설기준 도구 (KCSC)
// ══════════════════════════════════════════════════════════════

server.tool(
  "search_standards",
  "한국 건설기준(KDS 설계기준, KCS 표준시방서) 키워드 검색",
  {
    query: z.string().describe("검색 키워드 (예: 콘크리트, 하수도, 도로, 철도, 하천, 항만, 공항, 건축, 내진). 여러 단어는 관련도 점수로 반영합니다."),
    type:  z.enum(["ALL", "KDS", "KCS"]).default("ALL").describe("기준 종류 필터: ALL(KDS+KCS), KDS(설계기준), KCS(표준시방서)"),
    domain: z.string().default("auto").describe("auto 또는 엔지니어링 분야 key/한글명. 분야 코드 계열에 가중치를 부여"),
    include_local_standards: z.boolean().default(false).describe("SMCS/LHCS 등 기관·지자체 기준도 포함할지 여부"),
    limit: z.number().int().min(1).max(100).default(20).describe("최대 결과 수 (기본 20)"),
  },
  async ({ query, type, domain, include_local_standards, limit }) => {
    const list = await getCodeList();
    const detectedDomains = resolveEngineeringDomains(query, domain, 2);
    const keywords = meaningfulKeywords(query);
    const searchTerms = keywords.length ? keywords : [query.trim()].filter(Boolean);
    const matched = list
      .map((item) => {
        const keywordScore = scoreText(`${item.code || ""} ${item.fullCode || ""} ${item.name || ""}`, searchTerms);
        const domainBoost = standardDomainBoost(item, detectedDomains);
        return { item, score: keywordScore * 10 + domainBoost, keywordScore, domainBoost };
      })
      .filter(({ item, score }) => {
        if (score <= 0) return false;
        if (type !== "ALL") return item.codeType === type;
        return include_local_standards || ["KDS", "KCS"].includes(item.codeType);
      })
      .sort((a, b) => b.score - a.score || b.keywordScore - a.keywordScore || standardAuthorityRank(a.item.codeType) - standardAuthorityRank(b.item.codeType));

    const results = matched.slice(0, limit).map(({ item }) => item);

    if (!results.length) return { content: [{ type: "text", text: `'${query}' 검색 결과 없음` }] };

    const countLabel = matched.length > results.length
      ? `총 ${matched.length}건 중 상위 ${results.length}건 표시`
      : `${results.length}건`;
    const lines = [`검색결과: '${query}' (${countLabel})\n`];
    for (const item of results) {
      lines.push(`[${item.codeType}] ${item.code} - ${item.name}`);
      lines.push(`  버전: ${item.version || "-"} | 수정일: ${item.updateDate?.split("T")[0] || "-"}`);
      lines.push(`  원문: https://www.kcsc.re.kr/StandardCode/Viewer/${item.no}`);
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "get_standard_detail",
  "특정 건설기준 코드의 상세 내용(목차 및 본문) 조회",
  {
    type:    z.enum(["KDS", "KCS"]).describe("기준 종류: KDS(설계기준) 또는 KCS(표준시방서)"),
    code:    z.string().regex(/^[\d\s]+$/, "기준 코드는 숫자여야 합니다 (예: 142001)").describe("기준 코드 번호 (예: 142001, 570010)"),
    section: z.string().optional().describe("특정 절 키워드로 필터링 (선택사항, 예: 재료, 설계, 시공)"),
  },
  async ({ type, code, section }) => {
    const normalizedCode = code.replace(/\s+/g, "");
    const data = await fetchKCSC(`/CodeViewer/${type}/${encodeURIComponent(normalizedCode)}`);
    const item = Array.isArray(data) ? data[0] : data;
    if (!item?.name) return { content: [{ type: "text", text: `${type} ${code} 조회 실패` }] };

    const lines = [
      `=== ${item.name} (${item.codeType} ${item.code}) ===`,
      `버전: ${item.version || "-"} | 수정일: ${item.updateDate?.split("T")[0] || "-"}`,
      `원문: https://www.kcsc.re.kr/StandardCode/Viewer/${item.no}`,
      "",
    ];

    const sections = item.list || [];
    const filtered = section
      ? sections.filter((s) => s.title?.includes(section) || stripHtml(s.contents)?.includes(section))
      : sections;

    for (const sec of filtered) {
      const indent = "  ".repeat(Math.max(0, (sec.level || 1) - 1));
      lines.push(`${indent}[${sec.title}]`);
      const body = stripHtml(sec.contents);
      if (body && body !== sec.title) {
        lines.push(`${indent}  ${body.length > 500 ? body.slice(0, 500) + "..." : body}`);
      }
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "list_standard_categories",
  "건설기준 전체 카테고리 목록 조회 (분야별 기준 현황 파악용)",
  {
    type: z.enum(["ALL", "KDS", "KCS"]).default("ALL").describe("기준 종류 필터"),
  },
  async ({ type }) => {
    const list = await getCodeList();
    const filtered = type === "ALL" ? list : list.filter((i) => i.codeType === type);

    const groups = {};
    const domainCatalog = listEngineeringDomains();
    for (const item of filtered) {
      const prefix = (item.code || "").slice(0, 2);
      const groupKey = `${item.codeType}:${prefix}`;
      const domains = domainCatalog
        .filter((domain) => (domain.standard_prefixes || []).includes(prefix))
        .map((domain) => domain.label);
      if (!groups[groupKey]) groups[groupKey] = { count: 0, type: item.codeType, prefix, domains, samples: [] };
      groups[groupKey].count++;
      if (groups[groupKey].samples.length < 2) groups[groupKey].samples.push(item.name);
    }

    const lines = [`건설기준 카테고리 현황 (총 ${filtered.length}건)\n`];
    for (const info of Object.values(groups).sort((a, b) => `${a.type}${a.prefix}`.localeCompare(`${b.type}${b.prefix}`))) {
      const domainLabel = info.domains.length ? ` · 분야: ${info.domains.join(", ")}` : "";
      lines.push(`[${info.type}] ${info.prefix}xx계열 (${info.count}건${domainLabel}): ${info.samples.join(", ")}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);


// ══════════════════════════════════════════════════════════════
// 법령 도구 (법제처)
// ══════════════════════════════════════════════════════════════

server.tool(
  "search_laws",
  "법제처 법령 검색 (법률·시행령·시행규칙 등)",
  {
    query:   z.string().describe("검색 키워드 (예: 상수도법, 하수도법, 건설기술진흥법)"),
    display: z.number().int().min(1).max(100).default(10).describe("결과 수 (기본 10)"),
  },
  async ({ query, display }) => {
    const data = await fetchLaw("lawSearch.do", { target: "law", query, display });
    const search = data?.LawSearch;
    const laws = extractList(search, "law");

    if (!laws.length) return { content: [{ type: "text", text: `'${query}' 법령 검색 결과 없음` }] };

    const total = search?.["@total_count"] || search?.totalCnt || laws.length;
    const lines = [`법령 검색결과: '${query}' (총 ${total}건)\n`];
    for (const law of laws) {
      const name = law["법령명한글"] || "";
      const mst = law["법령일련번호"] || "";
      lines.push(`■ ${name}`);
      lines.push(`  종류: ${law["법령구분명"] || ""} | 시행: ${law["시행일자"] || ""} | 소관: ${law["소관부처명"] || ""}`);
      lines.push(`  법령ID: ${law["법령ID"] || ""} | MST: ${mst}`);
      lines.push(`  원문: ${lawDetailUrl(mst)}`);
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "search_interpretations",
  "법제처 법령 해석례 검색 (법령 적용 해석 사례)",
  {
    query:   z.string().describe("검색 키워드 (예: 기술진단, 하수도 대행, 상수도 허가)"),
    display: z.number().int().min(1).max(100).default(10).describe("결과 수 (기본 10)"),
  },
  async ({ query, display }) => {
    const data = await fetchLaw("lawSearch.do", { target: "expc", query, display });
    const search = data?.InterpSearch || data?.LawSearch;
    const items = extractList(search, "interp", "expc");

    if (!items.length) return { content: [{ type: "text", text: `'${query}' 해석례 검색 결과 없음` }] };

    const lines = [`해석례 검색결과: '${query}' (${items.length}건)\n`];
    for (const item of items) {
      const name = item["해석례명"] || item["사건명"] || item["title"] || "";
      lines.push(`■ ${name}`);
      lines.push(`  회신일: ${item["회신일자"] || ""} | 회신기관: ${item["회신기관명"] || item["회신기관"] || ""}`);
      const summary = item["질의요지"] || item["요지"] || "";
      if (summary) lines.push(`  요지: ${summary.slice(0, 200)}`);
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool(
  "search_admin_rules",
  "법제처 행정규칙 검색 (고시·예규·훈령·지침 등)",
  {
    query:   z.string().describe("검색 키워드 (예: 상수도 설계기준 고시, 하수도 기술진단 지침)"),
    display: z.number().int().min(1).max(100).default(10).describe("결과 수 (기본 10)"),
  },
  async ({ query, display }) => {
    const data = await fetchLaw("lawSearch.do", { target: "admrul", query, display });
    const search = data?.AdmRulSearch || data?.AdminRulSearch || data?.LawSearch;
    const items = extractList(search, "admrul");

    if (!items.length) return { content: [{ type: "text", text: `'${query}' 행정규칙 검색 결과 없음` }] };

    const lines = [`행정규칙 검색결과: '${query}' (${items.length}건)\n`];
    for (const item of items) {
      const id = item["행정규칙일련번호"] || "";
      lines.push(`■ ${item["행정규칙명"] || ""}`);
      lines.push(`  종류: ${item["행정규칙종류"] || item["행정규칙구분"] || ""} | 시행: ${item["시행일자"] || ""} | 발령: ${item["발령일자"] || ""} | 기관: ${item["소관부처명"] || item["발령기관명"] || item["발령기관"] || ""}`);
      lines.push(`  행정규칙ID: ${item["행정규칙ID"] || ""} | 일련번호: ${id}`);
      lines.push(`  원문: ${adminRuleDetailUrl(id)}`);
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);


server.tool(
  "get_law_detail",
  "법제처 법령 상세 조회. search_laws 결과의 MST(법령일련번호)를 넣으면 조문 단위 근거와 핵심 인용문을 반환합니다.",
  {
    mst: z.string().describe("법령일련번호(MST). search_laws 결과의 MST 값을 사용"),
    keyword: z.string().optional().describe("조문 필터링 키워드. 예: 기술진단, 배수설비, 공공하수도"),
    max_articles: z.number().int().min(1).max(20).default(8).describe("토큰 절감을 위한 최대 조문 수"),
  },
  async ({ mst, keyword, max_articles }) => {
    const detail = await fetchLaw("lawService.do", { target: "law", MST: mst });
    const law = detail?.["법령"] || {};
    const info = law?.["기본정보"] || {};
    const payload = {
      source_type: "law_detail",
      title: info["법령명_한글"] || "",
      law_type: info["법종구분"]?.["content"] || info["법종구분"] || "",
      mst,
      law_id: info["법령ID"] || "",
      promulgation_number: info["공포번호"] || "",
      promulgation_date: info["공포일자"] || "",
      effective_date: info["시행일자"] || "",
      ministry: info["소관부처"]?.["content"] || info["소관부처"] || "",
      url: lawDetailUrl(mst),
      articles: normalizeLawArticles(detail, keyword || "", Math.max(1, Math.min(Number(max_articles) || 8, 20))),
      citation_note: "최종 답변에는 법령명, 조문번호/제목, 시행일, 핵심 인용문을 함께 표시하세요.",
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }
);

server.tool(
  "get_admin_rule_detail",
  "법제처 행정규칙 상세 조회. search_admin_rules 결과의 일련번호를 넣으면 조문/별표 단위 근거와 핵심 인용문을 반환합니다.",
  {
    id: z.string().describe("행정규칙 일련번호. search_admin_rules 결과의 일련번호 값을 사용"),
    keyword: z.string().optional().describe("조문/별표 필터링 키워드"),
    max_articles: z.number().int().min(1).max(20).default(8).describe("토큰 절감을 위한 최대 조문/별표 수"),
  },
  async ({ id, keyword, max_articles }) => {
    const detail = await fetchLaw("lawService.do", { target: "admrul", ID: id });
    const root = detail?.AdmRulService || {};
    const info = root?.기본정보 || {};
    const payload = {
      source_type: "admin_rule_detail",
      title: info["행정규칙명"] || info["행정규칙명_한글"] || "",
      rule_type: info["행정규칙종류"] || "",
      id,
      issue_number: info["발령번호"] || "",
      issue_date: info["발령일자"] || "",
      effective_date: info["시행일자"] || "",
      agency: info["소관부처"]?.["content"] || info["소관부처명"] || "",
      url: adminRuleDetailUrl(id),
      articles: normalizeAdminRuleArticles(detail, keyword || "", Math.max(1, Math.min(Number(max_articles) || 8, 20))),
      citation_note: "최종 답변에는 행정규칙명, 조문/별표 제목, 시행일 또는 발령일, 핵심 인용문을 함께 표시하세요.",
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }
);


// ══════════════════════════════════════════════════════════════
// 통합 분석 도구
// ══════════════════════════════════════════════════════════════

server.tool(
  "comprehensive_research",
  "법령과 건설기준을 동시에 검색하여 엔지니어링 질문에 법적·기술적 근거를 종합 제공",
  {
    query:          z.string().describe("엔지니어링 질문 키워드 (예: 배수지 진출입로 경사, 도로배수, 철도 노반, 공항 활주로)"),
    domain:         z.string().default("auto").describe("auto 또는 엔지니어링 분야 key/한글명"),
    standard_query: z.string().optional().describe("건설기준 검색에 별도 키워드가 필요한 경우 (기본: query와 동일)"),
    law_query:      z.string().optional().describe("법령 검색에 별도 키워드가 필요한 경우 (기본: query와 동일)"),
  },
  async ({ query, domain, standard_query, law_query }) => {
    const sq = standard_query || query;
    const lq = law_query || query;
    const searchPlan = buildDomainSearchPlan(query, domain, lq);
    const detectedDomains = resolveEngineeringDomains(query, domain, 2);

    // 4개 API 병렬 호출
    const [kcscRes, lawRes, interpRes, adminRes] = await Promise.allSettled([
      getCodeList(),
      fetchLaw("lawSearch.do", { target: "law",    query: lq, display: 5 }),
      fetchLaw("lawSearch.do", { target: "expc",   query: lq, display: 5 }),
      fetchLaw("lawSearch.do", { target: "admrul", query: lq, display: 5 }),
    ]);

    const lines = [
      "═".repeat(60),
      `  종합 엔지니어링 조사: "${query}"`,
      `  분야: ${searchPlan.detected_domains.map((item) => item.label).join(" · ")}`,
      "═".repeat(60),
      "",
    ];

    // ── 1. 건설기준 (KDS/KCS) ──
    lines.push("▶ [건설기준 (KDS/KCS)]");
    if (kcscRes.status === "fulfilled") {
      const list = Array.isArray(kcscRes.value) ? kcscRes.value : [];
      const keywords = meaningfulKeywords(sq);
      const searchTerms = keywords.length ? keywords : [sq.trim()].filter(Boolean);
      const matched = list
        .map((item) => {
          const keywordScore = scoreText(`${item.code || ""} ${item.name || ""}`, searchTerms);
          const domainBoost = standardDomainBoost(item, detectedDomains);
          return { item, score: keywordScore * 10 + domainBoost };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || standardAuthorityRank(a.item.codeType) - standardAuthorityRank(b.item.codeType))
        .slice(0, 6)
        .map(({ item }) => item);

      if (matched.length) {
        for (const item of matched) {
          lines.push(`  [${item.codeType}] ${item.code} ${item.name}`);
          lines.push(`    → get_standard_detail 로 상세 조회 가능`);
        }
      } else {
        lines.push(`  "${sq}" 관련 건설기준 없음 (검색어 변경 후 search_standards 재시도 권장)`);
      }
    } else {
      lines.push(`  KCSC 조회 실패: ${kcscRes.reason?.message || kcscRes.reason}`);
    }
    lines.push("");

    // ── 2. 관련 법령 ──
    lines.push("▶ [관련 법령]");
    if (lawRes.status === "fulfilled") {
      const laws = extractList(lawRes.value?.LawSearch, "law");
      if (laws.length) {
        for (const law of laws) {
          lines.push(`  ■ ${law["법령명한글"]} (${law["법령구분명"]}, 시행 ${law["시행일자"]})`);
        }
      } else {
        lines.push(`  "${lq}" 관련 법령 없음`);
      }
    } else {
      lines.push(`  법제처 조회 실패: ${lawRes.reason?.message || lawRes.reason}`);
    }
    lines.push("");

    // ── 3. 법령 해석례 ──
    lines.push("▶ [법령 해석례]");
    if (interpRes.status === "fulfilled") {
      const search = interpRes.value?.InterpSearch || interpRes.value?.LawSearch;
      const items = extractList(search, "interp", "expc");
      if (items.length) {
        for (const item of items) {
          const name = item["해석례명"] || item["사건명"] || "";
          const date = item["회신일자"] || "";
          lines.push(`  ■ ${name} (${date})`);
          const summary = item["질의요지"] || "";
          if (summary) lines.push(`    요지: ${summary.slice(0, 120)}...`);
        }
      } else {
        lines.push(`  "${lq}" 관련 해석례 없음`);
      }
    } else {
      lines.push(`  해석례 조회 실패: ${interpRes.reason?.message || interpRes.reason}`);
    }
    lines.push("");

    // ── 4. 행정규칙 (고시·예규·지침) ──
    lines.push("▶ [행정규칙 (고시·예규·지침)]");
    if (adminRes.status === "fulfilled") {
      const search = adminRes.value?.AdmRulSearch || adminRes.value?.AdminRulSearch || adminRes.value?.LawSearch;
      const items = extractList(search, "admrul");
      if (items.length) {
        for (const item of items) {
          lines.push(`  ■ ${item["행정규칙명"] || ""} (${item["행정규칙종류"] || item["행정규칙구분"] || ""}, ${item["소관부처명"] || item["발령기관명"] || item["발령기관"] || ""})`);
        }
      } else {
        lines.push(`  "${lq}" 관련 행정규칙 없음`);
      }
    } else {
      lines.push(`  행정규칙 조회 실패: ${adminRes.reason?.message || adminRes.reason}`);
    }
    lines.push("");

    lines.push("─".repeat(60));
    lines.push("※ 세부 내용 조회: get_standard_detail / search_laws / search_interpretations / search_admin_rules");

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);


server.tool(
  "grounded_engineering_research",
  "한국 엔지니어링 답변 전 반드시 사용할 근거 패키지 생성 도구. 법령·행정규칙·해석례·KDS/KCS·설계기준 해설편을 우선 검색하고, 최종 답변은 반환된 근거와 한계 안에서만 작성해야 합니다. 근거가 부족하면 단정하지 말고 '근거 불충분'으로 표시하세요.",
  {
    question: z.string().describe("검토할 엔지니어링 질문"),
    domain: z.string().default("auto").describe("auto 또는 분야 key/한글명. 상하수도·도로·철도·도시·하천·항만·공항·건축 등"),
    standard_query: z.string().optional().describe("건설기준 검색어. 생략 시 question 사용"),
    law_query: z.string().optional().describe("법령/행정규칙 검색어. 생략 시 question 사용"),
    include_local_standards: z.boolean().default(false).describe("SMCS/LHCS 등 기관·지자체 기준까지 포함할지 여부. 기본은 KDS/KCS 우선"),
    max_evidence: z.number().int().min(3).max(20).default(8).describe("토큰 절감을 위한 최대 근거 항목 수"),
    compact: z.boolean().default(true).describe("짧은 인용문 중심으로 반환하여 모델 토큰 사용량 최소화"),
  },
  async ({ question, domain, standard_query, law_query, include_local_standards, max_evidence, compact }) => {
    const sq = standard_query || question;
    const lq = law_query || question;
    const maxItems = Math.max(3, Math.min(Number(max_evidence) || 8, 20));
    const searchPlan = buildDomainSearchPlan(question, domain, lq);
    const detectedDomains = resolveEngineeringDomains(question, domain, 2);

    const [standardsRes, lawsRes, interpRes, adminRes] = await Promise.allSettled([
      findStandardEvidence(sq, {
        includeLocalStandards: include_local_standards,
        maxStandards: Math.min(4, maxItems),
        maxSectionsPerStandard: compact ? 2 : 4,
        detectedDomains,
      }),
      collectLawSearchEvidence("law", searchPlan.law_queries, Math.min(4, maxItems)),
      collectLawSearchEvidence("expc", searchPlan.interpretation_queries, Math.min(2, maxItems)),
      collectLawSearchEvidence("admrul", searchPlan.admin_rule_queries, Math.min(3, maxItems)),
    ]);

    const rawStandards = standardsRes.status === "fulfilled" ? standardsRes.value : [];
    const lawSearchBundle = lawsRes.status === "fulfilled" ? lawsRes.value : { items: [], errors: [{ error: lawsRes.reason?.message || String(lawsRes.reason) }] };
    const interpSearchBundle = interpRes.status === "fulfilled" ? interpRes.value : { items: [], errors: [{ error: interpRes.reason?.message || String(interpRes.reason) }] };
    const adminSearchBundle = adminRes.status === "fulfilled" ? adminRes.value : { items: [], errors: [{ error: adminRes.reason?.message || String(adminRes.reason) }] };
    const rawManuals = searchManualEvidence(sq, {
      document: "전체",
      domain: detectedDomains[0]?.key || "auto",
      maxResults: Math.min(3, maxItems),
      compact,
    });
    const budgetedEvidence = applyEvidenceBudget({
      laws: lawSearchBundle.items,
      adminRules: adminSearchBundle.items,
      standards: rawStandards,
      manuals: rawManuals,
      interpretations: interpSearchBundle.items,
    }, maxItems);
    const {
      standards,
      laws,
      interpretations,
      adminRules,
      manuals,
    } = budgetedEvidence;
    const law_details = [];
    const admin_rule_details = [];
    const detailKeywords = meaningfulKeywords(lq).slice(0, 5).join(" ");

    if (laws[0]?.mst) {
      try {
        const detail = await fetchLaw("lawService.do", { target: "law", MST: laws[0].mst });
        const articles = normalizeLawArticles(detail, detailKeywords || laws[0].search_query || "", compact ? 3 : 6);
        law_details.push({
          ...laws[0],
          result_stage: articles.length ? "detail" : "candidate",
          articles,
        });
      } catch (error) {
        law_details.push({ ...laws[0], detail_error: error.message });
      }
    }
    if (adminRules[0]?.id) {
      try {
        const detail = await fetchLaw("lawService.do", { target: "admrul", ID: adminRules[0].id });
        const articles = normalizeAdminRuleArticles(detail, detailKeywords || adminRules[0].search_query || "", compact ? 3 : 6);
        admin_rule_details.push({
          ...adminRules[0],
          result_stage: articles.length ? "detail" : "candidate",
          articles,
        });
      } catch (error) {
        admin_rule_details.push({ ...adminRules[0], detail_error: error.message });
      }
    }

    const directStandardSections = standards.reduce((count, item) => count + (item.sections?.length || 0), 0);
    const directLawArticles = law_details.reduce((count, item) => count + (item.articles?.length || 0), 0);
    const directAdminArticles = admin_rule_details.reduce((count, item) => count + (item.articles?.length || 0), 0);
    const directEvidenceCount = directStandardSections + directLawArticles + directAdminArticles;
    const evidenceCount = standards.length + laws.length + interpretations.length + adminRules.length + manuals.length;
    const availableEvidenceCount = rawStandards.length + lawSearchBundle.items.length + interpSearchBundle.items.length + adminSearchBundle.items.length + rawManuals.length;
    const directSourceGroups = [directStandardSections, directLawArticles, directAdminArticles, manuals.length].filter((count) => count > 0).length;
    const evidenceStatus = directEvidenceCount >= 2 && directSourceGroups >= 2
      ? "sufficient"
      : directEvidenceCount > 0
        ? "partial"
        : evidenceCount > 0
          ? "weak"
          : "insufficient";

    const payload = {
      schema_version: "1.3",
      question,
      domain_context: searchPlan,
      evidence_status: evidenceStatus,
      evidence_summary: {
        total_candidates: availableEvidenceCount,
        max_evidence: maxItems,
        selected_count: evidenceCount,
        direct_standard_sections: directStandardSections,
        direct_law_articles: directLawArticles,
        direct_admin_rule_articles: directAdminArticles,
        local_reference_sections: manuals.length,
      },
      answer_policy: [
        "법령·시행령·시행규칙 > 행정규칙/고시 > KDS/KCS > 공식 설계기준·해설서 > 기관/지자체 기준 > 실무 관행 순으로 판단하세요.",
        "아래 근거에 없는 사항은 단정하지 말고 '직접 근거 미확인' 또는 '추가 확인 필요'로 표시하세요.",
        "근거자료를 나열하는 데 그치지 말고, 각 근거의 법적/기술적 효력과 질문 적용성을 종합해 결론을 내리세요.",
        "최종 답변에는 출처 유형, 법령명 또는 KDS/KCS 코드, 조문/절 제목, 시행일/개정일, 핵심 인용문을 명기하세요.",
        "항만·공항·도시처럼 KCSC 직접 기준이 제한되거나 분산된 분야는 법령·행정규칙과 소관기관 최신 기준을 추가 확인하세요."
      ],
      source_hierarchy: [
        "법률·시행령·시행규칙",
        "행정규칙·고시·지침",
        "KDS 설계기준",
        "KCS 표준시방서",
        "공식 설계기준·해설서·소관기관 기술기준",
        "기관·지자체 기준",
        "로컬 참고자료",
        "실무 관행",
      ],
      evidence: {
        laws,
        law_details,
        admin_rules: adminRules,
        admin_rule_details,
        interpretations,
        standards,
        local_reference_documents: manuals,
        design_manual_commentary: manuals,
      },
      search_diagnostics: {
        standard_error: standardsRes.status === "rejected" ? standardsRes.reason?.message || String(standardsRes.reason) : null,
        law_errors: lawSearchBundle.errors,
        interpretation_errors: interpSearchBundle.errors,
        admin_rule_errors: adminSearchBundle.errors,
      },
      gaps: [],
      required_final_answer_format: ["결론", "쟁점", "확인 근거", "종합 판단", "실무 적용", "한계/추가 확인 필요사항"],
      html_delivery: {
        tool: "render_engineering_answer_html",
        rule: "사용자가 HTML을 원하면 최종 답변과 정확히 동일한 Markdown을 answer_markdown에 넣어 생성하고 output_path를 함께 제공하세요.",
        template: "오프라인 단일 HTML · A4 인쇄 · Word 서식 복사 · 원문 HTML 비활성화",
      },
    };

    if (!standards.length) payload.gaps.push(`'${sq}'에 대한 KDS/KCS 직접 후보가 부족합니다. 분야별 동의어·상위개념 또는 소관기관 기준으로 재검색하세요.`);
    if (!laws.length && !adminRules.length) payload.gaps.push(`'${lq}'에 대한 법령/행정규칙 후보가 부족합니다. domain_context의 법령명·제도명 검색 계획으로 재확인하세요.`);
    if (standards.some((item) => !item.sections?.length)) payload.gaps.push("일부 기준은 상세 절 인용이 없어 원문 상세조회로 조문/절을 보강해야 합니다.");
    if (["port", "airport", "urban_planning"].includes(detectedDomains[0]?.key)) {
      payload.gaps.push(`${detectedDomains[0].label} 분야는 KCSC 외 소관기관 기준이 중요하므로 최신 원문을 별도 확인해야 합니다.`);
    }
    if (evidenceStatus === "weak" || evidenceStatus === "insufficient") {
      payload.gaps.push("현재 결과만으로 확정 결론을 내리지 말고 직접 조문·절 또는 공식 원문을 추가 확인하세요.");
    }

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }
);


// ══════════════════════════════════════════════════════════════
// 로컬 설계기준 해설편 검색 (파일이 있을 때만 등록)
// ══════════════════════════════════════════════════════════════

const availableDocs = Object.keys(referenceDocs);

if (availableDocs.length > 0) {
  server.tool(
    "search_design_manual",
    `로컬 설계기준 해설편에서 키워드 검색 (보유 문서: ${availableDocs.join(", ")}설계기준 해설편)`,
    {
      query:    z.string().describe("검색 키워드 (예: 배수지 용량, 관거 경사, 슬러지 처리)"),
      document: z.enum(["상수도", "하수도", "전체"]).default("전체")
                 .describe("검색 대상 문서 선택"),
      max_results: z.number().int().min(1).max(20).default(3).describe("반환할 최대 섹션 수 (기본 3)"),
    },
    async ({ query, document, max_results }) => {
      const keywords = query.trim().split(/\s+/).filter(Boolean);
      const targets = document === "전체" ? availableDocs : [document].filter(d => referenceDocs[d]);

      if (!targets.length) {
        return { content: [{ type: "text", text: `'${document}' 해설편 파일이 없습니다.` }] };
      }

      const results = [];

      for (const docName of targets) {
        const sections = referenceDocs[docName];

        const scored = sections
          .map((sec) => {
            const text = `${sec.title}\n${sec.content}`;
            const score = keywords.reduce((s, kw) => {
              const matches = (text.match(new RegExp(escapeRegExp(kw), "g")) || []).length;
              return s + matches;
            }, 0);
            return { docName, ...sec, score };
          })
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, max_results);

        results.push(...scored);
      }

      if (!results.length) {
        return { content: [{ type: "text", text: `'${query}' 관련 내용을 해설편에서 찾을 수 없습니다.` }] };
      }

      // 점수 높은 순 재정렬
      results.sort((a, b) => b.score - a.score);

      const lines = [`설계기준 해설편 검색결과: '${query}' (${results.length}건)\n`];
      for (const r of results) {
        lines.push(`${"─".repeat(50)}`);
        lines.push(`📘 [${r.docName}설계기준 해설편] ${r.title}`);
        lines.push("");
        // 내용은 최대 1000자로 제한
        const preview = r.content.length > 1000
          ? r.content.slice(0, 1000) + "\n...(이하 생략)"
          : r.content;
        lines.push(preview);
        lines.push("");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}


// ── 실행 ──────────────────────────────────────────────────────
// 단위 테스트에서 헬퍼 함수만 import할 수 있도록 자동 시작을 가드
if (process.env.KOREAN_ENGINEERING_MCP_SKIP_AUTOSTART !== "1") {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
