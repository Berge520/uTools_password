import { reactive } from 'vue'

// 偏好设置存储键（仅本地，不同步）
const KEY = 'password_pref'

export const pref = reactive({
  // 版本更新检查（联网）
  versionCheck: true,
  // 离线模式：关闭所有需要联网的功能（版本检查 / WebDAV 云备份 / uTools 数据同步）
  offlineMode: false
})

export function loadPref () {
  try {
    const s = JSON.parse(window.localStorage.getItem(KEY) || '{}')
    if (typeof s.versionCheck === 'boolean') pref.versionCheck = s.versionCheck
    if (typeof s.offlineMode === 'boolean') pref.offlineMode = s.offlineMode
  } catch (e) {}
}

export function savePref () {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      versionCheck: pref.versionCheck,
      offlineMode: pref.offlineMode
    }))
  } catch (e) {}
}
