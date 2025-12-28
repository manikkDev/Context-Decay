import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'

function findFirebaseCli() {
  const cwd = process.cwd()
  const localBin =
    process.platform === 'win32'
      ? path.join(cwd, 'node_modules', '.bin', 'firebase.cmd')
      : path.join(cwd, 'node_modules', '.bin', 'firebase')
  if (fs.existsSync(localBin)) return { command: localBin, args: [] }
  return { command: 'firebase', args: [] }
}

function startFirestoreEmulator() {
  const cli = findFirebaseCli()
  let fellBack = false
  const child = spawn(cli.command, [...cli.args, 'emulators:start', '--only', 'firestore'], {
    stdio: 'inherit',
    env: process.env,
  })
  child.on('error', () => {
    if (fellBack) return
    fellBack = true
    startLocalJsonStore()
  })
  child.on('exit', (code) => {
    if (fellBack) return
    if (code && code !== 0) {
      fellBack = true
      startLocalJsonStore()
    }
  })
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function withCors(req, res) {
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'origin')
  } else {
    res.setHeader('access-control-allow-origin', '*')
  }
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('Payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function startLocalJsonStore() {
  const portRaw = process.env.LOCAL_SESSION_STORE_PORT
  const port = portRaw && Number.isFinite(Number(portRaw)) ? Number(portRaw) : 8787
  const baseDir = path.join(process.cwd(), 'data', 'localSessions')
  fs.mkdirSync(baseDir, { recursive: true })

  const server = http.createServer(async (req, res) => {
    withCors(req, res)
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, mode: 'json', dir: baseDir })
      return
    }

    if (req.method === 'GET' && url.pathname === '/analysisSessions') {
      const files = fs.readdirSync(baseDir).filter((f) => f.endsWith('.json'))
      sendJson(res, 200, { ok: true, ids: files.map((f) => f.replace(/\.json$/, '')) })
      return
    }

    if (req.method === 'GET' && url.pathname.startsWith('/analysisSessions/')) {
      const id = url.pathname.slice('/analysisSessions/'.length)
      if (!id) {
        sendJson(res, 400, { ok: false, error: 'Missing id' })
        return
      }
      const filePath = path.join(baseDir, `${id}.json`)
      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { ok: false, error: 'Not found' })
        return
      }
      const raw = fs.readFileSync(filePath, 'utf8')
      res.statusCode = 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(raw)
      return
    }

    if (req.method === 'POST' && url.pathname === '/analysisSessions') {
      try {
        const raw = await readBody(req, 6_000_000)
        const data = raw.trim().length ? JSON.parse(raw) : null
        const id = `${Date.now()}_${Math.floor(Math.random() * 1_000_000_000)}`
        const filePath = path.join(baseDir, `${id}.json`)
        fs.writeFileSync(
          filePath,
          JSON.stringify({ createdAt: new Date().toISOString(), data }, null, 2),
          'utf8',
        )
        sendJson(res, 200, { ok: true, id, filePath })
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    sendJson(res, 404, { ok: false, error: 'Not found' })
  })

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Local JSON session store ready: http://127.0.0.1:${port}\n`)
    process.stdout.write(`Writing to: ${baseDir}\n`)
  })
}

startFirestoreEmulator()
