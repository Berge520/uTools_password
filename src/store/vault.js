import { reactive } from 'vue'
import { showToast } from '../utils/toast'
import { member, refreshMember } from './member'

// utools.dbStorage 存储键
const STORAGE_KEY = 'password_vault'

// uTools dbStorage 单键上限约 1MB（写超限会抛 “doc max size 1M”），此处留余量
const DB_MAX_BYTES = 900 * 1024

// 全局响应式状态
const store = reactive({
  ready: false,     // 已完成初始化
  secured: false,   // 是否启用了主密码
  locked: true,     // 是否处于锁定状态
  entries: [],      // 当前条目（未加密 / 已解锁时存在）
  groups: [],       // 分组：[{ id, name, parentId }]
  syncEnabled: true, // 是否写入可被 uTools 同步的 dbStorage（关闭则仅本地文件）
  syncBlocked: false, // 非付费用户：云端同步被锁定
  autoLockMinutes: 5, // 主密码空闲自动锁定分钟数（0=关闭）
  unlockError: '',  // 解锁错误提示
  bootNotice: '',   // 启动提示（如未在 uTools 环境）
  quickSearch: true, // uTools 搜索框输入文字后进入插件时，自动作为搜索关键词
  initialSearch: '',  // onPluginEnter 传入的初始搜索词（仅 quickSearch 开启时使用）
  pendingAction: null  // 匹配指令入口的待处理动作 { type: 'import'|'decode-qr', payload }
})

let currentBlob = null  // 加密模式下的密文对象
let masterPassword = ''  // 仅存在于内存的主密码

function generateId () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// 生成可跨上下文克隆的纯对象（Vue 响应式代理不能被 structuredClone，须先转纯数据）
// 条目/分组均为原始类型字段，浅拷贝即可，避免对全量数据做 JSON 序列化深拷贝（大库卡顿主因）
function toPlain (value) {
  if (Array.isArray(value)) return value.map((v) => (v && typeof v === 'object' ? { ...v } : v))
  if (value && typeof value === 'object') return { ...value }
  return value
}

// ---------- 自动锁定分钟数（存 localStorage）----------
function loadAutoLock () {
  try {
    const v = parseInt(window.localStorage.getItem('password_autolock'), 10)
    return Number.isFinite(v) && v >= 0 ? v : 5
  } catch (e) {
    return 5
  }
}

function setAutoLock (minutes) {
  const m = Math.max(0, parseInt(minutes, 10) || 0)
  store.autoLockMinutes = m
  try {
    window.localStorage.setItem('password_autolock', String(m))
  } catch (e) {}
  return m
}

// ---------- 快速搜索开关（存 localStorage）----------
function loadQuickSearch () {
  try {
    return window.localStorage.getItem('password_quick_search') !== '0'
  } catch (e) {
    return true
  }
}

function setQuickSearch (on) {
  store.quickSearch = !!on
  try {
    window.localStorage.setItem('password_quick_search', on ? '1' : '0')
  } catch (e) {}
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

// 计算 blob 序列化后的 UTF-8 字节数（dbStorage 以字节计上限）
function blobBytes (blob) {
  try {
    return new TextEncoder().encode(JSON.stringify(blob)).length
  } catch (e) {
    return 0
  }
}

// uTools dbStorage 写入一旦超过单键上限会直接抛错导致插件崩溃。
// 遇超限时改用本地文件存储并关闭同步，保证数据不丢、不再报 “doc max size 1M”。
// 注意：不得删除 dbStorage 里的云端副本——删除会经 uTools 同步传播到所有设备。
function fallbackToLocal (blob) {
  try { window.services.storeLocalData(JSON.stringify(blob)) } catch (e) {}
  if (store.syncEnabled) {
    store.syncEnabled = false
    saveSyncFlag(false)
    showToast('数据量超过 uTools 同步上限（约 1MB），已切换为仅本地存储')
  }
}

// 写入可同步后端；返回是否真的写入了 dbStorage（false 表示已自动回退到本地文件）
function writeDbBlob (blob) {
  // 提前拦截超限数据，避免触发 LevelDB 的 “doc max size 1M” 报错
  if (blobBytes(blob) > DB_MAX_BYTES) {
    fallbackToLocal(blob)
    return false
  }
  try {
    window.utools.dbStorage.setItem(STORAGE_KEY, blob)
    return true
  } catch (e) {
    fallbackToLocal(blob)
    return false
  }
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

// 启动时数据归位：db 有数据以 db 为准，仅文件有数据则用文件。
// 任何情况下都不删除 dbStorage 云端副本（删除会经 uTools 同步传播到所有设备）。
function normalizeBackend () {
  const db = readDbBlob()
  const local = readFileBlob()
  if (store.syncEnabled) {
    if (db != null) {
      if (local != null) clearFileBlob()
      return
    }
    if (local != null) {
      writeDbBlob(local)
      // 超限回退时 writeDbBlob 已切回本地并写好文件，此时不能再清文件
      if (store.syncEnabled) clearFileBlob()
    }
  } else {
    if (local != null) return
    if (db != null) writeFileBlob(db)
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

// 获取当前持久化数据（加密或明文的 blob）用于云端备份
function getBackupBlob () {
  return loadBlob()
}

// 从云端 blob 恢复：写回当前生效后端并刷新内存状态
function saveBlobFromBackup (blob) {
  if (!blob) return
  currentBlob = blob
  if (blob.mode === 'encrypted') {
    store.secured = true
    store.locked = true
    store.entries = []
    store.groups = []
    clearSessionKey()
  } else {
    store.secured = false
    store.locked = false
    masterPassword = ''
    clearSessionKey()
    store.entries = Array.isArray(blob.entries) ? blob.entries : []
    store.groups = Array.isArray(blob.groups) ? blob.groups : []
  }
  normalizeEntryOrder()
  persistBlob(blob)
}

// 开启 / 关闭数据同步：把当前数据迁移到新后端。
// 关闭同步时保留 dbStorage 云端副本（删除会传播到所有设备）；开启时清理本地旧副本。
function setSyncEnabled (on) {
  on = !!on
  if (on && !member.value.syncing) return { ok: false, blocked: true }
  if (on === store.syncEnabled) return { ok: true }
  // 先把当前内存数据落到原后端，确保迁移的是最新数据。
  // 加密模式只看 secured：宽限期自动解锁后 masterPassword 为空但 sessionKey 可用，
  // 若按 masterPassword 判断会误走明文落盘，把密码明文同步上云。
  if (store.secured) persistEncrypted()
  else persistPlain()
  // 落盘时若超限已自动回退本地（syncEnabled 已被翻转），无需再迁移
  if (on === store.syncEnabled) return { ok: true }
  const fromDb = store.syncEnabled
  const src = fromDb ? readDbBlob() : readFileBlob()
  if (src != null) {
    if (on) {
      // 开启同步：若数据超过 dbStorage 上限，writeDbBlob 会自动回退本地并关闭同步
      if (!writeDbBlob(src)) {
        return { ok: false, blocked: true }
      }
      clearFileBlob()
    } else {
      writeFileBlob(src)
    }
  }
  store.syncEnabled = on
  saveSyncFlag(on)
  return { ok: true }
}

// 启动时云端数据可能仍在拉取（replicateStateFromCloud() === 1），
// 立即读库会拿到空数据并可能把空库写回云端。等待拉取完成，最长约 10 秒。
function waitForCloudPull () {
  const db = window.utools && window.utools.db
  if (!db || typeof db.replicateStateFromCloud !== 'function') return Promise.resolve()
  return new Promise((resolve) => {
    let tries = 0
    const tick = () => {
      if (db.replicateStateFromCloud() !== 1 || tries >= 33) return resolve()
      tries++
      setTimeout(tick, 300)
    }
    tick()
  })
}

// 初始化：读取本地存储并判断模式。
// onMounted 与 onPluginEnter 都会调用，用序号防止并发的旧初始化覆盖新结果。
let initSeq = 0
async function initialize () {
  const seq = ++initSeq
  currentBlob = null
  sessionKey = null
  store.unlockError = ''
  store.bootNotice = ''

  // 未在 uTools 环境（例如直接在浏览器打开 dev 页面）
  if (!window.utools || !window.utools.dbStorage) {
    store.secured = false
    store.locked = false
    store.entries = []
    store.groups = []
    store.syncEnabled = true
    store.autoLockMinutes = loadAutoLock()
    store.quickSearch = loadQuickSearch()
    store.ready = true
    store.bootNotice = '未检测到 uTools 环境，请通过 uTools 插件开发工具打开本插件。'
    return
  }

  store.syncEnabled = loadSyncFlag()
  store.autoLockMinutes = loadAutoLock()
  store.quickSearch = loadQuickSearch()

  await waitForCloudPull()
  if (seq !== initSeq) return

  // 非会员 / 未开数据同步：仅标记受限，不强制迁移删除——dbStorage 本身即本地存储，
  // 云端副本必须保留（删除会经 uTools 同步传播到所有设备）
  const m = refreshMember()
  store.syncBlocked = !m.syncing

  try {
    normalizeBackend()
    const raw = loadBlob()

    if (!raw) {
      // 尚无任何数据：默认明文模式，直接进入
      store.secured = false
      store.locked = false
      store.entries = []
      store.groups = []
    } else if (raw.mode === 'encrypted') {
      // 已加密：需解锁，但若宽限期内可自动解锁
      store.secured = true
      store.locked = true
      store.entries = []
      store.groups = []
      currentBlob = raw
      tryAutoUnlock()
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
  normalizeEntryOrder()
  store.ready = true
}

// 其他设备的数据经 uTools 同步到达（onDbPull）时应用远程更新。
// 仅本地模式忽略；锁定中更新密文并尝试宽限期自动解锁；
// 已解锁则用内存密钥解密刷新，密钥不匹配（其他设备改了主密码）时锁定。
function handleDbPull () {
  if (!store.syncEnabled) return
  const incoming = readDbBlob()
  if (!incoming) return
  if (incoming.mode === 'encrypted') {
    currentBlob = incoming
    store.secured = true
    if (store.locked) {
      store.entries = []
      store.groups = []
      tryAutoUnlock()
    } else {
      try {
        let plain
        if (sessionKey) plain = window.services.decryptDataWithKey(incoming, sessionKey)
        else if (masterPassword) plain = window.services.decryptData(incoming, masterPassword)
        else throw new Error('no key')
        const data = JSON.parse(plain)
        store.entries = Array.isArray(data) ? data : (Array.isArray(data.entries) ? data.entries : [])
        store.groups = Array.isArray(data) ? [] : (Array.isArray(data.groups) ? data.groups : [])
        showToast('已同步其他设备的数据')
      } catch (e) {
        lock()
        showToast('其他设备修改了主密码，请重新解锁')
      }
    }
  } else {
    currentBlob = null
    masterPassword = ''
    store.secured = false
    store.locked = false
    clearSessionKey()
    store.entries = Array.isArray(incoming.entries) ? incoming.entries : []
    store.groups = Array.isArray(incoming.groups) ? incoming.groups : []
    showToast('已同步其他设备的数据')
  }
  normalizeEntryOrder()
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
  // 锁定态 entries 为空且无可用密钥语义，禁止落盘，避免把空库加密覆盖真实密文
  if (store.locked) return
  const payload = JSON.stringify({ entries: store.entries, groups: store.groups })
  const salt = currentBlob ? currentBlob.salt : ''
  // 优先复用已派生的会话密钥（与主密码等价），避免每次保存都重跑 PBKDF2（大库加密卡顿主因）
  if (sessionKey && salt) {
    currentBlob = window.services.encryptDataWithKey(payload, salt, sessionKey, currentBlob.iter)
  } else if (masterPassword) {
    // 首次启用 / 会话密钥尚未派生的场景：用主密码派生并生成新 salt
    currentBlob = window.services.encryptData(payload, masterPassword)
  } else {
    // 兜底：理论上不应发生
    return
  }
  persistBlob(currentBlob)
}

function save () {
  normalizeEntryOrder()
  if (store.secured) {
    persistEncrypted()
  } else {
    persistPlain()
  }
}

// 列表顺序不变量：收藏项恒定在前，分区内保持原有相对顺序（稳定分区）。
// 拖拽/收藏/导入等写入口最终都经过 save()，统一在此归一，界面不再需要二次排序。
function normalizeEntryOrder () {
  const list = store.entries
  let seenUnfav = false
  let need = false
  for (const e of list) {
    if (e.favorite) { if (seenUnfav) { need = true; break } } else seenUnfav = true
  }
  if (!need) return
  const favs = []
  const rest = []
  for (const e of list) (e.favorite ? favs : rest).push(e)
  store.entries = favs.concat(rest)
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
// 会话密钥（宽限期自动解锁）。仅在设定了自动锁定时才保存密钥；锁定/过期即删除
let sessionKey = null

function saveSessionKey () {
  if (!store.secured || !sessionKey || !store.autoLockMinutes) return
  try {
    window.services.storeSession({ key: sessionKey, expireAt: Date.now() + store.autoLockMinutes * 60000 })
  } catch (e) {}
}

function clearSessionKey () {
  sessionKey = null
  try {
    window.services.clearSession()
  } catch (e) {}
}

// 每次有活动时刷新宽限期（会话过期时间 = 最近活动 + 设定时长）
function touchSession () {
  if (!store.secured || store.locked || !sessionKey) return
  if (!store.autoLockMinutes) return
  saveSessionKey()
}

// 重进插件时，若会话密钥未过期则自动解锁
function tryAutoUnlock () {
  if (!store.secured || !currentBlob) return false
  if (!store.autoLockMinutes) return false
  let s = null
  try {
    s = window.services.readSession()
  } catch (e) {
    return false
  }
  if (!s || !s.key || !s.expireAt || Date.now() > s.expireAt) {
    sessionKey = null
    try { window.services.clearSession() } catch (e) {}
    return false
  }
  try {
    const plain = window.services.decryptDataWithKey(currentBlob, s.key)
    const data = JSON.parse(plain)
    store.entries = Array.isArray(data) ? data : (Array.isArray(data.entries) ? data.entries : [])
    store.groups = Array.isArray(data) ? [] : (Array.isArray(data.groups) ? data.groups : [])
    store.locked = false
    sessionKey = s.key
    normalizeEntryOrder()
    return true
  } catch (e) {
    sessionKey = null
    return false
  }
}

function setMasterPassword (pw) {
  masterPassword = pw
  store.secured = true
  store.locked = false
  save()
  // 记录会话密钥，便于宽限期自动解锁
  try {
    sessionKey = window.services.deriveKeyBase64(pw, currentBlob.salt, currentBlob.iter)
    saveSessionKey()
  } catch (e) {}
  return true
}

// 解锁
function unlock (pw) {
  // 重进插件时初始化会先清空 currentBlob 再等待云端拉取，期间应提示稍候而非“密码错误”
  if (!currentBlob) {
    store.unlockError = '数据加载中，请稍候重试'
    return { ok: false }
  }
  try {
    const plain = window.services.decryptData(currentBlob, pw)
    const data = JSON.parse(plain)
    // 兼容旧格式：早期只加密了数组，新格式为 { entries, groups }
    store.entries = Array.isArray(data) ? data : (Array.isArray(data.entries) ? data.entries : [])
    store.groups = Array.isArray(data) ? [] : (Array.isArray(data.groups) ? data.groups : [])
    normalizeEntryOrder()
    masterPassword = pw
    store.locked = false
    store.unlockError = ''
    try {
      sessionKey = window.services.deriveKeyBase64(pw, currentBlob.salt, currentBlob.iter)
    } catch (e) {}
    saveSessionKey()
    return { ok: true }
  } catch (e) {
    store.unlockError = '主密码错误，请重试'
    return { ok: false }
  }
}

// 锁定（清空内存中的密码与条目）；preserveSession 用于「退出插件」场景，保留宽限期会话
function lock (preserveSession = false) {
  masterPassword = ''
  store.entries = []
  store.groups = []
  store.locked = true
  store.unlockError = ''
  if (!preserveSession) clearSessionKey()
}

// 修改主密码（需先验证旧密码）
function changeMasterPassword (oldPw, newPw) {
  if (!verifyPassword(oldPw)) return { ok: false, error: '当前主密码不正确' }
  // 强制用新密码重新加密（encryptData 生成新 salt，不复用旧 salt）；
  // 加密/派生全部成功后才替换内存状态，失败时不得留下「新 salt + 旧密钥」的混合状态
  let blob, key
  try {
    const payload = JSON.stringify({ entries: store.entries, groups: store.groups })
    blob = window.services.encryptData(payload, newPw)
    key = window.services.deriveKeyBase64(newPw, blob.salt, blob.iter)
  } catch (e) {
    return { ok: false, error: '修改主密码失败：' + (e && e.message ? e.message : e) }
  }
  currentBlob = blob
  sessionKey = key
  masterPassword = newPw
  persistBlob(currentBlob)
  saveSessionKey()
  return { ok: true }
}

// 关闭/移除主密码（需先验证当前密码）
function disableMasterPassword (pw) {
  if (!verifyPassword(pw)) return { ok: false, error: '当前主密码不正确' }
  masterPassword = ''
  store.secured = false
  store.locked = false
  clearSessionKey()
  persistPlain()
  return { ok: true }
}

// ---------- 分组操作 ----------

function findGroup (id) {
  return store.groups.find((g) => g.id === id)
}

// 把分组树拍平为带层级深度的列表（用于下拉选择等）：[{ id, name, depth }]
function flattenGroups (groups) {
  const list = []
  const walk = (parentId, depth) => {
    groups.filter((g) => (g.parentId || null) === parentId).forEach((g) => {
      list.push({ id: g.id, name: g.name, depth })
      walk(g.id, depth + 1)
    })
  }
  walk(null, 0)
  return list
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
// 返回 false 表示因成环被拒绝（调用方应给出提示），true 表示已移动
function moveGroup (id, targetId, mode) {
  const idx = store.groups.findIndex((g) => g.id === id)
  if (idx === -1) return false
  if (id === targetId) return false
  // before/after 会让 item 成为 target 的同级；若 target 在 item 的子孙链上，
  // item.parentId 将指向自己的子孙 → 成环（分组从树上消失，遍历死循环）
  if (mode !== 'inside') {
    // visited 防护：历史数据里可能存在环（旧版拖拽产生），无防护会死循环
    const seen = new Set()
    let cursor = findGroup(targetId)
    while (cursor && !seen.has(cursor.id)) {
      if (cursor.id === id) return false
      seen.add(cursor.id)
      cursor = findGroup(cursor.parentId)
    }
  }
  const [item] = store.groups.splice(idx, 1)

  if (mode === 'inside') {
    // 成为 target 的子级
    item.parentId = targetId
    store.groups.push(item)
    // 阻止循环引用：若 target 的祖先包含 item，回退
    let cycle = false
    const seen = new Set()
    let cursor = findGroup(targetId)
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      if (cursor.id === item.id) {
        item.parentId = null
        cycle = true
        break
      }
      cursor = findGroup(cursor.parentId)
    }
    save()
    return !cycle
  }
  const tIdx = store.groups.findIndex((g) => g.id === targetId)
  const target = store.groups[tIdx]
  item.parentId = target ? target.parentId : null
  // 防止把自己移到自己的子孙下（before/after 一级不做深层校验，inside 已处理）
  store.groups.splice(mode === 'before' ? tIdx : tIdx + 1, 0, item)
  save()
  return true
}

// 把分组移到顶层（parentId = null）
// 批量删除分组：子分组与条目移到最近“未被删除”的上级（或未分组）
function deleteGroups (ids) {
  const set = new Set(ids)
  if (!set.size) return
  const gmap = {}
  store.groups.forEach((g) => { gmap[g.id] = g })
  function nearestAncestorId (pid) {
    // 删除集合内部若存在历史环，不设防会死循环（环内都“仍需上移”）
    const seen = new Set()
    let cur = gmap[pid]
    let p = pid
    while (cur && set.has(p)) {
      if (seen.has(p)) return null
      seen.add(p)
      p = cur.parentId || null
      cur = gmap[p]
    }
    return p || null
  }
  const remaining = store.groups.filter((g) => !set.has(g.id))
  for (const g of remaining) {
    if (set.has(g.parentId)) g.parentId = nearestAncestorId(g.parentId)
  }
  store.entries = store.entries.map((e) => set.has(e.groupId) ? { ...e, groupId: nearestAncestorId(e.groupId) } : e)
  store.groups = remaining
  save()
}

// 批量移动分组：把所选分组挂到目标父级下（目标若是所选之一则移到顶层，避免环）
// 返回 false 表示因成环被拒绝（调用方应给出提示）
function moveGroups (ids, targetParentId) {
  const set = new Set(ids)
  if (!set.size) return false
  const gid = targetParentId || null
  // 目标若是被移分组的子孙，挂上去会成环 → 拒绝整个操作
  if (gid && !set.has(gid)) {
    const seen = new Set()
    let cursor = findGroup(gid)
    while (cursor && !seen.has(cursor.id)) {
      if (set.has(cursor.id)) return false
      seen.add(cursor.id)
      cursor = findGroup(cursor.parentId)
    }
  }
  store.groups = store.groups.map((g) => set.has(g.id) ? { ...g, parentId: set.has(gid) ? null : gid } : g)
  save()
  return true
}
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

// 更新条目；条目不存在（如已被其他设备删除）返回 false
function updateEntry (id, patch) {
  const idx = store.entries.findIndex((e) => e.id === id)
  if (idx === -1) return false
  store.entries[idx] = { ...store.entries[idx], ...patch, updatedAt: Date.now() }
  save()
  return true
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

// 拖拽排序：把条目移动到另一条目标前/后。
// 收藏区与未收藏区互不穿插（与「收藏并置顶」一致）：跨区拖拽时吸附到分区边界——
// 未收藏项落在收藏区之后，收藏项落在收藏区末尾。
function moveEntry (id, targetId, before) {
  const from = store.entries.findIndex((e) => e.id === id)
  if (from === -1) return
  const item = store.entries[from]
  const target = store.entries.find((e) => e.id === targetId)
  if (!target) return
  const crossZone = !!item.favorite !== !!target.favorite
  const list = store.entries.filter((e) => e.id !== id)
  let anchorId = targetId
  let anchorBefore = !!before
  if (crossZone) {
    if (item.favorite) {
      // 收藏项拖入未收藏区 → 收藏区末尾：插在最后一个收藏项之后
      const lastFav = [...list].reverse().find((e) => e.favorite)
      if (lastFav) { anchorId = lastFav.id; anchorBefore = false } else { anchorId = null }
    } else {
      // 未收藏项拖入收藏区 → 收藏区之后：插在第一个未收藏项之前
      const firstUnfav = list.find((e) => !e.favorite)
      if (firstUnfav) { anchorId = firstUnfav.id; anchorBefore = true } else { anchorId = null }
    }
  }
  let to
  if (anchorId == null) {
    to = item.favorite ? list.length : 0
  } else {
    to = list.findIndex((e) => e.id === anchorId)
    if (to === -1) to = list.length
    else if (!anchorBefore) to += 1
  }
  list.splice(to, 0, item)
  store.entries = list
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

// 收集分组及其所有子孙分组的 id（visited 防御历史脏数据中的环，避免死循环）
function collectGroupIds (groupId) {
  const ids = [groupId]
  const visited = new Set(ids)
  const stack = store.groups.filter((g) => g.parentId === groupId).map((g) => g.id)
  while (stack.length) {
    const id = stack.pop()
    if (visited.has(id)) continue
    visited.add(id)
    ids.push(id)
    store.groups.forEach((g) => { if (g.parentId === id) stack.push(g.id) })
  }
  return ids
}

// 按范围获取条目：'all' | 'uncat' | 'fav' | groupId（含其子分组）
function getScopeEntries (scope) {
  if (scope === 'uncat') return store.entries.filter((e) => !e.groupId)
  if (scope === 'fav') return store.entries.filter((e) => e.favorite)
  if (scope && scope !== 'all') {
    const ids = collectGroupIds(scope)
    return store.entries.filter((e) => ids.includes((e.groupId || null)))
  }
  return store.entries.slice()
}

// 按范围导出：'all' | 'uncat' | 'fav' | groupId（含其子分组）
function exportScopeJson (scope) {
  const entries = getScopeEntries(scope)
  let groups = []
  if (scope === 'all') {
    groups = store.groups
  } else if (scope && scope !== 'uncat' && scope !== 'fav') {
    const ids = collectGroupIds(scope)
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
  const now = Date.now()
  // 补齐 id/时间戳：缺 id 的条目无法更新/收藏，且 deleteEntry(undefined) 会误删所有无 id 条目
  store.entries = list
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      favorite: false,
      ...e,
      id: e.id || generateId(),
      createdAt: e.createdAt || now,
      updatedAt: e.updatedAt || now,
      groupId: e.groupId || null
    }))
  store.groups = (Array.isArray(data.groups) ? data.groups : [])
    .filter((g) => g && g.name)
    .map((g) => ({ ...g, id: g.id || generateId(), parentId: g.parentId || null }))
  save()
}

// 合并式导入：保留现有数据，把文件的条目追加进来，并按名称复用/新建分组（保留文件层级）
function importMerge (jsonText) {
  const data = JSON.parse(jsonText)
  const fileGroups = Array.isArray(data.groups) ? data.groups : []
  const fileEntries = Array.isArray(data) ? data : (Array.isArray(data.entries) ? data.entries : [])
  if (!fileEntries.length && !fileGroups.length) throw new Error('文件格式不正确')

  const groupByName = {}
  store.groups.forEach((g) => { if (!(g.name in groupByName)) groupByName[g.name] = g })
  const idMap = {}
  const created = []
  // 第一遍：按名称复用/新建分组（先不挂层级，父组可能排在文件后面）
  fileGroups.forEach((fg) => {
    if (!fg || !fg.name) return
    if (!groupByName[fg.name]) {
      const ng = { id: generateId(), name: fg.name, parentId: null }
      groupByName[fg.name] = ng
      store.groups.push(ng)
      created.push({ ng, fg })
    }
    idMap[fg.id] = groupByName[fg.name].id
  })
  // 第二遍：新建分组按文件 parentId 经 idMap 重建层级（已有本地分组不动其层级）
  created.forEach(({ ng, fg }) => {
    if (fg.parentId && idMap[fg.parentId] && idMap[fg.parentId] !== ng.id) {
      ng.parentId = idMap[fg.parentId]
    }
  })

  // 去重：与现有条目或文件内前面条目完全相同（标题+账号+密码+网址）的跳过
  const keyOf = (e) => [e.title || '', e.username || '', e.password || '', e.url || ''].join('\u0000')
  const seen = new Set(store.entries.map(keyOf))
  const entries = []
  for (const e of fileEntries) {
    if (!e || typeof e !== 'object') continue
    const item = {
      title: e.title || '',
      username: e.username || '',
      password: e.password || '',
      url: e.url || '',
      notes: e.notes || '',
      otp: e.otp,
      favorite: !!e.favorite,
      isWifi: !!e.isWifi,
      wifiType: e.wifiType,
      wifiHidden: e.wifiHidden,
      groupId: e.groupId ? (idMap[e.groupId] || null) : null
    }
    const k = keyOf(item)
    if (seen.has(k)) continue
    seen.add(k)
    entries.push(item)
  }
  if (entries.length) addEntries(entries)
  else if (created.length) save()
  return entries.length
}
export {
  store,
  initialize,
  handleDbPull,
  save,
  setMasterPassword,
  unlock,
  lock,
  changeMasterPassword,
  disableMasterPassword,
  setSyncEnabled,
  setAutoLock,
  setQuickSearch,
  touchSession,
  tryAutoUnlock,
  getBackupBlob,
  saveBlobFromBackup,
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
  flattenGroups,
  renameGroup,
  deleteGroup,
  deleteGroupDeep,
  deleteGroups,
  moveGroups,
  moveGroup,
  moveGroupToRoot,
  exportJson,
  exportScopeJson,
  getScopeEntries,
  importJson,
  importMerge,
  generateId
}
