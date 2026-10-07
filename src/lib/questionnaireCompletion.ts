import type { QuestionnaireData, Reservation } from '@/types'

/** Return questionnaire records that represent committed guest submissions. */
export function completedQuestionnairesForReservation(
  reservation: Reservation,
  questionnaires: QuestionnaireData[],
): QuestionnaireData[] {
  return questionnaires.filter((questionnaire) =>
    questionnaire.reservationId === reservation.id && (
      questionnaire.submissionState === 'complete' ||
      (!questionnaire.submissionState && reservation.questionnaireCompleted)
    ),
  )
}

/** A shared reservation URL is complete only after every guest has submitted. */
export function hasAllGuestQuestionnaires(
  reservation: Reservation,
  questionnaires: QuestionnaireData[],
): boolean {
  const guestCount = Number.isFinite(reservation.guestCount)
    ? Math.max(1, Math.floor(reservation.guestCount))
    : 1
  return completedQuestionnairesForReservation(reservation, questionnaires).length >= guestCount
}
