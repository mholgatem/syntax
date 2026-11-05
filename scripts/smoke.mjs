// End-to-end smoke test against a running server (npm run preview).
// Uses the locally installed Chrome via playwright-core:  npm run smoke [-- <url>] [--shots <dir>]
import { chromium } from 'playwright-core';
import { unzipSync } from 'fflate';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const shotsIdx = args.indexOf('--shots');
const shots = shotsIdx >= 0 ? args.splice(shotsIdx, 2)[1] : null;
const url = args[0] ?? 'http://localhost:4173/syntax/';
if (shots) mkdirSync(shots, { recursive: true });

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};
const shot = async (name) => shots && page.screenshot({ path: join(shots, `${name}.png`) });

const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const verilog = `// counter\nmodule counter #(parameter W = 8) (\n  input  wire clk,\n  input  wire rst,\n  output reg [W-1:0] q\n);\n  always @(posedge clk) begin\n    if (rst) q <= 0;\n    else     q <= q + 1'b1;\n  end\nendmodule\n`;
const sv = `package pkg;\n  typedef enum logic [1:0] {IDLE, RUN, DONE} state_t;\nendpackage\n\nmodule tb;\n  import pkg::*;\n  logic clk = 0;\n  always #5 clk = ~clk;\n  initial begin\n    $display("hello %0d", 42);\n    $finish;\n  end\nendmodule\n`;
const vhdl = `library ieee;\nuse ieee.std_logic_1164.all;\n\nentity alu is\n  port (a, b : in std_logic_vector(7 downto 0);\n        y    : out std_logic_vector(7 downto 0));\nend entity;\n\narchitecture rtl of alu is\nbegin\n  y <= a and b; -- bitwise\nend architecture;\n`;
const v2 = verilog.replace("q + 1'b1", "q + 2'd2").replace('// counter', '// counter v2');

await page.goto(url);
await page.waitForSelector('body.ready');
check(await page.isVisible('#welcome'), 'welcome screen shown with no files');
await shot('01-welcome');

// Open files through the hidden input (the same path browsers without the FS Access API use).
await page.setInputFiles('#file-input', [
  file('counter.v', verilog),
  file('tb.sv', sv),
  file('alu.vhd', vhdl),
  file('counter_v2.v', v2),
]);
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 4);
check(true, '4 files open as tabs');
check(!(await page.isVisible('#welcome')), 'welcome hidden once files are open');

const langOf = async (name) => {
  await page.click(`.tab:has-text("${name}")`);
  await page.waitForTimeout(150);
  return page.textContent('.status-lang');
};
check((await langOf('counter.v')) === 'Verilog', 'counter.v detected as Verilog');
check((await langOf('alu.vhd')) === 'VHDL', 'alu.vhd detected as VHDL');
check((await langOf('tb.sv')) === 'SystemVerilog', 'tb.sv detected as SystemVerilog');

// Syntax highlighting: "module" and "endmodule" should be colored differently from identifiers.
await page.waitForTimeout(300);
const colors = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('#editor-host .view-line span span')];
  const color = (t) => {
    const s = spans.find((x) => x.textContent.replace(/ /g, ' ').trim().startsWith(t));
    return s ? getComputedStyle(s).color : null;
  };
  return { module: color('module'), tb: color('tb'), display: color('$display') };
});
check(colors.module && colors.tb && colors.module !== colors.tb, `SV keyword highlighted (${colors.module} vs ${colors.tb})`);
await shot('02-sv-light');

await page.click('.tab:has-text("alu.vhd")');
await page.waitForTimeout(300);
const vhdlColors = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('#editor-host .view-line span span')];
  const c = (t) => {
    const s = spans.find((x) => x.textContent.replace(/ /g, ' ').trim().startsWith(t));
    return s ? getComputedStyle(s).color : null;
  };
  return { entity: c('entity'), alu: c('alu'), comment: c('-- bitwise') };
});
check(vhdlColors.entity && vhdlColors.entity !== vhdlColors.alu, 'VHDL keyword highlighted');
check(vhdlColors.comment && vhdlColors.comment !== vhdlColors.alu, `VHDL comment highlighted (${JSON.stringify(vhdlColors)})`);

// Edit -> dirty; undo -> clean again.
await page.click('.tab:has-text("counter.v")');
await page.click('#editor-host .view-line >> nth=0');
await page.keyboard.press('End');
await page.keyboard.type(' edited');
await page.waitForTimeout(100);
check(await page.isVisible('.tab.dirty:has-text("counter.v")'), 'typing marks the tab dirty');
check((await page.title()).startsWith('●'), 'title shows unsaved marker');
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
check(!(await page.isVisible('.tab.dirty:has-text("counter.v")')), 'undo back to saved state clears dirty');
await page.keyboard.press('Control+y');
await page.waitForTimeout(100);
check(await page.isVisible('.tab.dirty:has-text("counter.v")'), 'redo makes it dirty again');

// Per-tab undo history: switch tabs, undo there does not touch counter.v.
await page.click('.tab:has-text("tb.sv")');
await page.keyboard.press('Control+z');
await page.click('.tab:has-text("counter.v")');
await page.waitForTimeout(100);
const firstLine = await page.textContent('#editor-host .view-line >> nth=0');
check(firstLine.includes('edited'), 'undo history is per tab');

// Ctrl+D duplicates the current line directly below.
await page.click('.tab:has-text("tb.sv")');
await page.click('#editor-host .view-line >> nth=1');
const lineCountBefore = await page.evaluate(() => document.querySelectorAll('#editor-host .view-line').length);
await page.keyboard.press('Control+d');
await page.waitForTimeout(150);
const dupLines = await page.evaluate(() =>
  [...document.querySelectorAll('#editor-host .view-line')]
    .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
    .slice(0, 4)
    .map((l) => l.textContent.replace(/ /g, ' ')),
);
check(
  dupLines[1] === dupLines[2] && dupLines[1].includes('typedef') && !dupLines[3].includes('typedef'),
  `Ctrl+D duplicates the line below (${JSON.stringify(dupLines.slice(1, 3))})`,
);
check((await page.evaluate(() => document.querySelectorAll('#editor-host .view-line').length)) === lineCountBefore + 1, 'Ctrl+D adds exactly one line');
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);

// New file via Alt+N
await page.keyboard.press('Alt+n');
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 5);
check(await page.isVisible('.tab.active:has-text("new 1")'), 'Alt+N creates "new 1"');
await page.keyboard.press('Alt+w');
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 4);
check(true, 'Alt+W closes a clean tab without prompting');

// Close a dirty tab -> custom prompt; cancel keeps it.
await page.click('.tab:has-text("counter.v") .tab-close', { force: true });
await page.waitForSelector('.modal');
check((await page.textContent('.modal h2')) === 'Save changes?', 'closing a dirty tab asks to save');
await shot('03-save-prompt');
await page.click('.modal button:has-text("Cancel")');
check((await page.locator('.tab').count()) === 4, 'cancel keeps the tab open');

// Compare
await page.click('.tab:has-text("counter.v")');
await page.keyboard.press('Control+Alt+c');
await page.waitForSelector('.modal select');
await page.selectOption('.modal select >> nth=0', { label: 'counter.v' });
await page.selectOption('.modal select >> nth=1', { label: 'counter_v2.v' });
await page.click('.modal button:has-text("Compare")');
await page.waitForSelector('body.comparing');
await page.waitForTimeout(800);
const diffStatus = await page.textContent('.status-diff');
check(/difference/.test(diffStatus ?? ''), `diff computed: "${diffStatus}"`);
const decorations = await page.locator('#diff-host .line-insert, #diff-host .char-insert, #diff-host .line-delete, #diff-host .char-delete').count();
check(decorations > 0, `diff highlighting rendered (${decorations} decorations)`);
await shot('04-diff');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check(!(await page.evaluate(() => document.body.classList.contains('comparing'))), 'Esc closes compare');

// Themes: dark mode + each scheme applies without errors.
await page.click('.toolbar-btn.codicon-color-mode');
const theme1 = await page.evaluate(() => document.documentElement.dataset.theme);
await page.click('.toolbar-btn.codicon-color-mode');
const theme2 = await page.evaluate(() => document.documentElement.dataset.theme);
check(theme1 !== theme2, `light/dark toggle (${theme1} -> ${theme2})`);
await page.click('.menubar-item:has-text("Settings")');
await page.hover('.menu-item:has-text("Color Scheme")');
const schemeCount = await page.locator('.menu-popup >> nth=1').locator('.menu-item').count();
check(schemeCount >= 6, `${schemeCount} color schemes offered`);
await page.click('.menu-popup >> nth=1 >> .menu-item:has-text("Solarized")');
await page.click('.toolbar-btn.codicon-color-mode');
await page.click('.tab:has-text("tb.sv")');
await page.waitForTimeout(200);
const bg = await page.evaluate(() => getComputedStyle(document.querySelector('#editor-host .monaco-editor-background')).backgroundColor);
check(bg === 'rgb(0, 43, 54)' || bg === 'rgb(253, 246, 227)', `Solarized applied to editor (${bg})`);
await shot('05-solarized');

// Language override from the status bar
await page.click('.status-lang');
await page.click('.menu-popup .menu-item:has-text("Python")');
await page.waitForTimeout(100);
check((await page.textContent('.status-lang')) === 'Python', 'language can be changed manually');
await page.click('.status-lang');
await page.click('.menu-popup .menu-item:has-text("SystemVerilog")');

// ZIP download
const [download] = await Promise.all([page.waitForEvent('download'), page.click('.toolbar-btn.codicon-file-zip')]);
const zipPath = await download.path();
const entries = Object.keys(unzipSync(new Uint8Array(readFileSync(zipPath))));
check(entries.length === 4 && entries.includes('tb.sv'), `zip contains ${entries.join(', ')}`);

// Save of a file with no handle falls back to a download in this browser context.
await page.click('.tab:has-text("alu.vhd")');
const hasPicker = await page.evaluate(() => 'showSaveFilePicker' in window);
if (!hasPicker) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  check(dl.suggestedFilename() === 'alu.vhd', 'Ctrl+S downloads the file');
} else {
  console.log('SKIP  Ctrl+S save (native save picker cannot be automated)');
}

// Session restore after reload (counter.v is still dirty).
await page.waitForTimeout(1200); // autosave debounce
page.on('dialog', (d) => d.accept());
await page.reload();
await page.waitForSelector('body.ready');
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 4, null, { timeout: 5000 }).catch(() => {});
check((await page.locator('.tab').count()) === 4, 'tabs restored after reload');
check(await page.isVisible('.tab.dirty:has-text("counter.v")'), 'unsaved edits restored as dirty');
await page.click('.tab:has-text("counter.v")');
check((await page.textContent('#editor-host .view-line >> nth=0')).includes('edited'), 'unsaved text restored');
check((await page.textContent('.status-lang')) === 'Verilog', 'language restored');

// beforeunload prompt when there are unsaved changes
let sawBeforeUnload = false;
page.removeAllListeners('dialog');
page.on('dialog', async (d) => {
  if (d.type() === 'beforeunload') sawBeforeUnload = true;
  await d.dismiss();
});
await page.close({ runBeforeUnload: true });
await new Promise((r) => setTimeout(r, 500));
check(sawBeforeUnload, 'leaving with unsaved changes triggers the beforeunload prompt');

// Mobile layout: no horizontal page scroll
const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 800 });
await mobile.goto(url);
await mobile.waitForSelector('body.ready');
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 0, 'no horizontal page scroll at phone width');
if (shots) await mobile.screenshot({ path: join(shots, '06-mobile.png') });

// Copy keeps syntax colors on every line, even in a large file that hasn't finished
// background tokenization (pasting into Google Docs / Word uses this HTML).
const cp = await context.newPage();
cp.on('pageerror', (e) => errors.push(String(e)));
await cp.goto(url);
await cp.waitForSelector('body.ready');
let big = '';
for (let i = 0; i < 400; i++) big += `// block ${i}\nmodule m${i} (input wire clk, output reg q);\n  always @(posedge clk) q <= ~q;\nendmodule\n\n`;
await cp.setInputFiles('#file-input', [file('big.sv', big)]);
await cp.waitForSelector('.tab.active:has-text("big.sv")');
await cp.click('#editor-host .view-line >> nth=0');
await cp.keyboard.press('Control+a');
await cp.keyboard.press('Control+c');
await cp.waitForTimeout(200);
const copiedHtml = await cp.evaluate(async () => {
  for (const it of await navigator.clipboard.read())
    if (it.types.includes('text/html')) return (await it.getType('text/html')).text();
  return '';
});
// Every copied line containing "module" must color that word (keyword or bracket-pair color),
// not leave it in the default text color.
const moduleLineStats = await cp.evaluate((html) => {
  const root = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild;
  const base = root.style.color;
  const lines = [...root.children].filter((l) => l.textContent.includes('module'));
  const uncolored = lines.filter(
    (l) => ![...l.querySelectorAll('span')].some((s) => s.textContent.includes('module') && s.style.color !== base),
  );
  return { total: lines.length, uncolored: uncolored.length };
}, copiedHtml);
const moduleLines = { length: moduleLineStats.total };
const uncoloredLines = { length: moduleLineStats.uncolored };
check(
  moduleLines.length === 800 && uncoloredLines.length === 0,
  `copied HTML keeps colors on every line (${moduleLines.length} lines, ${uncoloredLines.length} uncolored)`,
);

// Bracket pair colors are copied too, matching what the editor shows (tabs + nesting + unicode).
const bracketSrc = 'module b;\n\tassign y = ((a & b) | {c, d[3:0]}); // é ( in comment\n\tinitial begin if ((x)) $display("[%0d]", f(g(1))); end\nendmodule\n';
await cp.setInputFiles('#file-input', [file('brackets.sv', bracketSrc)]);
await cp.waitForSelector('.tab.active:has-text("brackets.sv")');
await cp.waitForTimeout(300);
const rendered = await cp.evaluate(() =>
  [...document.querySelectorAll('#editor-host .view-line')]
    .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
    .flatMap((line) =>
      [...line.querySelectorAll('span[class*="bracket-highlighting"]')].map((s) => {
        const [r, g, b] = getComputedStyle(s).color.match(/\d+/g).map(Number);
        return s.textContent + '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
      }),
    ),
);
await cp.click('#editor-host .view-line >> nth=0');
await cp.keyboard.press('Control+a');
await cp.keyboard.press('Control+c');
await cp.waitForTimeout(200);
const bracketHtml = await cp.evaluate(async () => {
  for (const it of await navigator.clipboard.read())
    if (it.types.includes('text/html')) return (await it.getType('text/html')).text();
  return '';
});
const copied = await cp.evaluate((html) => {
  const root = new DOMParser().parseFromString(html, 'text/html').body;
  const out = [];
  for (const span of root.querySelectorAll('span')) {
    const color = span.style.color.match(/\d+/g)?.map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    const t = span.textContent.trim();
    // SystemVerilog also treats module/endmodule and begin/end as bracket pairs.
    if (['module', 'endmodule', 'begin', 'end'].includes(t)) out.push({ ch: t, color: '#' + color, span: t });
    else for (const ch of span.textContent) if ('()[]{}'.includes(ch)) out.push({ ch, color: '#' + color, span: span.textContent });
  }
  return out;
}, bracketHtml);
// Brackets inside strings/comments aren't colorized by the editor, so compare only code brackets.
const copiedCode = copied.filter((c) => !c.span.includes('in comment') && !c.span.includes('%0d'));
const copiedSig = copiedCode.map((c) => c.ch + c.color);
check(
  rendered.length > 10 && JSON.stringify(copiedSig) === JSON.stringify(rendered),
  `copied bracket colors match the editor (${rendered.length} brackets)` +
    (JSON.stringify(copiedSig) === JSON.stringify(rendered) ? '' : `\n   editor: ${rendered.join(' ')}\n   copied: ${copiedSig.join(' ')}`),
);
check(new Set(rendered.map((r) => r.slice(1))).size >= 3, 'at least 3 nesting colors in use');
check(bracketHtml.includes('// é ( in comment'), 'copied text is unchanged by bracket recoloring');

// Partial selection starting mid-line (after a tab): line 2 from "assign" to the end of line 3.
await cp.keyboard.press('Control+Home');
await cp.keyboard.press('ArrowDown');
await cp.keyboard.press('Home'); // first non-whitespace character, i.e. after the tab
await cp.keyboard.press('Shift+ArrowDown');
await cp.keyboard.press('Shift+End');
await cp.keyboard.press('Control+c');
await cp.waitForTimeout(200);
const partial = await cp.evaluate(async () => {
  let html = '';
  for (const it of await navigator.clipboard.read())
    if (it.types.includes('text/html')) html = await (await it.getType('text/html')).text();
  const root = new DOMParser().parseFromString(html, 'text/html').body;
  const out = [];
  for (const span of root.querySelectorAll('span')) {
    const t = span.textContent.trim();
    const color = '#' + span.style.color.match(/\d+/g).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    if (['begin', 'end'].includes(t)) out.push(t + color);
    else if (!/%0d|comment/.test(span.textContent)) for (const ch of span.textContent) if ('()[]{}'.includes(ch)) out.push(ch + color);
  }
  return out;
});
const expectedPartial = rendered.slice(1, rendered.length - 1); // all but module / endmodule
check(
  JSON.stringify(partial) === JSON.stringify(expectedPartial),
  'partial selection after a tab keeps the right bracket colors' +
    (JSON.stringify(partial) === JSON.stringify(expectedPartial) ? '' : `\n   want: ${expectedPartial.join(' ')}\n   got:  ${partial.join(' ')}`),
);

// Unsaved-changes dot: cancel a save, then save for real, then edit again.
// The native save picker is stubbed: the first call is cancelled, later calls succeed.
const sp = await context.newPage();
sp.on('pageerror', (e) => errors.push(String(e)));
await sp.addInitScript(() => {
  let calls = 0;
  window.showSaveFilePicker = async (opts) => {
    if (++calls === 1) throw new DOMException('The user aborted a request.', 'AbortError');
    return {
      kind: 'file',
      name: opts.suggestedName,
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      isSameEntry: async () => false,
    };
  };
});
await sp.goto(url);
await sp.waitForSelector('body.ready');
await sp.setInputFiles('#file-input', [file('dirty.v', 'module d;\nendmodule\n')]);
await sp.waitForSelector('.tab.active:has-text("dirty.v")');
const isDirtyTab = () => sp.locator('.tab.active').evaluate((t) => t.classList.contains('dirty'));
await sp.click('#editor-host .view-line >> nth=0');
await sp.keyboard.press('End');
await sp.keyboard.type(' x');
await sp.keyboard.press('Control+s');
await sp.waitForTimeout(300);
check(await isDirtyTab(), 'cancelling Save leaves the tab marked unsaved');
await sp.keyboard.press('Control+s');
await sp.waitForTimeout(300);
check(!(await isDirtyTab()), 'saving clears the unsaved marker');
await sp.keyboard.type('y');
await sp.waitForTimeout(100);
check(await isDirtyTab(), 'editing after a save marks the tab unsaved again');
await sp.keyboard.press('Control+z');
await sp.waitForTimeout(100);
check(!(await isDirtyTab()), 'undoing back to the saved text clears it again');

// Download fallback (Brave, Firefox, Safari, or plain http): no File System Access API, so
// Save downloads the file. The page can't see whether the browser's own save dialog was
// cancelled, so saving always clears the marker; later edits must bring it back.
const fb = await context.newPage();
fb.on('pageerror', (e) => errors.push(String(e)));
await fb.addInitScript(() => {
  delete window.showSaveFilePicker;
  delete window.showOpenFilePicker;
});
await fb.goto(url);
await fb.waitForSelector('body.ready');
await fb.setInputFiles('#file-input', [file('fallback.v', 'module f;\nendmodule\n')]);
await fb.waitForSelector('.tab.active:has-text("fallback.v")');
const fbDirty = () => fb.locator('.tab.active').evaluate((t) => t.classList.contains('dirty'));
await fb.click('#editor-host .view-line >> nth=0');
await fb.keyboard.press('End');
await fb.keyboard.type(' x');
check(await fbDirty(), 'fallback: editing marks the tab unsaved');
const [fbDownload] = await Promise.all([fb.waitForEvent('download'), fb.keyboard.press('Control+s')]);
await fb.waitForTimeout(100);
check(fbDownload.suggestedFilename() === 'fallback.v', 'fallback: Ctrl+S downloads the file');
check(!(await fbDirty()), 'fallback: saving clears the unsaved marker');
await fb.keyboard.type('y');
await fb.waitForTimeout(100);
check(await fbDirty(), 'fallback: editing after saving marks the tab unsaved again');
await Promise.all([fb.waitForEvent('download'), fb.keyboard.press('Control+s')]);
await fb.waitForTimeout(100);
check(!(await fbDirty()), 'fallback: saving again clears it again');
await fb.keyboard.type('z');
await fb.waitForTimeout(100);
check(await fbDirty(), 'fallback: and the next edit marks it unsaved again');

// Word completion only offers words from code, not words that appear only in comments.
const wc = await context.newPage();
wc.on('pageerror', (e) => errors.push(String(e)));
await wc.goto(url);
await wc.waitForSelector('body.ready');
const wcSrc =
  'module wc;\n  // zebracomment zebrashared\n  /* zebrablock */\n  wire zebrawire;\n  wire zebrashared;\n  initial $display("zebrastring");\nendmodule\n';
await wc.setInputFiles('#file-input', [file('wc.sv', wcSrc)]);
await wc.waitForSelector('.tab.active:has-text("wc.sv")');
await wc.click('#editor-host .view-line >> nth=6'); // the "endmodule" line
await wc.keyboard.press('Home');
await wc.keyboard.type('zebr');
await wc.keyboard.press('Control+Space');
await wc.waitForSelector('.suggest-widget.visible .monaco-list-row', { timeout: 5000 }).catch(() => {});
await wc.waitForTimeout(300);
const suggested = await wc.$$eval('.suggest-widget.visible .monaco-list-row .label-name', (els) =>
  els.map((e) => e.textContent.trim()),
);
check(
  suggested.includes('zebrawire') && suggested.includes('zebrashared'),
  `completion offers code words (${suggested.join(', ')})`,
);
check(
  !suggested.includes('zebracomment') && !suggested.includes('zebrablock') && !suggested.includes('zebrastring'),
  'completion skips words that only appear in comments or strings',
);
await wc.keyboard.press('Escape');

// ---------- feature wave 2: outline, go to definition, instances, align, search, bookmarks,
// indentation, format, split view, installable app. Fresh context = empty session.
const ctx2 = await browser.newContext({
  viewport: { width: 1400, height: 850 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const nf = await ctx2.newPage();
nf.on('pageerror', (e) => errors.push(String(e)));
nf.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await nf.goto(url);
await nf.waitForSelector('body.ready');
const topV = `module top (input clk, output reg [7:0] q);\n  wire [7:0] s;\n  adder #(.W(8)) u_add (.a(q), .b(8'd1), .y(s));\n  always @(posedge clk) q <= s;\nendmodule\n`;
const adderV = `module adder #(parameter W = 8) (\n  input  [W-1:0] a,\n  input  [W-1:0] b,\n  output [W-1:0] y\n);\n  assign y = a + b;\nendmodule\n`;
await nf.setInputFiles('#file-input', [file('adder.v', adderV), file('top.v', topV)]);
await nf.waitForSelector('.tab.active:has-text("top.v")');
const paneWidths = () =>
  nf.evaluate(() => ({
    workspace: document.getElementById('workspace').getBoundingClientRect().width,
    left: document.getElementById('pane-0').getBoundingClientRect().width,
    right: document.getElementById('pane-1').getBoundingClientRect().width,
  }));
const w1 = await paneWidths();
check(Math.abs(w1.left - w1.workspace) < 2, `a single view fills the workspace (${Math.round(w1.left)} of ${Math.round(w1.workspace)}px)`);
const nfLines = (host = '#editor-host') =>
  nf.$$eval(`${host} .view-line`, (els) =>
    els
      .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
      .map((e) => e.textContent.replace(/ /g, ' ')),
  );
const gotoLine = async (n) => {
  await nf.keyboard.press('Control+g');
  await nf.keyboard.type(String(n));
  await nf.keyboard.press('Enter');
  await nf.waitForTimeout(100);
};
const menu = async (top, item) => {
  await nf.click(`.menubar-item:text-is("${top}")`);
  await nf.click(`.menu-popup .menu-item:has(.menu-label:text-is("${item}"))`);
  await nf.waitForTimeout(150);
};
const statusPos = () => nf.textContent('.status-pos');

// Outline
await nf.click('#editor-host .view-line >> nth=0');
await nf.keyboard.press('Alt+o');
await nf.waitForSelector('#outline-panel .tree-row');
const outlineNames = await nf.$$eval('#outline-panel .tree-name', (els) => els.map((e) => e.textContent));
check(['top', 'clk', 'q', 's', 'u_add'].every((n) => outlineNames.includes(n)), `outline lists module, ports, signals, instance (${outlineNames.join(', ')})`);
await nf.click('#outline-panel .tree-row:has(.tree-name:text-is("u_add"))');
await nf.waitForTimeout(150);
check((await statusPos()).includes('Ln: 3'), 'clicking an outline item moves the cursor to it');

// Go to definition across tabs
await gotoLine(3);
await nf.keyboard.press('Home');
await nf.keyboard.press('ArrowRight');
await nf.keyboard.press('ArrowRight');
await nf.keyboard.press('F12');
await nf.waitForSelector('.tab.active:has-text("adder.v")', { timeout: 5000 }).catch(() => {});
check(await nf.isVisible('.tab.active:has-text("adder.v")'), 'F12 on a module name opens its definition in another tab');
check((await statusPos()).includes('Ln: 1'), 'definition cursor is on the module line');

// Copy as Instance
await menu('Edit', 'Copy as Instance');
const inst = (await nf.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'); // the OS clipboard may use CRLF
check(
  inst === 'adder #(\n  .W (W)\n) u_adder (\n  .a (a),\n  .b (b),\n  .y (y)\n);',
  `Copy as Instance builds a named-port instance (${JSON.stringify(inst)})`,
);

// Indentation detection + change from the status bar
check((await nf.textContent('.status-indent')) === 'Spaces: 2', `indentation detected as 2 spaces (${await nf.textContent('.status-indent')})`);
await nf.click('.status-indent');
await nf.click('.menu-popup .menu-item:has(.menu-label:text-is("Indent Using Tabs"))');
await nf.waitForTimeout(100);
check((await nf.textContent('.status-indent')) === 'Tab Size: 2', 'status bar switches the file to tabs');

// Auto-align on Enter: off by default, on via Settings
await nf.setInputFiles('#file-input', [file('align.v', '')]);
await nf.waitForSelector('.tab.active:has-text("align.v")');
await nf.click('#editor-host .view-line >> nth=0');
await nf.keyboard.type('assign a = 1;');
await nf.keyboard.press('Enter');
await nf.keyboard.type('assign bbb = 2;');
await nf.keyboard.press('Enter');
await nf.waitForTimeout(150);
check((await nfLines())[0] === 'assign a = 1;', 'auto-align is off by default');
await menu('Settings', 'Auto-Align on Enter (Verilog / VHDL)');
await nf.click('#editor-host .view-line >> nth=2');
await nf.keyboard.type('assign cc = 3;');
await nf.keyboard.press('Enter');
await nf.waitForTimeout(200);
let al = await nfLines();
check(
  al[0] === 'assign a   = 1;' && al[1] === 'assign bbb = 2;' && al[2] === 'assign cc  = 3;',
  `auto-align lines up the block after Enter (${JSON.stringify(al.slice(0, 3))})`,
);
await nf.keyboard.press('Control+z');
await nf.waitForTimeout(150);
al = await nfLines();
check(al[0] === 'assign a = 1;' && al.length >= 4, 'one Ctrl+Z undoes only the alignment');
await menu('Settings', 'Auto-Align on Enter (Verilog / VHDL)'); // back off
await nf.click('#editor-host .view-line >> nth=0');
await nf.keyboard.press('Control+Alt+a');
await nf.waitForTimeout(150);
check((await nfLines())[0] === 'assign a   = 1;', 'Ctrl+Alt+A aligns the block on demand');

// Find / replace in all tabs
await nf.keyboard.press('Control+Shift+f');
await nf.waitForSelector('#search-find:focus');
await nf.keyboard.type('endmodule');
await nf.waitForSelector('#search-panel .result-line');
check((await nf.textContent('#search-panel .panel-summary')).startsWith('2 results in 2 files'), `search finds matches in every tab (${await nf.textContent('#search-panel .panel-summary')})`);
await nf.fill('#search-replace', 'endmodule // done');
await nf.click('#search-panel .input-row .codicon-replace-all');
await nf.waitForTimeout(300);
await nf.click('.tab:has-text("top.v")');
check((await nfLines())[4] === 'endmodule // done', 'Replace All edits the other tabs');
await nf.click('#editor-host .view-line >> nth=0');
await nf.keyboard.press('Control+z');
await nf.waitForTimeout(150);
check((await nfLines())[4] === 'endmodule', 'one Ctrl+Z per file undoes the replacement');

// Bookmarks: toggle, jump, survive a reload
await gotoLine(2);
await nf.keyboard.press('Control+F2');
await nf.waitForTimeout(100);
check((await nf.$$('#editor-host .bookmark-glyph')).length === 1, 'Ctrl+F2 adds a bookmark glyph');
await gotoLine(5);
await nf.keyboard.press('F2');
await nf.waitForTimeout(100);
check((await statusPos()).includes('Ln: 2'), 'F2 jumps to the bookmark');

// Format document (JSON)
await nf.setInputFiles('#file-input', [file('data.json', '{"a":1,"b":[1,2]}')]);
await nf.waitForSelector('.tab.active:has-text("data.json")');
await nf.click('#editor-host .view-line >> nth=0');
await nf.keyboard.press('Shift+Alt+f');
await nf.waitForFunction(() => document.querySelectorAll('#editor-host .view-line').length > 2, null, { timeout: 8000 }).catch(() => {});
check((await nfLines()).length > 2, 'Format Document pretty-prints JSON');

// Split view: clone top.v into the other view; edits show in both
await nf.click('.tab:has-text("top.v")', { button: 'right' });
await nf.click('.menu-popup .menu-item:has(.menu-label:text-is("Clone to Other View"))');
await nf.waitForSelector('body.split #tabbar-2 .tab:has-text("top.v")');
check(true, 'Clone to Other View opens the second view');
const w2 = await paneWidths();
check(Math.abs(w2.left - w2.right) < 4 && w2.left > w2.workspace * 0.4, `split views share the width evenly (${Math.round(w2.left)} / ${Math.round(w2.right)}px)`);
await nf.click('#editor-host-2 .view-line >> nth=0');
await nf.keyboard.press('Control+Home');
await nf.keyboard.type('// split edit\n');
await nf.waitForTimeout(150);
await nf.click('#tabbar .tab:has-text("top.v")');
check((await nfLines('#editor-host'))[0] === '// split edit', 'an edit in one view shows in the other');
await nf.click('#tabbar-2 .tab:has-text("top.v") .tab-close');
await nf.waitForTimeout(150);
check(!(await nf.evaluate(() => document.body.classList.contains('split'))) && (await nf.isVisible('#tabbar .tab:has-text("top.v")')),
  'closing the clone keeps the file open and closes the second view');

// Bookmark persists across reload (session autosave runs ~1s after changes)
await nf.waitForTimeout(1500);
await nf.reload();
await nf.waitForSelector('body.ready');
await nf.click('.tab:has-text("top.v")');
await nf.waitForTimeout(300);
check((await nf.$$('#editor-host .bookmark-glyph')).length === 1, 'bookmarks are restored after a reload');

// Installable app
const pwaInfo = await nf.evaluate(async () => {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 5000))]);
  const href = document.querySelector('link[rel="manifest"]')?.href;
  const manifest = href ? await (await fetch(href)).json() : null;
  return { sw: !!reg, accepts: Object.values(manifest?.file_handlers?.[0]?.accept ?? {}).flat() };
});
check(pwaInfo.sw, 'service worker is registered');
check(['.v', '.sv', '.vhd'].every((e) => pwaInfo.accepts.includes(e)), 'manifest registers HDL file handlers');
await ctx2.close();

const realErrors = errors.filter((e) => !/favicon/.test(e));
check(realErrors.length === 0, `no console errors${realErrors.length ? ': ' + realErrors.join(' | ') : ''}`);

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
