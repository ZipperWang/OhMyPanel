import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, type Text } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { ompEditorTheme } from './theme'
import { loadLanguage } from './languageLoader'
import type { LanguageId } from './languages'

export interface CodeEditorHandle {
  getContent(): string
  /** 保存成功后调用，把 content 设为新的“未修改”基准 */
  markSaved(content: string): void
  focus(): void
}

interface CodeEditorProps {
  initialContent: string
  language: LanguageId
  className?: string
  onDirtyChange?: (dirty: boolean) => void
  onSave?: () => void
}

// 文档内容只保存在 CodeMirror 内部，避免每次按键都重渲染外层组件
const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { initialContent, language, className, onDirtyChange, onSave },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const savedDocRef = useRef<Text | null>(null)
  const dirtyRef = useRef(false)
  const languageCompartment = useRef(new Compartment()).current

  // 回调放进 ref，CodeMirror 扩展只在创建时注册一次
  const onDirtyChangeRef = useRef(onDirtyChange)
  const onSaveRef = useRef(onSave)
  onDirtyChangeRef.current = onDirtyChange
  onSaveRef.current = onSave

  const syncDirty = (doc: Text) => {
    const dirty = !savedDocRef.current || !doc.eq(savedDocRef.current)
    if (dirty !== dirtyRef.current) {
      dirtyRef.current = dirty
      onDirtyChangeRef.current?.(dirty)
    }
  }

  useEffect(() => {
    if (!hostRef.current) return
    // 保留原文件换行符，避免 CRLF 文件保存后被改成 LF
    const lineSeparator = initialContent.includes('\r\n') ? '\r\n' : '\n'
    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        basicSetup,
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => { onSaveRef.current?.(); return true } },
          indentWithTab,
        ]),
        EditorState.lineSeparator.of(lineSeparator),
        EditorState.tabSize.of(4),
        languageCompartment.of([]),
        ompEditorTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) syncDirty(update.state.doc)
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    savedDocRef.current = state.doc
    dirtyRef.current = false
    view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 初始内容只在挂载时使用；切换文件时由父组件通过 key 重新挂载
  }, [])

  useEffect(() => {
    let cancelled = false
    loadLanguage(language)
      .then((ext) => {
        if (!cancelled) viewRef.current?.dispatch({ effects: languageCompartment.reconfigure(ext) })
      })
      .catch((e) => console.error('load editor language error:', e))
    return () => { cancelled = true }
  }, [language, languageCompartment])

  useImperativeHandle(ref, () => ({
    getContent: () => viewRef.current?.state.doc.toString() ?? '',
    markSaved: (content: string) => {
      const view = viewRef.current
      if (!view) return
      savedDocRef.current = view.state.toText(content)
      syncDirty(view.state.doc)
    },
    focus: () => viewRef.current?.focus(),
  }), [])

  return <div ref={hostRef} className={className} />
})

export default CodeEditor
