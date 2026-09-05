<script setup>
import { reactive, ref, computed, watch } from 'vue'
import { addEntry } from '../store/vault'
import { parseShareText } from '../utils/shareParse'
import { showToast } from '../utils/toast'
import { readClipboardContent } from '../utils/qrScan'
import GroupPicker from './GroupPicker.vue'
import QrScanButtons from './QrScanButtons.vue'

const props = defineProps({
  defaultGroupId: { type: String, default: null }
})
const emit = defineEmits(['close'])

const tab = ref('text') // text | qr
const rawText = ref('')
const notice = ref('') // 识别成功但内容非标准密码格式时的提示
const error = ref('')
const reading = ref(false)

const form = reactive({
  isWifi: false,
  title: '',
  username: '',
  password: '',
  url: '',
  notes: '',
  otp: null,
  wifiType: 'WPA',
  wifiHidden: false
})

const groupId = ref(props.defaultGroupId || null)

const parsed = computed(() => parseShareText(rawText.value))

// 解析结果变化时同步到可编辑表单
watch(parsed, (p) => {
  if (!p) {
    form.isWifi = false
    form.title = ''
    form.username = ''
    form.password = ''
    form.url = ''
    form.notes = ''
    form.otp = null
    form.wifiType = 'WPA'
    form.wifiHidden = false
    return
  }
  form.isWifi = !!p.isWifi
  form.title = p.title || ''
  form.username = p.username || ''
  form.password = p.password || ''
  form.url = p.url || ''
  form.notes = p.notes || ''
  form.otp = p.otp || null
  form.wifiType = p.wifiType || 'WPA'
  form.wifiHidden = !!p.wifiHidden
}, { immediate: true })

const wifiTypeLabel = computed(() => ({
  WPA: 'WPA / WPA2 / WPA3',
  WEP: 'WEP',
  nopass: '无密码'
}[form.wifiType] || form.wifiType))

function applyContent (text, sourceLabel) {
  rawText.value = text
  const p = parseShareText(text)
  if (!p || !p.matched) {
    notice.value = '已识别内容，但不是标准密码 / WiFi 分享格式，可在下方手动整理后保存。'
  } else {
    notice.value = ''
    showToast(p.isWifi ? `已识别 WiFi 信息（来自${sourceLabel}）` : `已识别分享内容（来自${sourceLabel}）`)
  }
}

function onScanned (text, source) {
  applyContent(text, source || '二维码')
}

async function pasteFromClipboard () {
  reading.value = true
  try {
    const r = await readClipboardContent()
    if (!r.ok) {
      showToast(r.reason === 'no-qr-in-image' ? '剪贴板是图片，但其中未识别到二维码' : '剪贴板没有文字或图片内容')
      return
    }
    applyContent(r.text, r.from === 'image' ? '剪贴板图片' : '剪贴板')
  } finally {
    reading.value = false
  }
}

function save () {
  error.value = ''
  if (!form.title.trim()) {
    error.value = form.isWifi ? '请填写 WiFi 网络名称（SSID）' : '请填写标题'
    return
  }
  addEntry({
    title: form.title.trim(),
    username: form.isWifi ? '' : form.username.trim(),
    password: form.password,
    url: form.isWifi ? '' : form.url.trim(),
    notes: form.notes.trim(),
    groupId: groupId.value || null,
    isWifi: form.isWifi ? true : undefined,
    wifiType: form.isWifi ? form.wifiType : undefined,
    wifiHidden: form.isWifi ? form.wifiHidden : undefined,
    otp: form.otp || undefined
  })
  showToast('已添加到密码库')
  emit('close')
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal recv">
      <h3>接收分享密码</h3>
      <p class="recv-sub">粘贴好友分享的密码文字，或扫描 / 选择分享二维码，识别核对后即可加入密码库。</p>

      <div class="recv-tabs">
        <button class="recv-tab" :class="{ on: tab === 'text' }" @click="tab = 'text'">📝 粘贴文字</button>
        <button class="recv-tab" :class="{ on: tab === 'qr' }" @click="tab = 'qr'">📷 识别二维码</button>
      </div>

      <div v-if="tab === 'text'" class="recv-source">
        <div class="recv-clip">
          <button class="btn sm primary" :disabled="reading" @click="pasteFromClipboard">📋 从剪贴板读取</button>
          <span class="recv-clip-hint">支持文字或图片，图片自动识别二维码</span>
        </div>
        <textarea
          v-model="rawText"
          class="recv-editor mono-font"
          rows="6"
          placeholder="支持格式示例：&#10;标题：GitHub&#10;账号：user@example.com&#10;密码：abc123&#10;网址：https://github.com&#10;备注：可选&#10;&#10;也支持 WiFi 二维码内容（WIFI:T:WPA;S:…）"
        ></textarea>
      </div>

      <div v-else class="recv-source">
        <QrScanButtons @detected="onScanned" />
        <div v-if="notice" class="scan-notice">{{ notice }}</div>
        <details v-if="rawText" class="recv-raw">
          <summary>识别到的原始内容</summary>
          <div class="recv-raw-text mono-font">{{ rawText }}</div>
        </details>
      </div>

      <div v-if="parsed" class="recv-parsed">
        <div class="recv-badges">
          <span v-if="form.isWifi" class="badge-wifi">📶 WiFi 直连 · {{ wifiTypeLabel }}<template v-if="form.wifiHidden"> · 隐藏网络</template></span>
          <span v-else-if="form.otp" class="badge-otp">✅ 含两步验证（TOTP）</span>
          <span v-else-if="parsed.matched" class="badge-ok">✅ 已识别密码信息</span>
          <span v-else class="badge-plain">📄 未识别标准格式，可手动整理后保存</span>
        </div>

        <div class="field">
          <label>{{ form.isWifi ? '网络名称 (SSID)' : '标题' }} <i class="req">*</i></label>
          <input v-model="form.title" class="input mono-input" :placeholder="form.isWifi ? 'WiFi 名称' : '例如 GitHub / 公司邮箱'" />
        </div>

        <template v-if="!form.isWifi">
          <div class="field">
            <label>用户名 / 账号</label>
            <input v-model="form.username" class="input mono-input" placeholder="手机号 / 邮箱 / 用户名" />
          </div>
          <div class="field">
            <label>网址</label>
            <input v-model="form.url" class="input mono-input" placeholder="https://…" />
          </div>
        </template>

        <div class="field">
          <label>密码</label>
          <input v-model="form.password" class="input mono-input" :placeholder="form.isWifi ? 'WiFi 密码（开放网络可留空）' : '密码'" autocomplete="off" />
        </div>

        <div class="field">
          <label>备注</label>
          <textarea v-model="form.notes" class="input" rows="2" placeholder="备注信息（可选）"></textarea>
        </div>

        <div class="field">
          <label>保存到分组</label>
          <GroupPicker v-model="groupId" />
        </div>

        <div v-if="error" class="form-error">{{ error }}</div>
      </div>

      <div class="modal-actions">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn primary" :disabled="!parsed" @click="save">＋ 添加到密码库</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal.recv { max-width: 480px; }
.recv-sub { margin: -4px 0 14px; font-size: 12px; color: var(--muted); line-height: 1.6; }
.recv-tabs { display: flex; gap: 6px; background: var(--panel-2); border-radius: 10px; padding: 4px; margin-bottom: 12px; }
.recv-tab { flex: 1; border: none; background: transparent; color: var(--text-2); font-size: 13px; padding: 8px 4px; border-radius: 8px; cursor: pointer; transition: background 0.14s, color 0.14s, box-shadow 0.14s; }
.recv-tab.on { background: var(--panel); color: var(--text); box-shadow: var(--shadow-sm); font-weight: 600; }
.recv-clip { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.recv-clip-hint { font-size: 12px; color: var(--muted); }
.recv-editor { width: 100%; resize: vertical; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel-2); color: var(--text); font-size: 13px; line-height: 1.7; outline: none; white-space: pre-wrap; word-break: break-all; }
.recv-editor:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.scan-notice { font-size: 12px; color: var(--warning); margin: 10px 0; line-height: 1.5; }
.recv-raw { margin-top: 10px; }
.recv-raw summary { font-size: 12px; color: var(--muted); cursor: pointer; }
.recv-raw-text { margin-top: 6px; max-height: 120px; overflow: auto; background: var(--panel-2); border-radius: 8px; padding: 8px 10px; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
.recv-parsed { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 2px; }
.recv-badges { margin-bottom: 10px; }
.badge-wifi, .badge-otp, .badge-ok, .badge-plain { display: inline-block; font-size: 12px; font-weight: 500; padding: 5px 10px; border-radius: 8px; background: var(--panel-2); color: var(--text-2); }
.badge-wifi { background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary); font-weight: 600; }
.badge-otp, .badge-ok { background: rgba(47, 191, 113, 0.12); color: var(--success); }
.req { color: var(--danger); font-style: normal; }
.mono-input { font-family: var(--mono-font); font-variant-ligatures: none; font-feature-settings: 'zero' 1; }
.form-error { color: var(--danger); font-size: 13px; margin-top: 4px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
</style>
