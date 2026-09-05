// 解析「分享出来的密码」文本 / 二维码内容 → 可直接入库的条目字段
// 兼容本插件 ShareDialog 生成的中文标签格式、WiFi 直连 payload、otpauth 链接
import { parseWifiPayload } from './wifi'
import { parseOtpauth } from './totp'

// 字段 → 可识别的标签（中英文，小写匹配）
const LABEL_MAP = [
  ['title', ['标题', '名称', '名字', '网络名称', '无线名称', '热点', 'title', 'name', 'ssid', 'wifi', 'wi-fi']],
  ['username', ['账号', '帐号', '用户名', '账户', '帐户', 'account', 'username', 'login', 'user', 'id']],
  ['password', ['密码', '口令', 'password', 'pwd', 'pass', 'passwd']],
  ['url', ['网址', '链接', '地址', 'url', 'website', 'site', 'link', 'uri']],
  ['notes', ['备注', '说明', '注释', 'notes', 'note', 'remark', 'comment']]
]

// 子串兜底匹配时，更具体的字段优先（避免 "username" 被 "name" 截胡到标题）
const FIELD_PRIORITY = ['username', 'password', 'url', 'notes', 'title']

// 出现这些标签时视为 WiFi 条目
const WIFI_LABELS = ['wifi', 'wi-fi', '无线', '网络', 'ssid', '热点']

// 标签行 → 字段名；精确匹配优先，子串匹配按字段特异性兜底
function matchField (label) {
  for (const [f, labels] of LABEL_MAP) {
    if (labels.includes(label)) return f
  }
  for (const f of FIELD_PRIORITY) {
    const labels = LABEL_MAP.find(([k]) => k === f)[1]
    if (labels.some((l) => label.includes(l))) return f
  }
  return null
}

function emptyResult (raw) {
  return {
    isWifi: false,
    title: '',
    username: '',
    password: '',
    url: '',
    notes: '',
    otp: null,
    wifiType: 'WPA',
    wifiHidden: false,
    matched: false,
    raw
  }
}

/**
 * 解析分享文本
 * @param {string} raw
 * @returns {object|null} 条目字段；空文本返回 null
 */
export function parseShareText (raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const result = emptyResult(text)

  // 1) WIFI:T:... 直连二维码内容
  const wifi = parseWifiPayload(text)
  if (wifi) {
    result.isWifi = true
    result.matched = true
    result.title = wifi.ssid
    result.password = wifi.password
    result.wifiType = wifi.type
    result.wifiHidden = wifi.hidden
    result.notes = wifi.hidden ? '隐藏网络' : ''
    return result
  }

  // 2) 内嵌 otpauth:// 链接
  const otpMatch = text.match(/otpauth:\/\/\S+/i)
  if (otpMatch) {
    result.otp = parseOtpauth(otpMatch[0]) || null
  }

  // 3) 逐行解析「标签: 值」（兼容中英文冒号）
  let currentField = null
  let matchedAny = false
  let wifiByLabel = false

  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([^:：]+?)\s*[:：]\s*(.*)$/.exec(line)
    if (m) {
      const label = m[1].trim().toLowerCase()
      const value = m[2].trim()
      const field = matchField(label)
      if (field) {
        result[field] = value
        currentField = field
        matchedAny = true
        if (WIFI_LABELS.some((l) => label.includes(l))) wifiByLabel = true
        continue
      }
    }
    // 无标签的续行：追加到备注（多行备注）
    if (currentField === 'notes' && line.trim()) {
      result.notes = (result.notes ? result.notes + '\n' : '') + line.trim()
    }
  }

  if (wifiByLabel) {
    result.isWifi = true
    result.wifiType = result.password ? 'WPA' : 'nopass'
    result.username = ''
    result.url = ''
  }

  result.matched = matchedAny || !!result.otp
  return result
}
