// 编辑器语言识别：纯函数，不依赖 CodeMirror，便于单测

export type LanguageId =
  | 'plain'
  | 'c'
  | 'cpp'
  | 'java'
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'json'
  | 'python'
  | 'php'
  | 'sql'
  | 'xml'
  | 'yaml'
  | 'markdown'
  | 'rust'
  | 'go'
  | 'shell'
  | 'nginx'
  | 'ini'
  | 'toml'
  | 'dockerfile'
  | 'diff'
  | 'powershell'

// 下拉框展示顺序；'plain' 的名称走 i18n
export const LANGUAGES: { id: LanguageId; label: string }[] = [
  { id: 'plain', label: 'Plain Text' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'java', label: 'Java' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'json', label: 'JSON' },
  { id: 'python', label: 'Python' },
  { id: 'php', label: 'PHP' },
  { id: 'sql', label: 'SQL' },
  { id: 'xml', label: 'XML' },
  { id: 'yaml', label: 'YAML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'rust', label: 'Rust' },
  { id: 'go', label: 'Go' },
  { id: 'shell', label: 'Shell' },
  { id: 'nginx', label: 'Nginx' },
  { id: 'ini', label: 'INI / Conf' },
  { id: 'toml', label: 'TOML' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'diff', label: 'Diff' },
  { id: 'powershell', label: 'PowerShell' },
]

const EXTENSIONS: Record<string, LanguageId> = {
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', 'c++': 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', ino: 'cpp',
  java: 'java',
  html: 'html', htm: 'html', xhtml: 'html', shtml: 'html', vue: 'html',
  css: 'css', scss: 'css', less: 'css',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json', map: 'json',
  py: 'python', pyw: 'python',
  php: 'php', phtml: 'php',
  sql: 'sql',
  xml: 'xml', svg: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', plist: 'xml',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown',
  rs: 'rust',
  go: 'go',
  sh: 'shell', bash: 'shell', zsh: 'shell', ksh: 'shell',
  ini: 'ini', cfg: 'ini', cnf: 'ini', conf: 'ini', properties: 'ini', env: 'ini',
  service: 'ini', socket: 'ini', timer: 'ini', desktop: 'ini',
  toml: 'toml',
  dockerfile: 'dockerfile',
  diff: 'diff', patch: 'diff',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
}

const FILENAMES: Record<string, LanguageId> = {
  'dockerfile': 'dockerfile',
  'containerfile': 'dockerfile',
  'nginx.conf': 'nginx',
  '.bashrc': 'shell',
  '.bash_profile': 'shell',
  '.bash_logout': 'shell',
  '.profile': 'shell',
  '.zshrc': 'shell',
  '.zprofile': 'shell',
  '.env': 'ini',
  '.gitconfig': 'ini',
  '.editorconfig': 'ini',
  'cargo.lock': 'toml',
}

function fromShebang(content: string): LanguageId | null {
  if (!content.startsWith('#!')) return null
  const firstLine = content.split('\n', 1)[0]
  if (/\b(ba|z|k|da)?sh\b/.test(firstLine)) return 'shell'
  if (/\bpython[\d.]*\b/.test(firstLine)) return 'python'
  if (/\b(node|deno|bun)\b/.test(firstLine)) return 'javascript'
  if (/\bphp\b/.test(firstLine)) return 'php'
  return null
}

/** 根据路径（及可选的文件内容）推断语言 */
export function detectLanguage(path: string, content = ''): LanguageId {
  const name = (path.split('/').pop() ?? '').toLowerCase()
  const lowerPath = path.toLowerCase()

  const byName = FILENAMES[name]
  if (byName) return byName
  if (name.startsWith('dockerfile.') || name.startsWith('containerfile.')) return 'dockerfile'
  if (name.startsWith('.env.')) return 'ini'

  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1) : ''

  // nginx 配置：位于 nginx 相关目录下的 .conf / 无扩展名 vhost 文件
  if (/\/(nginx|sites-available|sites-enabled)\//.test(lowerPath) && (ext === 'conf' || ext === '')) {
    return 'nginx'
  }

  const byExt = ext ? EXTENSIONS[ext] : undefined
  if (byExt) return byExt

  return fromShebang(content) ?? 'plain'
}
