import { createApp } from 'vue'
import './main.css'
import App from './App.vue'

// 运行时报错显示为可见的面板，避免 uTools 里静默空白
function showError (msg) {
  let el = document.getElementById('boot-error')
  if (!el) {
    el = document.createElement('div')
    el.id = 'boot-error'
    el.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:#1f2329;color:#ff7369;' +
      'font-family:Consolas,monospace;font-size:13px;line-height:1.6;padding:24px;' +
      'white-space:pre-wrap;overflow:auto;'
    document.body.appendChild(el)
  }
  el.textContent = '插件运行出错，请把下面的信息发给开发者：\n\n' + msg
}

window.addEventListener('error', (e) => {
  showError((e.message || e.error) + '\n' + (e.filename || '') + (e.lineno ? ':' + e.lineno : ''))
})

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason && (e.reason.stack || e.reason.message) || e.reason
  showError('Promise 未处理异常：\n' + reason)
})

createApp(App).mount('#app')
