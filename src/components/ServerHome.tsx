import { useTranslation } from 'react-i18next'
import Icon from './icons'
import { ServerAvatar, type Connection } from './Sidebar'

interface ServerHomeProps {
  connections: Connection[]
  connectingIds: string[]
  onConnect: (conn: Connection) => void
  onEdit: (conn: Connection) => void
  onNew: () => void
}

// ponytail：未打开任何会话时的首页，以卡片形式列出所有已保存的服务器
export default function ServerHome({ connections, connectingIds, onConnect, onEdit, onNew }: ServerHomeProps) {
  const { t } = useTranslation()

  return (
    <div className="home">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('home.title')}</h1>
          <p className="page-subtitle">{t('home.subtitle')}</p>
        </div>
        <button className="ui-btn primary" onClick={onNew}>
          <Icon name="plus" />
          {t('sidebar.newConnection')}
        </button>
      </div>

      {connections.length === 0 ? (
        <div className="home-empty">
          <div className="home-empty-icon"><Icon name="server" size={28} /></div>
          <h3>{t('home.emptyTitle')}</h3>
          <p>{t('home.emptyHint')}</p>
          <button className="ui-btn primary" onClick={onNew}>
            <Icon name="plus" />
            {t('sidebar.newConnection')}
          </button>
        </div>
      ) : (
        <div className="home-grid">
          {connections.map(conn => {
            const connecting = connectingIds.includes(conn.id)
            return (
              <div key={conn.id} className="home-card" onDoubleClick={() => !connecting && onConnect(conn)}>
                <div className="home-card-top">
                  <ServerAvatar name={conn.name || conn.host} size="lg" />
                  <div className="home-card-text">
                    <div className="home-card-name">{conn.name || conn.host}</div>
                    <div className="home-card-sub" dir="ltr">{conn.username}@{conn.host}:{conn.port}</div>
                  </div>
                  <button className="ui-icon-btn" onClick={() => onEdit(conn)} title={t('common.edit')} aria-label={t('common.edit')}>
                    <Icon name="pencil" size={15} />
                  </button>
                </div>
                <div className="home-card-bottom">
                  <span className="ui-badge">
                    <Icon name={conn.auth_type === 'password' ? 'lock' : 'key'} size={12} />
                    {conn.auth_type === 'password' ? t('sidebar.password') : 'SSH Key'}
                  </span>
                  <button className="ui-btn primary sm" onClick={() => onConnect(conn)} disabled={connecting}>
                    {connecting ? t('common.connecting') : t('common.connect')}
                  </button>
                </div>
              </div>
            )
          })}
          <button className="home-card add" onClick={onNew}>
            <Icon name="plus" size={20} />
            <span>{t('sidebar.newConnection')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
