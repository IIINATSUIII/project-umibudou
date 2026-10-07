import { describe, expect, it } from 'vitest'
import type { QuestionnaireData, Reservation } from '@/types'
import {
  completedQuestionnairesForReservation,
  hasAllGuestQuestionnaires,
} from '../questionnaireCompletion'

const reservation = {
  id: 'R-1',
  guestCount: 2,
  questionnaireCompleted: true,
} as Reservation

function questionnaire(id: string, submissionState?: QuestionnaireData['submissionState']): QuestionnaireData {
  return {
    id,
    reservationId: reservation.id,
    submittedAt: `2026-10-07T00:00:0${id.length}Z`,
    submissionState,
  } as QuestionnaireData
}

describe('guest questionnaire completion', () => {
  it('does not mark a multi-guest reservation complete after the first committed submission', () => {
    const questionnaires = [questionnaire('Q-1', 'complete')]
    expect(completedQuestionnairesForReservation(reservation, questionnaires)).toHaveLength(1)
    expect(hasAllGuestQuestionnaires(reservation, questionnaires)).toBe(false)
  })

  it('marks the shared URL complete after the guest count is reached', () => {
    const questionnaires = [questionnaire('Q-1', 'complete'), questionnaire('Q-2', 'complete')]
    expect(hasAllGuestQuestionnaires(reservation, questionnaires)).toBe(true)
  })

  it('does not count a pending row even if the reservation has a questionnaire link', () => {
    expect(hasAllGuestQuestionnaires(reservation, [questionnaire('Q-1', 'pending')])).toBe(false)
  })

  it('treats legacy rows without per-questionnaire state as complete only when the reservation is marked complete', () => {
    expect(hasAllGuestQuestionnaires(reservation, [questionnaire('Q-1'), questionnaire('Q-2')])).toBe(true)
    expect(hasAllGuestQuestionnaires(
      { ...reservation, questionnaireCompleted: false },
      [questionnaire('Q-1'), questionnaire('Q-2')],
    )).toBe(false)
  })
})
