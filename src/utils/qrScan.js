// 离线二维码解码：动态加载 jsQR，不进入首屏 bundle
// jsQR 读取的是 RGBA 像素数据 (Uint8ClampedArray)
import { readClipboardText, readClipboardImage } from './clipboard'

const MAX_DIM = 1280 // 超过该尺寸先缩小以提升解码速度

function loadImage (src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

function decodeOnCanvas (img, jsQR) {
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight))
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth'
  })
}

// ZXing 对无 ECI 的 Data Matrix 按 Windows-1252 解码：特殊字符 → 原始字节
const CP1252_REV = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
  0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
}

/**
 * 修正 ZXing 按 CP1252 解码导致的中文乱码：还原字节后先按 UTF-8（严格），再按 GB18030 解码
 * 已正确解码的真实 Unicode 字符串（含 >0xFF 且不在 CP1252 表中的字符）原样返回
 */
function recodeText (text) {
  if (!text) return text
  const bytes = []
  let hasHigh = false
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code <= 0xFF) { bytes.push(code); if (code >= 0x80) hasHigh = true }
    else if (CP1252_REV[code] != null) { bytes.push(CP1252_REV[code]); hasHigh = true }
    else return text
  }
  if (!hasHigh) return text
  const u8 = Uint8Array.from(bytes)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8) } catch (e) { /* 不是 UTF-8，继续尝试 */ }
  try { return new TextDecoder('gb18030').decode(u8) } catch (e) { /* 浏览器不支持则保留原文 */ }
  return text
}

/**
 * ZXing 兜底解码：jsQR 只支持 QR 码，Data Matrix 等码制用 ZXing
 * 动态加载（仅 jsQR 失败时才引入该 chunk）
 * @param {HTMLImageElement} img
 * @returns {Promise<{data: string, format: string}|null>}
 */
async function decodeWithZxing (img) {
  try {
    const {
      BrowserDatamatrixCodeReader,
      HTMLCanvasElementLuminanceSource,
      HybridBinarizer,
      BinaryBitmap,
      DecodeHintType
    } = await import('@zxing/library')
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight))
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    const reader = new BrowserDatamatrixCodeReader()
    const hints = new Map()
    hints.set(DecodeHintType.TRY_HARDER, true)
    // Data Matrix 可能有旋转，依次尝试 4 个方向
    let lum = new HTMLCanvasElementLuminanceSource(canvas)
    for (let i = 0; i < 4; i++) {
      try {
        const result = reader.decodeBitmap(new BinaryBitmap(new HybridBinarizer(lum)), hints)
        if (result && result.getText()) return { data: recodeText(result.getText()), format: 'Data Matrix' }
      } catch (e) { /* 该方向无解，继续旋转 */ }
      if (typeof lum.rotateCounterClockwise === 'function') {
        lum = lum.rotateCounterClockwise()
      } else break
    }
    return null
  } catch (e) {
    return null
  }
}

/**
 * 从 data URL 图片解码（QR 码优先，失败后用 ZXing 识别 Data Matrix 等）
 * @param {string} dataUrl 形如 data:image/png;base64,...
 * @returns {Promise<{data: string, format: string}|null>} format: 'QR 码' | 'Data Matrix'
 */
export async function decodeQrFromDataUrl (dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null
  try {
    const img = await loadImage(dataUrl)
    const { default: jsQR } = await import('jsqr')
    // 先尝试缩小后的图，失败再用原图
    const scaled = await decodeOnCanvas(img, jsQR)
    if (scaled && scaled.data) return { data: scaled.data, format: 'QR 码' }
    const full = await decodeOnCanvas(img, jsQR)
    if (full && full.data) return { data: full.data, format: 'QR 码' }
    // 最后一搏：放大（对小图有用）
    if (img.naturalWidth < 400) {
      const canvas = document.createElement('canvas')
      const scale = Math.min(3, 1024 / Math.max(img.naturalWidth, img.naturalHeight))
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const up = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth'
        })
        if (up && up.data) return { data: up.data, format: 'QR 码' }
      }
    }
    // QR 识别失败 → ZXing 兜底（Data Matrix 等）
    return await decodeWithZxing(img)
  } catch (e) {
    console.error('qr decode error', e)
    return null
  }
}

/**
 * 弹出文件选择框，选择图片并离线解码（QR / Data Matrix）
 * @returns {Promise<{data:string, format:string}|null>} 解码结果；取消或失败返回 null
 */
export async function pickAndDecodeQr () {
  const files = window.utools.showOpenDialog({
    title: '选择二维码 / Data Matrix 图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }]
  })
  if (!files || !files[0]) return null
  try {
    const dataUrl = window.services.readImageBase64(files[0])
    return await decodeQrFromDataUrl(dataUrl)
  } catch (e) {
    return null
  }
}

/**
 * 框选屏幕区域并离线解码（QR / Data Matrix）
 * @param {(result:{data:string, format:string}|null)=>void} done 回调；取消或未识别返回 null
 */
export function captureAndDecodeQr (done) {
  window.utools.screenCapture((imgBase64) => {
    if (!imgBase64) { done(null); return }
    decodeQrFromDataUrl(normalizeImageBase64(imgBase64)).then((qr) => {
      done(qr && qr.data ? qr : null)
    })
  })
}

// 规范化 uTools 截图回调可能返回的 base64 字符串 => data URL
export function normalizeImageBase64 (input) {
  if (!input) return ''
  const s = String(input).trim()
  if (/^data:image\//i.test(s)) return s
  if (/^https?:\/\//i.test(s)) return s
  // 纯 base64
  return `data:image/png;base64,${s}`
}

/**
 * 读取剪贴板内容：优先文字；无文字时读取图片并自动识别其中的二维码 / Data Matrix
 * @returns {Promise<{ok:true, text:string, format:string, from:'text'|'image'}|{ok:false, reason:'no-qr-in-image'|'empty'}>}
 */
export async function readClipboardContent () {
  const t = await readClipboardText()
  if (t && t.trim()) return { ok: true, text: t.trim(), format: '文字', from: 'text' }
  const img = await readClipboardImage()
  if (img) {
    const qr = await decodeQrFromDataUrl(img)
    if (qr && qr.data) return { ok: true, text: qr.data, format: qr.format, from: 'image' }
    return { ok: false, reason: 'no-qr-in-image' }
  }
  return { ok: false, reason: 'empty' }
}
