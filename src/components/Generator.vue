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
  password.value = generatePassword({
    length: length.value,
    lowercase: lowercase.value,
    uppercase: uppercase.value,
    digits: digits.value,
    symbols: symbols.value,
    excludeAmbiguous: excludeAmbiguous.value
  })
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
        <button class="btn icon sm" title="重新生成" @click="refresh">↻</button>
      </div>

      <div class="gen-body">
        <div class="gen-row">
          <label>长度</label>
          <input v-model.number="length" class="input gen-length" type="number" min="4" max="64" />
          <input v-model.number="length" class="slider" type="range" min="4" max="64" />
          <span class="gen-num">{{ length }}</span>
        </div>

        <label class="check">
          <input v-model="lowercase" type="checkbox" /> 小写字母 (a-z)
        </label>
        <label class="check">
          <input v-model="uppercase" type="checkbox" /> 大写字母 (A-Z)
        </label>
        <label class="check">
          <input v-model="digits" type="checkbox" /> 数字 (0-9)
        </label>
        <label class="check">
          <input v-model="symbols" type="checkbox" /> 符号 (!$&amp;…)
        </label>
        <label class="check">
          <input v-model="excludeAmbiguous" type="checkbox" /> 剔除易混淆字符 (0O1lI)
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
