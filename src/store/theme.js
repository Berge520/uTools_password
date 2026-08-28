import { ref } from 'vue'

const KEY = 'app_theme'
const THEMES = ['light', 'dark', 'sepia']

export const theme = ref('light')

function apply (t) {
  const root = document.documentElement
  // 切换期间禁用所有过渡，避免大量元素同时动画导致卡顿
  root.classList.add('no-anim')
  root.setAttribute('data-theme', t)
  // 双 rAF：确保本次样式计算以“无过渡”状态完成后再恢复动画
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove('no-anim'))
  })
}

function read () {
  try {
    if (window.utools && window.utools.dbStorage) {
      return window.utools.dbStorage.getItem(KEY) || null
    }
  } catch (e) {}
  try {
    return window.localStorage.getItem(KEY)
  } catch (e) {}
  return null
}

function write (t) {
  try {
    if (window.utools && window.utools.dbStorage) {
      window.utools.dbStorage.setItem(KEY, t)
      return
    }
  } catch (e) {}
  try {
    window.localStorage.setItem(KEY, t)
  } catch (e) {}
}

export function loadTheme () {
  const t = read()
  theme.value = THEMES.includes(t) ? t : 'light'
  apply(theme.value)
}

export function setTheme (t) {
  theme.value = THEMES.includes(t) ? t : 'light'
  apply(theme.value)
  write(theme.value)
}

export function cycleTheme () {
  const i = THEMES.indexOf(theme.value)
  setTheme(THEMES[(i + 1) % THEMES.length])
}
