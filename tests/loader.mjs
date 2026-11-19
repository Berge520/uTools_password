// 测试专用：源码使用 Vite 风格无扩展名导入，Node ESM 需要补全 .js
export async function resolve (specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.')) {
      return nextResolve(specifier + '.js', context)
    }
    throw err
  }
}