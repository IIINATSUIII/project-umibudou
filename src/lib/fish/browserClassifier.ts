/**
 * ブラウザの中で、魚判定モデル（ONNX）を動かす。写真は外部へ送らない。
 *
 * 実行用の部品（onnxruntime-web）は、バンドルせず、/ort/ から <script> で読み込む
 * （自分たちのサーバーから配る。外部のサイトには頼らない）。ファイルは public/ort/ に、ビルドの前に
 * scripts/copy-ort.mjs が node_modules からコピーする。
 */
import {
  INPUT_SIZE,
  MODEL_URL,
  SPECIES,
  rankCandidates,
  resizedSize,
  toModelInput,
  type FishResult,
} from './classify'

const ORT_SCRIPT = '/ort/ort.wasm.min.js'
const ORT_BASE = '/ort/'

interface OrtTensor {
  data: Float32Array
}
interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>
}
interface OrtGlobal {
  env: { wasm: { wasmPaths: string; numThreads: number } }
  InferenceSession: { create(url: string, options: { executionProviders: string[] }): Promise<OrtSession> }
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown
}

let ortLoading: Promise<OrtGlobal> | null = null
let sessionLoading: Promise<OrtSession> | null = null

function loadOrt(): Promise<OrtGlobal> {
  const existing = (window as unknown as { ort?: OrtGlobal }).ort
  if (existing) return Promise.resolve(existing)
  ortLoading ??= new Promise<OrtGlobal>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = ORT_SCRIPT
    script.async = true
    script.onload = () => {
      const ort = (window as unknown as { ort?: OrtGlobal }).ort
      if (ort) resolve(ort)
      else reject(new Error('判定の部品を読み込めませんでした'))
    }
    script.onerror = () => {
      ortLoading = null
      reject(new Error('判定の部品を読み込めませんでした。通信状態を確認してください。'))
    }
    document.head.appendChild(script)
  })
  return ortLoading
}

/** モデルを読み込む（初回だけ時間がかかる。2回目以降は、同じものを使い回す）。 */
export function loadModel(): Promise<OrtSession> {
  sessionLoading ??= (async () => {
    const ort = await loadOrt()
    // 絶対パスで指定する（相対パスだとモジュールとして読み込めない）
    ort.env.wasm.wasmPaths = new URL(ORT_BASE, window.location.href).href
    // 特別な設定（クロスオリジン分離）なしで動くよう、1スレッドにする
    ort.env.wasm.numThreads = 1
    return ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] })
  })().catch((error) => {
    sessionLoading = null
    throw error
  })
  return sessionLoading
}

/** 写真を、モデルの入力（短い辺をそろえて、中央を切り出した画像）に変える。向き（EXIF）は自動で直す。 */
async function photoToInput(file: Blob): Promise<Float32Array> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // ブラウザの英語のエラー文をそのまま見せない
    throw new Error('この写真は読み取れませんでした。別の写真でお試しください。')
  }
  try {
    const { width, height } = resizedSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = INPUT_SIZE
    canvas.height = INPUT_SIZE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('この端末では画像を処理できません')
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, (INPUT_SIZE - width) / 2, (INPUT_SIZE - height) / 2, width, height)
    return toModelInput(context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data)
  } finally {
    bitmap.close()
  }
}

/** 写真から、近い魚を3つ判定する。 */
export async function classifyPhoto(file: Blob): Promise<FishResult & { milliseconds: number }> {
  const [session, ort] = await Promise.all([loadModel(), loadOrt()])
  const input = await photoToInput(file)
  const started = performance.now()
  const output = await session.run({ input: new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]) })
  const probabilities = output.probs?.data
  if (!probabilities || probabilities.length !== SPECIES.length) {
    throw new Error('判定の結果を読み取れませんでした')
  }
  return { ...rankCandidates(probabilities), milliseconds: performance.now() - started }
}
