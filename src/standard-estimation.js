// 건설공사 표준품셈(국토교통부/한국건설기술연구원)은 law.go.kr·KCSC 같은 오픈API가 없고
// 매년 CODIL(건설기술정보시스템, codil.or.kr) 게시판에 PDF로만 공고된다. 이 모듈은 그
// 게시판을 확인해 최신판 PDF를 로컬 캐시로 받아두는 순수 파싱/선택 로직을 담당한다.
// 네트워크·파일시스템 I/O는 index.js의 ensureLatestStandardEstimation에서 수행한다.

// CODIL 서버는 리프 인증서만 보내고 중간(intermediate) 인증서를 생략하는 설정
// 오류가 있다. 브라우저나 curl(Windows schannel)은 AIA(Authority Info Access)를
// 따라가 누락분을 자동 보완하지만 Node의 fetch/undici는 그렇게 하지 않아
// UNABLE_TO_VERIFY_LEAF_SIGNATURE로 실패한다. DER 인증서를 PEM으로 바꾸는 이
// 순수 변환 함수만 여기 두고, 실제 AIA 조회·재요청(네트워크 I/O)은 index.js에서 한다.
export function derCertificateToPem(der) {
  const b64 = Buffer.isBuffer(der) ? der.toString("base64") : Buffer.from(der).toString("base64");
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

export const CODIL_ORIGIN = "https://www.codil.or.kr";
export const CODIL_BOARD_ID = "BBSMSTR_900000000202";
export const CODIL_LIST_URL = `${CODIL_ORIGIN}/helpdesk/search.do?bbsId=${CODIL_BOARD_ID}&bbsAttrbCode=BBSA01`;

export function codilDetailUrl(nttId) {
  return `${CODIL_ORIGIN}/helpdesk/read.do?bbsId=${CODIL_BOARD_ID}&nttId=${encodeURIComponent(nttId)}`;
}

// 게시판 목록 HTML에서 "표준품셈"이 제목에 들어간 가장 최근(첫 번째) 게시물을 찾는다.
// 목록은 최신순으로 내려오는 표(egovframework 게시판 공통 템플릿)이므로 첫 매치를 취하면 된다.
export function parseLatestStandardEstimationEntry(html) {
  const rowPattern = /nttId=(\d+)[^>]*"[^>]*>[\s\S]*?<td class="title">([\s\S]*?)<\/td>[\s\S]*?<td[^>]*>(\d{4}-\d{2}-\d{2})<\/td>/g;
  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    const [, nttId, titleBlock, date] = match;
    const title = titleBlock.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (title.includes("품셈")) {
      return { nttId, title, date };
    }
  }
  return null;
}

function parseFileSizeToBytes(sizeText) {
  const m = String(sizeText || "").trim().match(/([\d.]+)\s*(Kbyte|Mbyte|Gbyte|byte)/i);
  if (!m) return 0;
  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  const multiplier = { byte: 1, kbyte: 1024, mbyte: 1024 * 1024, gbyte: 1024 * 1024 * 1024 }[unit] || 1;
  return value * multiplier;
}

// 상세페이지 HTML의 첨부파일 목록(<li class="file"><a href="...">파일명&nbsp;[크기]</a></li>)을 추출한다.
export function parseAttachmentLinks(html) {
  const linkPattern = /<a href="([^"]+)"[^>]*target="_blank">\s*([^<]+?)&nbsp;\[([^\]]+)\]\s*<\/a>/g;
  const attachments = [];
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const [, href, filenameRaw, sizeText] = match;
    const filename = filenameRaw.replace(/\s+/g, " ").trim();
    if (!/\.pdf$/i.test(filename)) continue;
    attachments.push({
      url: href.startsWith("http") ? href : `${CODIL_ORIGIN}${href}`,
      filename,
      size_text: sizeText.trim(),
      size_bytes: parseFileSizeToBytes(sizeText),
    });
  }
  return attachments;
}

// 공고문/개정사항 요약/정오표 등 여러 첨부 중 "표준품셈 원문" 전체 문서를 고른다.
// 명명 관례상 파일명에 '원문'이 들어가는 게 원문 전체 PDF이므로 이를 최우선으로 하고,
// 그런 파일이 없으면 가장 큰 PDF(원문일 가능성이 높음)로 대체한다.
export function selectOriginalDocumentAttachment(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (!list.length) return null;
  const namedOriginal = list.filter((a) => a.filename.includes("원문"));
  if (namedOriginal.length) {
    return namedOriginal.reduce((best, cur) => (cur.size_bytes >= best.size_bytes ? cur : best));
  }
  return list.reduce((best, cur) => (cur.size_bytes >= best.size_bytes ? cur : best));
}
