<script setup>
import { ref } from 'vue'
import { store, addGroup } from '../store/vault'

defineProps({
  title: { type: String, default: '导入' },
  count: { type: Number, default: 0 },
  currentGroupId: { type: String, default: null },
  currentGroupName: { type: String, default: '' }
})

const emit = defineEmits(['close', 'confirm'])

const mode = ref('all') // file | current | all | group
const groupId = ref(null)
const newGroupOpen = ref(false)
const newGroupName = ref('')

function confirm () {
  if (mode.value === 'group') {
    if (newGroupOpen.value) {
      const name = newGroupName.value.trim()
      if (name) {
        const g = addGroup(name, null)
        emit('confirm', { mode: 'group', groupId: g.id })
        return
      }
    }
    emit('confirm', { mode: 'group', groupId: groupId.value || null })
    return
  }
  emit('confirm', { mode: mode.value })
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal imp">
      <h3>{{ title }}</h3>
      <p class="imp-count">共解析到 <b>{{ count }}</b> 条，请选择导入目标。</p>

      <div class="imp-options">
        <label class="imp-radio">
          <input v-model="mode" type="radio" value="file" />
          <span>
            <b>按文件分组</b>
            <small>文件含分组时恢复其结构；否则导入到未分组</small>
          </span>
        </label>

        <label class="imp-radio">
          <input v-model="mode" type="radio" value="current" />
          <span>
            <b>导入到当前打开分组</b>
            <small>当前：{{ currentGroupName || '全部' }}</small>
          </span>
        </label>

        <label class="imp-radio">
          <input v-model="mode" type="radio" value="all" />
          <span>
            <b>导入到全部</b>
            <small>不设分组，直接加入密码库</small>
          </span>
        </label>

        <label class="imp-radio">
          <input v-model="mode" type="radio" value="group" />
          <span><b>导入到指定分组</b><small>从下方选择，或新建一个分组</small></span>
        </label>

        <div v-if="mode === 'group'" class="imp-group">
          <select v-model="groupId" class="input">
            <option :value="null">未分组</option>
            <option v-for="g in store.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
          <button v-if="!newGroupOpen" class="btn sm" @click="newGroupOpen = true">＋ 新建分组</button>
        </div>

        <div v-if="mode === 'group' && newGroupOpen" class="imp-new">
          <input v-model="newGroupName" class="input mono-font" placeholder="新分组名称" autofocus @keyup.enter="confirm" />
          <button class="btn sm primary" @click="confirm">建组并导入</button>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn primary" @click="confirm">确认导入</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal.imp { max-width: 440px; }
.imp-count { margin: -6px 0 16px; font-size: 13px; color: var(--text-2); }
.imp-count b { color: var(--primary); }
.imp-options { display: flex; flex-direction: column; gap: 8px; }
.imp-radio { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; cursor: pointer; transition: border-color 0.14s, background 0.14s; }
.imp-radio:hover { background: var(--panel-2); }
.imp-radio input { accent-color: var(--primary); margin-top: 3px; }
.imp-radio span { display: flex; flex-direction: column; gap: 2px; }
.imp-radio b { font-size: 14px; }
.imp-radio small { font-size: 12px; color: var(--muted); }
.imp-group { display: flex; gap: 8px; margin-left: 20px; }
.imp-group .input { flex: 1; }
.imp-new { display: flex; gap: 8px; margin-left: 20px; }
.imp-new .input { flex: 1; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>