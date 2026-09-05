// WiFi 直连二维码（标准 WIFI: payload）构建与解析
// 格式：WIFI:T:<认证方式>;S:<SSID>;P:<密码>;H:<是否隐藏>;;
// 特殊字符 \ ; , : " 需用反斜杠转义

export const WIFI_TYPES = [
  { value: 'WPA', label: 'WPA / WPA2 / WPA3' },
  { value: 'WEP', label: 'WEP' },
  { value: 'nopass', label: '无密码（开放网络）' }
]

export function escapeWifi (s) {
  return String(s || '').replace(/([\\;,:"])/g, '\\$1')
}

function unescapeWifi (s) {
  return String(s || '').replace(/\\(.)/g, '$1')
}

/**
 * 构建 WIFI: 二维码内容
 * @param {{ssid:string, password?:string, type?:string, hidden?:boolean}} opts
 * @returns {string}
 */
export function buildWifiPayload ({ ssid, password = '', type = 'WPA', hidden = false }) {
  const auth = type === 'nopass' ? 'nopass' : (type === 'WEP' ? 'WEP' : 'WPA')
  const parts = [`T:${auth}`, `S:${escapeWifi(ssid || '')}`]
  if (auth !== 'nopass') parts.push(`P:${escapeWifi(password || '')}`)
  if (hidden) parts.push('H:true')
  return `WIFI:${parts.join(';')};;`
}

// 按未转义的分号切分字段
function splitWifiSegments (body) {
  const segs = []
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\' && i + 1 < body.length) {
      cur += body.slice(i, i + 2)
      i++
    } else if (ch === ';') {
      segs.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  segs.push(cur)
  return segs
}

/**
 * 解析 WIFI: 二维码内容
 * @param {string} raw
 * @returns {{ssid:string, password:string, type:string, hidden:boolean}|null}
 */
export function parseWifiPayload (raw) {
  const s = String(raw || '').trim()
  if (!/^WIFI:/i.test(s)) return null
  const body = s.replace(/^WIFI:/i, '').replace(/;;\s*$/, '')
  const fields = {}
  for (const seg of splitWifiSegments(body)) {
    const ci = seg.indexOf(':')
    if (ci <= 0) continue
    const k = seg.slice(0, ci).trim().toUpperCase()
    fields[k] = unescapeWifi(seg.slice(ci + 1))
  }
  if (!fields.S) return null
  return {
    ssid: fields.S,
    password: fields.P || '',
    type: (fields.T || 'WPA').toUpperCase() === 'NOPASS' ? 'nopass' : ((fields.T || 'WPA').toUpperCase() === 'WEP' ? 'WEP' : 'WPA'),
    hidden: fields.H === 'true'
  }
}
