import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import * as monaco from 'monaco-editor';
import { vhdlConfiguration, vhdlLanguage } from './vhdl';
import { SCHEMES, monacoThemeName, toMonacoTheme } from './themes';

// Monaco's own `new URL('...js', import.meta.url)` worker references are emitted by Vite
// as unbundled assets that fail to load, so hand Monaco properly bundled workers instead.
// The editor worker powers the diff computation, among other things.
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string): Worker {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

monaco.languages.register({ id: 'vhdl', extensions: ['.vhd', '.vhdl'], aliases: ['VHDL', 'vhdl'] });
monaco.languages.setLanguageConfiguration('vhdl', vhdlConfiguration);
monaco.languages.setMonarchTokensProvider('vhdl', vhdlLanguage);

for (const scheme of SCHEMES) {
  monaco.editor.defineTheme(monacoThemeName(scheme.id, 'light'), toMonacoTheme(scheme.light, 'light'));
  monaco.editor.defineTheme(monacoThemeName(scheme.id, 'dark'), toMonacoTheme(scheme.dark, 'dark'));
}

// Ctrl+D duplicates the current line (or selected lines) below, as in Notepad++,
// instead of Monaco's default "add next occurrence to selection".
monaco.editor.addKeybindingRules([
  { keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, command: '-editor.action.addSelectionToNextFindMatch' },
  {
    keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD,
    command: 'editor.action.copyLinesDownAction',
    when: 'editorTextFocus && !editorReadonly',
  },
]);

export { monaco };
