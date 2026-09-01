import { reactive } from 'vue'
import { getBackupBlob, saveBlobFromBackup } from './vault'

const KEY = 'password_webdav'

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

export function buildUrl () {
  let base = (cloud.url || '').trim()
  if (!base) return ''
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base
  base = base.replace(/\/+$/, '')
  const p = (cloud.path || '').replace(/^\/+/, '').replace(/\/+$/, '')
  const name = (cloud.fileName || '').trim() || 'password-vault-backup.json'
  return [base, p, name].filter(Boolean).join('/')
}

export async function testConnection () {
  const url = buildUrl()
  if (!url) return { ok: false, error: '请先填写服务器地址' }
  const r = await window.services.webdavPut(url, cloud.user, cloud.pass, '__ping__' + Date.now())
  // 尝试清理测试文件
  if (r.ok) window.services.webdavDelete(url, cloud.user, cloud.pass)
  return r.ok ? { ok: true } : { ok: false, error: '连接失败：' + (r.error || ('HTTP ' + (r.status || 0))) }
}

export async function backupNow () {
  saveCloud()
  const url = buildUrl()
  if (!url) return { ok: false, error: '请先填写 WebDAV 地址' }
  const blob = getBackupBlob()
  if (!blob) return { ok: false, error: '当前无数据可备份' }
  const payload = JSON.stringify({
    app: 'my-password-utools',
    version: 2,
    exportedAt: new Date().toISOString(),
    blob
  })
  const r = await window.services.webdavPut(url, cloud.user, cloud.pass, payload)
  return r.ok ? { ok: true } : { ok: false, error: '上传失败：' + (r.error || ('HTTP ' + (r.status || 0))) }
}

export async function restoreNow () {
  saveCloud()
  const url = buildUrl()
  if (!url) return { ok: false, error: '请先填写 WebDAV 地址' }
  const r = await window.services.webdavGet(url, cloud.user, cloud.pass)
  if (!r.ok) return { ok: false, error: '下载失败：' + (r.error || ('HTTP ' + (r.status || 0))) }
  let data
  try {
    data = JSON.parse(r.data)
  } catch (e) {
    return { ok: false, error: '备份文件格式不正确' }
  }
  const blob = data && data.blob ? data.blob : data
  if (!blob || (typeof blob !== 'object')) return { ok: false, error: '备份内容无效' }
  saveBlobFromBackup(blob)
  return { ok: true, encrypted: blob.mode === 'encrypted' }
}
