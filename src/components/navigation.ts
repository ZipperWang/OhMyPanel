import type { IconName } from './icons'

export type PanelSection = 'dashboard' | 'terminal' | 'files' | 'software' | 'nginx' | 'php' | 'sites' | 'logs' | 'ssl' | 'monitor' | 'firewall' | 'port' | 'tunnel' | 'bbr' | 'docker' | 'database' | 'redis' | 'update' | 'settings'

export interface NavItem {
  key: PanelSection
  labelKey: string
  icon: IconName
}

export interface NavGroup {
  key: string
  labelKey: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'overview',
    labelKey: 'navGroup.overview',
    items: [
      { key: 'dashboard', labelKey: 'nav.dashboard', icon: 'dashboard' },
      { key: 'monitor', labelKey: 'nav.monitor', icon: 'activity' },
    ],
  },
  {
    key: 'workspace',
    labelKey: 'navGroup.workspace',
    items: [
      { key: 'terminal', labelKey: 'nav.terminal', icon: 'terminal' },
      { key: 'files', labelKey: 'nav.files', icon: 'folder' },
    ],
  },
  {
    key: 'apps',
    labelKey: 'navGroup.apps',
    items: [
      { key: 'software', labelKey: 'nav.software', icon: 'package' },
      { key: 'sites', labelKey: 'nav.sites', icon: 'globe' },
      { key: 'ssl', labelKey: 'nav.ssl', icon: 'lock' },
      { key: 'docker', labelKey: 'nav.docker', icon: 'container' },
      { key: 'database', labelKey: 'nav.database', icon: 'database' },
      { key: 'redis', labelKey: 'nav.redis', icon: 'layers' },
      { key: 'logs', labelKey: 'nav.logs', icon: 'fileText' },
    ],
  },
  {
    key: 'network',
    labelKey: 'navGroup.network',
    items: [
      { key: 'firewall', labelKey: 'nav.firewall', icon: 'shield' },
      { key: 'port', labelKey: 'nav.port', icon: 'plug' },
      { key: 'tunnel', labelKey: 'nav.tunnel', icon: 'tunnel' },
      { key: 'bbr', labelKey: 'nav.bbr', icon: 'gauge' },
    ],
  },
  {
    key: 'system',
    labelKey: 'navGroup.system',
    items: [
      { key: 'update', labelKey: 'nav.update', icon: 'update' },
      { key: 'settings', labelKey: 'nav.settings', icon: 'settings' },
    ],
  },
]

const NAV_KEYS = new Set<string>(NAV_GROUPS.flatMap(group => group.items.map(item => item.key)))

export const isPanelSection = (section: string): section is PanelSection => NAV_KEYS.has(section)

export const DISCUSSIONS_URL = 'https://github.com/ZipperWang/OhMyPanel/discussions'
