<script setup>
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { store, initialize, lock, touchSession } from './store/vault'
import { toast, showToast } from './utils/toast'
import { loadTheme } from './store/theme'
import VaultView from './views/VaultView.vue'
import LockScreen from './components/LockScreen.vue'

// ---------- uTools sub-input ----------
let subInputActive = false

function setupSubInput () {
  if (!window.utools || !window.utools.setSubInput || subInputActive) return
  if (!store.quickSearch) return
  subInputActive = true
  window.utools.setSubInput(({ text }) => {
    store.initialSearch = text || ''
  }, '搜索密码…')
}

function removeSubInput () {
  if (subInputActive && window.utools && window.utools.removeSubInput) {
    window.utools.removeSubInput()
  }
  subInputActive = false
  store.initialSearch = ''
}

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
    // 插件命令词（与 plugin.json cmds 一致），进入时需排除这些词
    const CMDS = ['我的密码', '密码管理', '密码本', 'password', '二维码', '扫码', '数据矩阵']
    window.utools.onPluginEnter((action) => {
      initialize()
      armIdleLock()
      const code = action && action.code
      // 匹配指令入口：根据 code 路由到不同功能
      if (code === 'find-password') {
        // 网址匹配 → 直接搜索对应密码
        store.initialSearch = (action.payload || '').trim()
        setupSubInput()
      } else if (code === 'import-file') {
        // 文件匹配 → 触发导入
        store.pendingAction = { type: 'import', payload: action.payload }
      } else if (code === 'decode-qr') {
        // 图片匹配 → 打开二维码工具箱识别
        store.pendingAction = { type: 'decode-qr', payload: action.payload }
      } else if (code === 'qr-tool') {
        // 功能指令「二维码 / 扫码」→ 打开二维码工具箱
        store.pendingAction = { type: 'open-qrtool' }
      } else {
        // 主功能（vault）：快速搜索
        if (action && action.type === 'text' && action.payload && store.quickSearch) {
          const q = action.payload.trim()
          if (q && !CMDS.includes(q.toLowerCase())) {
            store.initialSearch = q
          }
        }
        setupSubInput()
      }
    })
    window.utools.onPluginOut(() => {
      removeSubInput()
      clearIdleTimer()
      lock(true)
    })
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
  // 快速搜索开关变化时，动态添加/移除 sub-input
  watch(() => store.quickSearch, (on) => {
    if (on) setupSubInput()
    else removeSubInput()
  })
})

onBeforeUnmount(() => {
  removeSubInput()
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
