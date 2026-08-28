// 解析浏览器导出的密码 CSV（Chrome / Edge 格式），尽量健壮
// 期望列：name,url,username,password

function parseCsvLine (line) {
  const out = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuote = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuote = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/**
 * @param {string} text CSV 文本
 * @returns {Array<{title,url,username,password}>}
 */
export function parseBrowserCsv (text) {
  if (!text) return []
  // 去除 BOM
  const clean = text.replace(/^\uFEFF/, '')
  const lines = clean.split(/\r?\n/)
  const rows = []
  let skippedHeader = false

  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    const f = parseCsvLine(t).map((s) => s.trim())

    // 表头识别（chrome/edge 字段顺序：name,url,username,password）
    if (!skippedHeader && f.length >= 4) {
      const urlH = (f[1] || '').toLowerCase()
      const userH = (f[2] || '').toLowerCase()
      const passH = (f[3] || '').toLowerCase()
      if (urlH === 'url' && userH === 'username' && passH === 'password') {
        skippedHeader = true
        continue
      }
    }

    if (f.length < 4) continue
    const [name, url, username, password] = f
    if (!password) continue

    rows.push({
      title: (name || username || url || '未命名').trim(),
      url: url || '',
      username: username || '',
      password
    })
  }

  return rows
}
