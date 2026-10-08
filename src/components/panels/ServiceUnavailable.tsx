import { useTranslation } from 'react-i18next'

interface ServiceUnavailableProps {
  serviceName: string
  onNavigate?: () => void
}

// ponytail：统一复用的组件，消息通过 i18n 模板根据 serviceName 生成
export default function ServiceUnavailable({ serviceName, onNavigate }: ServiceUnavailableProps) {
  const { t } = useTranslation()
  return (
    <div className="alert alert-error">
      <div style={{ marginBottom: '12px', fontSize: '14px' }}>
        {t('common.serviceUnavailable', { name: serviceName })}
      </div>
      {onNavigate && (
        <button className="btn-primary" onClick={onNavigate}>
          {t('common.goToSoftwareRepo')}
        </button>
      )}
    </div>
  )
}
