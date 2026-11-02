import type * as Monaco from 'monaco-editor';

// Monaco has no built-in VHDL grammar, so this is a Monarch tokenizer for it.
// VHDL is case-insensitive.

export const vhdlConfiguration: Monaco.languages.LanguageConfiguration = {
  comments: { lineComment: '--', blockComment: ['/*', '*/'] },
  brackets: [['(', ')'], ['[', ']']],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
  indentationRules: {
    increaseIndentPattern:
      /^\s*(begin|then|else|elsif|loop|is|generate|record|process|block|entity|architecture|component|package|function|procedure|configuration|units|protected|when\b.*=>)\b.*$/i,
    decreaseIndentPattern: /^\s*(end|else|elsif|begin|when)\b/i,
  },
};

export const vhdlLanguage: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  ignoreCase: true,
  tokenPostfix: '.vhdl',

  keywords: [
    'abs', 'access', 'after', 'alias', 'all', 'and', 'architecture', 'array', 'assert', 'assume',
    'attribute', 'begin', 'block', 'body', 'buffer', 'bus', 'case', 'component', 'configuration',
    'constant', 'context', 'cover', 'default', 'disconnect', 'downto', 'else', 'elsif', 'end', 'entity',
    'exit', 'fairness', 'file', 'for', 'force', 'function', 'generate', 'generic', 'group', 'guarded',
    'if', 'impure', 'in', 'inertial', 'inout', 'is', 'label', 'library', 'linkage', 'literal', 'loop',
    'map', 'mod', 'nand', 'new', 'next', 'nor', 'not', 'null', 'of', 'on', 'open', 'or', 'others',
    'out', 'package', 'parameter', 'port', 'postponed', 'procedure', 'process', 'property', 'protected',
    'pure', 'range', 'record', 'register', 'reject', 'release', 'rem', 'report', 'restrict', 'return',
    'rol', 'ror', 'select', 'sequence', 'severity', 'shared', 'signal', 'sla', 'sll', 'sra', 'srl',
    'strong', 'subtype', 'then', 'to', 'transport', 'type', 'unaffected', 'units', 'until', 'use',
    'variable', 'view', 'vmode', 'vprop', 'vunit', 'wait', 'when', 'while', 'with', 'xnor', 'xor',
  ],

  typeKeywords: [
    'bit', 'bit_vector', 'boolean', 'boolean_vector', 'character', 'integer', 'integer_vector',
    'natural', 'positive', 'real', 'real_vector', 'string', 'time', 'time_vector', 'delay_length',
    'severity_level', 'file_open_kind', 'file_open_status', 'std_logic', 'std_logic_vector',
    'std_ulogic', 'std_ulogic_vector', 'signed', 'unsigned', 'line', 'text', 'side', 'width',
    'sfixed', 'ufixed', 'float', 'float32', 'float64', 'float128',
  ],

  constants: ['true', 'false', 'note', 'warning', 'error', 'failure', 'nul'],

  builtins: [
    'rising_edge', 'falling_edge', 'to_integer', 'to_unsigned', 'to_signed', 'to_stdlogicvector',
    'to_stdulogicvector', 'to_bitvector', 'to_01', 'to_x01', 'to_x01z', 'to_ux01', 'resize',
    'shift_left', 'shift_right', 'rotate_left', 'rotate_right', 'conv_integer', 'conv_std_logic_vector',
    'std_match', 'is_x', 'now', 'readline', 'writeline', 'read', 'write', 'hread', 'hwrite', 'oread',
    'owrite', 'endfile', 'file_open', 'file_close', 'deallocate', 'minimum', 'maximum', 'to_string',
    'to_hstring', 'to_ostring', 'ieee', 'std', 'work', 'std_logic_1164', 'numeric_std', 'numeric_bit',
    'textio', 'std_logic_textio', 'math_real', 'fixed_pkg', 'float_pkg', 'env', 'stop', 'finish',
  ],

  operators: [
    '<=', '>=', '=>', ':=', '/=', '**', '?=', '?/=', '?<', '?<=', '?>', '?>=', '??',
    '=', '<', '>', '+', '-', '*', '/', '&', '|', '<>',
  ],

  symbols: /[=><!~?:&|+\-*/^%]+/,

  tokenizer: {
    root: [
      // character literal 'x' (before attributes so '1' isn't read as an attribute)
      [/'.'/, 'string'],
      // attributes: clk'event, x'range, etc.
      [/'[a-zA-Z_]\w*/, 'attribute'],

      // identifiers and keywords
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@constants': 'constant',
            '@builtins': 'predefined',
            '@default': 'identifier',
          },
        },
      ],
      // extended identifiers \foo bar\
      [/\\[^\\]*\\/, 'identifier'],

      { include: '@whitespace' },

      [/[()[\]]/, '@brackets'],
      [/[;,.]/, 'delimiter'],
      [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],

      // bit-string literals: X"FF", B"1010", 8UX"0F", O"77", D"10"
      [/\d*[us]?[bBoOxXdD]"[0-9a-fA-F_xXzZuUwWlLhH-]*"/, 'number.hex'],
      // based literals 16#FF#, 2#1010#E3
      [/\d+#[0-9a-fA-F_.]+#([eE][+-]?\d+)?/, 'number.hex'],
      // decimal / real
      [/\d[\d_]*\.\d[\d_]*([eE][+-]?\d+)?/, 'number.float'],
      [/\d[\d_]*([eE][+-]?\d+)?/, 'number'],

      // strings
      [/"/, { token: 'string.quote', next: '@string' }],
    ],

    whitespace: [
      [/[ \t\r\n]+/, ''],
      [/\/\*/, 'comment', '@comment'],
      [/--.*$/, 'comment'],
    ],

    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],

    string: [
      [/[^"]+/, 'string'],
      [/""/, 'string.escape'],
      [/"/, { token: 'string.quote', next: '@pop' }],
    ],
  },
};
