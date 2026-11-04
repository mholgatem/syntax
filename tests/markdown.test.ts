import { describe, expect, it } from 'vitest';
import { renderMarkdownBlocks } from '../src/editor/markdown';

describe('renderMarkdownBlocks', () => {
  const src = [
    '# Title', // 1
    '',
    'Para one', // 3
    'still one [ref]',
    '',
    '[ref]: https://example.com', // 6 (link definition: no block)
    '',
    '- a', // 8
    '- b',
    '',
    '```js', // 11
    'let x = 1;',
    '```',
    '',
    '| a | b |', // 15
    '|---|---|',
    '| 1 | 2 |',
    '',
    'tail', // 19
  ].join('\n');

  it('maps each block to its first source line', () => {
    expect(renderMarkdownBlocks(src).map((b) => b.line)).toEqual([1, 3, 8, 11, 15, 19]);
  });

  it('handles CRLF line endings the same way', () => {
    expect(renderMarkdownBlocks(src.replace(/\n/g, '\r\n')).map((b) => b.line)).toEqual([1, 3, 8, 11, 15, 19]);
  });

  it('resolves reference links defined elsewhere in the document', () => {
    expect(renderMarkdownBlocks(src)[1].html).toContain('href="https://example.com"');
  });

  it('renders GFM tables and fenced code with a language class', () => {
    const html = renderMarkdownBlocks(src).map((b) => b.html).join('');
    expect(html).toContain('<table>');
    expect(html).toContain('class="language-js"');
  });

  it('returns nothing for an empty document', () => {
    expect(renderMarkdownBlocks('')).toEqual([]);
  });
});
