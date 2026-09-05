<script setup>
import { reactive, ref, computed, watch, onMounted } from 'vue'
import QRCode from 'qrcode'
import { addEntry } from '../store/vault'
import { WIFI_TYPES, buildWifiPayload, parseWifiPayload } from '../utils/wifi'
import { showToast } from '../utils/toast'
import { copyText, copyImage } from '../utils/clipboard'
import GroupPicker from './GroupPicker.vue'
import QrScanButtons from './QrScanButtons.vue'

const props = defineProps({
  defaultGroupId: { type: String, default: null }
})
const emit = defineEmits(['close'])

const form = reactive({
  ssid: '',
  password: '',
  type: 'WPA',
  hidden: false
})

const qrData = ref('')
const saveError = ref('')
let debounceTimer = null

const groupId = ref(props.defaultGroupId || null)

const payload = computed(() => buildWifiPayload({
  ssid: form.ssid,
  password: form.password,
  type: form.type,
  hidden: form.hidden
}))

async function genQr () {
  if (!form.ssid.trim()) { qrData.value = ''; return }
  try {
    qrData.value = await QRCode.toDataURL(payload.value, {
      width: 320, margin: 2, errorCorrectionLevel: 'M',
      color: { dark: '#1c2230', light: '#ffffff' }
    })
  } catch (e) {
    qrData.value = ''
  }
}

function scheduleGen () {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(genQr, 200)
}

watch(() => [form.ssid, form.password, form.type, form.hidden], scheduleGen)
onMounted(genQr)

// ---------- 扫码识别已有 WiFi 二维码 ----------
function onScanned (text) {
  const wifi = parseWifiPayload(text)
  if (!wifi) {
    showToast('不是 WiFi 直连二维码，可改用「接收分享密码」识别')
    return
  }
  form.ssid = wifi.ssid
  form.password = wifi.password
  form.type = wifi.type
  form.hidden = wifi.hidden
  showToast('已识别 WiFi 信息')
}

// ---------- 二维码操作 ----------
function copyQr () {
  copyImage(qrData.value, { label: '二维码' })
}

function saveQrImage () {
  if (!qrData.value) return
  const p = window.utools.showSaveDialog({ title: '保存 WiFi 二维码', defaultPath: `${form.ssid.trim() || 'wifi'}.png` })
  if (!p) return
  window.services.saveImage(p, qrData.value)
  showToast('二维码已保存')
  window.utools.shellShowItemInFolder(p)
}

function copyPayload () {
  if (!form.ssid.trim()) return
  copyText(payload.value, { label: '二维码内容' })
}

// ---------- 保存到密码库 ----------
function saveToVault () {
  saveError.value = ''
  const ssid = form.ssid.trim()
  if (!ssid) {
    saveError.value = '请填写 WiFi 网络名称（SSID）'
    return
  }
  if (form.type !== 'nopass' && !form.password) {
    saveError.value = '请填写 WiFi 密码，或选择「无密码（开放网络）」'
    return
  }
  addEntry({
    title: ssid,
    username: '',
    password: form.type === 'nopass' ? '' : form.password,
    url: '',
    notes: form.hidden ? '隐藏网络' : '',
    groupId: groupId.value || null,
    isWifi: true,
    wifiType: form.type,
    wifiHidden: form.hidden
  })
  showToast('已保存到密码库')
  emit('close')
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal wqr">
      <h3>生成 WiFi 直连二维码</h3>
      <p class="wqr-sub">填写 WiFi 信息生成二维码，手机相机 / 扫码器识别即可直连；也可识别已有 WiFi 二维码自动回填，并保存到密码库。</p>

      <div class="wqr-body">
        <div class="wqr-form">
          <div class="field">
            <label>网络名称 (SSID) <i class="req">*</i></label>
            <input v-model="form.ssid" class="input mono-input" placeholder="WiFi 名称" autofocus />
          </div>
          <div class="field">
            <label>加密方式</label>
            <select v-model="form.type" class="input mono-input">
              <option v-for="t in WIFI_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
          <div v-if="form.type !== 'nopass'" class="field">
            <label>密码</label>
            <input v-model="form.password" class="input mono-input" placeholder="WiFi 密码" autocomplete="off" />
          </div>
          <label class="wqr-hidden">
            <input v-model="form.hidden" type="checkbox" />
            <span>隐藏网络（不广播 SSID）</span>
          </label>

          <div class="wqr-scan">
            <QrScanButtons @detected="onScanned" />
          </div>
        </div>

        <div class="wqr-stage">
          <div class="qr-box">
            <img v-if="qrData" :src="qrData" class="qr-img" alt="WiFi 直连二维码" />
            <div v-else class="qr-empty">填写网络名称后<br />自动生成二维码</div>
          </div>
          <div class="wqr-stage-actions">
            <button class="btn sm" :disabled="!qrData" @click="copyQr">复制二维码</button>
            <button class="btn sm" :disabled="!qrData" @click="saveQrImage">保存图片</button>
            <button class="btn sm" :disabled="!form.ssid.trim()" @click="copyPayload">复制内容</button>
          </div>
        </div>
      </div>

      <div class="field wqr-group">
        <label>保存到分组</label>
        <GroupPicker v-model="groupId" />
      </div>

      <div v-if="saveError" class="form-error">{{ saveError }}</div>

      <div class="modal-actions">
        <button class="btn" @click="emit('close')">关闭</button>
        <button class="btn primary" @click="saveToVault">＋ 保存到密码库</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal.wqr { max-width: 640px; }
.wqr-sub { margin: -4px 0 14px; font-size: 12px; color: var(--muted); line-height: 1.6; }
.wqr-body { display: flex; gap: 16px; align-items: flex-start; }
.wqr-form { flex: 1; min-width: 0; }
.wqr-stage { width: 230px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
.qr-box { display: flex; align-items: center; justify-content: center; min-height: 218px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 10px; }
.qr-img { width: 200px; height: 200px; border-radius: 8px; background: #fff; }
.qr-empty { color: var(--muted); font-size: 12px; text-align: center; line-height: 1.8; }
.wqr-stage-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.wqr-hidden { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); margin: 2px 0 10px; cursor: pointer; }
.wqr-hidden input { accent-color: var(--primary); }
.wqr-scan { margin-top: 2px; }
.req { color: var(--danger); font-style: normal; }
.mono-input { font-family: var(--mono-font); font-variant-ligatures: none; font-feature-settings: 'zero' 1; }
.wqr-group { margin-top: 14px; border-top: 1px solid var(--border); padding-top: 12px; }
.form-error { color: var(--danger); font-size: 13px; margin-top: 6px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
@media (max-width: 560px) {
  .wqr-body { flex-direction: column; }
  .wqr-stage { width: 100%; }
}
</style>
