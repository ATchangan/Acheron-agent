// v0.3.0 图片调度修复 FIX-C/G: 唯一压缩/解码实现
// 9 格式归一化矩阵: PNG/JPG/WebP/GIF/BMP/SVG/AVIF(Chromium 原生/栅格化) + HEIC(明确提示)
// 压缩: ≤1568px / ≤1.5MB, 透明保 PNG, 超限降级链(0.85 → 0.5 → 0.65 倍缩小重编)

async function decodeImage(dataUrl: string): Promise<{ bitmap: ImageBitmap; hasAlpha: boolean }> {
  const mime = (dataUrl.match(/^data:([^;]+)/) || [])[1] || ''
  const blob = await (await fetch(dataUrl)).blob()
  if (mime === 'image/heic') throw new Error('heic-unsupported: HEIC 格式需要先转换为 PNG/JPEG')
  if (mime === 'image/svg+xml') {
    // SVG: 读 XML 取 width/height/viewBox; 无 → 1024 视口, 栅格化
    const txt = await blob.text()
    const vb = /viewBox="[\d.\s]+ ([\d.]+) ([\d.]+)"/.exec(txt)
    const w = /width="(\d+(?:\.\d+)?)"/.exec(txt)?.[1] || vb?.[1] || '1024'
    const h = /height="(\d+(?:\.\d+)?)"/.exec(txt)?.[1] || vb?.[2] || '1024'
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.src = url
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('svg-load-failed')) })
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(+w)); c.height = Math.max(1, Math.round(+h))
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      const bmp = await createImageBitmap(c)
      return { bitmap: bmp, hasAlpha: true }
    } finally { URL.revokeObjectURL(url) }
  }
  // PNG/JPG/WebP/GIF(首帧)/BMP/AVIF: Chromium 原生解码
  const bitmap = await createImageBitmap(blob)
  const hasAlpha = ['image/png', 'image/webp', 'image/gif', 'image/svg+xml'].includes(mime)
  return { bitmap, hasAlpha }
}

export async function normalizeImage(dataUrl: string, opts?: {
  maxEdge?: number    // 默认 1568
  quality?: number    // 默认 0.85
  maxBytes?: number   // 默认 1.5MB
}): Promise<string> {
  const maxEdge = opts?.maxEdge ?? 1568
  const quality = opts?.quality ?? 0.85
  const maxBytes = opts?.maxBytes ?? 1.5 * 1024 * 1024
  try {
    const { bitmap, hasAlpha } = await decodeImage(dataUrl)
    // 小图零开销: 字节 ≤ maxBytes 且宽高 ≤ maxEdge → 原样返回
    if (dataUrl.length / 1.37 <= maxBytes && bitmap.width <= maxEdge && bitmap.height <= maxEdge) {
      bitmap.close?.()
      return dataUrl
    }
    // 等比缩放
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, w, h)
    // 编码: 透明 → PNG; 否则 JPEG(quality), 超限降级链(bitmap 保留到降级完成)
    const enc = hasAlpha ? 'image/png' : 'image/jpeg'
    let out = canvas.toDataURL(enc, quality)
    if (!hasAlpha && out.length / 1.37 > maxBytes) {
      out = canvas.toDataURL('image/jpeg', 0.5)
      if (out.length / 1.37 > maxBytes) {
        // 仍超 → 用原始 bitmap 重绘更小 canvas(不能 drawImage canvas 自身)
        const w2 = Math.max(1, Math.round(w * 0.65)); const h2 = Math.max(1, Math.round(h * 0.65))
        const c2 = document.createElement('canvas'); c2.width = w2; c2.height = h2
        c2.getContext('2d')!.drawImage(bitmap, 0, 0, w2, h2)
        out = c2.toDataURL('image/jpeg', 0.5)
      }
    }
    bitmap.close?.()
    return out
  } catch (e) { return 'E:decode-failed: ' + (e instanceof Error ? e.message : String(e)) }
}
