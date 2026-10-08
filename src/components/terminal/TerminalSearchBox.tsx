import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface TerminalSearchBoxProps {
  query: string
  caseSensitive: boolean
  regex: boolean
  current: number
  total: number
  invalidRegex: boolean
  onQueryChange: (query: string) => void
  onToggleCaseSensitive: () => void
  onToggleRegex: () => void
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}

export default function TerminalSearchBox({ query, caseSensitive, regex, current, total, invalidRegex, onQueryChange, onToggleCaseSensitive, onToggleRegex, onPrevious, onNext, onClose }: TerminalSearchBoxProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <div className="terminal-search-box" role="search" onMouseDown={event => event.stopPropagation()}>
      <input
        ref={inputRef}
        value={query}
        onChange={event => onQueryChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (event.shiftKey) onPrevious()
            else onNext()
          }
        }}
        className={invalidRegex ? 'invalid' : ''}
        placeholder={t('terminal.search.placeholder')}
        aria-label={t('terminal.search.placeholder')}
        spellCheck={false}
      />
      <span className={`terminal-search-count ${invalidRegex ? 'invalid' : ''}`}>
        {invalidRegex
          ? t('terminal.search.invalidRegex')
          : total > 0
            ? t('terminal.search.matchCount', { current, total })
            : query
              ? t('terminal.search.noResults')
              : ''}
      </span>
      <button className={caseSensitive ? 'active' : ''} onClick={onToggleCaseSensitive} title={t('terminal.search.caseSensitive')} aria-label={t('terminal.search.caseSensitive')}>Aa</button>
      <button className={regex ? 'active' : ''} onClick={onToggleRegex} title={t('terminal.search.regex')} aria-label={t('terminal.search.regex')}>.*</button>
      <button onClick={onPrevious} title={t('terminal.search.previous')} aria-label={t('terminal.search.previous')}>↑</button>
      <button onClick={onNext} title={t('terminal.search.next')} aria-label={t('terminal.search.next')}>↓</button>
      <button onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>×</button>
    </div>
  )
}
