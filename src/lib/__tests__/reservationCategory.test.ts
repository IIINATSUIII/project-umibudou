import { describe, expect, it } from 'vitest'
import { appendCancellationAudit, cancellationAudit, reservationMatchesCategory } from '../reservationStatus'
import type { Reservation } from '@/types'
const reservation = (status: string, staffNote = '') => ({ status, staffNote } as Reservation)
describe('Issue #79 reservation classification', () => {
  it('classifies pending and confirmed reservations', () => {
    expect(reservationMatchesCategory(reservation('STS-01'), 'progress')).toBe(true)
    expect(reservationMatchesCategory(reservation('STS-02'), 'progress')).toBe(true)
    expect(reservationMatchesCategory(reservation('STS-03'), 'confirmed')).toBe(true)
    expect(reservationMatchesCategory(reservation('STS-03'), 'progress')).toBe(false)
  })
  it('records the phase and timestamp when cancellation happens', () => {
    for (const [status, phase] of [['STS-01', 'before'], ['STS-03', 'after']] as const) {
      const note = appendCancellationAudit(reservation(status, '対応メモ'), '2026-10-20T01:00:00.000Z')
      const cancelled = reservation('STS-04', note)
      expect(note).toContain('対応メモ')
      expect(cancellationAudit(cancelled)).toEqual({ phase, at: '2026-10-20T01:00:00.000Z' })
      expect(reservationMatchesCategory(cancelled, phase)).toBe(true)
      expect(reservationMatchesCategory(cancelled, phase === 'before' ? 'after' : 'before')).toBe(false)
      expect(reservationMatchesCategory(cancelled, 'all')).toBe(true)
    }
  })
  it('does not guess the phase of legacy cancelled reservations', () => {
    expect(reservationMatchesCategory(reservation('cancelled'), 'all')).toBe(true)
    expect(reservationMatchesCategory(reservation('cancelled'), 'before')).toBe(false)
    expect(reservationMatchesCategory(reservation('cancelled'), 'after')).toBe(false)
  })
})
