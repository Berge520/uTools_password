<script setup>
import { ref, computed, onMounted } from 'vue'
import { store, addEntries } from '../store/vault'
import ImportDestination from './ImportDestination.vue'
import GroupPicker from './GroupPicker.vue'
import ShareDialog from './ShareDialog.vue'
import { showToast } from '../utils/toast'
import { copyText } from '../utils/clipboard'

const props = defineProps({
  defaultGroupId: { type: String, default: null }
})

const emit = defineEmits(['close'])

const loading = ref(true)
const progress = ref('')
const error = ref('')
const list = ref([])        // [{ name, password }]
const selected = ref({})    // name -> true
const targetGroupId = ref(props.defaultGroupId || null)

const importDestOpen = ref(false)
const importPending = ref([])

// WiFi 分享：复用通用分享弹窗（文字 / 二维码 / 直连二维码）
const shareRow = ref(null)
const shareEntry = computed(() =>
  shareRow.value
    ? { title: shareRow.value.name, password: shareRow.value.password, isWifi: true }
    : null
)

const platform = (window.services && window.services.wifiPlatform) ? window.services.wifiPlatform() : 'unknown'
const platformHint = {
  windows: '通过 netsh 读取本机已保存的 WiFi 配置。',
  macos: '通过系统钥匙串读取；首次可能弹出授权，请在“允许”后重试。',
  linux: '通过 nmcli（NetworkManager）读取；通常需要以 root 运行，否则密码可能为空。'
}[platform] || ''

const yieldFrame = () => new Promise((r) => setTimeout(r, 0))
const selectedCount = computed(() => Object.keys(selected.value).length)

function selectAll () { list.value.forEach((w) => { selected.value[w.name] = true }) }
function unselectAll () { selected.value = {} }
function invertSelect () {
  list.value.forEach((w) => { if (selected.value[w.name]) delete selected.value[w.name]; else selected.value[w.name] = true })
}
function toggle (name) {
  if (selected.value[name]) delete selected.value[name]
  else selected.value[name] = true
}

async function load () {
  loading.value = true
  error.value = ''
  progress.value = ''
  try {
    if (window.services.shellAvailable && !window.services.shellAvailable()) {
      error.value = '当前 uTools 环境不允许执行系统命令（child_process 受限）。' +
        (window.services.shellError ? (window.services.shellError() ? '\n' + window.services.shellError() : '') : '')
      loading.value = false
      return
    }
    const names = (await window.services.listWifiProfiles()) || []
    const rows = names.map((name) => ({ name, password: '' }))
    list.value = rows
    rows.forEach((w) => { selected.value[w.name] = true })
    if (!rows.length) {
      const raw = window.services.wifiRaw ? window.services.wifiRaw() : ''
      error.value = '未找到 WiFi 配置文件。' + (raw ? '\n\n命令输出（诊断）：\n' + raw.slice(0, 600) : '')
      loading.value = false
      return
    }
    let n = 0
    for (const w of rows) {
      w.password = (await window.services.getWifiPassword(w.name)) || ''
      n++
      progress.value = `${n}/${rows.length}`
      if (n % 2 === 0) await yieldFrame()
    }
  } catch (e) {
    error.value = '读取失败：' + (e && e.message ? e.message : e)
  } finally {
    loading.value = false
    progress.value = ''
  }
}

function copyPass (w) {
  if (!w.password) return
  copyText(w.password, { label: '密码' })
}

function importSelected () {
  const rows = list.value.filter((w) => selected.value[w.name] && w.password)
  if (!rows.length) { showToast('请至少勾选一个含密码的 WiFi'); return }
  // 已在上方选好分组：直接导入，不再弹目的地选择
  if (targetGroupId.value) {
    doImport(rows, targetGroupId.value)
    return
  }
  importPending.value = rows
  importDestOpen.value = true
}

function doImport (rows, gid) {
  const entries = rows.map((w) => ({ title: w.name, username: '', password: w.password, url: '', groupId: gid, isWifi: true }))
  addEntries(entries)
  importDestOpen.value = false
  importPending.value = []
  showToast(`已导入 ${entries.length} 个 WiFi 密码`)
  emit('close')
}

function onImportConfirm (dest) {
  let gid = null
  if (dest.mode === 'current') gid = targetGroupId.value || null
  else if (dest.mode === 'group') gid = dest.groupId || null
  else gid = null // file / all
  doImport(importPending.value, gid)
}

// ---- WiFi 分享：复用通用分享弹窗 ----
function openShare (w) {
  shareRow.value = w
}

onMounted(load)
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal wifi">
      <h3>本机 WiFi 密码</h3>
      <p class="wifi-sub">{{ platformHint || '读取本机已保存的 WiFi 配置，可勾选导入到密码库。' }}</p>

      <div v-if="loading" class="wifi-loading">{{ progress ? '正在读取密码 ' + progress + ' …' : '正在读取…' }}</div>
      <div v-else-if="error" class="wifi-error">{{ error }}</div>

      <template v-else>
        <div class="wifi-group">
          <label>导入到分组</label>
          <GroupPicker v-model="targetGroupId" class="wifi-group-picker" />
          <span v-if="!targetGroupId" class="wifi-group-hint">未选分组时，导入前可选择目标</span>
        </div>

        <div class="wifi-bar">
          <span class="wifi-count">已选 <b>{{ selectedCount }}</b> / {{ list.length }}</span>
          <div class="wifi-actions">
            <button class="btn sm" @click="selectAll">全选</button>
            <button class="btn sm" @click="unselectAll">全不选</button>
            <button class="btn sm" @click="invertSelect">反选</button>
          </div>
        </div>

        <div class="wifi-list">
          <div v-for="w in list" :key="w.name" class="wifi-row">
            <label class="wifi-check">
              <input type="checkbox" :checked="!!selected[w.name]" @change="toggle(w.name)" />
              <span class="wifi-name mono-font">{{ w.name }}</span>
            </label>
            <span class="wifi-pass mono-font" :class="{ empty: !w.password }">{{ w.password || '—' }}</span>
            <button v-if="w.password" class="row-btn" title="复制密码" @click="copyPass(w)">⧉</button>
            <button v-if="w.password" class="row-btn share-btn" title="分享（文字/扫码连接）" @click="openShare(w)">📤</button>
          </div>
        </div>
        <div class="wifi-note">「📤」分享可复制文字或生成手机扫码直连二维码；未读到密码时请以管理员身份运行 uTools 后重试。</div>
      </template>

      <div class="modal-actions">
        <button class="btn" @click="emit('close')">关闭</button>
        <button class="btn primary" :disabled="loading || !selectedCount" @click="importSelected">导入所选到密码库</button>
      </div>
    </div>

    <!-- 导入目标 -->
    <ImportDestination
      v-if="importDestOpen"
      title="导入本机 WiFi 密码"
      :count="importPending.length"
      :current-group-name="(targetGroupId && store.groups.find(g=>g.id===targetGroupId) && store.groups.find(g=>g.id===targetGroupId).name) || '未分组'"
      @close="importDestOpen = false"
      @confirm="onImportConfirm"
    />

    <!-- 分享（文字 / 二维码 / WiFi 直连） -->
    <ShareDialog v-if="shareEntry" :entry="shareEntry" @close="shareRow = null" />
  </div>
</template>

<style scoped>
.modal.wifi { max-width: 560px; }
.wifi-sub { margin: -4px 0 16px; font-size: 12px; color: var(--muted); line-height: 1.5; }
.wifi-group { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.wifi-group label { font-size: 13px; color: var(--text-2); flex-shrink: 0; }
.wifi-group-picker { flex: 1; min-width: 0; }
.wifi-group-hint { font-size: 11px; color: var(--muted); white-space: nowrap; }
.wifi-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.wifi-count { font-size: 13px; color: var(--text-2); }
.wifi-count b { color: var(--primary); }
.wifi-actions { display: flex; gap: 6px; }
.wifi-list { max-height: 300px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; padding: 4px; margin-bottom: 8px; }
.wifi-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; }
.wifi-row:hover { background: var(--panel-2); }
.wifi-check { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; cursor: pointer; }
.wifi-check input { accent-color: var(--primary); }
.wifi-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.wifi-pass { font-size: 13px; color: var(--text); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wifi-pass.empty { color: var(--muted); }
.row-btn { border: none; background: transparent; color: var(--muted); cursor: pointer; font-size: 13px; padding: 4px 5px; border-radius: 6px; flex-shrink: 0; }
.row-btn:hover { background: var(--border-2); color: var(--text); }
.share-btn { font-size: 14px; }
.wifi-note { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
.wifi-loading, .wifi-error { padding: 30px 10px; text-align: center; color: var(--muted); font-size: 13px; }
.wifi-error { color: var(--danger); white-space: pre-wrap; word-break: break-word; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
</style>