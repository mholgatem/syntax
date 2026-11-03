# Syntax

A fast, private, browser-based code editor with the everyday features of a desktop
text editor. It runs entirely in your browser (files are never uploaded) and is hosted on GitHub Pages.

## Features

- **Drag & drop** files, or whole folders, anywhere on the window; each opens as a tab. You can also use Open (Ctrl+O) or New (Alt+N).
- **Syntax highlighting** for 60+ languages, including **Verilog**, **SystemVerilog**,
  **VHDL** and **Tcl / XDC / SDC**, plus C/C++, C#, Java, Python, JS/TS, Go, Rust, PHP, Ruby, Kotlin, Swift,
  Scala, SQL, shell, PowerShell, HTML/CSS, JSON, XML, YAML, Markdown and more. The language is detected from the
  extension and can be changed from the status bar or the Language menu.
- **Compare** two files side by side (or inline) with diff highlighting (Ctrl+Alt+C). Both sides stay editable.
- **Editing**: per-tab undo/redo, find & replace with regex, go to line, multi-cursor and column
  selection, line operations (duplicate, move, delete, sort, join, trim trailing whitespace), case conversion,
  comment toggling, folding, word wrap, show whitespace, zoom, and a command palette (F1).
- **Saving**: Ctrl+S saves in place when the browser supports the File System Access API (Chrome / Edge). Otherwise it
  downloads the file. Save As, Save All, and **Download All as ZIP** are also available.
- **Encodings & line endings**: UTF-8, UTF-8 BOM and UTF-16 LE/BE are detected on open and kept on save. You can convert CRLF ↔ LF.
- **Themes**: Light / Dark / Match System, and 7 color schemes (Default, Classic / Obsidian, Solarized, GitHub, One,
  Gruvbox, Vivid), each with a light and a dark variant.
- **Safety net**: unsaved tabs are marked. Closing a modified tab asks to save, and leaving the page with
  unsaved changes prompts first. Open tabs, including unsaved edits, are kept in the browser's IndexedDB and
  restored after a reload or crash. (Undo history is not kept across reloads.)

## Keyboard shortcuts

Browsers reserve Ctrl+N, Ctrl+W and Ctrl+Tab, so those actions use Alt instead.

| Action | Shortcut |
| --- | --- |
| New / Open | Alt+N / Ctrl+O |
| Save / Save As / Save All | Ctrl+S / Ctrl+Alt+S / Ctrl+Shift+S |
| Close tab | Alt+W, or middle-click the tab |
| Next / previous tab | Alt+PgDn / Alt+PgUp, Alt+1…9 |
| Find / Replace / Go to line | Ctrl+F / Ctrl+H / Ctrl+G |
| Compare files | Ctrl+Alt+C, then Alt+F5 / Shift+Alt+F5 to step through changes, Esc to close |
| Duplicate line | Ctrl+D |
| Word wrap / Zoom | Alt+Z / Ctrl+= Ctrl+- Ctrl+0 |

## Development

```bash
npm install
npm run dev        # dev server
npm test           # unit tests (Vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build at http://localhost:4173/syntax/
npm run smoke      # end-to-end smoke test against the preview server (uses your installed Chrome)
```

Built with Vite + TypeScript, the [Monaco editor](https://github.com/microsoft/monaco-editor),
[fflate](https://github.com/101arrowz/fflate) for zips and [idb-keyval](https://github.com/jakearchibald/idb-keyval) for session storage.

### Project layout

```
src/main.ts              bootstrap and wiring
src/commands.ts          menus, keyboard shortcuts, file/tab commands
src/editor/              Monaco setup, language map, VHDL grammar, color schemes
src/state/               document store, settings, IndexedDB session persistence
src/io/                  open (drop/picker), save (FS Access API / download), zip, text encodings
src/ui/                  editor/diff view, tab bar, menu bar, status bar, dialogs, theme
tests/                   unit tests
scripts/smoke.mjs        browser smoke test
```

## Deployment

`.github/workflows/deploy.yml` tests, builds and publishes to GitHub Pages on every push to `main`.
Before the first deploy, turn Pages on once: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The site is then served at `https://<user>.github.io/<repo>/`. The base path comes from the repository name automatically.
