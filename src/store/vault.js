import { reactive } from 'vue'
import { member, refreshMember } from './member'

// utools.dbStorage 存储键
const STORAGE_KEY = 'password_vault'

// 全局响应式状态
const store = reactive({
  ready: false,     // 已完成初始化
  secured: false,   // 是否启用了主密码
  locked: true,     // 是否处于锁定状态
  entries: [],      // 当前条目（未加密 / 已解锁时存在）
  groups: [],       // 分组：[{ id, name, parentId }]
  syncEnabled: true, // 是否写入可被 uTools 同步的 dbStorage（关闭则仅本地文件）
  syncBlocked: false, // 非付费用户：云端同步被锁定
  unlockError: '',  // 解锁错误提示
  bootNotice: ''    // 启动提示（如未在 uTools 环境）
})

let currentBlob = null  // 加密模式下的密文对象
let masterPassword = ''  // 仅存在于内存的主密码

function generateId () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// 生成可跨上下文克隆的纯对象（Vue 响应式代理不能被 structuredClone，须先转纯数据）
function toPlain (value) {
  return JSON.parse(JSON.stringify(value))
}

// ---------- 同步开关（存 localStorage，本地不回传）----------
function loadSyncFlag () {
  try {
    return window.localStorage.getItem('password_vault_sync') !== '0'
  } catch (e) {
    return true
  }
}

function saveSyncFlag (on) {
  try {
    window.localStorage.setItem('password_vault_sync', on ? '1' : '0')
  } catch (e) {}
}

// ---------- 双后端存取（dbStorage 可同步 / 本地文件不同步）----------
function readDbBlob () {
  return window.utools.dbStorage.getItem(STORAGE_KEY)
}
function writeDbBlob (blob) {
  window.utools.dbStorage.setItem(STORAGE_KEY, blob)
}
function clearDbBlob () {
  window.utools.dbStorage.removeItem(STORAGE_KEY)
}
function readFileBlob () {
  const t = window.services.readLocalData()
  if (!t) return null
  try {
    return JSON.parse(t)
  } catch (e) {
    return null
  }
}
function writeFileBlob (blob) {
  window.services.storeLocalData(JSON.stringify(blob))
}
function clearFileBlob () {
  window.services.removeLocalData()
}

// 启动时数据归位：若数据在“非当前后端”，自动迁移到当前后端并清理旧副本，避免“看似丢失”
function normalizeBackend () {
  const cur = store.syncEnabled
  if (cur) {
    if (readDbBlob() != null) {
      clearFileBlob()
      return
    }
    const local = readFileBlob()
    if (local != null) {
      writeDbBlob(local)
      clearFileBlob()
    }
  } else {
    if (readFileBlob() != null) {
      clearDbBlob()
      return
    }
    const db = readDbBlob()
    if (db != null) {
      writeFileBlob(db)
      clearDbBlob()
    }
  }
}

function persistBlob (blob) {
  if (store.syncEnabled) {
    writeDbBlob(blob)
  } else {
    writeFileBlob(blob)
  }
}

function loadBlob () {
  return store.syncEnabled ? readDbBlob() : readFileBlob()
}

// 开启 / 关闭数据同步：把当前数据从旧后端迁移到新后端，并清理旧副本
function setSyncEnabled (on) {
  on = !!on
  if (on && !member.value.syncing) return { ok: false, blocked: true }
  if (on === store.syncEnabled) return { ok: true }
  // 先把当前内存数据落到原后端，确保迁移的是最新数据
  if (store.secured && masterPassword) persistEncrypted()
  else persistPlain()
  const fromDb = store.syncEnabled
  const src = fromDb ? readDbBlob() : readFileBlob()
  if (src != null) {
    if (on) writeDbBlob(src)
    else writeFileBlob(src)
    // 清理旧后端，避免残留一份未经切换的数据
    if (fromDb) clearDbBlob()
    else clearFileBlob()
  }
  store.syncEnabled = on
  saveSyncFlag(on)
  return { ok: true }
}

// 初始化：读取本地存储并判断模式
function initialize () {
  currentBlob = null
  store.unlockError = ''
  store.bootNotice = ''

  // 未在 uTools 环境（例如直接在浏览器打开 dev 页面）
  if (!window.utools || !window.utools.dbStorage) {
    store.secured = false
    store.locked = false
    store.entries = []
    store.groups = []
    store.syncEnabled = true
    store.ready = true
    store.bootNotice = '未检测到 uTools 环境，请通过 uTools 插件开发工具打开本插件。'
    return
  }

  store.syncEnabled = loadSyncFlag()

  // 根据 uTools 会员/数据同步状态约束：未开启数据同步则强制本地存储
  const m = refreshMember()
  store.syncBlocked = !m.syncing
  if (!m.syncing) store.syncEnabled = false

  try {
    // 确保数据归属当前后端（非会员强制本地时，把 dbStorage 里的旧数据迁移到本地文件）
  normalizeBackend()
  const raw = loadBlob()

    if (!raw) {
      // 尚无任何数据：默认明文模式，直接进入
      store.secured = false
      store.locked = false
      store.entries = []
      store.groups = []
    } else if (raw.mode === 'encrypted') {
      // 已加密：需解锁
      store.secured = true
      store.locked = true
      store.entries = []
      store.groups = []
      currentBlob = raw
    } else {
      // 明文模式
      store.secured = false
      store.locked = false
      store.entries = Array.isArray(raw.entries) ? raw.entries : []
      store.groups = Array.isArray(raw.groups) ? raw.groups : []
    }
  } catch (err) {
    // 读取失败也进入界面并提示，而不静默空白
    store.secured = false
    store.locked = false
    store.entries = []
    store.groups = []
    store.bootNotice = '读取本地数据失败：' + (err && err.message ? err.message : err)
  }
  store.ready = true
}

function persistPlain () {
  currentBlob = null
  persistBlob({
    mode: 'plain',
    entries: toPlain(store.entries),
    groups: toPlain(store.groups)
  })
}

function persistEncrypted () {
  currentBlob = window.services.encryptData(
    JSON.stringify({ entries: store.entries, groups: store.groups }),
    masterPassword
  )
  persistBlob(currentBlob)
}

function save () {
  if (store.secured) {
    persistEncrypted()
  } else {
    persistPlain()
  }
}

function verifyPassword (pw) {
  try {
    window.services.decryptData(currentBlob, pw)
    return true
  } catch (e) {
    return false
  }
}

// 设置/开启主密码（把当前明文条目加密保存）
function setMasterPassword (pw) {
  masterPassword = pw
  store.secured = true
  store.locked = false
  save()
  return true
}

// 解锁
function unlock (pw) {
  try {
    const plain = window.services.decryptData(currentBlob, pw)
    const data = JSON.parse(plain)
    // 兼容旧格式：早期只加密了数组，新格式为 { entries, groups }
    store.entries = Array.isArray(data) ? data : (Array.isArray(data.entries) ? data.entries : [])
    store.groups = Array.isArray(data) ? [] : (Array.isArray(data.groups) ? data.groups : [])
    masterPassword = pw
    store.locked = false
    store.unlockError = ''
    return { ok: true }
  } catch (e) {
    store.unlockError = '主密码错误，请重试'
    return { ok: false }
  }
}

// 锁定（清空内存中的密码与条目）
function lock () {
  masterPassword = ''
  store.entries = []
  store.groups = []
  store.locked = true
  store.unlockError = ''
}

// 修改主密码（需先验证旧密码）
function changeMasterPassword (oldPw, newPw) {
  if (!verifyPassword(oldPw)) return { ok: false, error: '当前主密码不正确' }
  masterPassword = newPw
  save()
  return { ok: true }
}

// 关闭/移除主密码（需先验证当前密码）
function disableMasterPassword (pw) {
  if (!verifyPassword(pw)) return { ok: false, error: '当前主密码不正确' }
  masterPassword = ''
  store.secured = false
  store.locked = false
  persistPlain()
  return { ok: true }
}

// ---------- 分组操作 ----------

function findGroup (id) {
  return store.groups.find((g) => g.id === id)
}

function addGroup (name, parentId = null) {
  const group = { id: generateId(), name: name || '新分组', parentId: parentId || null }
  store.groups.push(group)
  save()
  return group
}

function renameGroup (id, name) {
  const g = findGroup(id)
  if (g && name) {
    g.name = name
    save()
  }
}

function deleteGroup (id) {
  const g = findGroup(id)
  if (!g) return
  const parentId = g.parentId || null
  // 子分组上移一层
  store.groups = store.groups
    .filter((x) => x.id !== id)
    .map((x) => (x.parentId === id ? { ...x, parentId } : x))
  // 该分组内的条目移到父分组（或未分组）
  store.entries = store.entries.map((e) =>
    e.groupId === id ? { ...e, groupId: parentId } : e
  )
  save()
}

// 删除分组并连同组内条目一起删除（子分组仍保留并上移一层）
function deleteGroupDeep (id) {
  const g = findGroup(id)
  if (!g) return
  const parentId = g.parentId || null
  store.groups = store.groups
    .filter((x) => x.id !== id)
    .map((x) => (x.parentId === id ? { ...x, parentId } : x))
  store.entries = store.entries.filter((e) => e.groupId !== id)
  save()
}

// 变更分组层级：mode = 'before' | 'after' | 'inside'
function moveGroup (id, targetId, mode) {
  const idx = store.groups.findIndex((g) => g.id === id)
  if (idx === -1) return
  if (id === targetId) return
  const [item] = store.groups.splice(idx, 1)

  if (mode === 'inside') {
    // 成为 target 的子级
    item.parentId = targetId
    store.groups.push(item)
    // 阻止循环引用：若 target 的祖先包含 item，回退
    let cursor = findGroup(targetId)
    while (cursor) {
      if (cursor.id === item.id) {
        item.parentId = null
        break
      }
      cursor = findGroup(cursor.parentId)
    }
  } else {
    const tIdx = store.groups.findIndex((g) => g.id === targetId)
    const target = store.groups[tIdx]
    item.parentId = target ? target.parentId : null
    // 防止把自己移到自己的子孙下（before/after 一级不做深层校验，inside 已处理）
    store.groups.splice(mode === 'before' ? tIdx : tIdx + 1, 0, item)
  }
  save()
}

// 把分组移到顶层（parentId = null）
function moveGroupToRoot (id) {
  const idx = store.groups.findIndex((g) => g.id === id)
  if (idx === -1) return
  const [item] = store.groups.splice(idx, 1)
  item.parentId = null
  store.groups.push(item)
  save()
}

// ---------- 条目操作 ----------

// 新增条目
function addEntry (entry) {
  const now = Date.now()
  const item = { id: generateId(), createdAt: now, updatedAt: now, groupId: null, favorite: false, ...entry }
  store.entries.unshift(item)
  save()
  return item
}

// 批量导入：构造一次、只落盘一次，避免逐条 save 导致的卡顿
function addEntries (entries) {
  const now = Date.now()
  const items = entries.map((entry) => ({
    id: generateId(),
    createdAt: now,
    updatedAt: now,
    groupId: null,
    favorite: false,
    ...entry
  }))
  store.entries.unshift(...items)
  save()
  return items
}

// 收藏 / 取消收藏（收藏项会置顶显示）
function toggleFavorite (id) {
  const idx = store.entries.findIndex((e) => e.id === id)
  if (idx !== -1) {
    store.entries[idx] = { ...store.entries[idx], favorite: !store.entries[idx].favorite }
    save()
  }
}

// 更新条目
function updateEntry (id, patch) {
  const idx = store.entries.findIndex((e) => e.id === id)
  if (idx !== -1) {
    store.entries[idx] = { ...store.entries[idx], ...patch, updatedAt: Date.now() }
    save()
  }
}

// 删除条目
function deleteEntry (id) {
  store.entries = store.entries.filter((e) => e.id !== id)
  save()
}

// 批量删除（一次落盘）
function deleteEntries (ids) {
  const set = new Set(ids)
  store.entries = store.entries.filter((e) => !set.has(e.id))
  save()
}

// 批量移动到分组（一次落盘）
function moveEntries (ids, groupId) {
  const set = new Set(ids)
  const gid = groupId || null
  store.entries = store.entries.map((e) => (set.has(e.id) ? { ...e, groupId: gid } : e))
  save()
}

// 拖拽排序：把条目移动到另一条目标前/后
function moveEntry (id, targetId, before) {
  const from = store.entries.findIndex((e) => e.id === id)
  if (from === -1) return
  const [item] = store.entries.splice(from, 1)
  let to = store.entries.findIndex((e) => e.id === targetId)
  if (to === -1) {
    store.entries.push(item)
  } else {
    if (!before) to += 1
    store.entries.splice(to, 0, item)
  }
  save()
}

// 变更条目所属分组
function setEntryGroup (id, groupId) {
  const idx = store.entries.findIndex((e) => e.id === id)
  if (idx === -1) return
  store.entries[idx] = { ...store.entries[idx], groupId: groupId || null }
  save()
}

// 清空所有密码（保留分组结构）
function clearEntries () {
  store.entries = []
  save()
}

// ---------- 导入导出 ----------

// 导出 JSON 字符串
function exportJson () {
  return JSON.stringify(
    {
      version: 2,
      exportedAt: new Date().toISOString(),
      entries: store.entries,
      groups: store.groups
    },
    null,
    2
  )
}

// 收集分组及其所有子孙分组的 id
function collectGroupIds (groupId) {
  const ids = [groupId]
  const stack = store.groups.filter((g) => g.parentId === groupId).map((g) => g.id)
  while (stack.length) {
    const id = stack.pop()
    ids.push(id)
    store.groups.forEach((g) => { if (g.parentId === id) stack.push(g.id) })
  }
  return ids
}

// 按范围导出：'all' | 'uncat' | 'fav' | groupId（含其子分组）
function exportScopeJson (scope) {
  let entries = []
  let groups = []
  if (scope === 'all') {
    entries = store.entries
    groups = store.groups
  } else if (scope === 'uncat') {
    entries = store.entries.filter((e) => !e.groupId)
  } else if (scope === 'fav') {
    entries = store.entries.filter((e) => e.favorite)
  } else if (scope) {
    const ids = collectGroupIds(scope)
    entries = store.entries.filter((e) => ids.includes((e.groupId || null)))
    groups = store.groups.filter((g) => ids.includes(g.id))
  }
  return JSON.stringify(
    { version: 2, exportedAt: new Date().toISOString(), scope: scope || '', entries, groups },
    null,
    2
  )
}

// 导入 JSON 字符串（替换现有条目与分组）
function importJson (jsonText) {
  const data = JSON.parse(jsonText)
  const list = Array.isArray(data) ? data : data.entries
  if (!Array.isArray(list)) throw new Error('文件格式不正确')
  const cleaned = list.filter((e) => e && typeof e === 'object')
  store.entries = cleaned
  store.groups = Array.isArray(data.groups) ? data.groups.filter((g) => g && g.name) : []
  save()
}

export {
  store,
  initialize,
  save,
  setMasterPassword,
  unlock,
  lock,
  changeMasterPassword,
  disableMasterPassword,
  setSyncEnabled,
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
  renameGroup,
  deleteGroup,
  deleteGroupDeep,
  moveGroup,
  moveGroupToRoot,
  exportJson,
  exportScopeJson,
  importJson,
  generateId
}
