import { StreamLanguage, type StreamParser } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import type { LanguageId } from './languages'

// 语言包按需动态加载，只有打开对应文件时才会下载
const legacy = (parser: StreamParser<unknown>): Extension => StreamLanguage.define(parser)

export async function loadLanguage(id: LanguageId): Promise<Extension> {
  switch (id) {
    case 'c':
    case 'cpp':
      return (await import('@codemirror/lang-cpp')).cpp()
    case 'java':
      return (await import('@codemirror/lang-java')).java()
    case 'html':
      return (await import('@codemirror/lang-html')).html()
    case 'css':
      return (await import('@codemirror/lang-css')).css()
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true })
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true })
    case 'json':
      return (await import('@codemirror/lang-json')).json()
    case 'python':
      return (await import('@codemirror/lang-python')).python()
    case 'php':
      return (await import('@codemirror/lang-php')).php()
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql()
    case 'xml':
      return (await import('@codemirror/lang-xml')).xml()
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml()
    case 'markdown':
      return (await import('@codemirror/lang-markdown')).markdown()
    case 'rust':
      return (await import('@codemirror/lang-rust')).rust()
    case 'go':
      return (await import('@codemirror/lang-go')).go()
    case 'shell':
      return legacy((await import('@codemirror/legacy-modes/mode/shell')).shell)
    case 'nginx':
      return legacy((await import('@codemirror/legacy-modes/mode/nginx')).nginx)
    case 'ini':
      return legacy((await import('@codemirror/legacy-modes/mode/properties')).properties)
    case 'toml':
      return legacy((await import('@codemirror/legacy-modes/mode/toml')).toml)
    case 'dockerfile':
      return legacy((await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile)
    case 'diff':
      return legacy((await import('@codemirror/legacy-modes/mode/diff')).diff)
    case 'powershell':
      return legacy((await import('@codemirror/legacy-modes/mode/powershell')).powerShell)
    case 'plain':
      return []
  }
}
