<script setup>
import { ref } from 'vue'
import { decodeQrFromDataUrl, normalizeImageBase64 } from '../utils/qrScan'
import { parseOtpauth, isValidSecret } from '../utils/totp'

const emit = defineEmits(['close', 'result'])

const busy = ref(false)
const source = ref('') // data URL 预览
const decoded = ref(null) // { raw, otp, text }
const error = ref('')

function applyResult (result) {
  emit('result', result)
  emit('close')
}

async function recognize (dataUrl) {
  if (!dataUrl) return
  busy.value = true
  error.value = ''
  decoded.value = null
  source.value = dataUrl
  try {
    const qr = await decodeQrFromDataUrl(dataUrl)
    if (!qr || !qr.data) {
      error.value = '未识别到二维码，请换更清晰的截图或图片重试。'
      return
    }
    const raw = qr.data
    const otp = parseOtpauth(raw)
    decoded.value = {
      raw,
      otp,
      text: !otp ? raw : ''
    }
  } catch (e) {
    error.value = '识别出错：' + (e && e.message ? e.message : e)
  } finally {
    busy.value = false
  }
}

function pickImage () {
  const files = window.utools.showOpenDialog({
    title: '选择二维码图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }]
  })
  if (!files || !files[0]) return
  try {
    const dataUrl = window.services.readImageBase64(files[0])
    recognize(dataUrl)
  } catch (e) {
    error.value = '读取图片失败：' + (e && e.message ? e.message : e)
  }
}

function captureScreen () {
  busy.value = true
  error.value = ''
  decoded.value = null
  window.utools.screenCapture((imgBase64) => {
    // 用户取消截图时可能返回空
    if (!imgBase64) {
      busy.value = false
      return
    }
    recognize(normalizeImageBase64(imgBase64))
  })
}

function useIt () {
  if (!decoded.value) return
  if (decoded.value.otp) {
    applyResult({ raw: decoded.value.raw, otp: decoded.value.otp })
  } else {
    // 纯文本：若是合法密钥则按 otp 应用，否则作为文本
    if (isValidSecret(decoded.value.text)) {
      applyResult({ raw: decoded.value.text, otp: parseOtpauth(decoded.value.text) })
    } else {
      applyResult({ raw: decoded.value.text, otp: null })
    }
  }
}

function copyRaw () {
  if (decoded.value) {
    window.utools.copyText(decoded.value.raw)
  }
}

function mask (s) {
  if (!s) return ''
  return s.length <= 8 ? s : s.slice(0, 4) + '…' + s.slice(-4)
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal qr">
      <h3>识别二维码</h3>

      <div class="qr-actions">
        <button class="btn primary" :disabled="busy" @click="pickImage">🖼 选择图片</button>
        <button class="btn" :disabled="busy" @click="captureScreen">🖱 截取屏幕区域</button>
      </div>

      <div class="qr-body">
        <div v-if="source" class="qr-preview">
          <img :src="source" alt="二维码" />
        </div>
        <div v-else class="qr-placeholder">
          支持上传本地二维码图片，或框选屏幕区域，离线识别。
        </div>

        <div v-if="busy" class="qr-status">识别中…</div>
        <div v-if="error" class="qr-error">{{ error }}</div>

        <div v-if="decoded" class="qr-result">
          <template v-if="decoded.otp">
            <div class="qr-badge ok">✅ 已识别为两步验证密钥</div>
            <div class="qr-line">
              <span class="qr-k">账号</span>
              <span class="qr-v">{{ decoded.otp.account || decoded.otp.issuer || '—' }}</span>
            </div>
            <div class="qr-line">
              <span class="qr-k">密钥</span>
              <span class="qr-v mono">{{ mask(decoded.otp.secret) }}</span>
            </div>
            <div class="qr-line">
              <span class="qr-k">参数</span>
              <span class="qr-v">{{ decoded.otp.algorithm.toUpperCase() }} / {{ decoded.otp.period }}s / {{ decoded.otp.digits }} 位</span>
            </div>
            <button class="btn primary qr-apply" @click="useIt">应用到表单</button>
          </template>
          <template v-else>
            <div class="qr-badge">📄 识别到文本</div>
            <div class="qr-text mono">{{ decoded.text }}</div>
            <div class="qr-actions">
              <button class="btn" @click="copyRaw">复制内容</button>
              <button class="btn primary" @click="useIt">作为密钥应用</button>
            </div>
          </template>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn" @click="emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal.qr {
  max-width: 460px;
}

.qr-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}

.qr-body {
  min-height: 120px;
}

.qr-preview {
  display: flex;
  justify-content: center;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 12px;
}

.qr-preview img {
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
  border-radius: 6px;
}

.qr-placeholder {
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  padding: 26px 12px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  line-height: 1.6;
}

.qr-status {
  margin-top: 10px;
  font-size: 13px;
  color: var(--primary);
}

.qr-error {
  margin-top: 10px;
  font-size: 13px;
  color: var(--danger);
}

.qr-result {
  margin-top: 12px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.qr-badge {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--panel-2);
}

.qr-badge.ok {
  background: rgba(47, 191, 113, 0.12);
  color: #2fbf71;
}

.qr-line {
  display: flex;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 6px;
}

.qr-k {
  width: 44px;
  color: var(--muted);
  flex-shrink: 0;
}

.qr-v {
  flex: 1;
  word-break: break-all;
}

.mono {
  font-family: var(--mono-font);
  font-variant-ligatures: none;
  font-feature-settings: 'zero' 1;
}

.qr-text {
  font-size: 12px;
  word-break: break-all;
  max-height: 120px;
  overflow: auto;
  background: var(--panel-2);
  padding: 8px 10px;
  border-radius: 8px;
  margin-bottom: 10px;
}

.qr-apply {
  margin-top: 10px;
  width: 100%;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
</style>
