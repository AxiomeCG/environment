import { getEnvironmentLabCase } from '@pascal-app/plugin-environment/lab/catalog'
import { notFound } from 'next/navigation'
import { EnvironmentLabClient } from '@/components/environment-lab/environment-lab-client'

type EnvironmentLabCasePageProps = {
  params: Promise<{ caseId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function EnvironmentLabCasePage({
  params,
  searchParams,
}: EnvironmentLabCasePageProps) {
  const [{ caseId }, query] = await Promise.all([params, searchParams])
  const labCase = getEnvironmentLabCase(caseId)
  if (!labCase) notFound()

  const requestedVariant = query.variant
  if (Array.isArray(requestedVariant)) notFound()
  const canonicalVariant = labCase.variants[0]
  if (!canonicalVariant) {
    throw new Error(`Environment lab case "${labCase.id}" has no canonical variant`)
  }
  const activeVariantId = requestedVariant ?? canonicalVariant.id
  if (!labCase.variants.some((variant) => variant.id === activeVariantId)) notFound()

  return <EnvironmentLabClient activeVariantId={activeVariantId} labCase={labCase} />
}
