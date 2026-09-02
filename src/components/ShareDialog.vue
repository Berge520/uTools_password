<script setup>
import { ref, watch, onMounted } from 'vue'
import QRCode from 'qrcode'
import { showToast } from '../utils/toast'

const props = defineProps({
  entry: { type: Object, required: true }
})

const emit = defineEmits(['close'])

const mode = ref('text') // 'text' | 'qr' | 'both'
const text = ref('')
const qrData = ref('')
const combinedData = ref('')
let debounceTimer = null

function buildText (e) {
  e = e || {}
  const lines = [`标题：${e.title || '未命名'}`]
  if (e.username) lines.push(`账号：${e.username}`)
  if (e.password) lines.push(`密码：${e.password}`)
  if (e.url) lines.push(`网址：${e.url}`)
  if (e.notes) lines.push(`备注：${e.notes}`)
  return lines.join('\n')
}

function wrapLines (str, maxChars) {
  const out = []
  for (const line of String(str || '').split('\n')) {
    if (line.length <= maxChars) { out.push(line); continue }
    let s = line
    while (s.length > maxChars) { out.push(s.slice(0, maxChars)); s = s.slice(maxChars) }
    out.push(s)
  }
  return out.length ? out : ['']
}

function loadImage (src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function genQr () {
  if (!text.value.trim()) { qrData.value = ''; return }
  try {
    qrData.value = await QRCode.toDataURL(text.value, {
      width: 320, margin: 2, errorCorrectionLevel: 'H',
      color: { dark: '#1c2230', light: '#ffffff' }
    })
    renderCombined()
  } catch (e) {}
}

// 文字卡 + 二维码合成一张图
async function renderCombined () {
  if (!qrData.value) return
  const W = 660
  const pad = 30
  const font = '400 17px "JetBrains Mono", Consolas, monospace'
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  ctx.font = font
  const maxChars = Math.max(12, Math.floor((W - pad * 2) / 11))
  const wrapped = wrapLines(text.value, maxChars)
  const lineH = 26
  const qrSize = 200
  const gap = 20
  const H = pad * 2 + wrapped.length * lineH + gap + qrSize + pad
  canvas.width = W
  canvas.height = H
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.font = font
  ctx.fillStyle = '#1c2230'
  wrapped.forEach((ln, i) => ctx.fillText(ln, pad, pad + i * lineH + 18))
  try {
    const img = await loadImage(qrData.value)
    ctx.drawImage(img, (W - qrSize) / 2, pad + wrapped.length * lineH + gap, qrSize, qrSize)
  } catch (e) {}
  combinedData.value = canvas.toDataURL('image/png')
}

function regenAll () {
  genQr()
}

function onTextEdit () {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(regenAll, 200)
}

function setMode (m) {
  mode.value = m
  if (m === 'qr' || m === 'both') regenAll()
}

const imageTarget = () => (mode.value === 'qr' ? qrData.value : (mode.value === 'both' ? combinedData.value : qrData.value))

function copyText () {
  if (!text.value.trim()) { showToast('内容为空'); return }
  window.utools.copyText(text.value)
  showToast('已复制分享文字')
}

function copyImage () {
  const url = imageTarget()
  if (!url) { showToast('请先切换二维码/合成模式'); return }
  window.utools.copyImage(url)
  showToast('图片已复制')
}

function saveImage () {
  const url = imageTarget()
  if (!url) { showToast('请先生成图片'); return }
  const name = (props.entry && props.entry.title) || 'share'
  const p = window.utools.showSaveDialog({ title: '保存分享图片', defaultPath: `${name}.png` })
  if (!p) return
  window.services.saveImage(p, url)
  showToast('图片已保存')
  window.utools.shellShowItemInFolder(p)
}

function saveTextFile () {
  const name = (props.entry && props.entry.title) || 'share'
  const p = window.utools.showSaveDialog({ title: '保存分享文字', defaultPath: `${name}.txt` })
  if (!p) return
  window.services.saveTextFile(p, text.value)
  showToast('文字文件已保存')
  window.utools.shellShowItemInFolder(p)
}

watch(
  () => props.entry,
  (e) => {
    text.value = buildText(e)
    qrData.value = ''
    combinedData.value = ''
    regenAll()
  },
  { immediate: true }
)

onMounted(() => regenAll())
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal share">
      <div class="share-head">
        <div class="share-title">分享「{{ entry.title || '未命名' }}」</div>
        <button class="share-close" @click="emit('close')">✕</button>
      </div>

      <label class="editor-label">分享内容（可编辑，二维码/合成图实时更新）</label>
      <textarea v-model="text" class="share-editor mono-font" rows="5" @input="onTextEdit"></textarea>

      <div class="share-tabs">
        <button class="share-tab" :class="{ on: mode === 'text' }" @click="setMode('text')">📝 文字</button>
        <button class="share-tab" :class="{ on: mode === 'qr' }" @click="setMode('qr')">🧩 二维码</button>
        <button class="share-tab" :class="{ on: mode === 'both' }" @click="setMode('both')">📄 文字+二维码</button>
      </div>

      <div class="preview">
        <template v-if="mode === 'qr'">
          <div class="img-stage">
            <img v-if="qrData" :src="qrData" class="qr-img" alt="二维码" />
            <div v-else class="stage-empty">生成中…</div>
          </div>
          <div class="preview-hint">扫码即可查看完整信息，二维码随内容实时更新。</div>
        </template>
        <template v-else-if="mode === 'both'">
          <div class="img-stage">
            <img v-if="combinedData" :src="combinedData" class="txt-img" alt="文字+二维码" />
            <div v-else class="stage-empty">生成中…</div>
          </div>
          <div class="preview-hint">一张图同时包含文字与二维码，扫码+直读皆可。</div>
        </template>
        <template v-else>
          <div class="preview-hint">以文字形式复制 / 导出，也可切换二维码或合成图。</div>
        </template>
      </div>

      <div class="share-actions">
        <button class="btn" @click="emit('close')">关闭</button>
        <button class="btn" @click="copyText">复制文字</button>
        <button class="btn" @click="saveTextFile">导出文件</button>
        <button v-if="mode !== 'text'" class="btn" :disabled="!imageTarget()" @click="copyImage">复制图片</button>
        <button v-if="mode !== 'text'" class="btn primary" :disabled="!imageTarget()" @click="saveImage">保存图片</button>
      </div>
      <div class="share-note">信息含密码，请通过可信渠道分享并及时清理。</div>
    </div>
  </div>
</template>

<style scoped>
.modal.share {
  max-width: 480px;
}

.share-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.share-title {
  font-size: 16px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.share-close {
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  flex-shrink: 0;
}

.share-close:hover {
  background: var(--panel-2);
  color: var(--text);
}

.editor-label {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
}

.share-editor {
  width: 100%;
  min-height: 92px;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 13px;
  line-height: 1.7;
  outline: none;
  white-space: pre-wrap;
  word-break: break-all;
}

.share-editor:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.share-tabs {
  display: flex;
  gap: 6px;
  background: var(--panel-2);
  border-radius: 10px;
  padding: 4px;
  margin: 14px 0 12px;
}

.share-tab {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  padding: 8px 0;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.14s, color 0.14s, box-shadow 0.14s;
}

.share-tab.on {
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadow-sm);
  font-weight: 600;
}

.preview {
  margin-bottom: 4px;
}

.img-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
}

.qr-img,
.txt-img {
  max-width: 100%;
  max-height: 240px;
  border-radius: 8px;
  background: #fff;
}

.qr-img {
  width: 220px;
  height: 220px;
}

.stage-empty {
  color: var(--muted);
  font-size: 13px;
}

.preview-hint {
  font-size: 12px;
  color: var(--muted);
  margin-top: 6px;
}

.share-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.share-note {
  margin-top: 10px;
  font-size: 11px;
  color: var(--warning);
  text-align: center;
}
</style>
