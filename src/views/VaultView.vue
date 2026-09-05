<script setup>
import { ref, computed, defineAsyncComponent, onMounted, onBeforeUnmount } from 'vue'
import {
  store,
  addEntry,
  addEntries,
  updateEntry,
  deleteEntry,
  deleteEntries,
  moveEntries,
  toggleFavorite,
  clearEntries,
  moveEntry,
  setEntryGroup,
  addGroup,
  moveGroupToRoot,
  deleteGroups,
  moveGroups,
  exportJson,
  exportScopeJson,
  importJson,
  importMerge,
  lock
} from '../store/vault'
import { dnd, startDrag, clearDrag } from '../store/dnd'
import { theme, cycleTheme } from '../store/theme'
import { showToast } from '../utils/toast'
import { copyText } from '../utils/clipboard'
import { parseBrowserCsv } from '../utils/browserCsv'
import TotpCode from '../components/TotpCode.vue'
import GroupNode from '../components/GroupNode.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

// 弹窗按需加载，减少首屏渲染与解析
const EntryForm = defineAsyncComponent(() => import('../components/EntryForm.vue'))
const Generator = defineAsyncComponent(() => import('../components/Generator.vue'))
const Settings = defineAsyncComponent(() => import('../components/Settings.vue'))
const WifiImport = defineAsyncComponent(() => import('../components/WifiImport.vue'))
const WifiQr = defineAsyncComponent(() => import('../components/WifiQr.vue'))
const ReceiveShare = defineAsyncComponent(() => import('../components/ReceiveShare.vue'))
const ShareDialog = defineAsyncComponent(() => import('../components/ShareDialog.vue'))
const ImportDestination = defineAsyncComponent(() => import('../components/ImportDestination.vue'))

const keyword = ref('')
const moreOpen = ref(false)
const moreRef = ref(null)
const searchRef = ref(null)
const showForm = ref(false)
const editing = ref(null)
const showGen = ref(false)
const showSettings = ref(false)
const showWifi = ref(false)
const showWifiQr = ref(false)   // WiFi 直连二维码（手动生成 / 扫码识别）
const showReceive = ref(false) // 接收分享（文字 / 二维码 → 新增到插件）
const shareEntry = ref(null) // 打开分享弹窗的条目
const importParsed = ref(null)
const moveGroupMenu = ref(false)
const importOpen = ref(false)
const revealed = ref({})
const selection = ref('all') // 'all' | 'uncat' | groupId
const confirmState = ref({ open: false, title: '', message: '', confirmText: '确定', danger: false, onConfirm: null })

// ---------- 批量管理 ----------
const batchMode = ref(false)
const selectedIds = ref({})      // id -> true
const moveMenuOpen = ref(false)
const moveMenuRef = ref(null)

const selectedCount = computed(() => Object.keys(selectedIds.value).length)
const hasSelection = computed(() => selectedCount.value > 0)

function enterBatch () {
  batchMode.value = true
  selectedIds.value = {}
  moveMenuOpen.value = false
}

function exitBatch () {
  batchMode.value = false
  selectedIds.value = {}
  moveMenuOpen.value = false
}

function toggleSelect (id) {
  if (selectedIds.value[id]) {
    delete selectedIds.value[id]
  } else {
    selectedIds.value[id] = true
  }
}

function selectAllVisible () {
  filtered.value.forEach((e) => { selectedIds.value[e.id] = true })
}

function invertVisible () {
  filtered.value.forEach((e) => {
    if (selectedIds.value[e.id]) delete selectedIds.value[e.id]
    else selectedIds.value[e.id] = true
  })
}

function batchCopy () {
  const list = store.entries.filter((e) => selectedIds.value[e.id])
  if (!list.length) return
  const lines = list.map((e) => `${e.title || ''}\t${e.username || ''}\t${e.password || ''}\t${e.url || ''}`)
  copyText(lines.join('\n'), { label: ` ${list.length} 条（标题/账号/密码/网址）` })
}

function batchDelete () {
  const ids = Object.keys(selectedIds.value)
  if (!ids.length) return
  confirmState.value = {
    open: true,
    title: '删除所选',
    message: `确定删除选中的 ${ids.length} 条密码？此操作不可恢复。`,
    confirmText: '删除',
    danger: true,
    onConfirm: () => {
      deleteEntries(ids)
      showToast(`已删除 ${ids.length} 条`)
      exitBatch()
    }
  }
}

function batchMoveTo (groupId) {
  const ids = Object.keys(selectedIds.value)
  if (!ids.length) return
  moveEntries(ids, groupId)
  showToast(`已移动 ${ids.length} 条`)
  moveMenuOpen.value = false
  exitBatch()
}

function onDocClickMoveMenu (e) {
  if (moveMenuOpen.value && moveMenuRef.value && !moveMenuRef.value.contains(e.target)) {
    moveMenuOpen.value = false
  }
}

const rootGroups = computed(() => store.groups.filter((g) => !g.parentId))

const selectedName = computed(() => {
  if (selection.value === 'all') return '全部'
  if (selection.value === 'uncat') return '未分组'
  if (selection.value === 'fav') return '收藏'
  const g = store.groups.find((x) => x.id === selection.value)
  return g ? g.name : '全部'
})

const themeLabel = computed(() => ({ light: '亮色', dark: '暗色', sepia: '护眼' }[theme.value]))

const selectedGroupId = computed(() => {
  if (selection.value === 'all' || selection.value === 'uncat' || selection.value === 'fav') return null
  return selection.value
})

const baseList = computed(() => {
  if (selection.value === 'all') return store.entries
  if (selection.value === 'uncat') return store.entries.filter((e) => !e.groupId)
  if (selection.value === 'fav') return store.entries.filter((e) => e.favorite)
  return store.entries.filter((e) => (e.groupId || null) === selection.value)
})

// 收藏项置顶显示（稳定排序）
const sortedList = computed(() => {
  const list = baseList.value.slice()
  return list.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0))
})

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return sortedList.value
  return sortedList.value.filter((e) =>
    [e.title, e.username, e.url, e.notes].some((v) => (v || '').toLowerCase().includes(k))
  )
})

const counts = computed(() => {
  const totp = store.entries.filter((e) => e.otp).length
  return { total: store.entries.length, totp }
})

function openAdd () {
  editing.value = null
  showForm.value = true
}

function openEdit (entry) {
  if (batchMode.value) return
  editing.value = { ...entry }
  showForm.value = true
}

function onSave (data) {
  if (editing.value) {
    updateEntry(editing.value.id, data)
    showToast('已保存')
  } else {
    if ((data.groupId || null) == null) data.groupId = selectedGroupId.value
    addEntry(data)
    showToast('已添加')
  }
  showForm.value = false
}

function onDelete (entry) {
  if (batchMode.value) return
  confirmState.value = {
    open: true,
    title: '删除密码',
    message: `确定删除「${entry.title}」吗？此操作不可恢复。`,
    confirmText: '删除',
    danger: true,
    onConfirm: () => {
      deleteEntry(entry.id)
      showToast('已删除')
    }
  }
}

function onConfirmConfirm () {
  const c = confirmState.value
  if (c && c.onConfirm) c.onConfirm()
  confirmState.value = { ...confirmState.value, open: false }
}

function copy (text, label, ev) {
  if (batchMode.value) return
  copyText(text, { label: label || '' })
}

function toggleReveal (id) {
  if (batchMode.value) return
  revealed.value[id] = !revealed.value[id]
}

// 打开分享弹窗（文字 / 二维码）
function openShare (entry) {
  if (batchMode.value) return
  shareEntry.value = entry
}

function openExternal (entry) {
  if (batchMode.value) return
  if (!entry.url) return
  window.utools.shellOpenExternal(entry.url)
}

function onGenUse (pw) {
  copy(pw, '密码')
}

function onExport () {
  const path = window.utools.showSaveDialog({
    title: '导出密码备份',
    defaultPath: `passwords_backup_${Date.now()}.json`
  })
  if (!path) return
  window.services.saveTextFile(path, exportJson())
  showToast('导出成功')
  window.utools.shellShowItemInFolder(path)
  moreOpen.value = false
}

// 导出当前视图（选中分组及其子分组 / 全部 / 未分组 / 收藏）
function onExportView () {
  const scope = selection.value
  const name = selectedName.value
  const path = window.utools.showSaveDialog({
    title: `导出「${name}」`,
    defaultPath: `passwords_${name}_${Date.now()}.json`
  })
  if (!path) return
  window.services.saveTextFile(path, exportScopeJson(scope))
  showToast(`已导出「${name}」`)
  window.utools.shellShowItemInFolder(path)
  moreOpen.value = false
}

// 导入密码：自动识别 JSON 备份 / 浏览器导出的 CSV
function importPassword () {
  moreOpen.value = false
  const files = window.utools.showOpenDialog({
    title: '导入密码（JSON 备份 / 浏览器 CSV）',
    properties: ['openFile'],
    filters: [{ name: '密码文件（JSON / CSV）', extensions: ['json', 'csv', 'txt'] }]
  })
  if (!files || !files[0]) return
  let text
  try {
    text = window.services.readFile(files[0])
  } catch (e) {
    showToast('读取失败：' + e.message)
    return
  }
  // 优先按 JSON 备份解析；不是合法 JSON 再按浏览器 CSV 解析
  try {
    const data = JSON.parse(text)
    const entries = Array.isArray(data) ? data : (Array.isArray(data.entries) ? data.entries : [])
    const groups = Array.isArray(data.groups) ? data.groups : []
    if (!entries.length && !groups.length) throw new Error('备份中没有密码条目')
    importParsed.value = { type: 'json', text, entries, groups }
    importOpen.value = true
    return
  } catch (e) { /* 不是 JSON 备份，继续按 CSV 处理 */ }
  let parsed
  try {
    parsed = parseBrowserCsv(text)
  } catch (e) {
    showToast('导入失败：请选择 JSON 备份或浏览器导出的 CSV')
    return
  }
  if (!parsed.length) {
    showToast('未解析到任何密码，请确认是 JSON 备份或 Chrome/Edge 导出的 CSV')
    return
  }
  importParsed.value = { type: 'csv', text: null, entries: parsed, groups: [] }
  importOpen.value = true
}

function onImportConfirm (dest) {
  const meta = importParsed.value || { type: 'csv', entries: [] }
  if (dest.mode === 'file') {
    if (meta.type === 'json') {
      importMerge(meta.text)
      showToast('已按文件分组导入（保留现有并合并）')
    } else {
      const rows = (meta.entries || []).map((p) => ({ title: p.title || '', username: p.username || '', password: p.password || '', url: p.url || '', notes: p.notes || '', otp: p.otp, groupId: null }))
      addEntries(rows)
      showToast('已导入 ' + rows.length + ' 条')
    }
    importOpen.value = false
    importParsed.value = null
    return
  }
  let groupId = null
  if (dest.mode === 'current') groupId = selectedGroupId.value
  else if (dest.mode === 'group') groupId = dest.groupId || null
  // file / all：不设分组
  const rows = (meta.entries || []).map((p) => ({
    title: p.title || '', username: p.username || '', password: p.password || '',
    url: p.url || '', notes: p.notes || '', otp: p.otp, groupId
  }))
  addEntries(rows)
  importOpen.value = false
  importParsed.value = null
  showToast(`已导入 ${rows.length} 条`)
}
function onLock () {
  lock()
  showToast('已锁定')
}

function prettyUrl (url) {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch (e) {
    return url
  }
}

const AVATAR_PALETTE = [
  '#4f8cff', '#7b5cff', '#2fbf8f', '#e5a13d', '#e5716b',
  '#39a0d8', '#8a6fd8', '#d87a4f'
]

function avatarColor (title) {
  let h = 0
  const s = title || ''
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}

function initial (title) {
  const s = (title || '').trim()
  return s ? s[0].toUpperCase() : '?'
}

const newGroupOpen = ref(false)
const newGroupName = ref('')

function pickGroup () {
  newGroupOpen.value = true
  newGroupName.value = ''
}

function confirmNewGroup () {
  const name = newGroupName.value.trim()
  if (name) {
    const parentId = selection.value !== 'all' && selection.value !== 'uncat' && selection.value !== 'fav' ? selection.value : null
    addGroup(name, parentId)
    showToast('已新建分组')
  }
  newGroupOpen.value = false
  newGroupName.value = ''
}

// ---------- 拖拽：条目 ----------
function onEntryDragStart (entry, e) {
  if (keyword.value || batchMode.value) return
  startDrag('entry', entry.id)
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', entry.id)
  }
}

function onEntryOver (entry, e) {
  if (dnd.type !== 'entry' || dnd.id === entry.id) return
  e.preventDefault()
  const rect = e.currentTarget.getBoundingClientRect()
  const mode = (e.clientY - rect.top) / rect.height < 0.5 ? 'before' : 'after'
  dnd.targetId = entry.id
  dnd.mode = mode
}

function onEntryLeave () {
  if (dnd.type === 'entry' && dnd.targetId) {
    dnd.targetId = null
    dnd.mode = null
  }
}

function onEntryDrop (entry, e) {
  e.preventDefault()
  if (dnd.type !== 'entry' || dnd.id === entry.id) return
  const before = dnd.mode === 'before'
  moveEntry(dnd.id, entry.id, before)
  clearDrag()
}

// ---------- 拖拽：分组到顶层 ----------
function onGroupsOver (e) {
  if (dnd.type === 'group') {
    e.preventDefault()
    dnd.targetId = null
    dnd.mode = null
  }
}

function onGroupsDrop (e) {
  e.preventDefault()
  if (dnd.type === 'group') {
    moveGroupToRoot(dnd.id)
    showToast('已移至顶层')
    clearDrag()
  }
}

// ---------- 拖拽：条目到未分组 ----------
function onUncatOver (e) {
  if (dnd.type === 'entry') {
    e.preventDefault()
    dnd.targetId = '__uncat__'
    dnd.mode = 'inside'
  }
}

function onUncatDrop (e) {
  e.preventDefault()
  if (dnd.type === 'entry') {
    setEntryGroup(dnd.id, null)
    showToast('已移至未分组')
    clearDrag()
  }
}

function onGlobalKeydown (e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    searchRef.value && searchRef.value.focus()
  }
  if (e.key === 'Escape' && moreOpen.value) moreOpen.value = false
}

function onDocClick (e) {
  if (moreOpen.value && moreRef.value && !moreRef.value.contains(e.target)) {
    moreOpen.value = false
  }
}

// ---------- 分组批量管理 ----------
const groupBatch = ref(false)
const selGroupIds = ref({}) // id -> true

const selGroupCount = computed(() => Object.keys(selGroupIds.value).length)
const groupHasSel = computed(() => selGroupCount.value > 0)

function toggleGroupBatch () {
  groupBatch.value = !groupBatch.value
  selGroupIds.value = {}
  moveGroupMenu.value = false
}

function toggleSelGroup (id) {
  if (selGroupIds.value[id]) delete selGroupIds.value[id]
  else selGroupIds.value[id] = true
}
function selectAllGroups () {
  store.groups.forEach((g) => { selGroupIds.value[g.id] = true })
}
function invertGroups () {
  store.groups.forEach((g) => { if (selGroupIds.value[g.id]) delete selGroupIds.value[g.id]; else selGroupIds.value[g.id] = true })
}
function batchDeleteGroups () {
  const ids = Object.keys(selGroupIds.value)
  if (!ids.length) return
  confirmState.value = {
    open: true,
    title: '删除所选分组',
    message: `确定删除选中的 ${ids.length} 个分组？其子分组与组内条目会移到上一级（不会被删除）。`,
    confirmText: '删除',
    danger: true,
    onConfirm: () => {
      deleteGroups(ids)
      selGroupIds.value = {}
      groupBatch.value = false
      showToast('已删除 ' + ids.length + ' 个分组')
    }
  }
}
function batchMoveGroupsTo (parentId) {
  const ids = Object.keys(selGroupIds.value)
  if (!ids.length) return
  moveGroups(ids, parentId)
  selGroupIds.value = {}
  groupBatch.value = false
  moveGroupMenu.value = false
  showToast('已移动 ' + ids.length + ' 个分组')
}
onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('click', onDocClick)
  window.addEventListener('click', onDocClickMoveMenu)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('click', onDocClick)
})
</script>

<template>
  <div class="vault">
    <!-- 左侧：分组 -->
    <aside class="sidebar">
      <div class="side-title">分组
        <button class="side-batch" :class="{ on: groupBatch }" :title="groupBatch ? '退出分组批量' : '批量管理分组'" @click="toggleGroupBatch">☑</button>
      </div>

      <div v-if="groupBatch" class="group-batch-bar">
        <span class="gb-count">已选 {{ selGroupCount }}</span>
        <button class="btn sm" @click="selectAllGroups">全选</button>
        <button class="btn sm" @click="invertGroups">反选</button>
        <div class="more gb-move" @click.stop>
          <button class="btn sm" @click="moveGroupMenu = !moveGroupMenu">移动 ▾</button>
          <div v-if="moveGroupMenu" class="more-menu">
            <button class="menu-item" @click="batchMoveGroupsTo(null)">📂 移到顶层</button>
            <button v-for="g in store.groups" :key="g.id" class="menu-item" @click="batchMoveGroupsTo(g.id)">{{ g.name }}</button>
          </div>
        </div>
        <button class="btn sm danger" :disabled="!groupHasSel" @click="batchDeleteGroups">删除</button>
      </div>

      <div
        class="side-item"
        :class="{ active: selection === 'all' }"
        @click="selection = 'all'"
      >
        <span class="si-icon">📚</span>
        <span class="si-name">全部</span>
        <span class="si-count">{{ store.entries.length }}</span>
      </div>

      <div
        class="side-item"
        :class="{ active: selection === 'uncat', 'drop-inside': dnd.type === 'entry' && dnd.targetId === '__uncat__' }"
        @click="selection = 'uncat'"
        @dragover="onUncatOver"
        @drop="onUncatDrop"
      >
        <span class="si-icon">📂</span>
        <span class="si-name">未分组</span>
        <span class="si-count">{{ store.entries.filter((e) => !e.groupId).length }}</span>
      </div>

      <div
        class="side-item"
        :class="{ active: selection === 'fav' }"
        @click="selection = 'fav'"
      >
        <span class="si-icon">⭐</span>
        <span class="si-name">收藏</span>
        <span class="si-count">{{ store.entries.filter((e) => e.favorite).length }}</span>
      </div>

      <div class="side-groups" @dragover="onGroupsOver" @drop="onGroupsDrop" @dblclick="pickGroup">
        <div class="side-groups-label">拖到此处移回顶层 · 双击空白新建分组</div>
        <template v-if="rootGroups.length">
          <GroupNode
            v-for="g in rootGroups"
            :key="g.id"
            :group="g"
            :depth="0"
            :selected-id="selection"
            :batch-mode="groupBatch"
            :selected="!!selGroupIds[g.id]"
            @select="(id) => (selection = id)" @toggle-select="toggleSelGroup"
          />
        </template>
        <div v-else class="side-empty">暂无分组，双击新建</div>
      </div>

      <div v-if="newGroupOpen" class="new-group-input">
        <input
          v-model="newGroupName"
          class="input mono-font"
          placeholder="分组名称"
          autofocus
          @keyup.enter="confirmNewGroup"
          @keyup.esc="newGroupOpen = false"
        />
        <button class="btn sm primary" @click="confirmNewGroup">确定</button>
      </div>
      <button class="btn ghost sm new-group" @click="pickGroup">＋ 新建分组</button>
    </aside>

    <!-- 右侧：主列表 -->
    <div class="main">
      <header class="vault-head">
        <div class="brand">
          <div class="brand-logo">🔑</div>
          <div class="brand-meta">
            <div class="brand-name">
              我的密码
              <span v-if="store.secured" class="badge">已加密</span>
            </div>
            <div class="brand-sub">
              <span class="brand-count">{{ selectedName }} · {{ filtered.length }} 条</span>
              <span v-if="counts.totp">· {{ counts.totp }} 个动态码</span>
            </div>
          </div>
        </div>
        <div class="head-actions">
          <button class="icon-round" :title="'切换主题（当前：' + themeLabel + '）'" @click="cycleTheme">
            {{ theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '🍃' }}
          </button>
          <button v-if="store.secured" class="icon-round" title="立即锁定" @click="onLock">🔒</button>
          <button class="icon-round" title="设置" @click="showSettings = true">⚙️</button>
        </div>
      </header>

      <div v-if="!batchMode" class="searchbar">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            ref="searchRef"
            v-model="keyword"
            class="search-input"
            placeholder="搜索标题 / 账号 / 网址 / 备注…"
          />
          <button v-if="keyword" class="search-clear" title="清空搜索" @click="keyword = ''">✕</button>
          <span v-else class="kbd">Ctrl F</span>
        </div>

        <div ref="moreRef" class="more">
          <button class="icon-round" title="更多" @click="moreOpen = !moreOpen">⋯</button>
          <div v-if="moreOpen" class="more-menu">
            <div class="menu-item has-sub">
              <span>📥 导入</span><span class="sub-arrow">▸</span>
              <div class="submenu">
                <button class="menu-item" @click="moreOpen = false; importPassword()">📄 密码文件<span class="menu-sub">JSON / CSV</span></button>
                <button class="menu-item" @click="moreOpen = false; showReceive = true">📩 接收分享密码</button>
                <button class="menu-item" @click="moreOpen = false; showWifi = true">📶 读取本机 WiFi 密码</button>
              </div>
            </div>
            <div class="menu-item has-sub">
              <span>📤 导出</span><span class="sub-arrow">▸</span>
              <div class="submenu">
                <button class="menu-item" @click="moreOpen = false; onExportView()">📂 导出当前分组</button>
                <button class="menu-item" @click="moreOpen = false; onExport()">⬇ 导出全部</button>
              </div>
            </div>
            <div class="menu-item has-sub">
              <span>🧰 工具</span><span class="sub-arrow">▸</span>
              <div class="submenu">
                <button class="menu-item" @click="moreOpen = false; showGen = true">🎲 生成密码</button>
                <button class="menu-item" @click="moreOpen = false; showWifiQr = true">📲 生成 WiFi 二维码</button>
              </div>
            </div>
          </div>
        </div>

        <button class="icon-round" title="批量管理" @click="enterBatch">☑</button>
        <button class="btn primary add-btn" @click="openAdd">＋ <span>新增</span></button>
      </div>

      <div v-else class="batchbar">
        <span class="batch-count">已选 <b>{{ selectedCount }}</b> 项</span>
        <button class="btn sm" @click="selectAllVisible">全选</button>
        <button class="btn sm" @click="invertVisible">反选</button>

        <div ref="moveMenuRef" class="more batch-move">
          <button class="btn sm" :disabled="!hasSelection" @click="moveMenuOpen = !moveMenuOpen">移动 ▾</button>
          <div v-if="moveMenuOpen" class="more-menu">
            <button class="menu-item" @click="batchMoveTo(null)">📂 未分组</button>
            <button v-for="g in store.groups" :key="g.id" class="menu-item" @click="batchMoveTo(g.id)">
              {{ g.name }}
            </button>
            <div v-if="!store.groups.length" class="menu-empty">暂无分组，请先新建</div>
          </div>
        </div>

        <button class="btn sm" :disabled="!hasSelection" @click="batchCopy">复制</button>
        <button class="btn sm danger" :disabled="!hasSelection" @click="batchDelete">删除</button>
        <button class="btn sm" @click="exitBatch">取消</button>
      </div>

      <div class="list">
        <template v-if="filtered.length">
          <div
            v-for="entry in filtered"
            :key="entry.id"
            class="card"
            :class="{
              'drop-before': dnd.type === 'entry' && dnd.targetId === entry.id && dnd.mode === 'before',
              'drop-after': dnd.type === 'entry' && dnd.targetId === entry.id && dnd.mode === 'after',
              selected: batchMode && selectedIds[entry.id]
            }"
            :draggable="!keyword && !batchMode"
            @dragstart="onEntryDragStart(entry, $event)"
            @dragover="onEntryOver(entry, $event)"
            @dragleave="onEntryLeave"
            @drop="onEntryDrop(entry, $event)"
            @dragend="clearDrag"
          >
            <span v-if="batchMode" class="card-check" :class="{ on: selectedIds[entry.id] }" @click.stop="toggleSelect(entry.id)">
              {{ selectedIds[entry.id] ? '✓' : '' }}
            </span>
            <div class="avatar" :style="{ background: avatarColor(entry.title) }">
              {{ initial(entry.title) }}
            </div>

            <div class="card-main">
              <div class="card-top">
                <span class="card-title mono-font" :title="entry.title">{{ entry.title || '未命名' }}</span>
                <span v-if="entry.url" class="card-url mono-font" @click="openExternal(entry)">
                  {{ prettyUrl(entry.url) }}
                </span>
                <button
                  class="card-star"
                  :class="{ on: entry.favorite }"
                  :title="entry.favorite ? '取消收藏' : '收藏并置顶'"
                  @click.stop="toggleFavorite(entry.id)"
                  :disabled="batchMode"
                >★</button>
              </div>

              <div class="row">
                <span class="row-label">账号</span>
                <span
                  class="row-value mono click-copy"
                  :title="entry.username ? '点击复制账号' : ''"
                  @click="copy(entry.username, '账号')"
                >{{ entry.username || '—' }}</span>
              </div>

              <div class="row">
                <span class="row-label">密码</span>
                <span
                  class="row-value mono click-copy"
                  title="点击复制密码"
                  @click="copy(entry.password, '密码')"
                >
                  <template v-if="revealed[entry.id]">{{ entry.password || '—' }}</template>
                  <template v-else>••••••••</template>
                </span>
                <button
                  class="row-btn"
                  :title="revealed[entry.id] ? '隐藏' : '显示'"
                  @click.stop="toggleReveal(entry.id)"
                >{{ revealed[entry.id] ? '🙈' : '👁' }}</button>
              </div>

              <TotpCode v-if="entry.otp" :otp="entry.otp" />
              <div v-if="entry.notes" class="notes">{{ entry.notes }}</div>
            </div>

            <div class="card-actions">
              <button class="card-act" title="分享" @click="openShare(entry)">📤</button>
              <button class="card-act" title="编辑" @click="openEdit(entry)">✏️</button>
              <button class="card-act danger" title="删除" @click="onDelete(entry)">🗑</button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="empty">
            <!-- 收藏为空 -->
            <template v-if="selection === 'fav'">
              <div class="empty-icon">⭐</div>
              <p class="empty-title">还没有收藏</p>
              <p class="empty-sub">点击卡片右上角 ★ 即可收藏并置顶</p>
            </template>
            <!-- 搜索/过滤无结果 -->
            <template v-else-if="keyword || store.entries.length">
              <div class="empty-icon">🔍</div>
              <p class="empty-title">没有匹配{{ keyword ? `「${keyword}」的` : '' }}记录</p>
              <p class="empty-sub">换个关键词，或按 Ctrl/⌘+F 快速搜索</p>
            </template>
            <!-- 完全为空 -->
            <template v-else>
              <div class="empty-icon">🔐</div>
              <p class="empty-title">开始你的密码保险库</p>
              <p class="empty-sub">点击「新增」保存第一条密码，支持两步验证与二维码识别</p>
              <button class="btn primary" @click="openAdd">＋ 新增密码</button>
            </template>
          </div>
        </template>
      </div>
    </div>

    <!-- 弹窗 -->
    <EntryForm v-if="showForm" :entry="editing" :default-group-id="selectedGroupId" @close="showForm = false" @save="onSave" />
    <Generator v-if="showGen" @close="showGen = false" @result="onGenUse" />
    <Settings v-if="showSettings" @close="showSettings = false" />
    <WifiImport v-if="showWifi" :default-group-id="selectedGroupId" @close="showWifi = false" />
    <WifiQr v-if="showWifiQr" :default-group-id="selectedGroupId" @close="showWifiQr = false" />
    <ReceiveShare v-if="showReceive" :default-group-id="selectedGroupId" @close="showReceive = false" />
    <ShareDialog v-if="shareEntry" :entry="shareEntry" @close="shareEntry = null" />
    <ImportDestination
      v-if="importOpen"
      :title="importParsed && importParsed.type === 'json' ? '导入密码备份' : '导入浏览器密码'"
      :count="(importParsed && importParsed.entries ? importParsed.entries.length : 0)"
      :current-group-id="selection"
      :current-group-name="selectedName"
      @close="importOpen = false"
      @confirm="onImportConfirm"
    />
    <ConfirmDialog
      v-if="confirmState.open"
      :title="confirmState.title"
      :message="confirmState.message"
      :confirm-text="confirmState.confirmText"
      :danger="confirmState.danger"
      @confirm="onConfirmConfirm"
      @cancel="confirmState.open = false"
    />
  </div>
</template>

<style scoped>
.vault {
  height: 100%;
  display: flex;
  flex-direction: row;
}

/* ---------- 侧边栏 ---------- */
.sidebar {
  width: 218px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding: 16px 10px 10px;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.side-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--muted); font-weight: 600; letter-spacing: 0.5px; padding: 0 0 10px; }
.side-batch { border: 1px solid var(--border-2); background: var(--panel); color: var(--muted); width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.side-batch.on { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
.group-batch-bar { display: flex; align-items: center; gap: 6px; padding: 8px; margin-bottom: 10px; border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent); background: color-mix(in srgb, var(--primary) 8%, var(--panel)); border-radius: 10px; flex-wrap: wrap; }
.gb-count { font-size: 12px; color: var(--text-2); margin-right: auto; }
.gb-move { position: relative; }
.gb-move .more-menu { top: 32px; right: 0; }

.side-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 9px;
  cursor: pointer;
  margin-bottom: 2px;
  font-size: 13px;
  color: var(--text-2);
  transition: background 0.14s;
}

.side-item:hover {
  background: var(--panel-2);
}

.side-item.active {
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: var(--text);
  font-weight: 600;
  position: relative;
}

.side-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 3px;
  background: var(--primary-grad);
}

.si-icon {
  font-size: 14px;
}

.si-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.si-count {
  font-size: 11px;
  color: var(--muted);
  background: var(--panel-2);
  border-radius: 10px;
  padding: 1px 7px;
}

.side-item.drop-inside {
  background: color-mix(in srgb, var(--primary) 22%, transparent);
}

.side-groups {
  flex: 1;
  margin-top: 8px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
  overflow: auto;
}

.side-groups-label {
  font-size: 11px;
  color: var(--muted);
  padding: 0 8px 8px;
}

.side-empty {
  font-size: 12px;
  color: var(--muted);
  padding: 12px 10px;
  text-align: center;
}

.new-group {
  margin-top: auto;
  width: 100%;
}

.new-group-input {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.new-group-input .input {
  flex: 1;
  height: 32px;
  font-size: 13px;
}

/* ---------- 主区 ---------- */
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 16px 20px 10px;
}

.vault-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-logo {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--primary-grad);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--primary) 40%, transparent);
}

.brand-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.3px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-sub {
  font-size: 12px;
  color: var(--muted);
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.brand-count {
  font-size: 11px;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  padding: 1px 8px;
  border-radius: 20px;
  font-weight: 600;
}

.badge {
  font-size: 11px;
  color: var(--success);
  background: rgba(47, 191, 113, 0.12);
  padding: 2px 9px;
  border-radius: 20px;
  font-weight: 500;
}

.head-actions {
  display: flex;
  gap: 8px;
}

.icon-round {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text-2);
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.16s, transform 0.12s, box-shadow 0.16s;
}

.icon-round:hover {
  background: var(--panel-2);
  box-shadow: var(--shadow-sm);
}

.icon-round:active {
  transform: translateY(1px);
}

.searchbar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0 13px;
  height: 44px;
  box-shadow: var(--shadow-sm);
  transition: border-color 0.16s, box-shadow 0.16s;
}

.search-box:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 18%, transparent);
}

.search-icon {
  color: var(--muted);
  font-size: 14px;
  margin-right: 9px;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 14px;
}

.search-input::placeholder {
  color: var(--muted);
}

.search-clear {
  border: none;
  background: var(--panel-2);
  color: var(--muted);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  flex-shrink: 0;
  transition: background 0.14s, color 0.14s;
}

.search-clear:hover {
  background: var(--border-2);
  color: var(--text);
}

.kbd {
  font-size: 11px;
  color: var(--muted);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 7px;
  flex-shrink: 0;
  white-space: nowrap;
}

.add-btn {
  height: 44px;
  padding: 0 20px;
  border-radius: 12px;
  font-size: 14px;
  white-space: nowrap;
}

.more {
  position: relative;
}

.more-menu {
  position: absolute;
  right: 0;
  top: 42px;
  min-width: 150px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 6px;
  z-index: 20;
  animation: menu-in 0.14s ease;
}

@keyframes menu-in {
  from { opacity: 0; transform: translateY(-4px); }
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 9px 12px;
  border-radius: 8px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.menu-item:hover {
  background: var(--panel-2);
}

/* ---------- 二级子菜单 ---------- */
.menu-item.has-sub {
  position: relative;
  justify-content: space-between;
  cursor: default;
  white-space: nowrap;
}
.menu-item .sub-arrow {
  margin-left: 12px;
  font-size: 11px;
  color: var(--muted);
}
.menu-item .menu-sub {
  margin-left: 8px;
  font-size: 11px;
  color: var(--muted);
}
.submenu {
  position: absolute;
  right: calc(100% - 6px); /* 向左展开，与父项重叠 6px 防止鼠标移经过断连 */
  top: -6px;
  min-width: 180px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 6px;
  z-index: 30;
  display: none;
  white-space: nowrap;
  animation: menu-in 0.12s ease;
}
.menu-item.has-sub:hover > .submenu,
.menu-item.has-sub:focus-within > .submenu {
  display: block;
}

.menu-empty {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--muted);
}

/* ---------- 批量管理 ---------- */
.batchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: color-mix(in srgb, var(--primary) 8%, var(--panel));
  border: 1px solid color-mix(in srgb, var(--primary) 25%, transparent);
  border-radius: 11px;
  flex-wrap: wrap;
}

.batch-count {
  font-size: 13px;
  color: var(--text-2);
  margin-right: auto;
}

.batch-count b {
  color: var(--primary);
}

.batch-move {
  position: relative;
}

.batch-move .more-menu {
  top: 34px;
}

.card.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary), var(--shadow-sm);
}

.card-check {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid var(--border-2);
  background: var(--panel);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #fff;
  flex-shrink: 0;
  cursor: pointer;
  margin-top: 8px;
  transition: background 0.14s, border-color 0.14s;
}

.card-check:hover {
  border-color: var(--primary);
}

.card-check.on {
  background: var(--primary);
  border-color: var(--primary);
}

/* ---------- 列表 ---------- */
.list {
  flex: 1;
  overflow: auto;
  padding-bottom: 14px;
}

.card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px 12px 13px;
  margin-bottom: 10px;
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.16s, transform 0.14s, border-color 0.16s;
  position: relative;
}

.card[draggable='true'] {
  cursor: grab;
}

.card[draggable='true']:active {
  cursor: grabbing;
}

.card:hover {
  box-shadow: var(--shadow);
  transform: translateY(-2px);
  border-color: var(--border-2);
}

.card.drop-before {
  box-shadow: 0 -3px 0 var(--primary) inset;
}

.card.drop-after {
  box-shadow: 0 3px 0 var(--primary) inset;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: #fff;
  font-size: 17px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
}

.card-main {
  flex: 1;
  min-width: 0;
}

.card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
}

.card-title {
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.card-url {
  font-size: 12px;
  color: var(--primary);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
  flex-shrink: 0;
}

.card-url:hover {
  text-decoration: underline;
}

.card-star {
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 16px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.14s, transform 0.14s, background 0.14s;
}

.card-star:hover {
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  color: var(--warning);
  transform: scale(1.08);
}

.card-star.on {
  color: var(--warning);
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.row-label {
  width: 36px;
  color: var(--muted);
  font-size: 12px;
  flex-shrink: 0;
}

.row-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
}

.click-copy {
  cursor: pointer;
  border-radius: 6px;
  padding: 2px 4px;
  margin: -2px -4px;
  transition: background 0.14s;
}

.click-copy:hover {
  background: var(--panel-2);
}

.mono {
  font-family: var(--mono-font);
  font-variant-ligatures: none;
  font-feature-settings: 'zero' 1;
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

.notes {
  margin-top: 7px;
  font-size: 12px;
  color: var(--muted);
  white-space: pre-wrap;
  word-break: break-word;
}

.card-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity 0.14s;
}

.card:hover .card-actions {
  opacity: 1;
}

.card-act {
  border: none;
  background: transparent;
  font-size: 14px;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  transition: background 0.14s;
}

.card-act:hover {
  background: var(--panel-2);
}

.card-act.danger:hover {
  background: rgba(229, 72, 77, 0.12);
}

.empty {
  text-align: center;
  color: var(--muted);
  padding: 60px 24px;
}

.empty-icon {
  font-size: 40px;
  width: 88px;
  height: 88px;
  line-height: 88px;
  border-radius: 24px;
  background: color-mix(in srgb, var(--primary) 10%, var(--panel));
  margin: 0 auto 16px;
  box-shadow: var(--shadow-sm);
}

.empty-title {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.empty-sub {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--muted);
}
</style>
