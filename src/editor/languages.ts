// Language catalogue: maps file names/extensions to Monaco language ids.
// Kept free of Monaco imports so it can be unit tested in Node.

export interface LanguageInfo {
  id: string; // Monaco language id
  label: string; // Shown in menus / status bar
  extensions: string[]; // lower-case, including the dot
  filenames?: string[]; // exact (lower-case) file names, e.g. "makefile"
}

export const LANGUAGES: LanguageInfo[] = [
  { id: 'plaintext', label: 'Plain Text', extensions: ['.txt', '.text', '.log'] },
  // Hardware description / EDA
  { id: 'verilog', label: 'Verilog', extensions: ['.v', '.vh', '.vlg', '.verilog', '.vg', '.vo'] },
  { id: 'systemverilog', label: 'SystemVerilog', extensions: ['.sv', '.svh', '.svi', '.svp', '.sva'] },
  { id: 'vhdl', label: 'VHDL', extensions: ['.vhd', '.vhdl', '.vho', '.vht'] },
  { id: 'tcl', label: 'Tcl / XDC / SDC', extensions: ['.tcl', '.tk', '.xdc', '.sdc', '.do', '.upf'] },
  // Systems
  { id: 'c', label: 'C', extensions: ['.c', '.h'] },
  { id: 'cpp', label: 'C++', extensions: ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.h++', '.ino', '.ipp', '.tpp'] },
  { id: 'csharp', label: 'C#', extensions: ['.cs', '.csx'] },
  { id: 'java', label: 'Java', extensions: ['.java'] },
  { id: 'kotlin', label: 'Kotlin', extensions: ['.kt', '.kts'] },
  { id: 'scala', label: 'Scala', extensions: ['.scala', '.sc', '.sbt'] },
  { id: 'go', label: 'Go', extensions: ['.go'] },
  { id: 'rust', label: 'Rust', extensions: ['.rs'] },
  { id: 'swift', label: 'Swift', extensions: ['.swift'] },
  { id: 'objective-c', label: 'Objective-C', extensions: ['.m', '.mm'] },
  { id: 'dart', label: 'Dart', extensions: ['.dart'] },
  { id: 'fsharp', label: 'F#', extensions: ['.fs', '.fsi', '.fsx'] },
  { id: 'vb', label: 'Visual Basic', extensions: ['.vb', '.bas', '.vbs'] },
  { id: 'pascal', label: 'Pascal', extensions: ['.pas', '.pp', '.dpr'] },
  { id: 'mips', label: 'MIPS Assembly', extensions: ['.s', '.asm', '.mips'] },
  // Scripting
  { id: 'python', label: 'Python', extensions: ['.py', '.pyw', '.pyi', '.gyp'] },
  { id: 'javascript', label: 'JavaScript', extensions: ['.js', '.mjs', '.cjs', '.jsx'] },
  { id: 'typescript', label: 'TypeScript', extensions: ['.ts', '.mts', '.cts', '.tsx'] },
  { id: 'php', label: 'PHP', extensions: ['.php', '.phtml', '.php4', '.php5'] },
  { id: 'ruby', label: 'Ruby', extensions: ['.rb', '.rbw', '.gemspec', '.rake'], filenames: ['gemfile', 'rakefile'] },
  { id: 'perl', label: 'Perl', extensions: ['.pl', '.pm', '.t'] },
  { id: 'lua', label: 'Lua', extensions: ['.lua'] },
  { id: 'r', label: 'R', extensions: ['.r', '.rhistory', '.rprofile'] },
  { id: 'julia', label: 'Julia', extensions: ['.jl'] },
  { id: 'elixir', label: 'Elixir', extensions: ['.ex', '.exs'] },
  { id: 'clojure', label: 'Clojure', extensions: ['.clj', '.cljs', '.cljc', '.edn'] },
  { id: 'shell', label: 'Shell / Bash', extensions: ['.sh', '.bash', '.zsh', '.ksh', '.csh', '.mk', '.mak'], filenames: ['makefile', 'gnumakefile', '.bashrc', '.zshrc', '.profile'] },
  { id: 'powershell', label: 'PowerShell', extensions: ['.ps1', '.psm1', '.psd1'] },
  { id: 'bat', label: 'Batch', extensions: ['.bat', '.cmd'] },
  // Web
  { id: 'html', label: 'HTML', extensions: ['.html', '.htm', '.xhtml', '.shtml'] },
  { id: 'css', label: 'CSS', extensions: ['.css'] },
  { id: 'scss', label: 'SCSS', extensions: ['.scss'] },
  { id: 'less', label: 'Less', extensions: ['.less'] },
  { id: 'graphql', label: 'GraphQL', extensions: ['.graphql', '.gql'] },
  // Data / config
  { id: 'json', label: 'JSON', extensions: ['.json', '.jsonc', '.json5', '.code-workspace'], filenames: ['.babelrc', '.eslintrc', 'tsconfig.json'] },
  { id: 'xml', label: 'XML', extensions: ['.xml', '.xsd', '.xsl', '.xslt', '.svg', '.csproj', '.vcxproj', '.props', '.targets', '.plist', '.xaml', '.qsys', '.ip'] },
  { id: 'yaml', label: 'YAML', extensions: ['.yaml', '.yml'] },
  { id: 'ini', label: 'INI / TOML / Properties', extensions: ['.ini', '.cfg', '.conf', '.properties', '.toml', '.editorconfig', '.gitconfig'], filenames: ['.gitattributes', '.gitignore', '.npmrc'] },
  { id: 'markdown', label: 'Markdown', extensions: ['.md', '.markdown', '.mdown', '.mkd'] },
  { id: 'restructuredtext', label: 'reStructuredText', extensions: ['.rst'] },
  { id: 'sql', label: 'SQL', extensions: ['.sql'] },
  { id: 'mysql', label: 'MySQL', extensions: [] },
  { id: 'pgsql', label: 'PostgreSQL', extensions: ['.pgsql'] },
  { id: 'dockerfile', label: 'Dockerfile', extensions: ['.dockerfile'], filenames: ['dockerfile', 'containerfile'] },
  { id: 'hcl', label: 'HCL / Terraform', extensions: ['.tf', '.tfvars', '.hcl'] },
  { id: 'proto', label: 'Protocol Buffers', extensions: ['.proto'] },
];

const byExt = new Map<string, LanguageInfo>();
const byFilename = new Map<string, LanguageInfo>();
const byId = new Map<string, LanguageInfo>();
for (const lang of LANGUAGES) {
  byId.set(lang.id, lang);
  for (const ext of lang.extensions) if (!byExt.has(ext)) byExt.set(ext, lang);
  for (const fn of lang.filenames ?? []) byFilename.set(fn, lang);
}

/** Pick a Monaco language id for a file name. Falls back to plaintext. */
export function detectLanguage(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop()!.toLowerCase();
  const exact = byFilename.get(base);
  if (exact) return exact.id;
  if (base.startsWith('dockerfile')) return 'dockerfile';
  if (base.startsWith('makefile')) return 'shell';
  const dot = base.lastIndexOf('.');
  if (dot >= 0) {
    const lang = byExt.get(base.slice(dot));
    if (lang) return lang.id;
  }
  return 'plaintext';
}

export function languageLabel(id: string): string {
  return byId.get(id)?.label ?? id;
}

/** Languages sorted for display, plaintext first. */
export function sortedLanguages(): LanguageInfo[] {
  const [plain, ...rest] = LANGUAGES;
  return [plain, ...rest.slice().sort((a, b) => a.label.localeCompare(b.label))];
}
