/**
 * コース・スタッフ・ステータスの各マスタ（Courses / Staff / Status シート相当）
 * MVP版ではスプレッドシートを持たず、コード内の静的データとして保持する。
 * docs/03_基本設計書_DB設計編.md §3-6〜3-8 準拠。
 */
import type { Course, Staff, StatusDef } from '@/types'

export const COURSES: Course[] = [
  { id: 'CRS-001', name: '体験ダイビング', type: '体験' },
  { id: 'CRS-002', name: 'ファンダイビング（2本）', type: 'ファン' },
  { id: 'CRS-003', name: 'ファンダイビング（3本）', type: 'ファン' },
  { id: 'CRS-004', name: 'ナイトダイビング', type: 'ファン' },
  { id: 'CRS-005', name: 'シュノーケリング', type: '体験' },
  { id: 'CRS-006', name: 'OWライセンス取得', type: 'ライセンス' },
]

export const STAFF: Staff[] = [
  { id: 'STF-001', name: '外間 健', isAdmin: true },
  { id: 'STF-002', name: '知念 美咲', isAdmin: false },
]

/** 予約ステータス。並び順は業務フローの進行順。 */
export const STATUSES: StatusDef[] = [
  { id: 'STS-01', name: '予約受付', color: '#FFF2CC' },
  { id: 'STS-02', name: '確認中', color: '#FCE4D6' },
  { id: 'STS-03', name: '確定', color: '#C6EFCE' },
  { id: 'STS-04', name: 'キャンセル', color: '#FFC7CE' },
  { id: 'STS-05', name: '実施済', color: '#D9D9D9' },
  { id: 'STS-06', name: '返金済', color: '#DDEBF7' },
]

export const DEFAULT_STATUS_ID = 'STS-01'   // 予約受付（客側フォームからの新規申し込み）
export const CONFIRMED_STATUS_ID = 'STS-03' // 確定（スタッフによる承認・手動登録）
export const CANCELLED_STATUS_ID = 'STS-04' // キャンセル

export function getCourseName(id: string): string {
  return COURSES.find((c) => c.id === id)?.name ?? ''
}

export function getStaffName(id?: string): string {
  if (!id) return ''
  return STAFF.find((s) => s.id === id)?.name ?? ''
}

export function getStatusName(id: string): string {
  return STATUSES.find((s) => s.id === id)?.name ?? id
}

export function getStatusColor(id: string): string {
  return STATUSES.find((s) => s.id === id)?.color ?? '#E5E7EB'
}
