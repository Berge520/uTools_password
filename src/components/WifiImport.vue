<script setup>
import { ref, computed, onMounted } from 'vue'
import QRCode from 'qrcode'
import { store, addEntries, addGroup } from '../store/vault'
import ImportDestination from './ImportDestination.vue'
import { showToast } from '../utils/toast'

defineProps({
  defaultGroupId: { type: String, default: null }
})

const emit = defineEmits(['close'])

const loading = ref(true)
const progress = ref('')
const error = ref('')
const list = ref([])        // [{ name, password }]
const selected = ref({})    // name -> true
const busy = ref(false)
const targetGroupId = ref(null)

const importDestOpen = ref(false)
const importPending = ref([])

// WiFi 分享
const shareWifi = ref(null)
const shareQr = ref('')
const shareText = ref('')

const newGroupOpen = ref(false)
const newGroupName = ref('')

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
  window.utools.copyText(w.password)
  showToast('已复制')
}

function importSelected () {
  const rows = list.value.filter((w) => selected.value[w.name] && w.password)
  if (!rows.length) { showToast('请至少勾选一个含密码的 WiFi'); return }
  importPending.value = rows
  importDestOpen.value = true
}

function onImportConfirm (dest) {
  const rows = importPending.value
  let gid = null
  if (dest.mode === 'current') gid = targetGroupId.value || null
  else if (dest.mode === 'group') gid = dest.groupId || null
  else gid = null // file / all
  const entries = rows.map((w) => ({ title: w.name, username: '', password: w.password, url: '', groupId: gid, isWifi: true }))
  addEntries(entries)
  importDestOpen.value = false
  importPending.value = []
  showToast(`已导入 ${entries.length} 个 WiFi 密码`)
  emit('close')
}

function createNewGroup () {
  const name = newGroupName.value.trim()
  if (!name) { showToast('请输入分组名称'); return }
  const g = addGroup(name, null)
  targetGroupId.value = g.id
  newGroupOpen.value = false
  newGroupName.value = ''
  showToast('已新建分组')
}

// ---- WiFi 分享：复制文字 / 扫码直连二维码 ----
function escapeWifi (s) {
  return String(s || '').replace(/([\\;,:"])/g, '\\$1')
}
function wifiQrPayload (w) {
  const type = w.password ? 'WPA' : 'nopass'
  return `WIFI:T:${type};S:${escapeWifi(w.name)};P:${w.password ? escapeWifi(w.password) : ''};;`
}
async function openShare (w) {
  shareWifi.value = w
  shareText.value = `WiFi：${w.name}\n密码：${w.password || '（无密码）'}`
  shareQr.value = ''
  try {
    shareQr.value = await QRCode.toDataURL(wifiQrPayload(w), {
      width: 300, margin: 2, errorCorrectionLevel: 'M',
      color: { dark: '#1c2230', light: '#ffffff' }
    })
  } catch (e) { showToast('二维码生成失败') }
}
function copyShareText () {
  if (!shareText.value) return
  window.utools.copyText(shareText.value)
  showToast('已复制')
}
function copyShareQr () {
  if (!shareQr.value) return
  window.utools.copyImage(shareQr.value)
  showToast('二维码已复制')
}
function saveShareQr () {
  if (!shareQr.value) return
  const p = window.utools.showSaveDialog({ title: '保存 WiFi 二维码', defaultPath: `${shareWifi.value && shareWifi.value.name}.png` })
  if (!p) return
  window.services.saveImage(p, shareQr.value)
  showToast('已保存')
  window.utools.shellShowItemInFolder(p)
}

onMounted(load)
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal wifi">
      <h3>WiFi 密码</h3>
      <p class="wifi-sub">{{ platformHint || '读取本机已保存的 WiFi 配置，可勾选导入到插件。' }}</p>

      <div v-if="loading" class="wifi-loading">{{ progress ? '正在读取密码 ' + progress + ' …' : '正在读取…' }}</div>
      <div v-else-if="error" class="wifi-error">{{ error }}</div>

      <template v-else>
        <div class="wifi-group">
          <label>预设分区</label>
          <select v-model="targetGroupId" class="input mono-select">
            <option :value="null">未分组</option>
            <option v-for="g in store.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
          <button v-if="!newGroupOpen" class="btn sm" @click="newGroupOpen = true">＋ 新建</button>
        </div>
        <div v-if="newGroupOpen" class="wifi-new">
          <input v-model="newGroupName" class="input mono-font" placeholder="新分组名称" autofocus @keyup.enter="createNewGroup" />
          <button class="btn sm primary" @click="createNewGroup">确定</button>
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
        <button class="btn primary" :disabled="loading || !selectedCount || busy" @click="importSelected">导入所选到插件</button>
      </div>
    </div>

    <!-- 导入目标 -->
    <ImportDestination
      v-if="importDestOpen"
      title="导入 WiFi 密码"
      :count="importPending.length"
      :current-group-name="(targetGroupId && store.groups.find(g=>g.id===targetGroupId) && store.groups.find(g=>g.id===targetGroupId).name) || '未分组'"
      @close="importDestOpen = false"
      @confirm="onImportConfirm"
    />

    <!-- WiFi 分享弹窗 -->
    <div v-if="shareWifi" class="modal-mask" @click.self="shareWifi = null">
      <div class="modal wifiq">
        <h3>分享「{{ shareWifi.name }}」</h3>
        <div class="wifiq-stage">
          <img v-if="shareQr" :src="shareQr" class="wifiq-img" alt="WiFi 二维码" />
          <div v-else class="wifiq-empty">生成中…</div>
        </div>
        <div class="wifiq-hint">手机相机 / 扫码器识别即可直连 WiFi（WPA/WPA2 / 免密）。</div>
        <div class="wifiq-text mono-font">{{ shareText }}</div>
        <div class="modal-actions">
          <button class="btn" @click="shareWifi = null">关闭</button>
          <button class="btn" @click="copyShareText">复制文字</button>
          <button class="btn" :disabled="!shareQr" @click="copyShareQr">复制二维码</button>
          <button class="btn primary" :disabled="!shareQr" @click="saveShareQr">保存二维码</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal.wifi { max-width: 560px; }
.wifi-sub, .wifiq-hint { margin: -4px 0 16px; font-size: 12px; color: var(--muted); line-height: 1.5; }
.wifi-group { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.wifi-group label { font-size: 13px; color: var(--text-2); flex-shrink: 0; }
.mono-select { font-family: var(--mono-font); font-variant-ligatures: none; font-feature-settings: "zero" 1; }
.wifi-new { display: flex; gap: 8px; margin: -6px 0 12px; }
.wifi-new .input { flex: 1; }
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
.modal.wifiq { max-width: 360px; text-align: center; }
.wifiq-stage { display: flex; align-items: center; justify-content: center; min-height: 220px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-bottom: 10px; }
.wifiq-img { width: 220px; height: 220px; border-radius: 8px; background: #fff; }
.wifiq-empty { color: var(--muted); font-size: 13px; }
.wifiq-hint { margin: 0 0 10px; }
.wifiq-text { text-align: left; background: var(--panel-2); border-radius: 8px; padding: 10px 12px; font-size: 13px; line-height: 1.8; white-space: pre-wrap; word-break: break-all; margin-bottom: 12px; }
</style>