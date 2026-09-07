<script setup>
import { ref, watch, onMounted } from 'vue'
import QRCode from 'qrcode'
import { showToast } from '../utils/toast'
import { copyText, copyImage } from '../utils/clipboard'
import QrScanButtons from './QrScanButtons.vue'

// 统一二维码工具箱：生成（任意文字/网址/WiFi 字符串）+ 识别（剪贴板/图片/截屏）
const props = defineProps({
  initialText: { type: String, default: '' }, // 外部带入的识别结果（如 uTools 图片匹配）
  initialFormat: { type: String, default: '' }
})
const emit = defineEmits(['close', 'search', 'receive'])

const tab = ref(props.initialText ? 'scan' : 'gen')

// ---------- 生成 ----------
const genText = ref('')
const qrData = ref('')
const genFormat = ref('qr') // qr | dm（Data Matrix）
let debounceTimer = null
let bwipLib = null // bwip-js 动态加载（仅生成 Data Matrix 时引入）

async function genQr () {
  if (!genText.value.trim()) { qrData.value = ''; return }
  try {
    if (genFormat.value === 'dm') {
      // Data Matrix：bwip-js 渲染到 canvas（动态加载，不占首屏）
      if (!bwipLib) bwipLib = (await import('bwip-js/browser')).default
      const canvas = document.createElement('canvas')
      bwipLib.toCanvas(canvas, {
        bcid: 'datamatrix',
        text: genText.value,
        scale: 5,
        padding: 10,
        includetext: false,
        backgroundcolor: 'FFFFFF' // 不透明白底，便于复制 / 保存 / 其他工具扫码
      })
      qrData.value = canvas.toDataURL('image/png')
    } else {
      qrData.value = await QRCode.toDataURL(genText.value, {
        width: 320, margin: 2, errorCorrectionLevel: 'M',
        color: { dark: '#1c2230', light: '#ffffff' }
      })
    }
  } catch (e) {
    qrData.value = ''
    if (genFormat.value === 'dm') showToast('Data Matrix 生成失败（内容可能过长）')
  }
}
function onGenInput () {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(genQr, 200)
}
function copyGenText () {
  if (!genText.value.trim()) return
  copyText(genText.value, { label: '内容' })
}
function copyGenImage () {
  if (!qrData.value) return
  copyImage(qrData.value, { label: '二维码图片' })
}
function saveGenImage () {
  if (!qrData.value) return
  const suffix = genFormat.value === 'dm' ? 'datamatrix' : 'qrcode'
  const p = window.utools.showSaveDialog({ title: '保存图片', defaultPath: `${suffix}_${Date.now()}.png` })
  if (!p) return
  window.services.saveImage(p, qrData.value)
  showToast('图片已保存')
  window.utools.shellShowItemInFolder(p)
}

// ---------- 识别 ----------
const scanText = ref(props.initialText || '')
const scanFrom = ref('')
const scanFormat = ref(props.initialFormat || '')

function onDetected (text, from, format) {
  scanText.value = text
  scanFrom.value = from ? `（来自${from}）` : ''
  scanFormat.value = format || ''
  showToast(`已识别${format || '二维码'}${scanFrom.value}`)
}
function copyScanText () {
  if (!scanText.value.trim()) return
  copyText(scanText.value, { label: '识别内容' })
}
function searchInVault () {
  const q = scanText.value.trim()
  if (!q) return
  emit('search', q)
}
function saveAsEntry () {
  const q = scanText.value.trim()
  if (!q) return
  emit('receive', q)
}

watch(tab, (t) => {
  if (t === 'gen' && genText.value && !qrData.value) genQr()
})
// 切换码制（QR / Data Matrix）后按当前内容重新生成
watch(genFormat, () => { if (genText.value.trim()) genQr() })

// 外部异步带入识别结果（uTools 图片匹配：先开弹窗后解码完成）
watch(() => props.initialText, (v) => {
  if (v) {
    tab.value = 'scan'
    scanText.value = v
    scanFrom.value = '（来自剪贴板图片）'
    scanFormat.value = props.initialFormat || ''
  }
})

onMounted(() => {
  if (tab.value === 'gen') genQr()
})
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal qrtool">
      <div class="qt-head">
        <div class="qt-title">🔳 二维码工具箱</div>
        <button class="qt-close" @click="emit('close')">✕</button>
      </div>

      <div class="qt-tabs">
        <button class="qt-tab" :class="{ on: tab === 'gen' }" @click="tab = 'gen'">🧩 生成二维码</button>
        <button class="qt-tab" :class="{ on: tab === 'scan' }" @click="tab = 'scan'">🔍 识别二维码</button>
      </div>

      <!-- 生成 -->
      <template v-if="tab === 'gen'">
        <div class="qt-formats">
          <button class="qt-fmt" :class="{ on: genFormat === 'qr' }" @click="genFormat = 'qr'">🧩 QR 码</button>
          <button class="qt-fmt" :class="{ on: genFormat === 'dm' }" @click="genFormat = 'dm'">🔲 Data Matrix</button>
        </div>
        <label class="qt-label">输入内容（文字 / 网址 / WiFi 字符串，码图实时生成）</label>
        <textarea v-model="genText" class="qt-editor mono-font" rows="4"
          placeholder="例如：https://github.com 或 WIFI:T:WPA;S:WiFi名;P:密码;;"
          @input="onGenInput"></textarea>
        <div class="qt-stage">
          <img v-if="qrData" :src="qrData" class="qt-qr" :class="{ dm: genFormat === 'dm' }" alt="码图" />
          <div v-else class="qt-empty">输入内容后显示{{ genFormat === 'dm' ? 'Data Matrix' : '二维码' }}</div>
        </div>
        <div class="qt-actions">
          <button class="btn" @click="emit('close')">关闭</button>
          <button class="btn" :disabled="!genText.trim()" @click="copyGenText">复制文字</button>
          <button class="btn" :disabled="!qrData" @click="copyGenImage">复制图片</button>
          <button class="btn primary" :disabled="!qrData" @click="saveGenImage">保存图片</button>
        </div>
      </template>

      <!-- 识别 -->
      <template v-else>
        <QrScanButtons @detected="onDetected" />
        <label class="qt-label" style="margin-top:12px">识别结果（可编辑，支持 QR 码与 Data Matrix）
          <span v-if="scanFormat" class="qt-badge">{{ scanFormat }}</span>
          <span v-if="scanFrom" class="qt-from">{{ scanFrom }}</span>
        </label>
        <textarea v-model="scanText" class="qt-editor mono-font" rows="5"
          placeholder="识别到的二维码 / Data Matrix 内容将显示在这里"></textarea>
        <div class="qt-actions">
          <button class="btn" @click="emit('close')">关闭</button>
          <button class="btn" :disabled="!scanText.trim()" @click="copyScanText">复制文字</button>
          <button class="btn" :disabled="!scanText.trim()" @click="searchInVault">🔍 搜索密码库</button>
          <button class="btn primary" :disabled="!scanText.trim()" @click="saveAsEntry">📩 存为密码</button>
        </div>
        <div class="qt-note">「存为密码」会打开接收分享窗口，自动解析账号 / 密码 / 网址 / WiFi 信息。</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.modal.qrtool { max-width: 460px; }
.qt-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.qt-title { font-size: 16px; font-weight: 700; }
.qt-close { border: none; background: transparent; color: var(--muted); font-size: 16px; cursor: pointer; padding: 4px 6px; border-radius: 6px; }
.qt-close:hover { background: var(--panel-2); color: var(--text); }
.qt-tabs { display: flex; gap: 6px; background: var(--panel-2); border-radius: 10px; padding: 4px; margin-bottom: 14px; }
.qt-tab { flex: 1; border: none; background: transparent; color: var(--text-2); font-size: 13px; padding: 8px 4px; border-radius: 8px; cursor: pointer; transition: background 0.14s, color 0.14s, box-shadow 0.14s; }
.qt-tab.on { background: var(--panel); color: var(--text); box-shadow: var(--shadow-sm); font-weight: 600; }
.qt-formats { display: flex; gap: 6px; background: var(--panel-2); border-radius: 10px; padding: 4px; margin-bottom: 12px; }
.qt-fmt { flex: 1; border: none; background: transparent; color: var(--text-2); font-size: 12.5px; padding: 6px 4px; border-radius: 8px; cursor: pointer; transition: background 0.14s, color 0.14s, box-shadow 0.14s; }
.qt-fmt.on { background: var(--panel); color: var(--text); box-shadow: var(--shadow-sm); font-weight: 600; }
.qt-badge { display: inline-block; font-size: 11px; font-weight: 600; color: var(--primary); background: var(--primary-soft); border-radius: 20px; padding: 1px 8px; margin-left: 6px; }
.qt-label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.qt-from { color: var(--primary); margin-left: 6px; }
.qt-editor { width: 100%; min-height: 80px; resize: vertical; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel-2); color: var(--text); font-size: 13px; line-height: 1.7; outline: none; white-space: pre-wrap; word-break: break-all; }
.qt-editor:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.qt-stage { display: flex; align-items: center; justify-content: center; min-height: 200px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-top: 12px; }
.qt-qr { width: 220px; height: 220px; object-fit: contain; border-radius: 8px; background: #fff; }
.qt-qr.dm { width: auto; height: auto; max-width: 100%; max-height: 240px; }
.qt-empty { color: var(--muted); font-size: 13px; }
.qt-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.qt-note { margin-top: 10px; font-size: 11px; color: var(--muted); text-align: center; }
</style>
