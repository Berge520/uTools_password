<script setup>
import { reactive, ref, computed, defineAsyncComponent, watch } from 'vue'
import Generator from './Generator.vue'
import { parseOtpauth } from '../utils/totp'

// 延迟加载，jsQR 不进入首屏 bundle
const QrScanner = defineAsyncComponent(() => import('./QrScanner.vue'))

const props = defineProps({
  entry: {
    type: Object,
    default: null
  },
  groups: {
    type: Array,
    default: () => []
  },
  defaultGroupId: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['close', 'save'])

const form = reactive({
  title: '',
  username: '',
  password: '',
  url: '',
  notes: '',
  totp: '',
  groupId: null
})

const showPw = ref(false)
const showGen = ref(false)
const showQr = ref(false)
const advanced = ref(false)
const error = ref('')

const totpHint = computed(() => {
  const parsed = parseOtpauth(form.totp)
  if (!parsed) return form.totp.trim() ? '无法识别，请输入 Base32 密钥或完整 otpauth:// 链接' : ''
  const algo = parsed.algorithm.toUpperCase()
  return `已识别：${algo} / ${parsed.period} 秒 / ${parsed.digits} 位`
})

watch(
  () => props.entry,
  (e) => {
    form.title = e ? (e.title || '') : ''
    form.username = e ? (e.username || '') : ''
    form.password = e ? (e.password || '') : ''
    form.url = e ? (e.url || '') : ''
    form.notes = e ? (e.notes || '') : ''
    form.totp = e && e.otp ? (e.otp.secret || '') : ''
    form.groupId = e ? (e.groupId || null) : (props.defaultGroupId || null)
    // 编辑时若含高级字段则自动展开
    advanced.value = !!(e && (e.url || e.notes || e.otp))
    showPw.value = false
    error.value = ''
  },
  { immediate: true }
)

function onGenResult (pw) {
  form.password = pw
  showGen.value = false
}

function onQrResult (result) {
  if (!result) return
  form.totp = result.raw || ''
  if (result.otp) {
    if (!form.title.trim()) {
      form.title = result.otp.issuer || result.otp.account || ''
    }
    if (!form.username.trim()) {
      form.username = result.otp.account || ''
    }
  }
  showQr.value = false
}

function onKeydown (e) {
  if (e.key === 'Escape' && !showGen.value && !showQr.value) {
    emit('close')
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    save()
  }
}

function save () {
  if (!form.title.trim()) {
    error.value = '请填写标题'
    return
  }
  const data = {
    title: form.title.trim(),
    username: form.username.trim(),
    password: form.password,
    url: form.url.trim(),
    notes: form.notes.trim(),
    groupId: form.groupId || null
  }
  if (form.totp.trim()) {
    const otp = parseOtpauth(form.totp)
    if (!otp) {
      error.value = 'TOTP 密钥格式无效'
      return
    }
    data.otp = otp
  } else {
    data.otp = undefined
  }
  emit('save', data)
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')" @keydown="onKeydown">
    <div class="modal">
      <h3>{{ entry ? '编辑密码' : '新增密码' }}</h3>

      <div class="field">
        <label>标题 <i class="req">*</i></label>
        <input v-model="form.title" class="input mono-input" placeholder="例如 GitHub / 公司邮箱" autofocus />
      </div>

      <div class="field">
        <label>用户名 / 账号</label>
        <input v-model="form.username" class="input mono-input" placeholder="手机号 / 邮箱 / 用户名" />
      </div>

      <div class="field">
        <label>密码</label>
        <div class="pw-wrap">
          <input
            v-model="form.password"
            class="input mono-input"
            :type="showPw ? 'text' : 'password'"
            placeholder="输入或点右侧生成"
            autocomplete="off"
          />
          <button class="btn icon sm" :title="showPw ? '隐藏' : '显示'" @click="showPw = !showPw">
            {{ showPw ? '🙈' : '👁' }}
          </button>
          <button class="btn icon sm" title="生成随机密码" @click="showGen = true">⚙️</button>
        </div>
      </div>

      <button class="advanced-toggle" @click="advanced = !advanced">
        {{ advanced ? '收起更多选项' : '更多选项（网址 / 备注 / 两步验证）' }}
        <span class="chev">{{ advanced ? '▲' : '▼' }}</span>
      </button>

      <template v-if="advanced">
        <div class="field">
          <label>分组</label>
          <select v-model="form.groupId" class="input mono-input">
            <option :value="null">未分组</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>

        <div class="field">
          <label>网址</label>
          <input v-model="form.url" class="input mono-input" placeholder="https://…" />
        </div>

        <div class="field">
          <label>备注</label>
          <textarea v-model="form.notes" class="input" rows="2" placeholder="备注信息（可选）"></textarea>
        </div>

        <div class="field totp-field">
          <label>两步验证 (TOTP)</label>
          <div class="totp-tip" role="tooltip">
            支持粘贴 Base32 密钥或完整 otpauth:// 链接，或点击右侧 📷 扫码识别二维码。
            可从验证器 App（Google / Microsoft Authenticator 等）的二维码直接扫码自动填写。
          </div>
          <div class="totp-wrap">
            <input
              v-model="form.totp"
              class="input mono-input"
              placeholder="粘贴 Base32 密钥 / otpauth:// 链接，或扫二维码"
              autocomplete="off"
              spellcheck="false"
            />
            <button class="btn icon sm" title="扫码识别二维码" @click="showQr = true">📷</button>
          </div>
          <div class="totp-hint" :class="{ err: totpHint && totpHint.startsWith('无法') }">
            {{ totpHint || '用于生成 6 位动态验证码' }}
          </div>
        </div>
      </template>

      <div v-if="error" class="form-error">{{ error }}</div>

      <div class="modal-actions">
        <span class="hint">Ctrl/⌘+Enter 保存 · Esc 取消</span>
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn primary" @click="save">保存</button>
      </div>
    </div>

    <Generator v-if="showGen" @close="showGen = false" @result="onGenResult" />
    <QrScanner v-if="showQr" @close="showQr = false" @result="onQrResult" />
  </div>
</template>

<style scoped>
.req {
  color: var(--danger);
  font-style: normal;
}

.pw-wrap {
  display: flex;
  gap: 6px;
}

.pw-wrap .input {
  flex: 1;
}

.advanced-toggle {
  width: 100%;
  border: none;
  background: var(--panel-2);
  color: var(--text-2);
  font-size: 13px;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  transition: background 0.14s;
}

.advanced-toggle:hover {
  background: var(--border-2);
}

.chev {
  color: var(--muted);
}

.mono-input {
  font-family: var(--mono-font);
  font-variant-ligatures: none;
  font-feature-settings: 'zero' 1;
}

.totp-wrap {
  display: flex;
  gap: 6px;
}

.totp-wrap .input {
  flex: 1;
}

.totp-field {
  position: relative;
}

.totp-tip {
  position: absolute;
  left: 0;
  bottom: calc(100% + 10px);
  z-index: 60;
  width: 100%;
  max-width: 320px;
  background: rgba(22, 26, 36, 0.94);
  color: #f0f2f6;
  font-size: 12px;
  line-height: 1.6;
  padding: 10px 12px;
  border-radius: 9px;
  box-shadow: var(--shadow);
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.totp-field:hover .totp-tip {
  opacity: 1;
  transform: translateY(0);
}

.totp-hint {
  font-size: 12px;
  color: var(--muted);
  margin-top: 6px;
  line-height: 1.5;
}

.totp-hint.err {
  color: var(--danger);
}

.form-error {
  color: var(--danger);
  font-size: 13px;
  margin-bottom: 10px;
}

.modal-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.hint {
  margin-right: auto;
  font-size: 11px;
  color: var(--muted);
}
</style>
