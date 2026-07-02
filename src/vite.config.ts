import { defineConfig, loadEnv } from 'vite'
import dotenv from 'dotenv'
import path from 'node:path'

// Slidev's CWD is src/, so we load .env from the project root explicitly
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') })
// Also try loading from cwd in case the server is run from root
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Helper: build a Vercel-like req/res shim for dev-server middleware
  function makeVercelShim(req: any, body: any, res: any) {
    const vercelReq = {
      method: req.method,
      headers: req.headers,
      body,
      query: Object.fromEntries(new URL(req.url, 'http://localhost').searchParams)
    }
    const vercelRes = {
      status(code: number) { res.statusCode = code; return this },
      json(data: any) {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(data))
        return this
      },
      setHeader(name: string, value: any) { res.setHeader(name, value); return this },
      end(data: any) { res.end(data); return this }
    }
    return { vercelReq, vercelRes }
  }

  // Helper: parse POST/DELETE body from raw request
  async function parseBody(req: any): Promise<any> {
    if (req.method !== 'POST' && req.method !== 'DELETE') return {}
    return new Promise((resolve) => {
      let data = ''
      req.on('data', (chunk: any) => data += chunk)
      req.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve({}) }
      })
    })
  }

  return {
    plugins: [
      {
        name: 'api-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {

            // ── /api/emails ─────────────────────────────────────────────
            if (req.url && req.url.startsWith('/api/emails')) {
              const body = await parseBody(req)
              const { vercelReq, vercelRes } = makeVercelShim(req, body, res)
              try {
                const { default: handler } = await import('../api/emails.js')
                await handler(vercelReq, vercelRes)
              } catch (err: any) {
                console.error('Error in /api/emails middleware:', err)
                res.statusCode = 500
                res.end(JSON.stringify({ error: err?.message || String(err) }))
              }
              return
            }

            // ── /api/zoho-auth ───────────────────────────────────────────
            if (req.url && req.url.startsWith('/api/zoho-auth')) {
              const body = await parseBody(req)
              const { vercelReq, vercelRes } = makeVercelShim(req, body, res)
              try {
                const { default: handler } = await import('../api/zoho-auth.js')
                await handler(vercelReq, vercelRes)
              } catch (err: any) {
                console.error('Error in /api/zoho-auth middleware:', err)
                res.statusCode = 500
                res.end(JSON.stringify({ error: err?.message || String(err) }))
              }
              return
            }

            // ── /zoho-callback.html ──────────────────────────────────────
            // Must intercept BEFORE Slidev's SPA router catches it and serves
            // the main app instead of the static callback page
            if (req.url && (req.url === '/zoho-callback.html' || req.url.startsWith('/zoho-callback.html?'))) {
              const callbackPath = path.resolve(process.cwd(), 'public', 'zoho-callback.html')
              const fallbackPath = path.resolve(process.cwd(), '..', 'public', 'zoho-callback.html')
              const fs = await import('node:fs')
              const filePath = fs.existsSync(callbackPath) ? callbackPath
                             : fs.existsSync(fallbackPath) ? fallbackPath
                             : null
              if (filePath) {
                res.setHeader('Content-Type', 'text/html; charset=utf-8')
                res.statusCode = 200
                res.end(fs.readFileSync(filePath, 'utf8'))
              } else {
                res.statusCode = 404
                res.end('zoho-callback.html not found')
              }
              return
            }

            next()
          })
        }
      }
    ],
    server: {
      proxy: {
        '/api/run': {
          target: env.VITE_EXECUTION_API_URL ? new URL(env.VITE_EXECUTION_API_URL).origin : 'http://136.111.214.182:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/run/, '/run'),
          configure: (proxy, options) => {
             if (env.VITE_EXECUTION_API_KEY) {
               proxy.on('proxyReq', (proxyReq, req, res) => {
                 proxyReq.setHeader('x-api-key', env.VITE_EXECUTION_API_KEY)
               })
             }
          }
        }
      }
    },
    ssr: {
      noExternal: [
        'monaco-editor',
        'popmotion',
        'style-value-types',
        'unhead',
        '@unhead/vue',
        '@floating-ui/core',
        '@vueuse/core',
        '@slidev/parser',
        '@slidev/client'
      ]
    }
  }
})

