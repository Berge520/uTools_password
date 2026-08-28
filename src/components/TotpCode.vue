<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { showToast } from '../utils/toast'

const props = defineProps({
  otp: { type: Object, required: true } // { secret, period, digits, algorithm }
})

const code = ref('')
const remaining = ref(0)
const period = ref(30)
const expired = ref(false)

let timer = null
let lastStep = -1

function tick () {
  const now = Math.floor(Date.now() / 1000)
  const step = Math.floor(now / period.value)
  remaining.value = period.value - (now % period.value)
  expired.value = remaining.value <= 0
  if (step !== lastStep) {
    lastStep = step
    code.value = window.services.generateTotp(
      props.otp.secret,
      period.value,
      props.otp.digits || 6,
      props.otp.algorithm || 'sha1'
    )
  }
}

function sync () {
  period.value = props.otp.period || 30
  lastStep = -1
  tick()
}

function copy () {
  if (!code.value) return
  window.utools.copyText(code.value)
  showToast('动态码已复制，15秒后自动清除')
  setTimeout(() => window.utools.copyText(''), 15000)
}

onMounted(() => {
  sync()
  timer = setInterval(tick, 1000)
})

onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="row">
    <span class="row-label">动态码</span>
    <span
      class="totp-code"
      :class="{ expired }"
      :title="code ? '双击复制动态码' : ''"
      @dblclick="copy"
    >{{ code || '无效密钥' }}</span>
    <span class="totp-count">{{ remaining }}s</span>
    <div class="totp-bar">
      <div class="totp-fill" :style="{ width: (remaining / period) * 100 + '%' }"></div>
    </div>
    <button class="row-btn" title="复制动态码" @click="copy">⧉</button>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.row-label {
  width: 36px;
  color: var(--muted);
  font-size: 12px;
  flex-shrink: 0;
}

.row-btn {
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 4px 5px;
  border-radius: 6px;
  transition: background 0.14s, color 0.14s;
  flex-shrink: 0;
}

.row-btn:hover {
  background: var(--panel-2);
  color: var(--text);
}

.totp-code {
  flex: 1;
  font-family: var(--mono-font);
  font-variant-ligatures: none;
  font-feature-settings: 'zero' 1;
  font-size: 14px;
  letter-spacing: 3px;
  color: var(--primary);
  cursor: pointer;
  border-radius: 6px;
  padding: 2px 4px;
  margin: -2px -4px;
  transition: background 0.14s;
}

.totp-code:hover {
  background: var(--panel-2);
}

.totp-code.expired {
  color: var(--danger);
}

.totp-count {
  font-size: 12px;
  color: var(--muted);
  min-width: 30px;
  text-align: right;
}

.totp-bar {
  width: 56px;
  height: 4px;
  background: var(--panel-2);
  border-radius: 2px;
  overflow: hidden;
  flex-shrink: 0;
}

.totp-fill {
  height: 100%;
  background: var(--primary);
  transition: width 1s linear;
}

.copy-btn {
  flex-shrink: 0;
}
</style>
