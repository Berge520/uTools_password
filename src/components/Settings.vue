<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import {
  store,
  setMasterPassword,
  changeMasterPassword,
  disableMasterPassword,
  lock,
  clearEntries,
  setSyncEnabled,
  setAutoLock
} from '../store/vault'
import { member, refreshMember } from '../store/member'
import { theme, setTheme } from '../store/theme'
import { cloud, loadCloud, saveCloud, testConnection, backupNow, restoreNow } from '../store/cloud'
import { showToast } from '../utils/toast'

const emit = defineEmits(['close'])

const webdavBusy = ref(false)
const webdavMsg = ref('')
const restoreConfirm = ref(false)

function toggleCloud () {
  cloud.enabled = !cloud.enabled
  saveCloud()
  webdavMsg.value = ''
}

async function onWebdavTest () {  saveCloud()
  webdavBusy.value = true
  webdavMsg.value = ''
  const r = await testConnection()
  webdavBusy.value = false
  webdavMsg.value = r.ok ? '✅ 连接成功' : ('❌ ' + (r.error || '失败'))
}

async function onWebdavBackup () {
  saveCloud()
  webdavBusy.value = true
  webdavMsg.value = ''
  const r = await backupNow()
  webdavBusy.value = false
  webdavMsg.value = r.ok ? '✅ 备份成功' : ('❌ ' + (r.error || '失败'))
}

async function onWebdavRestore () {
  webdavBusy.value = true
  webdavMsg.value = ''
  const r = await restoreNow()
  webdavBusy.value = false
  restoreConfirm.value = false
  webdavMsg.value = r.ok ? ('✅ 已从云端恢复' + (r.encrypted ? '（加密数据，需输入主密码）' : '')) : ('❌ ' + (r.error || '失败'))
  if (r.ok) emit('close')
}

const themeOptions = [
  { key: 'light', label: '亮色', icon: '☀️' },
  { key: 'dark', label: '暗色', icon: '🌙' },
  { key: 'sepia', label: '护眼', icon: '🍃' }
]

onMounted(() => { refreshMember(); loadCloud() })

const localPath = computed(() => {
  try {
    return window.services && window.services.localDataFilePath
      ? window.services.localDataFilePath()
      : ''
  } catch (e) {
    return ''
  }
})

function toggleSync () {
  if (!member.value.syncing) {
    showToast(member.value.loggedIn ? '请先在 uTools 设置中开启『数据同步』' : '请先登录 uTools 账号并开启『数据同步』（会员）')
    return
  }
  const res = setSyncEnabled(!store.syncEnabled)
  if (res.ok) {
    showToast(store.syncEnabled ? '已开启数据同步（备份到 uTools 云端）' : '已关闭数据同步（仅保存在本机）')
  }
}

function onAutoLockChange (e) {
  const v = parseInt(e.target.value, 10)
  setAutoLock(v)
  showToast(v === 0 ? '已关闭自动锁定' : `已设为 ${v} 分钟自动锁定`)
}

const showClearConfirm = ref(false)
const clearChecked = ref(false)

function openClear () {
  showClearConfirm.value = true
  clearChecked.value = false
}

function doClear () {
  if (!clearChecked.value) return
  const n = store.entries.length
  clearEntries()
  showToast(`已清空 ${n} 条密码`)
  showClearConfirm.value = false
  emit('close')
}

// 开启 / 修改
const enable = reactive({
  show: false,
  pw: '',
  confirm: '',
  error: ''
})

const unlockPw = ref('')
const disableError = ref('')
const showDisableConfirm = ref(false)

const change = reactive({
  show: false,
  current: '',
  next: '',
  confirm: '',
  error: ''
})

const repoUrl = 'https://github.com/Berge520/uTools_password'
const APP_VERSION = '0.0.4'

function openRepo () {
  window.utools.shellOpenExternal(repoUrl)
}

function validate (pw, confirm) {
  if (pw.length < 4) return '主密码至少 4 位'
  if (pw !== confirm) return '两次输入的密码不一致'
  return ''
}

function onEnable () {
  const err = validate(enable.pw, enable.confirm)
  if (err) { enable.error = err; return }
  setMasterPassword(enable.pw)
  showToast('已开启主密码加密')
  emit('close')
}

function onChange () {
  const err = validate(change.next, change.confirm)
  if (err) { change.error = err; return }
  const res = changeMasterPassword(change.current, change.next)
  if (!res.ok) { change.error = res.error; return }
  showToast('主密码已修改')
  emit('close')
}

function onDisable () {
  const res = disableMasterPassword(unlockPw.value)
  if (!res.ok) {
    disableError.value = res.error
    unlockPw.value = ''
    return
  }
  showToast('已关闭主密码（数据转为明文存储）')
  emit('close')
}

function onLock () {
  lock()
  emit('close')
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <h3>设置</h3>

      <!-- 主题 -->
      <div class="theme-section">
        <div class="theme-label">主题外观</div>
        <div class="theme-opts">
          <button
            v-for="opt in themeOptions"
            :key="opt.key"
            class="theme-opt"
            :class="{ active: theme === opt.key }"
            @click="setTheme(opt.key)"
          >
            <span class="theme-icon">{{ opt.icon }}</span>
            <span>{{ opt.label }}</span>
          </button>
        </div>
      </div>

      <!-- 关于 -->
      <div class="about-section">
        <div class="about-version">
          <span class="about-ico">🔑</span>
          <span>我的密码 <b>v{{ APP_VERSION }}</b></span>
        </div>
        <button class="about-row" @click="openRepo">
          <span class="about-label">仓库地址</span>
          <span class="about-url">{{ repoUrl.replace('https://', '') }}</span>
          <span class="arrow">›</span>
        </button>
        <div class="about-made">由 AI 开发 · 个人项目 · AGPL-3.0</div>
      </div>

      <!-- 自动锁定时长 -->
      <div v-if="store.secured" class="autolock-section">
        <div class="autolock-title">自动锁定</div>
        <div class="autolock-row">
          <span class="autolock-label">主密码空闲自动锁定</span>
          <select
            class="input autolock-select"
            :value="store.autoLockMinutes"
            @change="onAutoLockChange($event)"
          >
            <option :value="0">关闭</option>
            <option :value="1">1 分钟</option>
            <option :value="5">5 分钟</option>
            <option :value="15">15 分钟</option>
            <option :value="30">30 分钟</option>
            <option :value="60">60 分钟</option>
          </select>
        </div>
        <div class="autolock-desc">空闲超过该时长后自动锁定，需重新输入主密码；开启主密码后生效。</div>
      </div>

      <!-- WebDAV 云备份 -->
      <div class="cloud-section">
        <div class="cloud-head">
          <div class="cloud-title">云备份（WebDAV）</div>
          <button class="switch" :class="{ on: cloud.enabled }" @click="toggleCloud">
            <span class="switch-knob"></span>
          </button>
        </div>

        <div v-if="!cloud.enabled" class="cloud-note">
          开启后可将密码库备份到 WebDAV 服务器（支持坚果云 / Nextcloud / 群晖等）。
        </div>

        <template v-else>
          <div class="field">
            <label>服务器地址</label>
            <input v-model="cloud.url" class="input" placeholder="https://dav.example.com/webdav/" @change="saveCloud" />
          </div>
          <div class="field-row">
            <div class="field">
              <label>用户名</label>
              <input v-model="cloud.user" class="input" placeholder="账号" @change="saveCloud" />
            </div>
            <div class="field">
              <label>密码</label>
              <input v-model="cloud.pass" class="input" type="password" placeholder="应用密码" @change="saveCloud" />
            </div>
          </div>
          <div class="field">
            <label>子路径（可选）</label>
            <input v-model="cloud.path" class="input" placeholder="如 backup / 留空则存到根目录" @change="saveCloud" />
          </div>
          <div class="field">
            <label>备份文件名</label>
            <input v-model="cloud.fileName" class="input mono-input" placeholder="password-vault-backup.json" @change="saveCloud" />
          </div>

          <div class="cloud-actions">
            <button class="btn sm" :disabled="webdavBusy" @click="onWebdavTest">测试连接</button>
            <button class="btn sm primary" :disabled="webdavBusy" @click="onWebdavBackup">立即备份</button>
            <button class="btn sm" :disabled="webdavBusy || !store.entries.length" @click="restoreConfirm = true">从云端恢复</button>
          </div>
          <div v-if="webdavMsg" class="cloud-msg">{{ webdavMsg }}</div>
          <div class="cloud-note">
            备份内容：{{ store.secured ? '已加密（AES-256）' : '明文（建议先开启主密码）' }}。地址、账号、密码仅保存在本机。
          </div>

          <div v-if="restoreConfirm" class="cloud-restore-confirm">
            <p>将用云端备份<b>覆盖</b>当前所有数据，此操作不可撤销。确认继续？</p>
            <div class="modal-actions">
              <button class="btn" @click="restoreConfirm = false">取消</button>
              <button class="btn red" @click="onWebdavRestore">覆盖恢复</button>
            </div>
          </div>
        </template>
      </div>

      <!-- 数据同步（uTools 会员） -->
      <div class="sync-section">
        <div class="sync-row">
          <div class="sync-info">
            <div class="sync-title">
              数据同步
              <span class="tag" :class="member.syncing ? 'ok' : 'lock'">
                {{ member.syncing ? '同步中' : (member.loggedIn ? '未开启' : '未登录') }}
              </span>
            </div>
            <div class="sync-desc">
              <template v-if="member.syncing">
                {{ store.syncEnabled
                  ? '数据写入 uTools 数据库，已开启『数据同步』，可自动备份到服务端并跨设备同步。'
                  : '数据仅保存在本机，不随 uTools 同步。' }}
              </template>
              <template v-else>
                {{ member.loggedIn
                  ? '云端备份为 uTools 会员功能。请在 uTools 设置 → 数据同步 中开启；开启前数据只保存在本机。'
                  : '请先在 uTools 登录账号，并开启『数据同步』（会员）后，才能备份到服务端。' }}
              </template>
            </div>
          </div>
          <button
            class="switch"
            :class="{ on: store.syncEnabled }"
            :disabled="!member.syncing"
            @click="toggleSync"
          >
            <span class="switch-knob"></span>
          </button>
        </div>

        <div v-if="!member.syncing" class="sync-lock">
          <span class="lock-ico">🔒</span>
          <span class="lock-text">
            当前未开启 uTools 数据同步，云端备份不会生效（免费版仅本地离线保存）。
          </span>
        </div>

        <div class="storage-info">
          当前存储：<b>{{ store.syncEnabled ? 'uTools 数据库（随会员数据同步）' : '本地文件' }}</b>
          <template v-if="!store.syncEnabled && localPath">
            <span class="path">{{ localPath }}</span>
          </template>
        </div>
      </div>

      <!-- 危险操作 -->
      <div class="danger-section">
        <div class="danger-title">危险操作</div>
        <div class="danger-row">
          <span class="danger-desc">删除全部 {{ store.entries.length }} 条密码（分组保留，不可恢复）</span>
          <button class="btn red sm" @click="openClear">清空所有密码</button>
        </div>

        <div v-if="showClearConfirm" class="clear-confirm">
          <p class="clear-msg">
            将删除全部 <strong>{{ store.entries.length }}</strong> 条密码，此操作<b>不可恢复</b>。分组结构会保留。
          </p>
          <label class="clear-check">
            <input v-model="clearChecked" type="checkbox" />
            我了解此操作不可恢复
          </label>
          <div class="modal-actions">
            <button class="btn" @click="showClearConfirm = false">取消</button>
            <button class="btn red" :disabled="!clearChecked" @click="doClear">确认清空</button>
          </div>
        </div>
      </div>

      <!-- 未开启主密码：开启 -->
      <div v-if="!store.secured">
        <div class="sec-desc">
          当前为<strong>明文存储</strong>。开启主密码后，所有条目将以 AES-256-GCM 加密保存在本地。
        </div>
        <div class="field">
          <label>主密码</label>
          <input v-model="enable.pw" class="input" type="password" autocomplete="off" />
        </div>
        <div class="field">
          <label>确认主密码</label>
          <input v-model="enable.confirm" class="input" type="password" autocomplete="off" />
        </div>
        <div v-if="enable.error" class="form-error">{{ enable.error }}</div>
        <div class="warn">⚠️ 主密码无法找回，忘记将无法恢复数据，请务必牢记。</div>
        <div class="modal-actions">
          <button class="btn" @click="emit('close')">取消</button>
          <button class="btn primary" @click="onEnable">开启主密码</button>
        </div>
      </div>

      <!-- 已开启主密码：修改 / 关闭 / 锁定 -->
      <div v-else>
        <div class="sec-desc">
          已开启主密码，条目以 <strong>AES-256-GCM</strong> 加密保存在本地。
        </div>

        <div v-if="!change.show && !showDisableConfirm">
          <button class="settings-row" @click="change.show = true">
            <span>修改主密码</span>
            <span class="arrow">›</span>
          </button>
          <button class="settings-row" @click="showDisableConfirm = true">
            <span>关闭主密码</span>
            <span class="arrow">›</span>
          </button>
          <button class="settings-row" @click="onLock">
            <span>立即锁定</span>
            <span class="arrow">›</span>
          </button>
        </div>

        <!-- 修改主密码 -->
        <div v-else-if="change.show">
          <div class="field">
            <label>当前主密码</label>
            <input v-model="change.current" class="input" type="password" autocomplete="off" />
          </div>
          <div class="field">
            <label>新主密码</label>
            <input v-model="change.next" class="input" type="password" autocomplete="off" />
          </div>
          <div class="field">
            <label>确认新主密码</label>
            <input v-model="change.confirm" class="input" type="password" autocomplete="off" />
          </div>
          <div v-if="change.error" class="form-error">{{ change.error }}</div>
          <div class="modal-actions">
            <button class="btn" @click="change.show = false">返回</button>
            <button class="btn primary" @click="onChange">确认修改</button>
          </div>
        </div>

        <!-- 关闭主密码 -->
        <div v-else>
          <div class="field">
            <label>输入当前主密码以确认关闭</label>
            <input v-model="unlockPw" class="input" type="password" autocomplete="off" />
          </div>
          <div v-if="disableError" class="form-error">{{ disableError }}</div>
          <div class="warn">关闭后所有条目将转为明文存储，不再受加密保护。</div>
          <div class="modal-actions">
            <button class="btn" @click="showDisableConfirm = false; unlockPw = ''; disableError = ''">返回</button>
            <button class="btn danger" @click="onDisable">关闭主密码</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sec-desc {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
  margin-bottom: 16px;
  background: var(--panel-2);
  padding: 10px 12px;
  border-radius: 8px;
}

.settings-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  margin-bottom: 6px;
  text-align: left;
}

.settings-row:hover {
  background: var(--panel-2);
}

.arrow {
  color: var(--muted);
  font-size: 18px;
}

.form-error {
  color: var(--danger);
  font-size: 13px;
  margin-bottom: 10px;
}

.warn {
  font-size: 12px;
  color: #e5a13d;
  background: rgba(229, 161, 61, 0.12);
  padding: 10px 12px;
  border-radius: 8px;
  line-height: 1.5;
  margin-bottom: 14px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.theme-section {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
}

.about-section {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
}

.about-version {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}

.about-version b {
  color: var(--primary);
}

.about-ico {
  font-size: 16px;
}

.about-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  background: var(--panel-2);
  border-radius: 9px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: background 0.14s;
}

.about-row:hover {
  background: var(--border-2);
}

.about-label {
  flex-shrink: 0;
  color: var(--text-2);
}

.about-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--primary);
  font-family: var(--mono-font);
  font-variant-ligatures: none;
  font-feature-settings: 'zero' 1;
}

.arrow {
  color: var(--muted);
}

.about-made {
  margin-top: 10px;
  font-size: 11px;
  color: var(--muted);
}

.theme-label {
  font-size: 13px;
  color: var(--text-2);
  font-weight: 500;
  margin-bottom: 10px;
}

.theme-opts {
  display: flex;
  gap: 8px;
}

.theme-opt {
  flex: 1;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel);
  color: var(--text-2);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: border-color 0.14s, background 0.14s, color 0.14s;
}

.theme-opt:hover {
  border-color: var(--border-2);
  background: var(--panel-2);
}

.theme-opt.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}

.theme-icon {
  font-size: 15px;
}

/* 数据同步 */
.sync-section {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
}

.sync-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sync-info {
  min-width: 0;
}

.sync-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}

.sync-desc {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}

.switch {
  width: 46px;
  height: 26px;
  border-radius: 20px;
  border: none;
  background: var(--border-2);
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  transition: background 0.18s;
  padding: 0;
}

.switch .switch-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform 0.18s;
}

.switch.on {
  background: var(--primary);
}

.switch.on .switch-knob {
  transform: translateX(20px);
}

.switch:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 20px;
  margin-left: 6px;
  vertical-align: middle;
}

.tag.ok {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 14%, transparent);
}

.tag.lock {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
}

.sync-lock {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
  background: color-mix(in srgb, var(--warning) 8%, var(--panel));
  border-radius: 10px;
}

.lock-ico {
  font-size: 16px;
}

.lock-text {
  font-size: 12px;
  color: var(--warning);
  line-height: 1.5;
}

.storage-info {
  margin-top: 12px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
  word-break: break-all;
}

.storage-info b {
  color: var(--text-2);
}

.path {
  display: block;
  font-family: var(--mono-font);
  font-variant-ligatures: none;
  font-feature-settings: 'zero' 1;
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
}

/* 自动锁定 */
.autolock-section {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
}

.autolock-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}

.autolock-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.autolock-label {
  font-size: 13px;
  color: var(--text-2);
}

.autolock-select {
  width: 130px;
  height: 36px;
}

.autolock-desc {
  margin-top: 8px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}

/* 云备份 */
.cloud-section {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
}

.cloud-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}

.cloud-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.cloud-head .cloud-title {
  margin-bottom: 0;
}

.cloud-head .switch {
  flex-shrink: 0;
}

.field-row {
  display: flex;
  gap: 10px;
}

.field-row .field {
  flex: 1;
}

.cloud-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.cloud-msg {
  margin-top: 10px;
  font-size: 13px;
  color: var(--text-2);
}

.cloud-note {
  margin-top: 8px;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}

.cloud-restore-confirm {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  background: color-mix(in srgb, var(--danger) 6%, var(--panel));
  border-radius: 10px;
}

.cloud-restore-confirm p {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
}

.cloud-restore-confirm .modal-actions {
  justify-content: flex-end;
}

/* 危险操作 */
.danger-section {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
}.danger-title {
  font-size: 13px;
  color: var(--danger);
  font-weight: 600;
  margin-bottom: 10px;
}

.danger-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.danger-desc {
  font-size: 13px;
  color: var(--text-2);
}

.clear-confirm {
  margin-top: 16px;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  background: color-mix(in srgb, var(--danger) 6%, var(--panel));
  border-radius: 10px;
  padding: 14px;
}

.clear-msg {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  word-break: break-word;
}

.clear-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--danger);
  cursor: pointer;
  margin-bottom: 14px;
  user-select: none;
}

.clear-check input {
  accent-color: var(--danger);
}

.clear-confirm .modal-actions {
  justify-content: flex-end;
}
</style>
