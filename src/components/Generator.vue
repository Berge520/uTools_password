<script setup>
import { ref, computed, onMounted } from 'vue'
import { generatePassword } from '../utils/generator'

const emit = defineEmits(['close', 'result'])

const length = ref(16)
const lowercase = ref(true)
const uppercase = ref(true)
const digits = ref(true)
const symbols = ref(false)
const excludeAmbiguous = ref(true)

const password = ref('')
const locked = ref(false)

const strength = computed(() => {
  let pool = 0
  if (lowercase.value) pool += 26
  if (uppercase.value) pool += 26
  if (digits.value) pool += 10
  if (symbols.value) pool += 24
  const entropy = Math.round(length.value * Math.log2(pool || 26))
  if (entropy >= 90) return { label: '很强', color: '#2fbf71' }
  if (entropy >= 60) return { label: '较强', color: '#4f8cff' }
  if (entropy >= 40) return { label: '一般', color: '#e5a13d' }
  return { label: '弱', color: '#e5484d' }
})

function refresh () {
  if (locked.value) return
  password.value = generatePassword({
    length: length.value,
    lowercase: lowercase.value,
    uppercase: uppercase.value,
    digits: digits.value,
    symbols: symbols.value,
    excludeAmbiguous: excludeAmbiguous.value
  })
}

function toggleLock () {
  locked.value = !locked.value
}

function useIt () {
  if (!password.value) return
  emit('result', password.value)
  emit('close')
}

onMounted(refresh)
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <h3>密码生成器</h3>

      <div class="gen-output">
        <span class="gen-text">{{ password }}</span>
        <span class="gen-strength" :style="{ color: strength.color }">
          {{ strength.label }} · {{ length }} 位
        </span>
        <button
          class="gen-lock"
          :class="{ on: locked }"
          :title="locked ? '已锁定，点击解锁' : '锁定（防止重新生成覆盖）'"
          @click="toggleLock"
        >{{ locked ? '🔒' : '🔓' }}</button>
        <button class="btn icon sm" title="重新生成" :disabled="locked" @click="refresh">↻</button>
      </div>

      <div v-if="locked" class="gen-locked-hint">已锁定，重新生成与调整参数已被禁用，当前密码不会被覆盖。</div>

      <div class="gen-body" :class="{ locked }">
        <div class="gen-row">
          <label>长度</label>
          <input v-model.number="length" class="input gen-length" type="number" min="4" max="64" :disabled="locked" />
          <input v-model.number="length" class="slider" type="range" min="4" max="64" :disabled="locked" />
          <span class="gen-num">{{ length }}</span>
        </div>

        <label class="check">
          <input v-model="lowercase" type="checkbox" :disabled="locked" /> 小写字母 (a-z)
        </label>
        <label class="check">
          <input v-model="uppercase" type="checkbox" :disabled="locked" /> 大写字母 (A-Z)
        </label>
        <label class="check">
          <input v-model="digits" type="checkbox" :disabled="locked" /> 数字 (0-9)
        </label>
        <label class="check">
          <input v-model="symbols" type="checkbox" :disabled="locked" /> 符号 (!$&amp;…)
        </label>
        <label class="check">
          <input v-model="excludeAmbiguous" type="checkbox" :disabled="locked" /> 剔除易混淆字符 (0O1lI)
        </label>
      </div>

      <div class="modal-actions">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn primary" :disabled="!password" @click="useIt">使用此密码</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gen-output {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 16px;
}

.gen-text {
  flex: 1;
  font-family: var(--mono-font);
  font-variant-ligatures: none;
  font-feature-settings: 'zero' 1;
  font-size: 14px;
  word-break: break-all;
  user-select: all;
}

.gen-strength {
  font-size: 12px;
  white-space: nowrap;
}

.gen-lock {
  border: none;
  background: transparent;
  font-size: 16px;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 6px;
  transition: background 0.14s, transform 0.14s;
}

.gen-lock:hover {
  background: var(--panel-2);
  transform: scale(1.08);
}

.gen-lock.on {
  color: var(--warning);
}

.gen-locked-hint {
  font-size: 12px;
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  border-radius: 8px;
  padding: 8px 10px;
  margin: -8px 0 12px;
}

.gen-body.locked {
  opacity: 0.6;
}

.gen-body.locked .check {
  cursor: not-allowed;
}

.gen-body.locked .check input,
.gen-body.locked input:disabled {
  cursor: not-allowed;
}

.gen-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.gen-row label {
  font-size: 13px;
  color: var(--muted);
  min-width: 34px;
}

.gen-length {
  width: 60px;
  text-align: center;
}

.slider {
  flex: 1;
  accent-color: var(--primary);
}

.gen-num {
  min-width: 22px;
  text-align: right;
  color: var(--muted);
  font-size: 12px;
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 5px 0;
  cursor: pointer;
  user-select: none;
}

.check input {
  accent-color: var(--primary);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
</style>
