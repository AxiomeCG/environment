'use client'

import type { EnvironmentLabCase } from '@pascal-app/plugin-environment/lab/catalog'
import dynamic from 'next/dynamic'

const EnvironmentLabEditor = dynamic(
  () =>
    import('./environment-lab-editor').then((module) => ({
      default: module.EnvironmentLabEditor,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        aria-busy="true"
        className="dark flex h-screen w-screen items-center justify-center bg-background text-foreground"
      >
        <div className="text-center" role="status">
          <div className="pascal-loader-1 mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-4 font-medium text-sm">Loading Environment lab</p>
          <p className="mt-1 text-muted-foreground text-xs">
            Preparing the isolated editor bundle…
          </p>
        </div>
      </div>
    ),
  },
)

export function EnvironmentLabClient(props: {
  activeVariantId: string
  labCase: EnvironmentLabCase
}) {
  return <EnvironmentLabEditor {...props} />
}
