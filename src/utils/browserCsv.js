// 解析浏览器导出的密码 CSV（Chrome / Edge 格式），尽量健壮
// 期望列：name,url,username,password,note（note 可选）

// 整文本 CSV 状态机解析（正确处理引号内逗号 / 引号 / 换行）
function parseCsv (text) {
  const rows = []
  let row = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
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
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur)
      cur = ''
      rows.push(row)
      row = []
    } else {
      cur += ch
    }
  }
  if (cur !== '' || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

/**
 * @param {string} text CSV 文本
 * @returns {Array<{title,url,username,password,notes}>}
 */
export function parseBrowserCsv (text) {
  if (!text) return []
  // 去除 BOM
  const clean = text.replace(/^\uFEFF/, '')
  const rows = []
  let skippedHeader = false

  for (const fRaw of parseCsv(clean)) {
    const f = fRaw.map((s) => s.trim())
    if (!f.some((x) => x !== '')) continue

    // 表头识别（chrome/edge 字段顺序：name,url,username,password,note）
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
    const [name, url, username, password, note] = f
    if (!password) continue

    rows.push({
      title: (name || username || url || '未命名').trim(),
      url: url || '',
      username: username || '',
      password,
      notes: note || ''
    })
  }

  return rows
}

// CSV 单元格转义：含逗号 / 引号 / 换行时用双引号包裹，内部引号翻倍
function csvCell (v) {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/**
 * 生成 Chrome / Edge 可直接导入的密码 CSV
 * 列与浏览器自身导出一致：name,url,username,password,note；行尾 CRLF；无 BOM
 * @param {Array<{title,url,username,password,notes}>} entries
 * @returns {string}
 */
export function buildBrowserCsv (entries) {
  const header = 'name,url,username,password,note'
  const lines = (entries || []).map((e) =>
    [e.title, e.url, e.username, e.password, e.notes].map(csvCell).join(',')
  )
  return [header, ...lines].join('\r\n')
}
