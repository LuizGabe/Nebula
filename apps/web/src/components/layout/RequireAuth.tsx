import { useEffect } from 'react'
import { useNavigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { Spinner } from '../ui/misc'

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
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="w-8 h-8" />
      </div>
    )
  }

  if (!user) {
    navigate('/login', { replace: true })
    return null
  }

  return <Outlet />
}