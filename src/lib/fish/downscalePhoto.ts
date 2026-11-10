/**
 * コレクションに保存する写真を、縮小した JPEG に書き直す（ブラウザ専用）。
 * 書き直すので、撮影場所などの情報（EXIF）は残らない。向き（回転）は、書き直す前に直す。
 */
import { downscaledSize } from './collection'

const JPEG_QUALITY = 0.82

export async function downscalePhoto(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('この写真は読み取れませんでした。別の写真でお試しください。')
  }
  try {
    const { width, height } = downscaledSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('この端末では画像を処理できません')
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) throw new Error('写真を保存用に変換できませんでした')
    return blob
  } finally {
    bitmap.close()
  }
}
