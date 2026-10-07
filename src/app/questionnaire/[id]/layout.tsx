import { notFound } from 'next/navigation'
import { store } from '@/lib/dataStore'
import { findReservationByQuestionnaireToken } from '@/lib/questionnaireToken'
export const dynamic='force-dynamic'
export default async function QuestionnaireLayout({children,params}:{children:React.ReactNode;params:{id:string}}) {
  if(!findReservationByQuestionnaireToken(await store.getReservations(),params.id)) notFound()
  return children
}
