// 离线二维码解码：动态加载 jsQR，不进入首屏 bundle
// jsQR 读取的是 RGBA 像素数据 (Uint8ClampedArray)

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

/**
 * 从 data URL 图片解码二维码
 * @param {string} dataUrl 形如 data:image/png;base64,...
 * @returns {Promise<{data: string}|null>}
 */
export async function decodeQrFromDataUrl (dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null
  try {
    const img = await loadImage(dataUrl)
    const { default: jsQR } = await import('jsqr')
    // 先尝试缩小后的图，失败再用原图
    const scaled = await decodeOnCanvas(img, jsQR)
    if (scaled && scaled.data) return { data: scaled.data }
    const full = await decodeOnCanvas(img, jsQR)
    if (full && full.data) return { data: full.data }
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
        if (up && up.data) return { data: up.data }
      }
    }
    return null
  } catch (e) {
    console.error('qr decode error', e)
    return null
  }
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
