/**
 * 写真から、魚だけを切り抜いた画像（背景が透明な PNG）を作る（ブラウザ専用）。
 * うまく切り抜けなかった写真は null を返す（その場合、水槽では、写真を泡に包んで泳がせる）。
 * 写真は外部へ送らない。
 */
import { classifyPhoto, loadOrt, type OrtSession } from './browserClassifier'
import {
  CUTOUT_INPUT_SIZE,
  CUTOUT_MODEL_URL,
  boundingBox,
  centerCropBox,
  coverageOf,
  isUsableCutout,
  judgeCutout,
  normalizeMap,
  spriteSize,
  toAlpha,
  type Box,
  type CutoutVerdict,
} from './cutout'

/** U²-Netp（u2netp-v1.onnx）の入力名と、いちばん仕上がった出力の名前。モデルを差し替えるときは、確かめ直すこと */
const INPUT_NAME = 'input.1'
const OUTPUT_NAME = '1959'
const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const

let sessionLoading: Promise<OrtSession> | null = null

function loadCutoutModel(): Promise<OrtSession> {
  sessionLoading ??= (async () => {
    const ort = await loadOrt()
    return ort.InferenceSession.create(CUTOUT_MODEL_URL, { executionProviders: ['wasm'] })
  })().catch((error) => {
    sessionLoading = null
    throw error
  })
  return sessionLoading
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** 画像の指定した範囲を、AI に渡す大きさ（正方形）で渡し、「目立つ場所」のマップ（0〜1）を得る。 */
async function saliencyMap(bitmap: ImageBitmap, region: Box): Promise<Float32Array> {
  const [ort, session] = await Promise.all([loadOrt(), loadCutoutModel()])
  const size = CUTOUT_INPUT_SIZE
  const canvas = makeCanvas(size, size)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('この端末では画像を処理できません')
  context.drawImage(bitmap, region.x, region.y, region.width, region.height, 0, 0, size, size)
  const pixels = context.getImageData(0, 0, size, size).data
  const input = new Float32Array(3 * size * size)
  for (let i = 0; i < size * size; i++) {
    for (let channel = 0; channel < 3; channel++) {
      input[channel * size * size + i] = (pixels[i * 4 + channel] / 255 - MEAN[channel]) / STD[channel]
    }
  }
  const output = await session.run({ [INPUT_NAME]: new ort.Tensor('float32', input, [1, 3, size, size]) })
  const final = output[OUTPUT_NAME]
  if (!final) throw new Error('切り抜きの結果を読み取れませんでした')
  return normalizeMap(final.data)
}

/** 切り抜き: 魚の部分だけ残した、背景が透明の PNG。切り抜けなければ null。 */
export async function cutOutFish(photo: Blob): Promise<Blob | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(photo, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
  try {
    const whole: Box = { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
    let region = whole
    let map = await saliencyMap(bitmap, region)
    if (!isUsableCutout(coverageOf(map))) {
      // 魚が小さい写真は、中央を拡大して、もう一度試す
      region = centerCropBox(bitmap.width, bitmap.height)
      map = await saliencyMap(bitmap, region)
      if (!isUsableCutout(coverageOf(map))) return null
    }
    const box = boundingBox(map, CUTOUT_INPUT_SIZE, CUTOUT_INPUT_SIZE)
    if (!box) return null

    // マップ上の四角を、元の写真の範囲に直し、その範囲を、切り抜き画像の大きさに描く
    const scaleX = region.width / CUTOUT_INPUT_SIZE
    const scaleY = region.height / CUTOUT_INPUT_SIZE
    const source: Box = { x: region.x + box.x * scaleX, y: region.y + box.y * scaleY, width: box.width * scaleX, height: box.height * scaleY }
    const { width, height } = spriteSize(Math.round(source.width), Math.round(source.height))
    const canvas = makeCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, width, height)

    // 透明度: マップを、切り抜き画像の大きさに合わせて、各画素に付ける
    const mapCanvas = makeCanvas(CUTOUT_INPUT_SIZE, CUTOUT_INPUT_SIZE)
    const mapContext = mapCanvas.getContext('2d', { willReadFrequently: true })
    if (!mapContext) return null
    const mapImage = mapContext.createImageData(CUTOUT_INPUT_SIZE, CUTOUT_INPUT_SIZE)
    for (let i = 0; i < map.length; i++) {
      mapImage.data[i * 4] = mapImage.data[i * 4 + 1] = mapImage.data[i * 4 + 2] = 255
      mapImage.data[i * 4 + 3] = toAlpha(map[i])
    }
    mapContext.putImageData(mapImage, 0, 0)
    const alphaCanvas = makeCanvas(width, height)
    const alphaContext = alphaCanvas.getContext('2d', { willReadFrequently: true })
    if (!alphaContext) return null
    alphaContext.imageSmoothingQuality = 'high'
    alphaContext.drawImage(mapCanvas, box.x, box.y, box.width, box.height, 0, 0, width, height)

    // 魚の色の画素に、透明度を付ける
    const fish = context.getImageData(0, 0, width, height)
    const alpha = alphaContext.getImageData(0, 0, width, height).data
    for (let i = 0; i < width * height; i++) fish.data[i * 4 + 3] = alpha[i * 4 + 3]
    context.putImageData(fish, 0, 0)

    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  } finally {
    bitmap.close()
  }
}

/** 透明な部分を、水の色で埋めた画像にする（魚の判定にかけ直すときに使う）。 */
async function onWaterColor(sprite: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(sprite)
  try {
    const canvas = makeCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('この端末では画像を処理できません')
    context.fillStyle = 'rgb(110, 140, 170)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('画像を変換できませんでした')
    return blob
  } finally {
    bitmap.close()
  }
}

/**
 * 切り抜きを、魚の判定AIにかけ直して、魚を切り抜けていそうかを調べる（目安）。
 * 調べられなかったとき（エラーなど）は 'unknown'。
 */
export async function checkCutout(
  sprite: Blob,
  expectedId: number | null,
  originalProbability: number
): Promise<CutoutVerdict> {
  if (expectedId === null) return 'unknown'
  try {
    const result = await classifyPhoto(await onWaterColor(sprite))
    const top = result.candidates[0]
    return judgeCutout(expectedId, originalProbability, top.species.id, top.probability)
  } catch {
    return 'unknown'
  }
}
