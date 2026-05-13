function safeDate(value: string | number | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(
    typeof value === 'number' && value < 1e12
      ? value * 1000  // Unix em segundos → ms
      : value
  )
  return isNaN(d.getTime()) ? null : d
}

export {
  safeDate
}