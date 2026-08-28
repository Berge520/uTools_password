<script setup>
import { ref } from 'vue'
import { store, unlock } from '../store/vault'

const pw = ref('')
const busy = ref(false)

function doUnlock () {
  if (!pw.value || busy.value) return
  busy.value = true
  const res = unlock(pw.value)
  if (!res.ok) {
    busy.value = false
    pw.value = ''
  }
}
</script>

<template>
  <div class="lock">
    <div class="lock-card">
      <div class="lock-logo">🔐</div>
      <h2>密码库已锁定</h2>
      <p class="lock-sub">输入主密码以解锁本地加密数据</p>

      <input
        v-model="pw"
        class="input lock-input"
        type="password"
        placeholder="主密码"
        autofocus
        @keyup.enter="doUnlock"
      />

      <div v-if="store.unlockError" class="lock-error">{{ store.unlockError }}</div>

      <button class="btn primary unlock-btn" :disabled="!pw || busy" @click="doUnlock">
        解锁
      </button>

      <p class="lock-note">主密码无法找回，请务必牢记</p>
    </div>
  </div>
</template>

<style scoped>
.lock {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.lock-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 32px 30px;
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: pop 0.2s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

@keyframes pop {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
}

.lock-logo {
  width: 60px;
  height: 60px;
  border-radius: 18px;
  background: var(--primary-grad);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  margin-bottom: 18px;
  box-shadow: 0 10px 24px color-mix(in srgb, var(--primary) 42%, transparent);
}

.lock-card h2 {
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 700;
}

.lock-sub {
  margin: 0 0 22px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
  line-height: 1.5;
}

.lock-input {
  text-align: center;
}

.unlock-btn {
  margin-top: 14px;
  width: 100%;
  height: 40px;
}

.lock-error {
  margin-top: 12px;
  color: var(--danger);
  font-size: 13px;
  text-align: center;
}

.lock-note {
  margin-top: 22px;
  color: var(--muted);
  font-size: 12px;
}
</style>
