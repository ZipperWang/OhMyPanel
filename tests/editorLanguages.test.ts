import { describe, it, expect } from 'vitest'
import { detectLanguage, LANGUAGES } from '../src/components/editor/languages'

describe('detectLanguage', () => {
  it('detects common languages by extension', () => {
    expect(detectLanguage('/root/main.c')).toBe('c')
    expect(detectLanguage('/root/util.h')).toBe('c')
    expect(detectLanguage('/root/app.cpp')).toBe('cpp')
    expect(detectLanguage('/root/app.HPP')).toBe('cpp')
    expect(detectLanguage('/src/Main.java')).toBe('java')
    expect(detectLanguage('/www/index.html')).toBe('html')
    expect(detectLanguage('/www/index.htm')).toBe('html')
    expect(detectLanguage('/www/app.tsx')).toBe('typescript')
    expect(detectLanguage('/www/index.php')).toBe('php')
    expect(detectLanguage('/etc/compose.yml')).toBe('yaml')
  })

  it('detects special file names', () => {
    expect(detectLanguage('/app/Dockerfile')).toBe('dockerfile')
    expect(detectLanguage('/app/Dockerfile.prod')).toBe('dockerfile')
    expect(detectLanguage('/root/.bashrc')).toBe('shell')
    expect(detectLanguage('/app/.env.production')).toBe('ini')
    expect(detectLanguage('/etc/nginx/nginx.conf')).toBe('nginx')
  })

  it('treats conf files under nginx directories as nginx', () => {
    expect(detectLanguage('/etc/nginx/conf.d/site.conf')).toBe('nginx')
    expect(detectLanguage('/etc/nginx/sites-available/default')).toBe('nginx')
    expect(detectLanguage('/usr/local/nginx/conf/vhost/a.com.conf')).toBe('nginx')
    expect(detectLanguage('/etc/mysql/my.cnf')).toBe('ini')
    expect(detectLanguage('/etc/sysctl.conf')).toBe('ini')
  })

  it('falls back to shebang, then plain text', () => {
    expect(detectLanguage('/usr/local/bin/deploy', '#!/usr/bin/env bash\necho hi')).toBe('shell')
    expect(detectLanguage('/usr/local/bin/run', '#!/usr/bin/python3\nprint(1)')).toBe('python')
    expect(detectLanguage('/usr/local/bin/tool', '#!/usr/bin/env node\n')).toBe('javascript')
    expect(detectLanguage('/root/README', 'hello')).toBe('plain')
    expect(detectLanguage('/root/data.bin')).toBe('plain')
  })

  it('only returns ids listed in the language picker', () => {
    const ids = new Set(LANGUAGES.map(l => l.id))
    for (const p of ['/a.c', '/a.rs', '/a.go', '/a.sql', '/a.toml', '/a.patch', '/a.ps1', '/a.md', '/a.xml', '/a.json', '/a.css', '/a.py']) {
      expect(ids.has(detectLanguage(p))).toBe(true)
    }
  })
})
