import createDOMPurify from 'dompurify';
import { monaco } from '../editor/monacoSetup';
import { renderMarkdownBlocks } from '../editor/markdown';
import { store, type Doc, type PaneIndex } from '../state/documents';
import { onSystemModeChange, settings } from '../state/settings';
import { getEditors } from './editorView';

// Live, side-by-side rendered view of a markdown tab, inside each of the two views. It
// follows the editor's scroll position and re-renders shortly after each edit.

const RENDER_DELAY = 120;

// A private DOMPurify instance: Monaco uses the shared one for hovers, and the link hook
// below must not leak into that.
const purify = createDOMPurify(window);
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? '';
    if (href && !href.startsWith('#')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

export const isMarkdown = (doc: Doc | undefined): boolean => doc?.model.getLanguageId() === 'markdown';

/** GitHub-style heading anchor: lower-case, punctuation dropped, spaces to dashes. */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Monaco language id for a fenced code block's info string (`ts`, `verilog`, `sh`...). */
function codeLanguage(name: string): string | undefined {
  const n = name.toLowerCase();
  const langs = monaco.languages.getLanguages();
  return (
    langs.find((l) => l.id === n)?.id ??
    langs.find((l) => l.aliases?.some((a) => a.toLowerCase() === n))?.id ??
    langs.find((l) => l.extensions?.includes(`.${n}`))?.id
  );
}

interface View {
  sync(): void;
  /** Re-render now, if showing a doc. */
  render(): void;
  /** Re-render shortly (after an edit). */
  schedule(): void;
  docId(): string | null;
}

function createView(pane: PaneIndex, ed: monaco.editor.IStandaloneCodeEditor): View {
  const body = document.querySelector<HTMLElement>(`#pane-${pane} .pane-body`)!;
  const divider = document.createElement('div');
  divider.className = 'md-divider';
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-label', 'Resize preview');
  divider.title = 'Drag to resize';
  const preview = document.createElement('div');
  preview.className = 'md-preview';
  preview.tabIndex = 0;
  preview.setAttribute('role', 'document');
  preview.setAttribute('aria-label', 'Markdown preview');
  body.append(divider, preview);

  let shownId: string | null = null;
  let blocks: HTMLElement[] = [];
  let timer = 0;
  let generation = 0;

  const visible = () => shownId !== null;

  function render(): void {
    window.clearTimeout(timer);
    const doc = shownId ? store.get(shownId) : undefined;
    if (!doc) return;
    const gen = ++generation;
    const frag = document.createDocumentFragment();
    blocks = [];
    for (const b of renderMarkdownBlocks(doc.model.getValue())) {
      const wrap = document.createElement('div');
      wrap.className = 'md-block';
      wrap.dataset.line = String(b.line);
      wrap.append(purify.sanitize(b.html, { RETURN_DOM_FRAGMENT: true }));
      frag.append(wrap);
      blocks.push(wrap);
    }
    // Heading anchors go in a data attribute rather than `id`, so a heading can't clash
    // with the app's own element ids.
    const seen = new Map<string, number>();
    for (const h of frag.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
      const base = slug(h.textContent ?? '');
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      h.dataset.anchor = n ? `${base}-${n}` : base;
    }
    const codes = [...frag.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')];
    preview.replaceChildren(frag);
    syncScroll();
    for (const code of codes) {
      const lang = codeLanguage(/language-(\S+)/.exec(code.className)?.[1] ?? '');
      if (!lang) continue;
      void monaco.editor.colorize(code.textContent ?? '', lang, { tabSize: doc.model.getOptions().tabSize }).then((html) => {
        // colorize() escapes the source text, so its output is safe to insert.
        // It ends every line with <br/>, which would leave a blank last line.
        if (gen === generation) code.innerHTML = html.replace(/<br\/>$/, '');
      });
    }
  }

  function schedule(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(render, RENDER_DELAY);
  }

  /** Scroll the preview so the block at the top of the editor is at the top of the preview. */
  function syncScroll(): void {
    if (!visible() || blocks.length === 0) return;
    const top = ed.getScrollTop();
    const maxPreview = preview.scrollHeight - preview.clientHeight;
    // Once the end of the file is on screen, show the end of the preview too.
    const lineCount = ed.getModel()?.getLineCount() ?? 1;
    const endY = ed.getTopForLineNumber(lineCount) + ed.getOption(monaco.editor.EditorOption.lineHeight);
    if (top > 0 && endY <= top + ed.getLayoutInfo().height) {
      preview.scrollTop = maxPreview;
      return;
    }
    // Pairs of (editor y, preview y) to interpolate between.
    let e0 = 0;
    let p0 = 0;
    let e1 = ed.getScrollHeight();
    let p1 = preview.scrollHeight;
    for (const b of blocks) {
      const ey = ed.getTopForLineNumber(Number(b.dataset.line));
      if (ey > top) {
        e1 = ey;
        p1 = b.offsetTop;
        break;
      }
      e0 = ey;
      p0 = b.offsetTop;
    }
    const t = e1 > e0 ? (top - e0) / (e1 - e0) : 0;
    preview.scrollTop = Math.min(maxPreview, p0 + t * (p1 - p0));
  }

  function sync(): void {
    const doc = store.panes[pane].activeId ? store.get(store.panes[pane].activeId!) : undefined;
    const on = settings.get().markdownPreview && isMarkdown(doc);
    body.classList.toggle('md-previewing', on);
    if (!on) {
      if (shownId) {
        shownId = null;
        blocks = [];
        preview.replaceChildren();
      }
      return;
    }
    if (doc!.id !== shownId) {
      shownId = doc!.id;
      // Render after the editor has switched models, so scroll sync sees the right doc.
      window.setTimeout(render, 0);
    }
  }

  ed.onDidScrollChange((e) => {
    if (e.scrollTopChanged || e.scrollHeightChanged) syncScroll();
  });

  // In-page links (#heading) scroll the preview instead of navigating the app.
  preview.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!href?.startsWith('#')) return;
    e.preventDefault();
    const name = decodeURIComponent(href.slice(1)).toLowerCase();
    const target = [...preview.querySelectorAll<HTMLElement>('[data-anchor]')].find((h) => h.dataset.anchor === name);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  divider.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('dragging');
    const box = body.getBoundingClientRect();
    let ratio = settings.get().previewRatio;
    const move = (ev: PointerEvent) => {
      ratio = Math.max(0.15, Math.min(0.85, (ev.clientX - box.left) / box.width));
      document.documentElement.style.setProperty('--md-split', String(ratio));
    };
    const up = () => {
      divider.classList.remove('dragging');
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      settings.update({ previewRatio: ratio });
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
  });
  divider.addEventListener('dblclick', () => settings.update({ previewRatio: 0.5 }));

  return {
    sync,
    render: () => {
      if (visible()) render();
    },
    schedule,
    docId: () => shownId,
  };
}

export function initMarkdownPreview(): void {
  const eds = getEditors();
  const views = ([0, 1] as const).map((p) => createView(p, eds[p]));
  const root = document.documentElement;

  const applySettings = () => {
    const s = settings.get();
    root.style.setProperty('--md-split', String(s.previewRatio));
    root.style.setProperty('--md-font-size', `${s.fontSize}px`);
  };
  applySettings();

  store.subscribe(() => views.forEach((v) => v.sync()));
  store.onContent((doc) => views.forEach((v) => v.docId() === doc.id && v.schedule()));
  let lastKey = '';
  settings.subscribe((s) => {
    applySettings();
    views.forEach((v) => v.sync());
    // Token colors in highlighted code blocks depend on the theme.
    const key = `${s.scheme}|${s.mode}`;
    if (key !== lastKey) views.forEach((v) => v.render());
    lastKey = key;
  });
  lastKey = `${settings.get().scheme}|${settings.get().mode}`;
  onSystemModeChange(() => views.forEach((v) => v.render()));
  views.forEach((v) => v.sync());
}
