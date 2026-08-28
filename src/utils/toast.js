import { reactive } from 'vue'

const state = reactive({
  message: '',
  visible: false,
  timer: null
})

function showToast (message, duration = 2200) {
  state.message = message
  state.visible = true
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => {
    state.visible = false
  }, duration)
}

export const toast = state
export { showToast }
