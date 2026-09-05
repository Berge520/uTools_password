<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { store, addGroup, flattenGroups, deleteGroup } from '../store/vault'
import { showToast } from '../utils/toast'

// v-model 绑定分组 id（null = 未分组）
defineProps({
  modelValue: { type: String, default: null }
})
const emit = defineEmits(['update:modelValue'])

const newGroupOpen = ref(false)
const newGroupName = ref('')

// 本次内联新建的分组 id：弹窗关闭时若无任何条目使用则自动清理，避免残留空分组
const createdIds = []

const options = computed(() => flattenGroups(store.groups))
const NBSP = String.fromCharCode(160)
function optionLabel (g) {
  return g.depth > 0 ? NBSP.repeat(g.depth * 2) + '└ ' + g.name : g.name
}

function onSelect (e) {
  emit('update:modelValue', e.target.value || null)
}

function openNew () {
  newGroupOpen.value = true
  newGroupName.value = ''
}

function createGroup () {
  const name = newGroupName.value.trim()
  if (!name) return
  const g = addGroup(name, null)
  createdIds.push(g.id)
  emit('update:modelValue', g.id)
  newGroupOpen.value = false
  newGroupName.value = ''
  showToast('已新建分组')
}

// 弹窗/表单关闭时：本次新建但没有任何条目使用的分组视为放弃，自动清理
onBeforeUnmount(() => {
  for (const id of createdIds) {
    const g = store.groups.find((x) => x.id === id)
    if (g && !store.entries.some((e) => e.groupId === id)) deleteGroup(id)
  }
})
</script>

<template>
  <div class="group-picker">
    <div class="gp-row">
      <select :value="modelValue || ''" class="input mono-input" @change="onSelect">
        <option value="">未分组</option>
        <option v-for="g in options" :key="g.id" :value="g.id">{{ optionLabel(g) }}</option>
      </select>
      <button v-if="!newGroupOpen" type="button" class="btn icon sm" title="新建分组" @click="openNew">＋</button>
    </div>
    <div v-if="newGroupOpen" class="gp-new">
      <input
        v-model="newGroupName"
        class="input mono-input"
        placeholder="新分组名称，回车创建"
        autofocus
        @keyup.enter="createGroup"
        @keyup.esc="newGroupOpen = false"
      />
      <button type="button" class="btn sm primary" @click="createGroup">创建</button>
      <button type="button" class="btn sm" @click="newGroupOpen = false">取消</button>
    </div>
  </div>
</template>

<style scoped>
.mono-input {
  font-family: var(--mono-font);
  font-variant-ligatures: none;
  font-feature-settings: 'zero' 1;
}
.gp-row {
  display: flex;
  gap: 6px;
}
.gp-row .input {
  flex: 1;
}
.gp-new {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.gp-new .input {
  flex: 1;
}
</style>
