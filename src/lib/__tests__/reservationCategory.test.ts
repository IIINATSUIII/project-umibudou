import { describe, expect, it } from 'vitest'
import type { Reservation } from '@/types'
import { reservationMatchesCategory } from '@/lib/reservationStatus'

const reservation = (
  status: string,
  cancellationPhase?: Reservation['cancellationPhase'],
): Reservation => ({
  id: 'R-1',
  diveDate: '2026-10-20',
  guestName: '山田 太郎',
  guestPhone: '090-1234-5678',
  guestCount: 1,
  timeSlot: 'morning',
  courseName: '体験ダイビング',
  channel: 'phone',
  status,
  ...(cancellationPhase ? { cancellationPhase } : {}),
})

describe('reservationMatchesCategory', () => {
  it('separates confirmed and in-progress reservations', () => {
    expect(reservationMatchesCategory(reservation('STS-03'), 'confirmed')).toBe(true)
    expect(reservationMatchesCategory(reservation('STS-01'), 'progress')).toBe(true)
    expect(reservationMatchesCategory(reservation('STS-02'), 'progress')).toBe(true)
    expect(reservationMatchesCategory(reservation('STS-03'), 'progress')).toBe(false)
  })

  it('uses the persisted cancellation phase for cancelled reservations', () => {
    expect(reservationMatchesCategory(reservation('STS-04', 'before'), 'before')).toBe(true)
    expect(reservationMatchesCategory(reservation('STS-04', 'after'), 'after')).toBe(true)
    expect(reservationMatchesCategory(reservation('STS-04', 'before'), 'after')).toBe(false)
  })

  it('keeps legacy cancellations in all records without guessing a category', () => {
    const legacy = reservation('STS-04')
    expect(reservationMatchesCategory(legacy, 'all')).toBe(true)
    expect(reservationMatchesCategory(legacy, 'before')).toBe(false)
    expect(reservationMatchesCategory(legacy, 'after')).toBe(false)
  })
})
