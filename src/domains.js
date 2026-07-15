import { readFileSync } from "node:fs";

const registryUrl = new URL("../data/engineering-domains.json", import.meta.url);
export const ENGINEERING_DOMAINS = Object.freeze(
  JSON.parse(readFileSync(registryUrl, "utf8")),
);

const DOMAIN_STOPWORDS = new Set([
  "관련", "대한", "위한", "검토", "질문", "기준", "설계", "시공", "공사", "시설",
  "방법", "사항", "적용", "여부", "어떻게", "무엇", "필요", "가능", "조건", "계획",
]);

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s·ㆍ/\\_,.:;()[\]{}"'“”‘’+-]+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function meaningfulKeywords(value) {
  return unique(
    normalize(value)
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && !DOMAIN_STOPWORDS.has(item)),
  );
}

export function getEngineeringDomain(keyOrLabel) {
  const rawKey = String(keyOrLabel || "").trim();
  const input = normalize(rawKey);
  if (!input || input === "auto" || input === "자동") return null;
  if (ENGINEERING_DOMAINS[rawKey]) {
    return { key: rawKey, ...ENGINEERING_DOMAINS[rawKey] };
  }
  for (const [key, profile] of Object.entries(ENGINEERING_DOMAINS)) {
    const candidates = [key, profile.label, ...(profile.aliases || [])].map(normalize);
    if (candidates.includes(input)) return { key, ...profile };
  }
  return null;
}

export function classifyEngineeringDomains(text, limit = 3) {
  const haystack = normalize(text);
  if (!haystack) return [{ key: "general", ...ENGINEERING_DOMAINS.general, score: 0, matched_terms: [] }];

  const ranked = Object.entries(ENGINEERING_DOMAINS)
    .map(([key, profile]) => {
      const matched = [];
      let score = 0;
      const terms = unique([profile.label, ...(profile.aliases || []), ...(profile.standard_terms || [])])
        .sort((a, b) => String(b).length - String(a).length);
      for (const term of terms) {
        const needle = normalize(term);
        if (needle.length < 2 || !haystack.includes(needle)) continue;
        matched.push(term);
        score += Math.min(8, Math.max(2, needle.replace(/\s/g, "").length));
      }
      return { key, ...profile, score, matched_terms: unique(matched) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "ko"));

  if (!ranked.length) {
    return [{ key: "general", ...ENGINEERING_DOMAINS.general, score: 0, matched_terms: [] }];
  }
  return ranked.slice(0, Math.max(1, Math.min(Number(limit) || 3, 5)));
}

export function resolveEngineeringDomains(text, requestedDomain = "auto", limit = 3) {
  const explicit = getEngineeringDomain(requestedDomain);
  if (requestedDomain && !["auto", "자동"].includes(normalize(requestedDomain)) && !explicit) {
    const valid = Object.keys(ENGINEERING_DOMAINS).join(", ");
    throw new Error(`지원하지 않는 엔지니어링 분야입니다: ${requestedDomain}. 사용 가능 값: ${valid}`);
  }
  if (explicit) return [{ ...explicit, score: 100, matched_terms: [explicit.label] }];
  return classifyEngineeringDomains(text, limit);
}

export function buildDomainSearchPlan(question, requestedDomain = "auto", lawQuery = "") {
  const domains = resolveEngineeringDomains(question, requestedDomain, 2);
  const primary = String(lawQuery || question || "").trim();
  const lawHints = domains.flatMap((domain) => domain.law_hints || []);
  const adminHints = domains.flatMap((domain) => domain.admin_rule_hints || []);
  const standardTerms = domains.flatMap((domain) => domain.standard_terms || []);

  return {
    requested_domain: requestedDomain || "auto",
    detected_domains: domains.map((domain) => ({
      key: domain.key,
      label: domain.label,
      score: domain.score,
      matched_terms: domain.matched_terms,
      coverage: domain.coverage,
      standard_prefixes: domain.standard_prefixes || [],
    })),
    law_queries: unique([primary, ...lawHints]).slice(0, 3),
    admin_rule_queries: unique([primary, ...adminHints]).slice(0, 3),
    interpretation_queries: unique([primary]).slice(0, 1),
    standard_terms: unique(standardTerms).slice(0, 8),
  };
}

export function standardDomainBoost(item, detectedDomains = []) {
  const code = String(item?.code || item?.fullCode || "").replace(/\s+/g, "");
  const name = normalize(item?.name || "");
  let boost = 0;
  for (const domain of detectedDomains) {
    if ((domain.standard_prefixes || []).some((prefix) => code.startsWith(String(prefix)))) {
      boost = Math.max(boost, 8);
    }
    if ((domain.standard_terms || []).some((term) => name.includes(normalize(term)))) {
      boost = Math.max(boost, 6);
    }
  }
  return boost;
}

export function listEngineeringDomains() {
  return Object.entries(ENGINEERING_DOMAINS).map(([key, profile]) => ({
    key,
    label: profile.label,
    aliases: profile.aliases,
    standard_prefixes: profile.standard_prefixes,
    coverage: profile.coverage,
    law_hints: profile.law_hints,
    admin_rule_hints: profile.admin_rule_hints,
  }));
}
