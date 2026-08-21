import { useEffect, useRef } from 'react'

export type TerminalContextMenuItem =
  | { id: string; label: string; disabled?: boolean; onSelect: () => void | Promise<void> }
  | { id: string; separator: true }

interface TerminalContextMenuProps {
  x: number
  y: number
  items: TerminalContextMenuItem[]
  onClose: (restoreTerminalFocus?: boolean) => void
}

export default function TerminalContextMenu({ x, y, items, onClose }: TerminalContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [])

  return (
    <div
      ref={menuRef}
      className="terminal-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      onMouseDown={event => event.stopPropagation()}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
          return
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        if (!buttons.length) return
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : event.key === 'ArrowDown'
              ? (currentIndex + 1 + buttons.length) % buttons.length
              : (currentIndex - 1 + buttons.length) % buttons.length
        buttons[nextIndex]?.focus()
      }}
    >
      {items.map(item => 'separator' in item
        ? <div key={item.id} className="terminal-context-separator" role="separator" />
        : (
          <button
            key={item.id}
            role="menuitem"
            disabled={item.disabled}
            onMouseDown={event => event.preventDefault()}
            onClick={() => {
              onClose(false)
              void item.onSelect()
            }}
          >
            {item.label}
          </button>
        ))}
    </div>
  )
}
