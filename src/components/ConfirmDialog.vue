<script setup>
defineProps({
  title: { type: String, default: '确认' },
  message: { type: String, required: true },
  confirmText: { type: String, default: '确定' },
  confirm2Text: { type: String, default: '' },
  danger: { type: Boolean, default: false },
  danger2: { type: Boolean, default: false }
})

const emit = defineEmits(['confirm', 'confirm2', 'cancel'])
</script>

<template>
  <div class="modal-mask" @click.self="emit('cancel')">
    <div class="modal confirm-modal" @keydown.esc="emit('cancel')">
      <div class="confirm-icon" :class="{ danger }">{{ danger || danger2 ? '⚠️' : '❓' }}</div>
      <h3>{{ title }}</h3>
      <p class="confirm-msg">{{ message }}</p>
      <div class="modal-actions">
        <button class="btn" @click="emit('cancel')">取消</button>
        <button class="btn" :class="danger ? 'confirm-danger' : 'primary'" @click="emit('confirm')">
          {{ confirmText }}
        </button>
        <button v-if="confirm2Text" class="btn" :class="danger2 ? 'confirm-danger' : ''" @click="emit('confirm2')">
          {{ confirm2Text }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-modal {
  max-width: 340px;
  text-align: center;
}

.confirm-icon {
  font-size: 36px;
  margin-bottom: 10px;
}

.confirm-modal h3 {
  margin: 0 0 8px;
}

.confirm-msg {
  margin: 0 0 20px;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.modal-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}

.confirm-danger {
  background: var(--danger);
  color: #fff;
}

.confirm-danger:hover {
  filter: brightness(1.05);
}
</style>
