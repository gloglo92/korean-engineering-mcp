import katex from "katex";

const MATH_OPTIONS = Object.freeze({
  throwOnError: false,
  output: "mathml",
  trust: false,
  strict: "ignore",
  maxExpand: 1_000,
  maxSize: 50,
});

function findUnescapedDelimiter(source, delimiter, start) {
  let index = start;
  while (index < source.length) {
    index = source.indexOf(delimiter, index);
    if (index < 0) return -1;
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) return index;
    index += delimiter.length;
  }
  return -1;
}

function renderMath(tex, displayMode) {
  return katex.renderToString(tex, {
    ...MATH_OPTIONS,
    displayMode,
  });
}

function mathInlineRule(state, silent) {
  const start = state.pos;
  if (state.src[start] !== "$" || state.src[start + 1] === "$") return false;
  if (start > 0 && state.src[start - 1] === "\\") return false;
  if (!state.src[start + 1] || /\s/.test(state.src[start + 1])) return false;

  let end = start + 1;
  while (end < state.posMax) {
    end = findUnescapedDelimiter(state.src, "$", end);
    if (end < 0 || end >= state.posMax) return false;
    if (end > start + 1 && !/\s/.test(state.src[end - 1])) break;
    end += 1;
  }

  const content = state.src.slice(start + 1, end);
  if (!content || content.includes("\n")) return false;
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = content;
    token.markup = "$";
  }
  state.pos = end + 1;
  return true;
}

function mathBlockRule(state, startLine, endLine, silent) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (state.src.slice(start, start + 2) !== "$$") return false;

  const openingRemainder = state.src.slice(start + 2, max);
  const sameLineClose = findUnescapedDelimiter(openingRemainder, "$$", 0);
  if (sameLineClose >= 0) {
    if (openingRemainder.slice(sameLineClose + 2).trim()) return false;
    const content = openingRemainder.slice(0, sameLineClose).trim();
    if (!content) return false;
    if (silent) return true;
    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.content = content;
    token.map = [startLine, startLine + 1];
    token.markup = "$$";
    state.line = startLine + 1;
    return true;
  }

  const lines = [];
  if (openingRemainder.trim()) lines.push(openingRemainder);
  let nextLine = startLine + 1;
  let found = false;

  for (; nextLine < endLine; nextLine += 1) {
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineEnd = state.eMarks[nextLine];
    const line = state.src.slice(lineStart, lineEnd);
    const close = findUnescapedDelimiter(line, "$$", 0);
    if (close >= 0 && !line.slice(close + 2).trim()) {
      if (line.slice(0, close).trim()) lines.push(line.slice(0, close));
      found = true;
      break;
    }
    lines.push(line);
  }

  if (!found) return false;
  const content = lines.join("\n").trim();
  if (!content) return false;
  if (silent) return true;

  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = content;
  token.map = [startLine, nextLine + 1];
  token.markup = "$$";
  state.line = nextLine + 1;
  return true;
}

/**
 * Adds offline-safe TeX rendering to markdown-it.
 *
 * KaTeX emits standards-based MathML only, so generated reports need no remote
 * JavaScript, CSS, fonts, or trackers. Raw TeX is retained in data-tex for
 * accessible fallback and plain-text clipboard copies.
 */
export function installMathRendering(md) {
  md.inline.ruler.after("escape", "math_inline", mathInlineRule);
  md.block.ruler.before("fence", "math_block", mathBlockRule, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.renderer.rules.math_inline = (tokens, index) => {
    const tex = tokens[index].content;
    return `<span class="math-inline" data-tex="${md.utils.escapeHtml(tex)}">${renderMath(tex, false)}</span>`;
  };
  md.renderer.rules.math_block = (tokens, index) => {
    const tex = tokens[index].content;
    return `<div class="math-display" data-tex="${md.utils.escapeHtml(tex)}">${renderMath(tex, true)}</div>\n`;
  };

  return md;
}
