import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyText, copyImage } from '../../src/utils/clipboard'

// 敏感内容复制后 15 秒自动清空；非敏感内容（账号等）不得清空

beforeEach(() => {
  vi.useFakeTimers()
  window.utools = {
    copyText: vi.fn(() => true),
    copyImage: vi.fn(() => true)
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('复制密码（敏感）15 秒后清空剪贴板', async () => {
  await copyText('secret-pw', { label: '密码' })
  expect(window.utools.copyText).toHaveBeenCalledWith('secret-pw')
  vi.advanceTimersByTime(15000)
  expect(window.utools.copyText).toHaveBeenLastCalledWith('')
})

test('复制账号（非敏感）不得清空剪贴板', async () => {
  await copyText('user@example.com', { label: '账号', sensitive: false })
  vi.advanceTimersByTime(15000)
  expect(window.utools.copyText).toHaveBeenCalledTimes(1)
  expect(window.utools.copyText).not.toHaveBeenCalledWith('')
})

test('复制图片会取消待执行的文本清空', async () => {
  await copyText('secret-pw', { label: '密码' })
  await copyImage('data:image/png;base64,AAAA', { label: '二维码' })
  vi.advanceTimersByTime(15000)
  expect(window.utools.copyText).not.toHaveBeenCalledWith('')
})
