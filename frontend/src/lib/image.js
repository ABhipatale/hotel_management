/** Thumbnail URL of an uploaded picture ("name.webp" -> "name-t.webp"); falls back to the original when none exists. */
export const thumbOf = (url) => (url && /\.(webp|jpg)$/i.test(url) ? url.replace(/\.(webp|jpg)$/i, '-t.$1') : url)

const canWebp = (() => {
  try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp') } catch { return false }
})()

/**
 * Shrinks a picked photo in the browser BEFORE upload (max side px, WebP/JPEG), so uploading works on weak mobile data too.
 * Returns the original file if it is already small, not a normal image, or anything fails.
 */
export async function compressImage(file, max = 1200, quality = 0.82) {
  try {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 200 * 1024) { bmp.close?.(); return file }
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const type = canWebp ? 'image/webp' : 'image/jpeg'
    const blob = await new Promise((res) => canvas.toBlob(res, type, quality))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + (canWebp ? '.webp' : '.jpg'), { type })
  } catch {
    return file
  }
}
