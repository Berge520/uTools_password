<script setup>
import { ref } from 'vue'
import { pickAndDecodeQr, captureAndDecodeQr, readClipboardContent } from '../utils/qrScan'

// 识别成功后抛出文本、来源与码制（from: 图片 | 屏幕截图 | 剪贴板；format: QR 码 | Data Matrix）；失败 / 取消不抛事件
const emit = defineEmits(['detected'])

const busy = ref(false)
const failHint = ref('')

async function fromClipboard () {
  busy.value = true
  failHint.value = ''
  try {
    const r = await readClipboardContent()
    if (r.ok) {
      handle(r.text, '剪贴板', r.format)
      return
    }
    failHint.value = r.reason === 'no-qr-in-image'
      ? '剪贴板是图片，但其中未识别到二维码 / Data Matrix'
      : '剪贴板没有文字或图片内容'
  } finally {
    busy.value = false
  }
}

async function fromImage () {
  busy.value = true
  failHint.value = ''
  try {
    const res = await pickAndDecodeQr()
    if (!res) return // 用户取消
    handle(res.data, '图片', res.format)
  } finally {
    busy.value = false
  }
}

function fromScreen () {
  busy.value = true
  failHint.value = ''
  captureAndDecodeQr((res) => {
    busy.value = false
    if (!res) {
      failHint.value = '未识别到二维码或 Data Matrix，请换更清晰的截图重试。'
      return
    }
    handle(res.data, '屏幕截图', res.format)
  })
}

function handle (text, from, format) {
  failHint.value = ''
  emit('detected', text, from, format)
}
</script>

<template>
  <div class="qr-scan-btns">
    <button class="btn sm" :disabled="busy" @click="fromClipboard">📋 剪贴板</button>
    <button class="btn sm" :disabled="busy" @click="fromImage">📷 选择图片</button>
    <button class="btn sm" :disabled="busy" @click="fromScreen">🖱 截取屏幕区域</button>
    <span v-if="busy" class="qsb-busy">识别中…</span>
    <span v-if="failHint" class="qsb-fail">{{ failHint }}</span>
  </div>
</template>

<style scoped>
.qr-scan-btns {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.qsb-busy {
  font-size: 12px;
  color: var(--primary);
}
.qsb-fail {
  font-size: 12px;
  color: var(--danger);
  line-height: 1.5;
}
</style>
