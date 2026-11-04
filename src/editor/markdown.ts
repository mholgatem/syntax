import { marked, type TokensList } from 'marked';

/** One top-level block of rendered markdown and the source line it starts on (1-based). */
export interface MdBlock {
  line: number;
  html: string;
}

/**
 * Render markdown to HTML one top-level block at a time, so the preview can line its
 * blocks up with the editor's lines for scroll sync. The HTML is NOT sanitized.
 */
export function renderMarkdownBlocks(text: string): MdBlock[] {
  const src = text.replace(/\r\n?/g, '\n');
  const tokens = marked.lexer(src, { gfm: true });
  const blocks: MdBlock[] = [];
  // Link definitions are dropped from the token list, so the raws don't simply add up to
  // the source: find each token's raw text in the source instead.
  let pos = 0;
  let line = 1;
  for (const tok of tokens) {
    const at = tok.raw ? src.indexOf(tok.raw, pos) : -1;
    if (at >= 0) {
      for (let i = pos; i < at; i++) if (src.charCodeAt(i) === 10) line++;
      pos = at;
    }
    const start = line;
    if (at >= 0) {
      for (let i = at; i < at + tok.raw.length; i++) if (src.charCodeAt(i) === 10) line++;
      pos = at + tok.raw.length;
    }
    if (tok.type === 'space') continue;
    const list = Object.assign([tok], { links: tokens.links }) as TokensList;
    blocks.push({ line: start, html: marked.parser(list, { gfm: true }) });
  }
  return blocks;
}
