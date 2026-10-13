import { notFound } from 'next/navigation'
import { store } from '@/lib/dataStore'
import { findReservationByQuestionnaireToken } from '@/lib/questionnaireToken'
export const dynamic='force-dynamic'
export default async function QuestionnaireLayout({children,params}:{children:React.ReactNode;params:Promise<{id:string}>}) {
  const { id } = await params
  if(!findReservationByQuestionnaireToken(await store.getReservations(),id)) notFound()
  return children
}
