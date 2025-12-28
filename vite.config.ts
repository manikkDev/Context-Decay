import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import envCompatible from 'vite-plugin-env-compatible'

function devApiPlugin(): Plugin {
  const fetchUrlMiddleware = () => {
    return async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      try {
        const body = await new Promise<string>((resolve, reject) => {
          let buf = ''
          req.on('data', (chunk: unknown) => {
            buf += String(chunk)
          })
          req.on('end', () => resolve(buf))
          req.on('error', reject)
        })

        const payload = JSON.parse(body) as { url?: unknown }
        const urlRaw = typeof payload.url === 'string' ? payload.url : ''
        const trimmed = urlRaw.trim()
        if (!trimmed) {
          res.statusCode = 400
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Missing url' }))
          return
        }

        let parsed: URL
        try {
          parsed = new URL(trimmed)
        } catch {
          res.statusCode = 400
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Invalid url' }))
          return
        }

        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          res.statusCode = 400
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Unsupported protocol' }))
          return
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 12000)
        const upstream = await fetch(parsed.toString(), {
          method: 'GET',
          headers: {
            'user-agent': 'knowledge-decay-detector/1.0',
            accept: 'text/html, text/plain;q=0.9, */*;q=0.1',
            'accept-language': 'en-US,en;q=0.9',
          },
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout))

        if (!upstream.ok) {
          const isStackOverflow = parsed.hostname === 'stackoverflow.com'
          const matchQuestionId = /^\/questions\/(?<id>\d{3,})\b/i.exec(parsed.pathname)
          const questionId = matchQuestionId?.groups?.id ?? null
          const shouldTryStackPrinter = isStackOverflow && !!questionId && (upstream.status === 403 || upstream.status === 429)

          if (!shouldTryStackPrinter) {
            res.statusCode = 502
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: `Upstream HTTP ${upstream.status}` }))
            return
          }

          const printer = new AbortController()
          const printerTimeout = setTimeout(() => printer.abort(), 12000)
          const printerUrl = `https://stackoverflow.stackprinter.appspot.com/export?question=${encodeURIComponent(
            questionId,
          )}&service=stackoverflow&language=en&width=640`
          const printerRes = await fetch(printerUrl, {
            method: 'GET',
            headers: {
              'user-agent': 'knowledge-decay-detector/1.0',
              accept: 'text/html, text/plain;q=0.9, */*;q=0.1',
              'accept-language': 'en-US,en;q=0.9',
            },
            signal: printer.signal,
          }).finally(() => clearTimeout(printerTimeout))

          if (!printerRes.ok) {
            res.statusCode = 502
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: `Upstream HTTP ${upstream.status}` }))
            return
          }

          const contentType = printerRes.headers.get('content-type') ?? ''
          const raw = await printerRes.text()
          const cleaned =
            contentType.includes('text/html') || raw.includes('<html')
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

          const clipped = cleaned.length > 120_000 ? `${cleaned.slice(0, 120_000)}…` : cleaned
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: true, url: `https://stackoverflow.com/questions/${questionId}`, text: clipped }))
          return
        }

        const contentType = upstream.headers.get('content-type') ?? ''
        const raw = await upstream.text()
        const cleaned =
          contentType.includes('text/html') || raw.includes('<html')
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

        const clipped = cleaned.length > 120_000 ? `${cleaned.slice(0, 120_000)}…` : cleaned
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: true, url: upstream.url || parsed.toString(), text: clipped }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        res.statusCode = 500
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: message }))
      }
    }
  }

  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/__api/fetch-url', fetchUrlMiddleware())

      server.middlewares.use('/__api/decay', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        try {
          const body = await new Promise<string>((resolve, reject) => {
            let buf = ''
            req.on('data', (chunk) => {
              buf += String(chunk)
            })
            req.on('end', () => resolve(buf))
            req.on('error', reject)
          })

          const payload = JSON.parse(body) as { text?: unknown }
          const text = typeof payload.text === 'string' ? payload.text : ''
          if (!text.trim()) {
            res.statusCode = 400
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'Missing text' }))
            return
          }

          const extractor = await server.ssrLoadModule('/src/lib/assumptionExtractor.ts')
          const engine = await server.ssrLoadModule('/src/lib/decayEngine.ts')
          const seedMod = await server.ssrLoadModule('/src/data/reality-seed.json')
          const anchors = Array.isArray(seedMod.default) ? seedMod.default : []

          const assumptions = await extractor.extractAssumptions(text)
          const evaluation = engine.evaluateDecay(assumptions, anchors)
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ...evaluation, assumptions }))
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: message }))
        }
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__api/fetch-url', fetchUrlMiddleware())
    },
  }
}

export default defineConfig({
  plugins: [
    envCompatible({ prefix: 'VITE', mountedPath: 'process.env', ignoreProcessEnv: false }),
    react(),
    devApiPlugin(),
  ],
})
