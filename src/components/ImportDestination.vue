<script setup>
import { ref } from 'vue'
import GroupPicker from './GroupPicker.vue'

defineProps({
  title: { type: String, default: '导入' },
  count: { type: Number, default: 0 },
  currentGroupId: { type: String, default: null },
  currentGroupName: { type: String, default: '' }
})

const emit = defineEmits(['close', 'confirm'])

const mode = ref('all') // file | current | all | group
const groupId = ref(null)

function confirm () {
  if (mode.value === 'group') {
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
          <GroupPicker v-model="groupId" />
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
.imp-group { margin-left: 20px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>