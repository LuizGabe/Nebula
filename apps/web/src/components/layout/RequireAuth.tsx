import { useEffect } from 'react'
import { useNavigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { SessionSkeleton, Skeleton } from '../ui/Skeleton'

export function RequireAuth() {
  const { user, loading, fetchMe } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    const checkAuth = async () => {
      if (!user && !loading) {
        try {
          await fetchMe()
        } catch {
          navigate('/login')
        }
      }
    }
    checkAuth()
  }, [loading, user, navigate])

  if (loading) {
    return (
      <div className="flex min-h-screen bg-ink-50">
        <Skeleton className="hidden min-h-screen w-64 shrink-0 rounded-none lg:block" />
        <div className="flex-1"><SessionSkeleton /></div>
      </div>
    )
  }

  if (!user) {
    navigate('/login', { replace: true })
    return null
  }

  return <Outlet />
}
