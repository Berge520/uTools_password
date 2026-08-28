import { reactive } from 'vue'

// 拖拽过程中的全局上下文，供主列表与分组树共用
export const dnd = reactive({
  type: null,       // 'entry' | 'group'
  id: null,         // 被拖拽对象 id
  targetId: null,   // 当前悬停目标 id
  mode: null        // entry: 'before' | 'after' ; group: 'before' | 'after' | 'inside'
})

export function startDrag (type, id) {
  dnd.type = type
  dnd.id = id
  dnd.targetId = null
  dnd.mode = null
}

export function clearDrag () {
  dnd.type = null
  dnd.id = null
  dnd.targetId = null
  dnd.mode = null
}

// 根据鼠标在目标行内的纵向位置估算插入模式
export function computeMode (event, insideThreshold = 0.28) {
  const rect = event.currentTarget.getBoundingClientRect()
  const ratio = (event.clientY - rect.top) / rect.height
  if (ratio < insideThreshold) return 'before'
  if (ratio > 1 - insideThreshold) return 'after'
  return 'inside'
}
