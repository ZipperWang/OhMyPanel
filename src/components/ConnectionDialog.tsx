import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import Icon from './icons'

export interface ConnectionDraft {
  id?: string
  name: string
  host: string
  port: number
  username: string
  auth_type: string
  key_path?: string
  password?: string
  remember_me?: boolean
}

interface ConnectionDialogProps {
  mode: 'create' | 'edit'
  initial: ConnectionDraft
  onCancel: () => void
  onSave: (draft: ConnectionDraft) => void | Promise<void>
  onSaveAndConnect?: (draft: ConnectionDraft) => void | Promise<void>
  onDelete?: () => void
}

const authUsesPassword = (authType: string) => authType === 'password' || authType === 'managed_key_password'
const authUsesKey = (authType: string) => authType === 'key' || authType === 'managed_key' || authType === 'managed_key_password'

// 清理主机、用户名和端口两端的空白；仅在勾选 remember_me 时保存凭据
export function normalizeDraft(draft: ConnectionDraft): ConnectionDraft {
  return {
    ...draft,
    host: draft.host.trim(),
    username: draft.username.trim(),
    port: Number(String(draft.port).trim()) || draft.port,
    remember_me: draft.remember_me || false,
    password: draft.remember_me ? draft.password : undefined,
    key_path: draft.remember_me ? draft.key_path : undefined,
  }
}

export default function ConnectionDialog({ mode, initial, onCancel, onSave, onSaveAndConnect, onDelete }: ConnectionDialogProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ConnectionDraft>(initial)
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const managed = draft.auth_type.startsWith('managed_')
  const canSubmit = draft.host.trim() !== '' && draft.username.trim() !== '' && !busy

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const update = (patch: Partial<ConnectionDraft>) => setDraft(current => ({ ...current, ...patch }))

  const pickKeyFile = async () => {
    const path = await open()
    if (path) update({ key_path: String(path) })
  }

  const run = async (action?: (value: ConnectionDraft) => void | Promise<void>) => {
    if (!action || !canSubmit) return
    setBusy(true)
    try {
      await action(normalizeDraft(draft))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ui-overlay">
      <form
        className="ui-dialog conn-dialog"
        onClick={event => event.stopPropagation()}
        onSubmit={event => { event.preventDefault(); void run(mode === 'create' ? onSave : (onSaveAndConnect ?? onSave)) }}
      >
        <div className="ui-dialog-header">
          <div className="ui-dialog-title">
            <span className="ui-dialog-icon"><Icon name="server" size={18} /></span>
            {mode === 'create' ? t('sidebar.newConnection') : t('sidebar.editConnection')}
          </div>
          <button type="button" className="ui-icon-btn" onClick={onCancel} aria-label={t('common.close')}>
            <Icon name="x" />
          </button>
        </div>

        <div className="ui-dialog-body conn-form">
          <label className="ui-field">
            <span className="ui-label">{t('sidebar.name')}</span>
            <input className="ui-input" value={draft.name} autoFocus onChange={e => update({ name: e.target.value })} placeholder={t('sidebar.serverName')} />
          </label>
          <div className="conn-form-row">
            <label className="ui-field grow">
              <span className="ui-label">{t('sidebar.host')}</span>
              <input className="ui-input" value={draft.host} onChange={e => update({ host: e.target.value })} placeholder="192.168.1.1" spellCheck={false} />
            </label>
            <label className="ui-field port">
              <span className="ui-label">{t('sidebar.port')}</span>
              <input
                className="ui-input"
                type="number"
                value={draft.port || ''}
                onChange={e => update({ port: e.target.value === '' ? 0 : Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="conn-form-row">
            <label className="ui-field grow">
              <span className="ui-label">{t('sidebar.username')}</span>
              <input className="ui-input" value={draft.username} onChange={e => update({ username: e.target.value })} placeholder="root" spellCheck={false} />
            </label>
            <label className="ui-field grow">
              <span className="ui-label">{t('sidebar.authType')}</span>
              <select
                className="ui-input"
                value={draft.auth_type}
                onChange={e => update({
                  auth_type: e.target.value,
                  key_path: authUsesKey(e.target.value) ? draft.key_path : undefined,
                  password: authUsesPassword(e.target.value) ? draft.password : undefined,
                })}
              >
                <option value="password">{t('sidebar.password')}</option>
                <option value="key">Key File</option>
                {draft.auth_type === 'managed_key' && <option value="managed_key">Managed Key</option>}
                {draft.auth_type === 'managed_key_password' && <option value="managed_key_password">Managed Key + Password</option>}
              </select>
            </label>
          </div>
          {authUsesPassword(draft.auth_type) && (
            <label className="ui-field">
              <span className="ui-label">{t('sidebar.password')}</span>
              <div className="ui-input-group">
                <input
                  className="ui-input"
                  type={showPassword ? 'text' : 'password'}
                  value={draft.password || ''}
                  onChange={e => update({ password: e.target.value })}
                  placeholder={t('sidebar.enterPassword')}
                />
                <button
                  type="button"
                  className="ui-input-addon"
                  onClick={() => setShowPassword(value => !value)}
                  title={showPassword ? t('sidebar.hidePassword') : t('sidebar.showPassword')}
                  aria-label={showPassword ? t('sidebar.hidePassword') : t('sidebar.showPassword')}
                >
                  <Icon name={showPassword ? 'eyeOff' : 'eye'} />
                </button>
              </div>
            </label>
          )}
          {authUsesKey(draft.auth_type) && (
            <label className="ui-field">
              <span className="ui-label">{t('sidebar.keyPath')}</span>
              <div className="ui-input-group">
                <input
                  className="ui-input"
                  value={draft.key_path || ''}
                  onChange={e => update({ key_path: e.target.value })}
                  placeholder="~/.ssh/id_rsa"
                  readOnly={managed}
                  spellCheck={false}
                />
                <button type="button" className="ui-input-addon" onClick={pickKeyFile} disabled={managed} title={t('sidebar.browseKeyFile')} aria-label={t('sidebar.browseKeyFile')}>
                  <Icon name="folder" />
                </button>
              </div>
            </label>
          )}
          <label className="ui-check">
            <input type="checkbox" checked={draft.remember_me || false} onChange={e => update({ remember_me: e.target.checked })} />
            <span>{t('sidebar.rememberMe')}</span>
          </label>
        </div>

        <div className="ui-dialog-footer">
          {mode === 'edit' && onDelete && (
            <button type="button" className="ui-btn ghost danger" onClick={onDelete}>
              <Icon name="trash" />
              {t('common.delete')}
            </button>
          )}
          <span className="ui-spacer" />
          {mode === 'create' ? (
            <>
              <button type="button" className="ui-btn" onClick={onCancel}>{t('common.cancel')}</button>
              <button type="submit" className="ui-btn primary" disabled={!canSubmit}>{t('common.create')}</button>
            </>
          ) : (
            <>
              <button type="button" className="ui-btn" disabled={!canSubmit} onClick={() => void run(onSave)}>{t('common.save')}</button>
              <button type="submit" className="ui-btn primary" disabled={!canSubmit}>{t('common.connect')}</button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
