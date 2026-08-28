import { ref } from 'vue'

// uTools 会员 / 数据同步状态（判断是否能备份到 uTools 服务端）
export const member = ref({
  loggedIn: false,  // 是否登录 uTools 账号
  syncing: false,   // uTools 数据同步已开启并生效（会员专属）
  syncState: null   // replicateStateFromCloud 原值：null | 0 | 1
})

// 检测 uTools 登录与数据同步状态
export function refreshMember () {
  let loggedIn = false
  let syncing = false
  let syncState = null
  try {
    loggedIn = !!(window.utools && window.utools.getUser && window.utools.getUser())
  } catch (e) {
    loggedIn = false
  }
  try {
    const f = window.utools && window.utools.db && window.utools.db.replicateStateFromCloud
    if (typeof f === 'function') {
      syncState = f()
      syncing = syncState === 0 || syncState === 1
    }
  } catch (e) {
    syncState = null
  }
  member.value = { loggedIn, syncing, syncState }
  return member.value
}
