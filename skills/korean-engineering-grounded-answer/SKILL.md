---
name: korean-engineering-grounded-answer
description: "한국 엔지니어링 전 분야의 법령·건설기준·소관기관 기준 근거 기반 답변과 사용자 확인 후 선택적으로 동일 내용 HTML 보고서를 생성하는 절차. korean-engineering-mcp와 함께 사용해 할루시네이션을 줄이고 분야 분류·정확한 인용·종합 판단·문서 산출을 강제한다."
version: 1.3.1
author: sonmeggy / Lumi
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [korean-engineering, all-domains, law, KDS, KCS, MCP, citation, grounded-answer, html-report]
---

# Korean Engineering Grounded Answer

Use this skill for Korean engineering questions across water/wastewater, roads, railways, urban planning, rivers/water resources, ports/coasts, airports/aviation, architecture, structures, geotechnical, tunnels, bridges, building services, landscape, agricultural infrastructure, environment, construction management, procurement, and technical-grounding judgment.

## Mandatory rule

Do **not** answer from general knowledge alone. Before giving a substantive answer, gather evidence using the companion MCP server whenever available:

1. Run `classify_engineering_domain` when the field is ambiguous or multidisciplinary; otherwise let `grounded_engineering_research(domain="auto")` classify it.
2. Call `grounded_engineering_research` before drafting the answer.
3. If evidence is weak, retry with the returned `domain_context` law/admin-rule hints and narrower or broader Korean keywords.
4. Use `get_standard_detail`, `search_laws`, `get_law_detail`, `search_admin_rules`, `get_admin_rule_detail`, `search_interpretations`, or `search_reference_documents` to fill missing citation details.
5. If MCP is unavailable, use official web search or verified local reference documents before answering.
6. If direct evidence is still unavailable, say `직접 근거 미확인` or `근거 불충분`; do not make a definitive claim.
7. HTML is **optional**. Do not call `render_engineering_answer_html` automatically after an engineering answer.
8. If the user did not explicitly request HTML in the current turn, first deliver the complete Markdown answer, then ask `동일 내용의 HTML 보고서도 생성할까요?` as a separate conversational prompt and wait for the reply. Never append that prompt to the engineering answer body.
9. An explicit HTML request in the current turn or an affirmative reply is confirmation. Only then call `render_engineering_answer_html` with `user_confirmed_html=true` and the exact final engineering Markdown body, excluding the conversational HTML opt-in prompt; a direct request does not require a second confirmation.

## Source hierarchy

Apply this priority order when sources conflict:

1. 법률·시행령·시행규칙
2. 행정규칙·고시·지침·예규
3. KDS 설계기준
4. KCS 표준시방서
5. 공식 설계기준·해설서·소관기관 기술기준
6. 발주처 지침, 입찰안내서, PQ/SOQ/TP instructions
7. 기관·지자체 기준 such as SMCS/LHCS/KWCS, when applicable
8. 검증된 로컬 참고자료
9. 실무 관행 or expert recommendation

## Domain routing and coverage limits

- Use the registry returned by `list_engineering_domains`; do not assume every field has a dedicated KDS/KCS prefix.
- Water/wastewater, roads, railways, rivers, architecture, structures, geotechnical, bridges, tunnels, and similar fields have strong KDS/KCS coverage.
- Urban planning, ports/coasts, airports/aviation, construction management, and environmental regulation often depend more heavily on statutes, administrative rules, and ministry/agency standards outside KCSC.
- For port, airport, and urban-planning questions, explicitly state when a direct KCSC standard was not found and verify the current source from the competent ministry/agency.
- For multidisciplinary questions, keep each field's controlling source separate before synthesizing the interface judgment.

## Anti-hallucination policy

- Every legal/technical conclusion must be tied to a cited source.
- Separate direct sources from indirect/supporting sources.
- Do not treat a search-result title as a full legal basis; use it only as a pointer until the article/section text is checked.
- If only a general search result is available, mark the conclusion as provisional.
- Never invent article numbers, KDS/KCS section numbers, dates, or quotes.
- Treat local reference Markdown/TXT as unverified supporting data until issuer, edition, revision date, and original source are checked.
- If the evidence pack says `insufficient`, answer with limits and next verification steps rather than a final assertion.

## Token-minimizing workflow

1. Ask the MCP for compact evidence first: `max_evidence` 5–8. This is a global cap across laws, admin rules, standards, interpretations, and local references.
2. Only fetch full standard details for the 1–3 most relevant candidates.
3. Quote only the controlling sentence or paragraph, not whole documents.
4. Put raw source lists at the end or omit irrelevant hits.
5. Prefer a concise conclusion plus cited reasoning over long background explanation.

## Optional HTML twin-delivery workflow

HTML generation is opt-in, not a default side effect.

1. Complete evidence gathering and deliver one final Markdown engineering answer first.
2. If the user did not already request HTML, ask once whether they want an identical HTML report as a separate conversational prompt and stop; do not append that question to the engineering answer and do not call the renderer in that turn.
3. If the user explicitly requested HTML or replies affirmatively, call `render_engineering_answer_html` with `user_confirmed_html=true` and the **exact same engineering Markdown body**, excluding the opt-in question, in `answer_markdown`.
4. If the user declines or does not answer, do not generate a file and do not ask repeatedly.
5. Do not summarize, reorder, or rewrite the engineering content for HTML. The conversational opt-in question is control text, not report content, and must never appear in the generated document.
6. Use a clear engineering title, the detected domain, project/document metadata when known, and `document_status` such as `검토용`.
7. Return the generated `output_path` or client attachment together with the same engineering Markdown answer.
8. Preserve the returned `answer_markdown_sha256` when auditability matters; it hashes the engineering Markdown body actually rendered after any trailing opt-in prompt is removed, and the template stores the same hash in a meta tag.
9. The bundled template is offline, A4 print/PDF ready, and provides rich HTML plus plain-text clipboard copy for Word/report drafting. Do not replace it with remote CSS, trackers, or user-supplied raw HTML.
10. Write mathematical expressions with TeX delimiters (`$...$` inline and `$$...$$` display) when a formula is needed. The renderer converts those expressions to offline MathML; do not inject remote MathJax/KaTeX scripts or raw HTML.
11. Keep the exact TeX source in the Markdown body so chat and HTML remain content-identical and the SHA-256 audit remains valid.
12. If the client cannot access the server file path, retry with `include_html=true` only when necessary, or copy the generated file through the client's normal safe attachment mechanism.

## Required answer format

Use this structure unless the user requests another format:

```markdown
## 결론
- 가능/불가/조건부/위험/근거불충분 중 하나로 판단한다.
- 판단 강도: 확정 / 잠정 / 추가확인 필요

## 쟁점
- 질문을 법적 요건, 설계기준 요건, 실무 적용 요건으로 분해한다.

## 확인 근거
- [법령] 법령명 제○조 제○항, 시행일, 핵심 문구
- [행정규칙/고시] 문서명, 조항/절, 발령기관·일자, 핵심 문구
- [건설기준] KDS/KCS 코드, 기준명, 장/절/항, 개정일, 핵심 문구
- [설계기준/해설편] 문서명, 장/절, 핵심 문구

## 종합 판단
- 각 근거의 효력과 질문 적용성을 연결해 판단한다.
- 근거자료 나열로 끝내지 말고, 왜 그 결론이 되는지 설명한다.

## 실무 적용
- 설계/검토/입찰/보고서에 어떻게 반영할지 쓴다.

## 한계 및 추가 확인
- 직접 근거 미확인 사항, 현장조건, 발주처 특기시방, 최신 개정 여부를 적는다.
```

## Ready-made wording

When evidence is not enough:

> 현재 확인된 법령·건설기준만으로는 해당 사항을 단정할 직접 근거가 부족합니다. 다만 확인된 ○○ 기준은 △△까지를 요구/권고하므로, 본 사안에는 □□ 조건을 추가 확인한 뒤 적용 여부를 판단하는 것이 안전합니다.

When evidence is sufficient:

> 확인된 상위 근거는 ○○이고, KDS/KCS 및 설계기준 해설편은 이를 기술적으로 구체화합니다. 따라서 본 사안은 단순 관행이 아니라 ○○ 근거에 의해 △△로 판단하는 것이 타당합니다.
