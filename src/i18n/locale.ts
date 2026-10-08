// 将系统区域设置（navigator.language）映射为应用支持的语言代码。
// 系统语言为英语或不受支持时返回 null（保留默认值 'en'）。

// 除 en/zh-CN/zh-TW（显式处理）之外的应用支持语言
const SUPPORTED: readonly string[] = ['ja', 'fr', 'de', 'ru', 'ar', 'pt', 'ko']

export function systemToAppLocale(systemLang: string): string | null {
  const lower = systemLang.toLowerCase()
  if (lower.startsWith('zh')) {
    // 繁体中文：TW/HK/MO 地区或显式 Hant 脚本
    if (lower.includes('tw') || lower.includes('hk') || lower.includes('mo') || lower.includes('hant')) {
      return 'zh-TW'
    }
    return 'zh-CN'
  }
  for (const code of SUPPORTED) {
    if (lower.startsWith(code)) return code
  }
  return null
}
