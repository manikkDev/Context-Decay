import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve4, resolve6 } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_UPSTREAM_CHARS = 2_000_000
const MAX_CLEANED_CHARS = 120_000
const UPSTREAM_TIMEOUT_MS = 12_000

function setJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-max-age', '86400')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (chunk: unknown) => {
      buf += String(chunk)
      if (buf.length > 1_000_000) {
        reject(new Error('Request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(buf))
    req.on('error', reject)
  })
}

function isPrivateOrReservedIpV4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = parts

  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

function isPrivateOrReservedIpV6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1') return true
  if (lower.startsWith('fe80:')) return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice('::ffff:'.length)
    return isPrivateOrReservedIpV4(v4)
  }
  if (lower === '::') return true
  return false
}

function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isPrivateOrReservedIpV4(ip)
  if (version === 6) return isPrivateOrReservedIpV6(ip)
  return true
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase()
  if (!h) return true

  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h === 'metadata.google.internal' ||
    h === '169.254.169.254'
  ) {
    return true
  }

  return false
}

async function hostnameResolvesToPrivate(hostname: string): Promise<boolean> {
  const ips = new Set<string>()
  try {
    for (const ip of await resolve4(hostname)) ips.add(ip)
  } catch {
    // ignore
  }
  try {
    for (const ip of await resolve6(hostname)) ips.add(ip)
  } catch {
    // ignore
  }
  if (ips.size === 0) return false
  for (const ip of ips) {
    if (isPrivateOrReservedIp(ip)) return true
  }
  return false
}

function cleanUpstreamText(raw: string, contentType: string): string {
  const looksHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml') || raw.includes('<html')
  const cleaned = looksHtml
    ? raw
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
    : raw.replace(/\s+/g, ' ').trim()
  return cleaned.length > MAX_CLEANED_CHARS ? `${cleaned.slice(0, MAX_CLEANED_CHARS)}…` : cleaned
}

async function fetchText(url: string): Promise<{ resolvedUrl: string; cleaned: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  const upstream = await fetch(url, {
    method: 'GET',
    headers: {
      'user-agent': 'context-decay/1.0',
      accept: 'text/html, text/plain;q=0.9, */*;q=0.1',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout))

  return await parseFetchResponse(upstream, url)
}

async function parseFetchResponse(
  upstream: Response,
  originalUrl: string,
): Promise<{ resolvedUrl: string; cleaned: string }> {
  const contentType = upstream.headers.get('content-type') ?? ''

  if (!upstream.ok) {
    const parsed = new URL(originalUrl)
    const isStackOverflow = parsed.hostname === 'stackoverflow.com'
    const matchQuestionId = /^\/questions\/(?<id>\d{3,})\b/i.exec(parsed.pathname)
    const questionId = matchQuestionId?.groups?.id ?? null
    const shouldTryStackPrinter = isStackOverflow && !!questionId && (upstream.status === 403 || upstream.status === 429)

    if (!shouldTryStackPrinter) {
      throw new Error(`Upstream HTTP ${upstream.status}`)
    }

    const printer = new AbortController()
    const printerTimeout = setTimeout(() => printer.abort(), UPSTREAM_TIMEOUT_MS)
    const printerUrl = `https://stackoverflow.stackprinter.appspot.com/export?question=${encodeURIComponent(
      questionId,
    )}&service=stackoverflow&language=en&width=640`
    const printerRes = await fetch(printerUrl, {
      method: 'GET',
      headers: {
        'user-agent': 'context-decay/1.0',
        accept: 'text/html, text/plain;q=0.9, */*;q=0.1',
        'accept-language': 'en-US,en;q=0.9',
      },
      signal: printer.signal,
    }).finally(() => clearTimeout(printerTimeout))

    if (!printerRes.ok) throw new Error(`Upstream HTTP ${upstream.status}`)

    const printerType = printerRes.headers.get('content-type') ?? ''
    const raw = (await printerRes.text()).slice(0, MAX_UPSTREAM_CHARS)
    const cleaned = cleanUpstreamText(raw, printerType)
    return { resolvedUrl: `https://stackoverflow.com/questions/${questionId}`, cleaned }
  }

  const raw = (await upstream.text()).slice(0, MAX_UPSTREAM_CHARS)
  const cleaned = cleanUpstreamText(raw, contentType)
  if (!cleaned) throw new Error('Upstream returned empty text')
  return { resolvedUrl: upstream.url || originalUrl, cleaned }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    setJson(res, 204, {})
    return
  }

  if (req.method !== 'POST') {
    setJson(res, 405, { error: 'Method not allowed' })
    return
  }

  try {
    const body = await readBody(req)
    const payload = JSON.parse(body) as { url?: unknown }
    const urlRaw = typeof payload.url === 'string' ? payload.url : ''
    const trimmed = urlRaw.trim()
    if (!trimmed) {
      setJson(res, 400, { error: 'Missing url' })
      return
    }

    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      setJson(res, 400, { error: 'Invalid url' })
      return
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setJson(res, 400, { error: 'Unsupported protocol' })
      return
    }

    if (parsed.username || parsed.password) {
      setJson(res, 400, { error: 'Credentials in URL are not allowed' })
      return
    }

    if (isBlockedHostname(parsed.hostname)) {
      setJson(res, 403, { error: 'Blocked hostname' })
      return
    }

    if (isIP(parsed.hostname) !== 0 && isPrivateOrReservedIp(parsed.hostname)) {
      setJson(res, 403, { error: 'Blocked IP address' })
      return
    }

    if (await hostnameResolvesToPrivate(parsed.hostname)) {
      setJson(res, 403, { error: 'Blocked address range' })
      return
    }

    const { resolvedUrl, cleaned } = await fetchText(parsed.toString())
    setJson(res, 200, { ok: true, url: resolvedUrl, text: cleaned })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const statusCode =
      /blocked/i.test(message) ? 403 : /upstream http/i.test(message) ? 502 : /too large/i.test(message) ? 413 : 500
    setJson(res, statusCode, { error: message })
  }
}

