#!/usr/bin/env node
/**
 * おさかな図鑑（ブラウザでの魚判定）が使う、onnxruntime-web の実行用ファイルを public/ort/ にコピーする。
 * dev / build の前に自動で実行する（package.json の predev / prebuild）。コピー先は Git の管理外。
 * WebGPU なしの軽い版（ort.wasm.min.js と、対応する .mjs / .wasm）だけを使う。
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(root, 'node_modules', 'onnxruntime-web', 'dist')
const to = path.join(root, 'public', 'ort')
const files = ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']

mkdirSync(to, { recursive: true })
for (const file of files) {
  const source = path.join(from, file)
  if (!existsSync(source)) {
    console.error(`[copy-ort] ${file} が見つかりません。npm ci を実行してください。`)
    process.exit(1)
  }
  copyFileSync(source, path.join(to, file))
}
console.log(`[copy-ort] ${files.length} 個のファイルを public/ort/ にコピーしました`)
