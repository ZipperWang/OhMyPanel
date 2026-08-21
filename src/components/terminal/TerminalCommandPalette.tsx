import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { filterTerminalActions, type TerminalAction } from './terminalActions'

interface TerminalCommandPaletteProps {
  actions: TerminalAction[]
  onClose: (restoreTerminalFocus?: boolean) => void
}

export default function TerminalCommandPalette({ actions, onClose }: TerminalCommandPaletteProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const filtered = useMemo(() => filterTerminalActions(actions, query), [actions, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const firstEnabled = filtered.findIndex(action => !action.disabled)
    setSelectedIndex(firstEnabled < 0 ? 0 : firstEnabled)
  }, [filtered])

  const moveSelection = (current: number, direction: 1 | -1) => {
    if (!filtered.length) return 0
    let next = current
    for (let index = 0; index < filtered.length; index += 1) {
      next = (next + direction + filtered.length) % filtered.length
      if (!filtered[next]?.disabled) return next
    }
    return current
  }

  const run = (action: TerminalAction | undefined) => {
    if (!action || action.disabled) return
    onClose(action.restoreTerminalFocus !== false)
    void action.run()
  }

  return (
    <div className="terminal-palette-backdrop" onMouseDown={() => onClose()}>
      <div className="terminal-command-palette" role="dialog" aria-label={t('terminal.palette.title')} onMouseDown={event => event.stopPropagation()}>
        <div className="terminal-command-input-row">
          <span aria-hidden="true">›</span>
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelectedIndex(index => moveSelection(index, 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelectedIndex(index => moveSelection(index, -1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                run(filtered[selectedIndex])
              }
            }}
            placeholder={t('terminal.palette.placeholder')}
            aria-label={t('terminal.palette.placeholder')}
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="terminal-command-list" role="listbox">
          {filtered.length === 0 && <div className="terminal-command-empty">{t('terminal.palette.noResults')}</div>}
          {filtered.map((action, index) => (
            <button
              key={action.id}
              className={index === selectedIndex ? 'selected' : ''}
              disabled={action.disabled}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => run(action)}
              role="option"
              aria-selected={index === selectedIndex}
            >
              <span>{action.label}</span>
              {action.shortcut && <kbd>{action.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
