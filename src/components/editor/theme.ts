import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// 颜色全部引用 CSS 变量（tokens.css），深浅色随 data-theme 自动切换
const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'var(--bg)',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
  },
  '.cm-content': { caretColor: 'var(--text)', padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-soft-strong)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--syn-active-line)' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-panel)',
    color: 'var(--text-faint)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)', color: 'var(--text)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--accent-soft-strong)',
    outline: '1px solid var(--accent)',
  },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--red-soft)' },
  '.cm-searchMatch': {
    backgroundColor: 'var(--yellow-soft)',
    outline: '1px solid var(--yellow)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-soft-strong)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)' },
  '.cm-panels': {
    backgroundColor: 'var(--bg-panel)',
    color: 'var(--text)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel input, .cm-panel button, .cm-panel select': { fontFamily: 'var(--font-sans)' },
  '.cm-textfield': {
    backgroundColor: 'var(--bg-input)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-xs)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--bg-subtle)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-xs)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-panel)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent-soft-strong)',
    color: 'var(--text)',
  },
})

const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--syn-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName), t.standard(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: 'var(--syn-definition)' },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: 'var(--syn-property)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syn-tag)' },
  { tag: [t.attributeValue], color: 'var(--syn-string)' },
  { tag: [t.meta, t.processingInstruction, t.annotation, t.special(t.variableName)], color: 'var(--syn-meta)' },
  { tag: [t.self, t.constant(t.variableName)], color: 'var(--syn-number)' },
  { tag: [t.escape], color: 'var(--syn-type)' },
  { tag: t.heading, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--syn-string)', textDecoration: 'underline' },
  { tag: t.inserted, color: 'var(--green)' },
  { tag: t.deleted, color: 'var(--red)' },
  { tag: t.changed, color: 'var(--yellow)' },
  { tag: t.invalid, color: 'var(--red)' },
])

export const ompEditorTheme = [editorTheme, syntaxHighlighting(highlightStyle)]
