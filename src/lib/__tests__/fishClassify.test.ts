import { describe, it, expect } from 'vitest'
import {
  CONFIDENT_THRESHOLD,
  INPUT_SIZE,
  MODEL_URL,
  RESIZE_SHORT_SIDE,
  SPECIES,
  cautionFor,
  rankCandidates,
  resizedSize,
  toModelInput,
} from '../fish/classify'

describe('対応している魚のデータ', () => {
  it('75種で、番号が 0〜74 の連番、日本語名・学名が全部ある', () => {
    expect(SPECIES).toHaveLength(75)
    expect(SPECIES.map((s) => s.id)).toEqual(Array.from({ length: 75 }, (_, i) => i))
    for (const s of SPECIES) {
      expect(s.ja.trim()).not.toBe('')
      expect(s.scientific).toMatch(/^[A-Z][a-z]+ [a-z-]+$/)
    }
  })

  it('同じ魚（学名）が重複していない', () => {
    expect(new Set(SPECIES.map((s) => s.scientific)).size).toBe(SPECIES.length)
  })

  it('干潟・淡水の魚（ダイビングで出会わない魚）は、対応の一覧に入れていない', () => {
    const names = SPECIES.map((s) => s.ja)
    for (const excluded of ['ミナミトビハゼ', 'クロヨシノボリ', 'オオウナギ', 'オオクチユゴイ']) {
      expect(names).not.toContain(excluded)
    }
  })

  it('モデルのファイルは、バージョン付きの名前で /models/fish/ から配る', () => {
    expect(MODEL_URL).toMatch(/^\/models\/fish\/fish-s75-v\d+\.onnx$/)
  })
})

describe('毒・とげの注意（名前による簡易の判定）', () => {
  it('ミノカサゴ・アイゴ・モンガラの仲間には、注意が付く', () => {
    expect(cautionFor('ハナミノカサゴ')).toContain('毒')
    expect(cautionFor('ヒフキアイゴ')).toContain('毒')
    expect(cautionFor('ゴマモンガラ')).toContain('かみつく')
    expect(cautionFor('ハリセンボン')).toContain('とげ')
  })

  it('それ以外の魚には、注意を付けない', () => {
    expect(cautionFor('ハマクマノミ')).toBeUndefined()
    expect(cautionFor('ツノダシ')).toBeUndefined()
  })

  it('対応の75種のうち、注意が付くのは、決めた仲間だけ', () => {
    const flagged = SPECIES.filter((s) => cautionFor(s.ja)).map((s) => s.ja)
    expect(flagged.length).toBeGreaterThan(0)
    for (const name of flagged) {
      expect(name).toMatch(/ミノカサゴ|オニダルマオコゼ|ゴンズイ|アイゴ|ハリセンボン|モンガラ/)
    }
  })
})

describe('rankCandidates(確率から、上位3つを選ぶ)', () => {
  const probabilities = (top: Record<number, number>) => {
    const p = new Float32Array(SPECIES.length)
    for (const [i, v] of Object.entries(top)) p[Number(i)] = v
    return p
  }

  it('確率の高い順に3つ返し、1位が高ければ「自信あり」', () => {
    const result = rankCandidates(probabilities({ 5: 0.8, 10: 0.1, 20: 0.05, 30: 0.02 }))

    expect(result.candidates.map((c) => c.species.id)).toEqual([5, 10, 20])
    expect(result.candidates[0].probability).toBeCloseTo(0.8)
    expect(result.confident).toBe(true)
  })

  it('1位が閾値未満なら「自信なし」。ちょうど閾値なら「自信あり」', () => {
    expect(rankCandidates(probabilities({ 1: CONFIDENT_THRESHOLD - 0.01, 2: 0.4 })).confident).toBe(false)
    expect(rankCandidates(probabilities({ 1: CONFIDENT_THRESHOLD, 2: 0.4 })).confident).toBe(true)
  })

  it('毒のある魚が上位に来たら、注意を付けて返す', () => {
    const harmful = SPECIES.find((s) => s.ja.includes('ミノカサゴ'))!

    const result = rankCandidates(probabilities({ [harmful.id]: 0.9 }))

    expect(result.candidates[0].species.ja).toBe(harmful.ja)
    expect(result.candidates[0].caution).toContain('触らないでください')
  })

  it('出力の数が種の数と合わないときは、誤った名前を返さずに、エラーにする', () => {
    expect(() => rankCandidates(new Float32Array(74))).toThrow('出力の数が合いません')
    expect(() => rankCandidates(new Float32Array(76))).toThrow('出力の数が合いません')
  })

  it('同じ確率でも、並びが崩れず、必ず3件返す', () => {
    const result = rankCandidates(new Float32Array(SPECIES.length).fill(1 / SPECIES.length))

    expect(result.candidates).toHaveLength(3)
    expect(result.confident).toBe(false)
  })
})

describe('写真の前処理(学習のときと同じ手順)', () => {
  it('短い辺を293にそろえる（縦横比は保つ）', () => {
    expect(resizedSize(1000, 500)).toEqual({ width: 586, height: RESIZE_SHORT_SIDE })
    expect(resizedSize(500, 1000)).toEqual({ width: RESIZE_SHORT_SIDE, height: 586 })
    expect(resizedSize(293, 293)).toEqual({ width: 293, height: 293 })
  })

  it('小さい写真でも、切り出す大きさ(256)を下回らない', () => {
    const { width, height } = resizedSize(100, 100)

    expect(width).toBeGreaterThanOrEqual(INPUT_SIZE)
    expect(height).toBeGreaterThanOrEqual(INPUT_SIZE)
  })

  it('RGBA を、平均・標準偏差で正規化した NCHW(チャンネル順)に並べ替える', () => {
    const pixels = INPUT_SIZE * INPUT_SIZE
    const rgba = new Uint8ClampedArray(pixels * 4)
    for (let i = 0; i < pixels; i++) rgba.set([255, 0, 128, 255], i * 4) // R=255 G=0 B=128

    const input = toModelInput(rgba)

    expect(input).toHaveLength(3 * pixels)
    expect(input[0]).toBeCloseTo((1 - 0.485) / 0.229, 4)                   // R の面
    expect(input[pixels]).toBeCloseTo((0 - 0.456) / 0.224, 4)               // G の面
    expect(input[2 * pixels]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 4)   // B の面
    expect(input[pixels - 1]).toBeCloseTo(input[0], 6)                      // 面の中は同じ値
  })

  it('画像の大きさが違うときは、エラーにする', () => {
    expect(() => toModelInput(new Uint8ClampedArray(100))).toThrow('画像の大きさが合いません')
  })
})
