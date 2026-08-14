// 문서에 인용된 법령·자치법규·행정규칙이 실제 현행 내용과 일치하는지 검증하는 순수 로직.
// 네트워크 호출(법제처 검색)은 index.js에서 담당하고, 이 모듈은 검색 결과와
// 문서에 적힌 인용 정보를 비교해 판정만 내린다 (단위 테스트 용이성을 위해 분리).

export function normalizeDateDigits(value) {
  const str = String(value || "").trim();
  if (!str) return "";
  const onlyDigits = str.replace(/\D/g, "");
  if (onlyDigits.length === 8 && str === onlyDigits) return onlyDigits;
  const m = str.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}${mo.padStart(2, "0")}${d.padStart(2, "0")}`;
  }
  return onlyDigits.length === 8 ? onlyDigits : "";
}

export function formatDateDigits(digits) {
  if (!/^\d{8}$/.test(String(digits || ""))) return String(digits || "");
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
}

export function normalizeCompactText(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

export function nameSimilarityScore(a, b) {
  const na = normalizeCompactText(a);
  const nb = normalizeCompactText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 70;
  const ta = new Set(String(a || "").split(/\s+/).filter(Boolean));
  const tb = new Set(String(b || "").split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap += 1;
  return overlap * 10;
}

// citation: { kind: 'law'|'ordinance'|'admin_rule', name, region?, claimed_date?, claimed_issuer? }
// candidates: 정규화된 검색결과 배열. 각 항목은 최소 { title, effective_date, url }를 가지며
// ordinance는 region, law/admin_rule은 ministry 또는 agency 필드를 추가로 가질 수 있다.
export function evaluateCitation(citation, candidates) {
  const name = String(citation?.name || "").trim();
  const list = Array.isArray(candidates) ? candidates : [];

  if (!list.length) {
    return {
      status: "not_found",
      reasons: [`'${name}' 검색 결과가 없습니다. 검색어나 명칭을 확인하세요.`],
      matched: null,
      alternatives: [],
    };
  }

  const normalizedRegion = normalizeCompactText(citation?.region);
  const scored = list
    .map((candidate) => {
      let score = nameSimilarityScore(name, candidate.title);
      if (citation?.kind === "ordinance" && normalizedRegion) {
        if (normalizeCompactText(candidate.region).includes(normalizedRegion)) score += 50;
      }
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score);

  const topScore = scored[0].score;
  const rivals = scored.filter((s) => s.score === topScore);
  if (rivals.length > 1 && topScore > 0) {
    return {
      status: "ambiguous",
      reasons: [`동일 순위 후보가 ${rivals.length}건입니다. 지자체명/명칭을 더 구체적으로 지정하세요.`],
      matched: null,
      alternatives: scored.slice(0, 5).map((s) => s.candidate),
    };
  }

  const matched = scored[0].candidate;
  const reasons = [];

  if (normalizeCompactText(matched.title) !== normalizeCompactText(name)) {
    reasons.push(`검색된 명칭이 다릅니다: 문서상 '${name}' vs 실제 '${matched.title}'`);
  }

  if (citation?.claimed_date) {
    const claimed = normalizeDateDigits(citation.claimed_date);
    const actual = normalizeDateDigits(matched.effective_date);
    if (claimed && actual && claimed !== actual) {
      reasons.push(`시행일자 불일치: 문서상 ${citation.claimed_date} vs 실제 ${formatDateDigits(actual)}`);
    }
  }

  if (citation?.kind === "ordinance" && citation?.region) {
    if (!normalizeCompactText(matched.region).includes(normalizedRegion)) {
      reasons.push(`지자체 불일치: 문서상 '${citation.region}' vs 실제 '${matched.region || "확인불가"}'`);
    }
  }

  if ((citation?.kind === "law" || citation?.kind === "admin_rule") && citation?.claimed_issuer) {
    const claimedIssuer = normalizeCompactText(citation.claimed_issuer);
    const actualIssuerRaw = matched.ministry || matched.agency || "";
    const actualIssuer = normalizeCompactText(actualIssuerRaw);
    // 부처명은 완전일치로만 비교한다. 부분일치를 허용하면 "환경부"→"기후에너지환경부"처럼
    // 개편 후에도 옛 이름이 신 이름의 부분 문자열로 남아있어 개편 사실을 놓치게 된다.
    if (claimedIssuer && actualIssuer && claimedIssuer !== actualIssuer) {
      reasons.push(`소관부처 불일치(조직개편·명칭변경 가능성): 문서상 '${citation.claimed_issuer}' vs 실제 '${actualIssuerRaw}'`);
    }
  }

  return {
    status: reasons.length ? "mismatch" : "current",
    reasons,
    matched,
    alternatives: scored.slice(1, 4).map((s) => s.candidate),
  };
}
