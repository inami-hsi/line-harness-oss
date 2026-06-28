const DEFAULT_API_URL = 'http://localhost:8787'

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function getApiBaseUrl(): string {
  return trimTrailingSlash(process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL)
}

export function buildLineAuthUrl(ref?: string): string {
  const baseUrl = getApiBaseUrl()
  const authUrl = new URL('/auth/line', `${baseUrl}/`)

  if (ref) {
    authUrl.searchParams.set('ref', ref)
  }

  return authUrl.toString()
}
