import { reactive } from 'vue'
import { getBackupBlob, saveBlobFromBackup } from './vault'

const KEY = 'password_webdav'

// 多版本备份最多保留的份数（含最新一份），更早的会被自动清理
const KEEP_VERSIONS = 3
// 网络级错误自动重试次数（总计尝试 1+2=3 次；HTTP 状态错误不重试）
const DAV_RETRY = 2

export const cloud = reactive({
  enabled: false,
  url: '',
  user: '',
  pass: '',
  path: '',
  fileName: 'password-vault-backup.json'
})

export function loadCloud () {
  try {
    const s = JSON.parse(window.localStorage.getItem(KEY) || '{}')
    Object.assign(cloud, s)
  } catch (e) {}
}

export function saveCloud () {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      enabled: cloud.enabled, url: cloud.url, user: cloud.user, pass: cloud.pass,
      path: cloud.path, fileName: cloud.fileName
    }))
  } catch (e) {}
}

function normalizeBase () {
  let base = (cloud.url || '').trim()
  if (!base) return ''
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base
  return base.replace(/\/+$/, '')
}

function normalizePath () {
  return (cloud.path || '').replace(/^\/+/, '').replace(/\/+$/, '')
}

function defaultName () {
  return (cloud.fileName || '').trim() || 'password-vault-backup.json'
}

// 文件名的「主干 + 扩展名」（去掉扩展名作为版本前缀，便于匹配版本文件）
function splitName (name) {
  const dot = name.lastIndexOf('.')
  if (dot > 0) return { stem: name.slice(0, dot), ext: name.slice(dot + 1) }
  return { stem: name, ext: 'json' }
}

// 生成带时间戳的版本文件名：例如 password-vault-backup-20260907-153000-123.json
// 精确到毫秒，避免同一秒内备份两次时互相覆盖
function versionName (stem, ext, d) {
  const pad = (n) => String(n).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${ms}`
  return `${stem}-${ts}.${ext}`
}

// 拼接完整上传地址；file 缺省时用「当前文件名」（非版本）
function buildUrl (file) {
  const base = normalizeBase()
  if (!base) return ''
  const p = normalizePath()
  const name = file || defaultName()
  return [base, p, name].filter(Boolean).join('/')
}

// 目录地址（不含文件名），用于 PROPFIND
function buildDirUrl () {
  const base = normalizeBase()
  if (!base) return ''
  const p = normalizePath()
  return [base, p].filter(Boolean).join('/')
}

function escapeRegExp (s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 从 PROPFIND 返回的 XML 中解析出资源文件名列表
function parsePropfindNames (xml) {
  const names = []
  const re = /<[^>]*?href[^>]*>([^<]+)<\/[^>]*?>/gi
  let m
  while ((m = re.exec(xml)) !== null) {
    try {
      const decoded = decodeURIComponent(m[1].trim())
      const name = decoded.split('/').filter(Boolean).pop()
      if (name) names.push(name)
    } catch (e) {}
  }
  return names
}

// ---- 常见 WebDAV 状态码 → 友好中文提示 ----
const DAV_STATUS_TEXT = {
  401: '认证失败：账号或密码错误',
  403: '权限不足：服务器拒绝访问',
  404: '路径不存在：请检查服务器地址或子路径',
  405: '服务器不支持该操作（可能不是标准 WebDAV）',
  409: '资源冲突：目录创建或文件写入失败',
  413: '文件过大：超出服务器大小限制',
  501: '服务器不支持该操作（可能不是标准 WebDAV）',
  507: '服务器存储空间不足'
}

function davErrorMessage (r, prefix) {
  const base = prefix || '操作'
  if (r && r.status) {
    return base + '：' + (DAV_STATUS_TEXT[r.status] || ('HTTP ' + r.status))
  }
  return base + '：' + (r.error || '网络异常，请检查连接')
}

// 网络级错误（无 HTTP 状态码）自动重试；HTTP 状态错误直接返回，避免无意义重试
async function davRetry (fn) {
  let last
  for (let i = 0; i <= DAV_RETRY; i++) {
    last = await fn()
    if (last.ok) return last
    if (last.status) return last
  }
  return last
}

// 列举该目录下本插件生成的版本备份文件名（按时间戳升序）
async function listBackupVersions () {
  const dirUrl = buildDirUrl()
  if (!dirUrl) return { ok: false, error: '请先填写服务器地址' }
  const r = await davRetry(() => window.services.webdavPropfind(dirUrl, cloud.user, cloud.pass))
  if (!r.ok) {
    // 目录不存在（首次备份之前）时也视为「无版本」，交由上传时自动创建
    if (r.status && (r.status === 404 || r.status === 409)) return { ok: true, names: [] }
    return { ok: false, error: davErrorMessage(r, '读取云端目录失败') }
  }
  const { stem, ext } = splitName(defaultName())
  const re = new RegExp('^' + escapeRegExp(stem) + '-(\\d{8}-\\d{6}-\\d{3})\\.' + escapeRegExp(ext) + '$')
  const names = parsePropfindNames(r.xml || '').filter((n) => re.test(n))
  names.sort()
  return { ok: true, names }
}

// 从版本文件名解析出备份时间（无时间戳的旧版文件名返回 null）
function parseVersionStamp (name, stem, ext) {
  const re = new RegExp('^' + escapeRegExp(stem) + '-(\\d{4})(\\d{2})(\\d{2})-(\\d{2})(\\d{2})(\\d{2})-(\\d{3})\\.' + escapeRegExp(ext) + '$')
  const m = re.exec(name)
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7])
}

// 拉取云端备份列表，返回 [{ name, date, legacy }]（仅一次 PROPFIND，不含文件内容）
export async function listRemoteBackups () {
  saveCloud()
  const dirUrl = buildDirUrl()
  if (!dirUrl) return { ok: false, error: '请先填写服务器地址' }
  const r = await davRetry(() => window.services.webdavPropfind(dirUrl, cloud.user, cloud.pass))
  if (!r.ok) {
    // 目录不存在（首次备份之前）时视为「无备份」
    if (r.status && (r.status === 404 || r.status === 409)) return { ok: true, backups: [] }
    return { ok: false, error: davErrorMessage(r, '读取云端列表失败') }
  }
  const { stem, ext } = splitName(defaultName())
  const names = parsePropfindNames(r.xml || '')
  const backups = []
  // 旧版默认文件名（无时间戳）也纳入列表，作为「旧版本文件」展示
  const def = defaultName()
  if (names.indexOf(def) !== -1) backups.push({ name: def, date: null, legacy: true })
  const re = new RegExp('^' + escapeRegExp(stem) + '-(\\d{8}-\\d{6}-\\d{3})\\.' + escapeRegExp(ext) + '$')
  const seen = new Set()
  for (const n of names) {
    if (!re.test(n) || seen.has(n)) continue
    seen.add(n)
    backups.push({ name: n, date: parseVersionStamp(n, stem, ext), legacy: false })
  }
  backups.sort((a, b) => {
    const ta = a.date ? a.date.getTime() : -Infinity
    const tb = b.date ? b.date.getTime() : -Infinity
    return ta - tb
  })
  return { ok: true, backups }
}

// 清理超出保留数量的历史版本（保留最新的 KEEP_VERSIONS 份）
async function pruneBackupVersions (names) {
  if (!names || names.length <= KEEP_VERSIONS) return
  const del = names.slice(0, names.length - KEEP_VERSIONS)
  for (const name of del) {
    // 清理失败不影响主流程，仅忽略
    await window.services.webdavDelete(buildUrl(name), cloud.user, cloud.pass)
  }
}

// 逐级创建 WebDAV 目录（自动创建父目录，已存在则容错）
async function ensureRemoteDir () {
  const base = normalizeBase()
  const segs = normalizePath().split('/').filter(Boolean)
  for (let i = 1; i <= segs.length; i++) {
    const dirUrl = base + '/' + segs.slice(0, i).join('/')
    const r = await davRetry(() => window.services.webdavMkcol(dirUrl, cloud.user, cloud.pass))
    if (!r.ok) {
      // 无 status 表示网络级错误（无法连接/超时），视为失败；405/301/409 等表示目录已存在，继续
      if (!r.status) return r
    }
  }
  return { ok: true }
}

export async function testConnection () {
  const url = buildUrl()
  if (!url) return { ok: false, error: '请先填写服务器地址' }
  const dr = await ensureRemoteDir()
  if (!dr.ok) return { ok: false, error: davErrorMessage(dr, '连接失败') }
  const r = await davRetry(() => window.services.webdavPut(url, cloud.user, cloud.pass, '__ping__' + Date.now()))
  // 尝试清理测试文件
  if (r.ok) window.services.webdavDelete(url, cloud.user, cloud.pass)
  return r.ok ? { ok: true } : { ok: false, error: davErrorMessage(r, '连接失败') }
}

export async function backupNow () {
  saveCloud()
  const url = buildUrl()
  if (!url) return { ok: false, error: '请先填写 WebDAV 地址' }
  const blob = getBackupBlob()
  if (!blob) return { ok: false, error: '当前无数据可备份' }

  // 备份体附带 SHA-256 校验和：checksum 针对不含校验和的其余字段计算
  const obj = {
    app: 'my-password-utools',
    version: 2,
    exportedAt: new Date().toISOString(),
    blob
  }
  const body = JSON.stringify(obj)
  const checksum = window.services.sha256(body)
  const payload = JSON.stringify({ ...obj, checksum })

  const dr = await ensureRemoteDir()
  if (!dr.ok) return { ok: false, error: davErrorMessage(dr, '上传失败') }

  // 多版本防覆盖：写入带时间戳的版本文件，而不是覆盖原有文件
  const { stem, ext } = splitName(defaultName())
  const versionUrl = buildUrl(versionName(stem, ext, new Date()))
  const put = await davRetry(() => window.services.webdavPut(versionUrl, cloud.user, cloud.pass, payload))
  if (!put.ok) return { ok: false, error: davErrorMessage(put, '上传失败') }

  // 完整性校验：上传后回读，重新计算校验和并比对，防止静默写入损坏
  const rb = await davRetry(() => window.services.webdavGet(versionUrl, cloud.user, cloud.pass))
  if (!rb.ok) return { ok: false, error: '上传后校验失败：无法回读，请检查网络' }
  let rbData
  try {
    const parsed = JSON.parse(rb.data)
    const rbBody = JSON.stringify({ app: parsed.app, version: parsed.version, exportedAt: parsed.exportedAt, blob: parsed.blob })
    if (window.services.sha256(rbBody) !== (parsed.checksum || checksum)) {
      return { ok: false, error: '上传后校验失败：校验和不匹配，备份可能已损坏' }
    }
    rbData = parsed
  } catch (e) {
    return { ok: false, error: '上传后校验失败：备份格式不正确' }
  }

  // 清理超出的历史版本（失败不影响本次备份结果）
  const lst = await listBackupVersions()
  if (lst.ok) await pruneBackupVersions(lst.names)

  return { ok: true, plain: !blob.mode || blob.mode === 'plain', version: rbData.exportedAt || '', kept: KEEP_VERSIONS }
}

export async function restoreNow (name) {
  saveCloud()
  let url
  if (name) {
    // 指定从某个版本恢复
    url = buildUrl(name)
  } else {
    // 未指定：优先最新版本备份；若无版本备份，回退到默认文件名（兼容旧版本）
    const lst = await listBackupVersions()
    if (lst.ok && lst.names.length) {
      url = buildUrl(lst.names[lst.names.length - 1])
    } else {
      url = buildUrl()
    }
  }
  if (!url) return { ok: false, error: '请先填写 WebDAV 地址' }
  const r = await davRetry(() => window.services.webdavGet(url, cloud.user, cloud.pass))
  if (r.status === 404) {
    return { ok: false, error: '云端暂无备份' }
  }
  if (!r.ok) return { ok: false, error: davErrorMessage(r, '下载失败') }
  let data
  try {
    data = JSON.parse(r.data)
  } catch (e) {
    return { ok: false, error: '备份文件格式不正确' }
  }
  const blob = data && data.blob ? data.blob : data
  if (!blob || (typeof blob !== 'object')) return { ok: false, error: '备份内容无效' }

  // 完整性校验：备份带校验和时，恢复前须校验通过，防止恢复损坏数据
  if (data.checksum) {
    const recalc = window.services.sha256(JSON.stringify({
      app: data.app, version: data.version, exportedAt: data.exportedAt, blob
    }))
    if (recalc !== data.checksum) {
      return { ok: false, error: '校验和不匹配，备份文件可能已损坏，已取消恢复' }
    }
  }

  saveBlobFromBackup(blob)
  return { ok: true, encrypted: blob.mode === 'encrypted', exportedAt: data.exportedAt || '' }
}

// 读取云端备份的摘要（是否加密、记录数、备份时间），用于恢复前预览
// name 缺省时：优先最新版本备份；无版本备份则回退默认文件名
export async function previewRemote (name) {
  saveCloud()
  let url, fileName
  if (name) {
    // 指定从某个备份文件预览
    fileName = name
    url = buildUrl(name)
  } else {
    const lst = await listBackupVersions()
    if (lst.ok && lst.names.length) {
      fileName = lst.names[lst.names.length - 1]
      url = buildUrl(fileName)
    } else {
      // 目录列举失败或无版本备份时，回退读取默认文件名（兼容旧版本 / 不支持 PROPFIND 的服务器）
      fileName = defaultName()
      url = buildUrl()
    }
  }
  if (!url) return { ok: false, error: '请先填写 WebDAV 地址' }
  const r = await davRetry(() => window.services.webdavGet(url, cloud.user, cloud.pass))
  if (r.status === 404) return { ok: false, error: '云端暂无备份' }
  if (!r.ok) return { ok: false, error: davErrorMessage(r, '下载失败') }
  let data
  try {
    data = JSON.parse(r.data)
  } catch (e) {
    return { ok: false, error: '备份文件格式不正确' }
  }
  const blob = data && data.blob ? data.blob : data
  if (!blob || (typeof blob !== 'object')) return { ok: false, error: '备份内容无效' }
  // 预览时也校验完整性，避免用户点击恢复后才被告知备份损坏
  if (data.checksum) {
    const recalc = window.services.sha256(JSON.stringify({
      app: data.app, version: data.version, exportedAt: data.exportedAt, blob
    }))
    if (recalc !== data.checksum) {
      return { ok: false, error: '校验和不匹配，备份文件可能已损坏，无法恢复' }
    }
  }
  const encrypted = blob.mode === 'encrypted'
  const count = encrypted ? null : (Array.isArray(blob.entries) ? blob.entries.length : 0)
  return {
    ok: true,
    file: fileName || defaultName(),
    encrypted,
    count,
    exportedAt: data.exportedAt || '',
    hasChecksum: !!data.checksum
  }
}

// 导出备份到本地文件（云端之外再留一份），返回保存路径或取消
export async function exportLocal () {
  const blob = getBackupBlob()
  if (!blob) return { ok: false, error: '当前无数据可导出' }
  const obj = {
    app: 'my-password-utools',
    version: 2,
    exportedAt: new Date().toISOString(),
    blob
  }
  const body = JSON.stringify(obj)
  const checksum = window.services.sha256(body)
  const payload = JSON.stringify({ ...obj, checksum })
  const { stem, ext } = splitName(defaultName())
  const name = versionName(stem, ext, new Date())
  const r = await window.services.saveFileDialog(name, payload)
  if (!r) return { ok: false, error: '导出失败' }
  return r.ok ? { ok: true, path: r.path } : (r.canceled ? { ok: false, canceled: true } : { ok: false, error: r.error || '导出失败' })
}
