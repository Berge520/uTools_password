<script setup>
import { ref, computed } from 'vue'
import GroupNode from './GroupNode.vue'
import { store, deleteGroup, deleteGroupDeep, renameGroup, moveGroup, setEntryGroup } from '../store/vault'
import { dnd, startDrag, clearDrag, computeMode } from '../store/dnd'
import { showToast } from '../utils/toast'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps({
  group: { type: Object, required: true },
  depth: { type: Number, default: 0 },
  selectedId: { type: String, default: null },
  batchMode: { type: Boolean, default: false },
  selected: { type: Boolean, default: false }
})

const emit = defineEmits(['select', 'toggle-select'])

const confirmState = ref({ open: false, title: '', message: '', confirmText: '确定', danger: false, onConfirm: null })

function onConfirmConfirm () {
  const c = confirmState.value
  if (c && c.onConfirm) c.onConfirm()
  confirmState.value = { ...confirmState.value, open: false }
}

function onConfirm2Confirm () {
  const c = confirmState.value
  if (c && c.onConfirm2) c.onConfirm2()
  confirmState.value = { ...confirmState.value, open: false }
}

const children = computed(() =>
  store.groups.filter((g) => g.parentId === props.group.id)
)
const count = computed(() => store.entries.filter((e) => e.groupId === props.group.id).length)

const expanded = ref(true)
const editing = ref(false)
const editName = ref('')

function toggle () {
  if (children.value.length) expanded.value = !expanded.value
}

function select () {
  emit('select', props.group.id)
}

function startEdit () {
  editing.value = true
  editName.value = props.group.name
}

function commitEdit () {
  if (editName.value.trim()) renameGroup(props.group.id, editName.value.trim())
  editing.value = false
}

function remove () {
  const entryCount = store.entries.filter((e) => e.groupId === props.group.id).length
  confirmState.value = {
    open: true,
    title: '删除分组',
    message: `删除「${props.group.name}」？${
      entryCount ? `组内 ${entryCount} 条密码将一并处理。` : ''
    }子分组会自动上移一层。`,
    confirmText: '仅删分组（条目上移）',
    confirm2Text: entryCount ? `连同 ${entryCount} 条条目删除` : '',
    danger: false,
    danger2: true,
    onConfirm: () => {
      deleteGroup(props.group.id)
      showToast('已删除分组，条目已上移')
    },
    onConfirm2: () => {
      deleteGroupDeep(props.group.id)
      showToast('已删除分组及组内条目')
    }
  }
}

function onDragStart (e) {
  if (editing.value) return
  startDrag('group', props.group.id)
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', props.group.id)
  }
}

function onDragOver (e) {
  if (!dnd.type || dnd.id === props.group.id) return
  e.preventDefault()
  e.stopPropagation()
  dnd.targetId = props.group.id
  dnd.mode = computeMode(e)
}

function onDragLeave () {
  if (dnd.targetId === props.group.id) {
    dnd.targetId = null
    dnd.mode = null
  }
}

function onDrop (e) {
  e.preventDefault()
  e.stopPropagation()
  if (!dnd.type || dnd.id === props.group.id) return
  const mode = dnd.mode || 'inside'
  if (dnd.type === 'entry') {
    setEntryGroup(dnd.id, props.group.id)
    showToast('已移动到分组')
  } else if (dnd.type === 'group') {
    moveGroup(dnd.id, props.group.id, mode)
    showToast('已调整分组')
  }
  clearDrag()
}

function onDragEnd () {
  clearDrag()
}
</script>

<template>
  <div
    class="gnode"
    :class="{
      selected: selectedId === group.id,
      editing,
      'drop-before': dnd.targetId === group.id && dnd.mode === 'before',
      'drop-after': dnd.targetId === group.id && dnd.mode === 'after',
      'drop-inside': dnd.targetId === group.id && dnd.mode === 'inside',
      'batch-sel': props.selected
    }"
    :style="{ paddingLeft: depth * 14 + 'px' }"
    draggable="true"
    @dragstart="onDragStart"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @dragend="onDragEnd"
    @dblclick.stop
  >
    <span v-if="batchMode" class="gnode-check" :class="{ on: selected }" @click.stop="emit('toggle-select', group.id)">✓</span>
    <span class="gnode-caret" :class="{ hidden: !children.length }" @click.stop="toggle">
      {{ expanded ? '▼' : '▶' }}
    </span>

    <template v-if="editing">
      <input
        v-model="editName"
        class="gnode-edit mono-font"
        autofocus
        @click.stop
        @keyup.enter="commitEdit"
        @keyup.esc="editing = false"
      />
      <div class="gnode-ops">
        <button class="gnode-op ok" title="确认" @click.stop="commitEdit">✓</button>
        <button class="gnode-op" title="取消" @click.stop="editing = false">✕</button>
      </div>
    </template>
    <template v-else>
      <span class="gnode-name mono-font" @click.stop="select" @dblclick.stop="startEdit">
        {{ group.name }}
      </span>
      <span v-if="count" class="gnode-count">{{ count }}</span>
      <div class="gnode-ops">
        <button class="gnode-op" title="重命名" @click.stop="startEdit">✎</button>
        <button class="gnode-op danger" title="删除分组" @click.stop="remove">✕</button>
      </div>
    </template>
  </div>

  <template v-if="expanded">
    <GroupNode
      v-for="child in children"
      :key="child.id"
      :group="child"
      :depth="depth + 1"
      :selected-id="selectedId"
      :batch-mode="batchMode"
      :selected="selected"
      @select="(id) => emit('select', id)"
      @toggle-select="(id) => emit('toggle-select', id)"
    />
  </template>

  <ConfirmDialog
    v-if="confirmState.open"
    :title="confirmState.title"
    :message="confirmState.message"
    :confirm-text="confirmState.confirmText"
    :confirm2-text="confirmState.confirm2Text"
    :danger="confirmState.danger"
    :danger2="confirmState.danger2"
    @confirm="onConfirmConfirm"
    @confirm2="onConfirm2Confirm"
    @cancel="confirmState.open = false"
  />
</template>

<style scoped>
.gnode {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px 7px 8px;
  border-radius: 8px;
  cursor: grab;
  position: relative;
  transition: background 0.14s, box-shadow 0.14s;
  color: var(--text-2);
  user-select: none;
}

.gnode:hover {
  background: var(--panel-2);
}

.gnode.selected {
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  color: var(--text);
  font-weight: 600;
}

.gnode:active {
  cursor: grabbing;
}

.gnode.drop-before {
  box-shadow: 0 -3px 0 var(--primary) inset;
}

.gnode.drop-after {
  box-shadow: 0 3px 0 var(--primary) inset;
}

.gnode.drop-inside {
  background: color-mix(in srgb, var(--primary) 22%, transparent);
}

.gnode-check { width: 18px; height: 18px; border: 1px solid var(--border-2); border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #fff; flex-shrink: 0; cursor: pointer; }
.gnode-check.on { background: var(--primary); border-color: var(--primary); }
.gnode.batch-sel { background: color-mix(in srgb, var(--primary) 10%, transparent); }
.gnode-caret {
  width: 14px;
  font-size: 10px;
  color: var(--muted);
  cursor: pointer;
  text-align: center;
  flex-shrink: 0;
}

.gnode-caret.hidden {
  visibility: hidden;
}

.gnode-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.gnode-count {
  font-size: 11px;
  color: var(--muted);
  background: var(--panel-2);
  border-radius: 10px;
  padding: 1px 7px;
  flex-shrink: 0;
}

.gnode-ops {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}

.gnode:hover .gnode-ops {
  display: flex;
}

.gnode.editing .gnode-ops {
  display: flex;
}

.gnode-op {
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 5px;
}

.gnode-op.ok:hover {
  color: var(--success);
}

.gnode-op:hover {
  background: var(--border-2);
  color: var(--text);
}

.gnode-op.danger:hover {
  color: var(--danger);
}

.gnode-edit {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--primary);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  padding: 3px 6px;
  outline: none;
}
</style>
