import { z } from 'zod'

export function normalizeYouTubeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null
    const host = url.hostname.toLowerCase()
    let videoId: string | null = null
    if (host === 'youtu.be' || host === 'www.youtu.be') {
      videoId = /^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1] ?? null
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
      videoId = url.pathname === '/watch'
        ? url.searchParams.get('v')
        : /^\/shorts\/([\w-]{11})\/?$/.exec(url.pathname)?.[1] ?? null
    }
    return videoId && /^[\w-]{11}$/.test(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null
  } catch {
    return null
  }
}

export const youtubeUrlSchema = z.string().trim().max(2048).refine(
  (value) => normalizeYouTubeUrl(value) !== null,
  'Informe uma URL valida de um video do YouTube (watch, youtu.be ou shorts).',
)
