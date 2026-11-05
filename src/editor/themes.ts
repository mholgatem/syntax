import type * as Monaco from 'monaco-editor';

// Each color scheme has a light and a dark variant. A variant is a compact palette
// that drives both the Monaco theme and the app chrome (menus, tabs, status bar).

export interface Palette {
  bg: string;
  fg: string;
  comment: string;
  keyword: string;
  string: string;
  number: string;
  type: string;
  func: string; // builtins / predefined
  constant: string;
  operator: string;
  attribute: string;
  tag: string;
  // editor UI
  selection: string;
  lineHighlight: string;
  lineNumber: string;
  lineNumberActive: string;
  cursor: string;
  // app chrome
  chromeBg: string; // menu bar, tab strip, status bar
  chromeFg: string;
  chromeMuted: string;
  tabActiveBg: string;
  border: string;
  accent: string;
  hover: string;
  diffInsert: string;
  diffRemove: string;
  /** HDL module / entity names (decorations, see hdl/monacoHdl.ts). Unset: normal token color. */
  moduleName?: string;
}

/** Extras for special schemes. */
export interface SchemeEffects {
  /** CRT look: scan-lines and glow (styled in app.css under :root[data-crt]). */
  crt?: true;
  cursorStyle?: 'block';
  fontFamily?: string;
  /** Added to the editor font size (small pixel fonts need a bump). */
  fontSizeDelta?: number;
}

export interface Scheme {
  id: string;
  label: string;
  light: Palette;
  dark: Palette;
  /** Always rendered dark, whatever the Light/Dark setting. */
  darkOnly?: true;
  /** Extra Monaco token rules, applied after the defaults. */
  extraRules?: Monaco.editor.ITokenThemeRule[];
  /** Extra Monaco UI colors, applied after the defaults. */
  extraColors?: Record<string, string>;
  effects?: SchemeEffects;
}

type Mode = 'light' | 'dark';

const SCHEMES_DATA: Scheme[] = [
  {
    id: 'default',
    label: 'Default',
    light: {
      bg: '#ffffff', fg: '#1f1f1f', comment: '#008000', keyword: '#0000ff', string: '#a31515',
      number: '#098658', type: '#267f99', func: '#795e26', constant: '#0070c1', operator: '#000000',
      attribute: '#e50000', tag: '#800000',
      selection: '#add6ff', lineHighlight: '#f3f3f3', lineNumber: '#9a9a9a', lineNumberActive: '#0b216f',
      cursor: '#000000',
      chromeBg: '#f3f3f3', chromeFg: '#1f1f1f', chromeMuted: '#6b6b6b', tabActiveBg: '#ffffff',
      border: '#d4d4d4', accent: '#005fb8', hover: '#e3e3e3', diffInsert: '#9ccc2c40', diffRemove: '#ff000033',
    },
    dark: {
      bg: '#1e1e1e', fg: '#d4d4d4', comment: '#6a9955', keyword: '#569cd6', string: '#ce9178',
      number: '#b5cea8', type: '#4ec9b0', func: '#dcdcaa', constant: '#4fc1ff', operator: '#d4d4d4',
      attribute: '#9cdcfe', tag: '#569cd6',
      selection: '#264f78', lineHighlight: '#2a2d2e', lineNumber: '#6e7681', lineNumberActive: '#cccccc',
      cursor: '#aeafad',
      chromeBg: '#252526', chromeFg: '#cccccc', chromeMuted: '#8b8b8b', tabActiveBg: '#1e1e1e',
      border: '#3c3c3c', accent: '#3794ff', hover: '#37373d', diffInsert: '#9ccc2c33', diffRemove: '#ff000033',
    },
  },
  {
    id: 'classic',
    label: 'Classic / Obsidian',
    light: {
      // Bright, traditional desktop-editor look
      bg: '#ffffff', fg: '#000000', comment: '#008000', keyword: '#0000ff', string: '#808080',
      number: '#ff8000', type: '#8000ff', func: '#8000ff', constant: '#ff8000', operator: '#000080',
      attribute: '#ff0000', tag: '#0000ff',
      selection: '#c0c0c0', lineHighlight: '#e8e8ff', lineNumber: '#808080', lineNumberActive: '#000000',
      cursor: '#000000',
      chromeBg: '#f0f0f0', chromeFg: '#000000', chromeMuted: '#606060', tabActiveBg: '#ffffff',
      border: '#c8c8c8', accent: '#ff8000', hover: '#dcdcf0', diffInsert: '#00c00033', diffRemove: '#ff000033',
    },
    dark: {
      bg: '#293134', fg: '#e0e2e4', comment: '#66747b', keyword: '#93c763', string: '#ec7600',
      number: '#ffcd22', type: '#678cb1', func: '#a082bd', constant: '#ffcd22', operator: '#e8e2b7',
      attribute: '#678cb1', tag: '#93c763',
      selection: '#404e51', lineHighlight: '#2f393c', lineNumber: '#5f6b70', lineNumberActive: '#e0e2e4',
      cursor: '#e0e2e4',
      chromeBg: '#22292c', chromeFg: '#e0e2e4', chromeMuted: '#8a969b', tabActiveBg: '#293134',
      border: '#3b4548', accent: '#93c763', hover: '#344044', diffInsert: '#93c76333', diffRemove: '#ec760033',
    },
  },
  {
    id: 'solarized',
    label: 'Solarized',
    light: {
      bg: '#fdf6e3', fg: '#586e75', comment: '#93a1a1', keyword: '#859900', string: '#2aa198',
      number: '#d33682', type: '#b58900', func: '#268bd2', constant: '#cb4b16', operator: '#657b83',
      attribute: '#268bd2', tag: '#268bd2',
      selection: '#eee8d5', lineHighlight: '#eee8d5', lineNumber: '#93a1a1', lineNumberActive: '#586e75',
      cursor: '#657b83',
      chromeBg: '#eee8d5', chromeFg: '#586e75', chromeMuted: '#93a1a1', tabActiveBg: '#fdf6e3',
      border: '#ddd6c1', accent: '#268bd2', hover: '#e4ddc8', diffInsert: '#85990033', diffRemove: '#dc322f33',
    },
    dark: {
      bg: '#002b36', fg: '#93a1a1', comment: '#586e75', keyword: '#859900', string: '#2aa198',
      number: '#d33682', type: '#b58900', func: '#268bd2', constant: '#cb4b16', operator: '#839496',
      attribute: '#268bd2', tag: '#268bd2',
      selection: '#073642', lineHighlight: '#073642', lineNumber: '#586e75', lineNumberActive: '#93a1a1',
      cursor: '#839496',
      chromeBg: '#00212b', chromeFg: '#93a1a1', chromeMuted: '#657b83', tabActiveBg: '#002b36',
      border: '#0a3a47', accent: '#2aa198', hover: '#073642', diffInsert: '#85990033', diffRemove: '#dc322f33',
    },
  },
  {
    id: 'github',
    label: 'GitHub',
    light: {
      bg: '#ffffff', fg: '#1f2328', comment: '#59636e', keyword: '#cf222e', string: '#0a3069',
      number: '#0550ae', type: '#953800', func: '#8250df', constant: '#0550ae', operator: '#1f2328',
      attribute: '#0550ae', tag: '#116329',
      selection: '#b6e3ff', lineHighlight: '#f6f8fa', lineNumber: '#8c959f', lineNumberActive: '#1f2328',
      cursor: '#1f2328',
      chromeBg: '#f6f8fa', chromeFg: '#1f2328', chromeMuted: '#59636e', tabActiveBg: '#ffffff',
      border: '#d1d9e0', accent: '#0969da', hover: '#eaeef2', diffInsert: '#aceebb80', diffRemove: '#ffcecb80',
    },
    dark: {
      bg: '#0d1117', fg: '#e6edf3', comment: '#9198a1', keyword: '#ff7b72', string: '#a5d6ff',
      number: '#79c0ff', type: '#ffa657', func: '#d2a8ff', constant: '#79c0ff', operator: '#e6edf3',
      attribute: '#79c0ff', tag: '#7ee787',
      selection: '#264f78', lineHighlight: '#161b22', lineNumber: '#6e7681', lineNumberActive: '#e6edf3',
      cursor: '#e6edf3',
      chromeBg: '#010409', chromeFg: '#e6edf3', chromeMuted: '#9198a1', tabActiveBg: '#0d1117',
      border: '#30363d', accent: '#2f81f7', hover: '#161b22', diffInsert: '#2ea04340', diffRemove: '#f8514940',
    },
  },
  {
    id: 'one',
    label: 'One',
    light: {
      bg: '#fafafa', fg: '#383a42', comment: '#a0a1a7', keyword: '#a626a4', string: '#50a14f',
      number: '#986801', type: '#c18401', func: '#4078f2', constant: '#986801', operator: '#0184bc',
      attribute: '#e45649', tag: '#e45649',
      selection: '#e5e5e6', lineHighlight: '#f0f0f1', lineNumber: '#9d9d9f', lineNumberActive: '#383a42',
      cursor: '#526fff',
      chromeBg: '#eaeaeb', chromeFg: '#383a42', chromeMuted: '#808084', tabActiveBg: '#fafafa',
      border: '#dbdbdc', accent: '#526fff', hover: '#dfdfe0', diffInsert: '#50a14f33', diffRemove: '#e4564933',
    },
    dark: {
      bg: '#282c34', fg: '#abb2bf', comment: '#7f848e', keyword: '#c678dd', string: '#98c379',
      number: '#d19a66', type: '#e5c07b', func: '#61afef', constant: '#d19a66', operator: '#56b6c2',
      attribute: '#e06c75', tag: '#e06c75',
      selection: '#3e4451', lineHighlight: '#2c313c', lineNumber: '#495162', lineNumberActive: '#abb2bf',
      cursor: '#528bff',
      chromeBg: '#21252b', chromeFg: '#abb2bf', chromeMuted: '#7f848e', tabActiveBg: '#282c34',
      border: '#181a1f', accent: '#528bff', hover: '#2c313a', diffInsert: '#98c37933', diffRemove: '#e06c7533',
    },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    light: {
      bg: '#fbf1c7', fg: '#3c3836', comment: '#928374', keyword: '#9d0006', string: '#79740e',
      number: '#8f3f71', type: '#b57614', func: '#427b58', constant: '#8f3f71', operator: '#af3a03',
      attribute: '#076678', tag: '#076678',
      selection: '#ebdbb2', lineHighlight: '#f2e5bc', lineNumber: '#a89984', lineNumberActive: '#3c3836',
      cursor: '#3c3836',
      chromeBg: '#ebdbb2', chromeFg: '#3c3836', chromeMuted: '#7c6f64', tabActiveBg: '#fbf1c7',
      border: '#d5c4a1', accent: '#af3a03', hover: '#e2d1a8', diffInsert: '#79740e33', diffRemove: '#9d000633',
    },
    dark: {
      bg: '#282828', fg: '#ebdbb2', comment: '#928374', keyword: '#fb4934', string: '#b8bb26',
      number: '#d3869b', type: '#fabd2f', func: '#8ec07c', constant: '#d3869b', operator: '#fe8019',
      attribute: '#83a598', tag: '#83a598',
      selection: '#504945', lineHighlight: '#32302f', lineNumber: '#7c6f64', lineNumberActive: '#ebdbb2',
      cursor: '#ebdbb2',
      chromeBg: '#1d2021', chromeFg: '#ebdbb2', chromeMuted: '#a89984', tabActiveBg: '#282828',
      border: '#3c3836', accent: '#fe8019', hover: '#32302f', diffInsert: '#b8bb2633', diffRemove: '#fb493433',
    },
  },
  {
    id: 'vivid',
    label: 'Vivid',
    light: {
      bg: '#fdfdfb', fg: '#272822', comment: '#8a8a7a', keyword: '#d0175d', string: '#a08600',
      number: '#7a3fd1', type: '#1a8fa8', func: '#4a8f00', constant: '#7a3fd1', operator: '#d0175d',
      attribute: '#c76a00', tag: '#d0175d',
      selection: '#e6e6d8', lineHighlight: '#f3f3ec', lineNumber: '#a0a090', lineNumberActive: '#272822',
      cursor: '#272822',
      chromeBg: '#efefe8', chromeFg: '#272822', chromeMuted: '#75756a', tabActiveBg: '#fdfdfb',
      border: '#ddddd2', accent: '#d0175d', hover: '#e5e5dc', diffInsert: '#4a8f0033', diffRemove: '#d0175d33',
    },
    dark: {
      // Classic high-saturation dark palette
      bg: '#272822', fg: '#f8f8f2', comment: '#88846f', keyword: '#f92672', string: '#e6db74',
      number: '#ae81ff', type: '#66d9ef', func: '#a6e22e', constant: '#ae81ff', operator: '#f92672',
      attribute: '#fd971f', tag: '#f92672',
      selection: '#49483e', lineHighlight: '#3e3d32', lineNumber: '#90908a', lineNumberActive: '#f8f8f2',
      cursor: '#f8f8f0',
      chromeBg: '#1e1f1c', chromeFg: '#f8f8f2', chromeMuted: '#a59f85', tabActiveBg: '#272822',
      border: '#414339', accent: '#a6e22e', hover: '#3e3d32', diffInsert: '#a6e22e33', diffRemove: '#f9267233',
    },
  },
];

// ---------- vaporwave: "Syntax" and "Mode 13h" ----------

const VAPOR = {
  fg: '#f2f0ff', comment: '#8478c4', keyword: '#3ee6ff', string: '#ff6ad5', number: '#ffa057',
  type: '#a9b4ff', func: '#c792ff', constant: '#5cf2a0', operator: '#ff9de6', attribute: '#3ee6ff',
  tag: '#ff6ad5', moduleName: '#ffe45e',
  lineNumber: '#5d5a8c', lineNumberActive: '#ff6ad5', cursor: '#ff3fd8',
  chromeFg: '#e9e6f5', chromeMuted: '#9a93c4', accent: '#ff3fd8',
  diffInsert: '#3ee6ff2e', diffRemove: '#ff3fd833',
} satisfies Partial<Palette>;

/** HDL data-type keywords get the type color instead of the keyword color. */
const VAPOR_RULES: Monaco.editor.ITokenThemeRule[] = [
  ...['logic', 'int', 'integer', 'bit', 'byte', 'reg', 'wire', 'real', 'shortint', 'longint', 'shortreal', 'time', 'realtime', 'signed', 'unsigned', 'string', 'tri', 'uwire', 'genvar'].map(
    (k) => ({ token: `keyword.${k}`, foreground: VAPOR.type.slice(1) }),
  ),
  { token: 'type', foreground: VAPOR.type.slice(1) },
];

/**
 * Bracket-pair colors. HDL keyword pairs (module/endmodule, begin/end) are colored as
 * brackets too, so the outermost level matches the keyword color.
 */
const VAPOR_COLORS: Record<string, string> = {
  'editorBracketHighlight.foreground1': VAPOR.keyword,
  'editorBracketHighlight.foreground2': VAPOR.string,
  'editorBracketHighlight.foreground3': VAPOR.func,
  'editorBracketHighlight.foreground4': VAPOR.keyword,
  'editorBracketHighlight.foreground5': VAPOR.string,
  'editorBracketHighlight.foreground6': VAPOR.func,
  'editorBracketMatch.border': VAPOR.accent,
  'editorBracketMatch.background': '#ff3fd822',
};

const SYNTAX_DARK: Palette = {
  ...VAPOR,
  bg: '#0a0d24', selection: '#2b2f6e', lineHighlight: '#121638',
  chromeBg: '#070a1c', tabActiveBg: '#0a0d24', border: '#1f2550', hover: '#161b44',
};

const MODE13H_DARK: Palette = {
  ...VAPOR,
  bg: '#1a0b2e', selection: '#3d1f66', lineHighlight: '#24123f', lineNumber: '#6a5a9a',
  chromeBg: '#13082a', tabActiveBg: '#1a0b2e', border: '#4a2a7a', hover: '#2a1748',
};

SCHEMES_DATA.push(
  { id: 'syntax', label: 'Syntax', light: SYNTAX_DARK, dark: SYNTAX_DARK, darkOnly: true, extraRules: VAPOR_RULES, extraColors: VAPOR_COLORS },
  {
    id: 'mode13h',
    label: 'Mode 13h',
    light: MODE13H_DARK,
    dark: MODE13H_DARK,
    darkOnly: true,
    extraRules: VAPOR_RULES,
    extraColors: VAPOR_COLORS,
    effects: { crt: true, cursorStyle: 'block', fontFamily: "'VT323', 'Cascadia Code', Consolas, monospace", fontSizeDelta: 4 },
  },
);

export const SCHEMES: readonly Scheme[] = SCHEMES_DATA;

/** The mode a scheme actually renders in. */
export function schemeMode(scheme: Scheme, mode: Mode): Mode {
  return scheme.darkOnly ? 'dark' : mode;
}

export function getScheme(id: string): Scheme {
  return SCHEMES.find((s) => s.id === id) ?? SCHEMES[0];
}

export function monacoThemeName(schemeId: string, mode: Mode): string {
  return `syntax-${schemeId}-${mode}`;
}

const hex = (c: string) => c.replace('#', '');

export function toMonacoTheme(
  p: Palette,
  mode: Mode,
  extraRules: Monaco.editor.ITokenThemeRule[] = [],
  extraColors: Record<string, string> = {},
): Monaco.editor.IStandaloneThemeData {
  return {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: hex(p.fg) },
      { token: 'comment', foreground: hex(p.comment), fontStyle: 'italic' },
      { token: 'keyword', foreground: hex(p.keyword) },
      { token: 'keyword.flow', foreground: hex(p.keyword) },
      { token: 'string', foreground: hex(p.string) },
      { token: 'string.escape', foreground: hex(p.constant) },
      { token: 'string.include.identifier', foreground: hex(p.string) },
      { token: 'number', foreground: hex(p.number) },
      { token: 'number.hex', foreground: hex(p.number) },
      { token: 'number.float', foreground: hex(p.number) },
      { token: 'type', foreground: hex(p.type) },
      { token: 'type.identifier', foreground: hex(p.type) },
      { token: 'predefined', foreground: hex(p.func) },
      { token: 'variable.predefined', foreground: hex(p.func) },
      { token: 'constant', foreground: hex(p.constant) },
      { token: 'operator', foreground: hex(p.operator) },
      { token: 'delimiter', foreground: hex(p.fg) },
      { token: 'attribute', foreground: hex(p.attribute) },
      { token: 'attribute.name', foreground: hex(p.attribute) },
      { token: 'attribute.value', foreground: hex(p.string) },
      { token: 'tag', foreground: hex(p.tag) },
      { token: 'metatag', foreground: hex(p.tag) },
      { token: 'annotation', foreground: hex(p.func) },
      { token: 'regexp', foreground: hex(p.constant) },
      { token: 'identifier', foreground: hex(p.fg) },
      { token: 'variable', foreground: hex(p.fg) },
      { token: 'key', foreground: hex(p.attribute) },
      { token: 'string.key.json', foreground: hex(p.attribute) },
      { token: 'string.value.json', foreground: hex(p.string) },
      ...extraRules,
    ],
    colors: {
      'editor.background': p.bg,
      'editor.foreground': p.fg,
      'editor.selectionBackground': p.selection,
      'editor.lineHighlightBackground': p.lineHighlight,
      'editorLineNumber.foreground': p.lineNumber,
      'editorLineNumber.activeForeground': p.lineNumberActive,
      'editorCursor.foreground': p.cursor,
      'editorGutter.background': p.bg,
      'editorWidget.background': p.chromeBg,
      'editorWidget.border': p.border,
      'minimap.background': p.bg,
      'diffEditor.insertedTextBackground': p.diffInsert,
      'diffEditor.removedTextBackground': p.diffRemove,
      'diffEditor.insertedLineBackground': p.diffInsert,
      'diffEditor.removedLineBackground': p.diffRemove,
      focusBorder: p.accent,
      ...extraColors,
    },
  };
}

/** CSS custom properties for the app chrome. */
export function cssVars(p: Palette): Record<string, string> {
  return {
    '--bg': p.bg,
    '--fg': p.fg,
    '--chrome-bg': p.chromeBg,
    '--chrome-fg': p.chromeFg,
    '--muted': p.chromeMuted,
    '--tab-active-bg': p.tabActiveBg,
    '--border': p.border,
    '--accent': p.accent,
    '--hover': p.hover,
    '--selection': p.selection,
    ...(p.moduleName ? { '--module-name': p.moduleName } : {}),
  };
}
