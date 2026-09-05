<script setup>
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { store, initialize, lock, touchSession } from './store/vault'
import { toast, showToast } from './utils/toast'
import { loadTheme } from './store/theme'
import VaultView from './views/VaultView.vue'
import LockScreen from './components/LockScreen.vue'

// ---------- 空闲自动锁定 ----------
let idleTimer = null
let lastEvent = 0

function clearIdleTimer () {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

function armIdleLock () {
  clearIdleTimer()
  if (!store.secured || store.locked) return
  const minutes = store.autoLockMinutes
  if (!minutes || minutes <= 0) return
  // 有活动就刷新宽限期会话（重进免输密码）
  touchSession()
  idleTimer = setTimeout(() => {
    lock()
    showToast('长时间未操作，已锁定')
    idleTimer = null
  }, minutes * 60 * 1000)
}

function onActivity () {
  const now = Date.now()
  if (now - lastEvent > 1000) {
    lastEvent = now
    armIdleLock()
  }
}

onMounted(() => {
  loadTheme()
  // 非 uTools 环境（浏览器直接打开 dev 页面）下无此 API，跳过生命周期挂载
  if (window.utools && window.utools.onPluginEnter) {
    window.utools.onPluginEnter(() => { initialize(); armIdleLock() })
    window.utools.onPluginOut(() => { clearIdleTimer(); lock(true) })
  }

  initialize()
  window.addEventListener('mousemove', onActivity)
  window.addEventListener('keydown', onActivity)
  window.addEventListener('mousedown', onActivity)
  window.addEventListener('scroll', onActivity, true)
  armIdleLock()

  // 解锁后立即开始计时；更改自动锁定时长也重新计时
  watch(() => store.locked, (locked) => {
    if (locked) clearIdleTimer()
    else armIdleLock()
  })
  watch(() => store.autoLockMinutes, () => armIdleLock())
})

onBeforeUnmount(() => {
  clearIdleTimer()
  window.removeEventListener('mousemove', onActivity)
  window.removeEventListener('keydown', onActivity)
  window.removeEventListener('mousedown', onActivity)
  window.removeEventListener('scroll', onActivity, true)
})
</script>

<template>
  <div class="app-root">
    <div v-if="store.bootNotice" class="boot-notice">{{ store.bootNotice }}</div>
    <LockScreen v-if="store.secured && store.locked" />
    <VaultView v-else-if="store.ready && !store.bootNotice" />

    <div class="toast" :class="{ show: toast.visible }">{{ toast.message }}</div>
  </div>
</template>

<style scoped>
.app-root {
  height: 100%;
}

.boot-notice {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9998;
  background: rgba(229, 161, 61, 0.14);
  color: #e5a13d;
  border-bottom: 1px solid rgba(229, 161, 61, 0.3);
  padding: 10px 16px;
  font-size: 13px;
}
</style>
