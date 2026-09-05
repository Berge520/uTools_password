// 统一剪贴板能力：文本 / 图片复制、敏感内容定时清除、剪贴板读取
// uTools 环境走 window.utools / window.services；浏览器环境走 navigator.clipboard 兜底
import { showToast } from './toast'

const CLEAR_DELAY = 15000 // 敏感内容复制后 15 秒自动清除
let clearTimer = null

function clearTimerSafe () {
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
}

function scheduleClear () {
  clearTimerSafe()
  clearTimer = setTimeout(() => {
    clearTimer = null
    try {
      if (window.utools && window.utools.copyText) window.utools.copyText('')
    } catch (e) {}
  }, CLEAR_DELAY)
}

/**
 * 复制文本
 * @param {string} text 内容
 * @param {object} opts { label: 提示中的名称, sensitive: 是否敏感(默认true,15秒后清除), silent: 不弹提示 }
 * @returns {Promise<boolean>}
 */
export async function copyText (text, opts = {}) {
  const { label = '', sensitive = true, silent = false } = opts
  if (text == null || text === '') return false
  let ok = false
  try {
    if (window.utools && window.utools.copyText) {
      ok = window.utools.copyText(String(text)) !== false
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(String(text))
      ok = true
    }
  } catch (e) {
    ok = false
  }
  if (ok && sensitive) scheduleClear()
  // 复制图片等非文本内容后，不应再让旧的定时清除把剪贴板清空
  if (ok && !sensitive) clearTimerSafe()
  if (ok && !silent) {
    showToast(sensitive ? `已复制${label}，15 秒后自动清除` : `已复制${label}`)
  } else if (!ok && !silent) {
    showToast('复制失败，请手动复制')
  }
  return ok
}

function dataUrlToBlob (dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) return null
  try {
    const bin = atob(m[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: m[1] })
  } catch (e) {
    return null
  }
}

/**
 * 复制图片（data URL）
 * @param {string} dataUrl
 * @param {object} opts { label, silent }
 * @returns {Promise<boolean>}
 */
export async function copyImage (dataUrl, opts = {}) {
  const { label = '图片', silent = false } = opts
  if (!dataUrl) return false
  // 图片复制后取消待执行的文本清除，避免刚复制的图片被 copyText('') 覆盖
  clearTimerSafe()
  let ok = false
  try {
    if (window.utools && window.utools.copyImage) {
      ok = window.utools.copyImage(dataUrl) !== false
    } else if (navigator.clipboard && window.ClipboardItem) {
      const blob = dataUrlToBlob(dataUrl)
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
        ok = true
      }
    }
  } catch (e) {
    ok = false
  }
  if (!silent) showToast(ok ? `${label}已复制` : '复制失败，请改用保存图片')
  return ok
}

/**
 * 读取剪贴板文本（uTools 下走 preload 的 Electron clipboard，浏览器走 navigator.clipboard）
 * @returns {Promise<string>} 读取失败返回 ''
 */
export async function readClipboardText () {
  try {
    if (window.services && typeof window.services.readClipboardText === 'function') {
      const t = window.services.readClipboardText()
      if (t) return String(t)
    }
  } catch (e) {}
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      return (await navigator.clipboard.readText()) || ''
    }
  } catch (e) {}
  return ''
}

function blobToDataUrl (blob) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => resolve('')
    reader.readAsDataURL(blob)
  })
}

/**
 * 读取剪贴板图片，返回 data URL（如 data:image/png;base64,…）；无图片返回 ''
 */
export async function readClipboardImage () {
  try {
    if (window.services && typeof window.services.readClipboardImage === 'function') {
      const d = window.services.readClipboardImage()
      if (d) return String(d)
    }
  } catch (e) {}
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types && item.types.find((t) => String(t).startsWith('image/'))
        if (type) {
          const blob = await item.getType(type)
          if (blob) return await blobToDataUrl(blob)
        }
      }
    }
  } catch (e) {}
  return ''
}
