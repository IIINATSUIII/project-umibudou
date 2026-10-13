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

/** Pending questionnaires already reserve a guest slot and count against capacity. */
export function hasQuestionnaireGuestSlot(
  reservation: Reservation,
  questionnaires: QuestionnaireData[],
): boolean {
  const capacity = Number.isFinite(reservation.guestCount)
    ? Math.max(1, Math.floor(reservation.guestCount))
    : 1
  const usedSlots = questionnaires.filter(
    (questionnaire) => questionnaire.reservationId === reservation.id,
  ).length
  return usedSlots < capacity
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
