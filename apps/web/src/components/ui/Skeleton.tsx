import clsx from 'clsx'

export function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={clsx('animate-pulse rounded-xl bg-hover', className)} />
}
export function SessionSkeleton() {
  return <div className="mx-auto max-w-4xl space-y-6 p-8" role="status" aria-label="Carregando sessão">
    <Skeleton className="h-10 w-2/3" /><Skeleton className="h-56" /><Skeleton className="h-72" />
  </div>
}
export function DocumentSkeleton() {
  return <div className="nebula-surface h-80 space-y-5 rounded-2xl border border-line bg-surface p-6 shadow-soft" role="status" aria-label="Carregando documento">
    <Skeleton className="h-6 w-1/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
  </div>
}
