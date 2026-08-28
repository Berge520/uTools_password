<script setup>
import { onMounted } from 'vue'
import { store, initialize, lock } from './store/vault'
import { toast } from './utils/toast'
import { loadTheme } from './store/theme'
import VaultView from './views/VaultView.vue'
import LockScreen from './components/LockScreen.vue'

onMounted(() => {
  loadTheme()
  window.utools.onPluginEnter(() => initialize())
  window.utools.onPluginOut(() => lock())
  initialize()
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
