import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error Node's runtime types are not otherwise needed by the browser app.
import { readFile, writeFile } from 'node:fs/promises'
// @ts-expect-error Node's runtime types are not otherwise needed by the browser app.
import { resolve } from 'node:path'

declare const process: { cwd: () => string }

const progressFile = resolve(process.cwd(), 'stitchtracker.progress.json')

function localProgressStore() {
  return {
    name: 'stitchtracker-local-progress',
    configureServer(server: { middlewares: { use: (handler: (request: any, response: any, next: () => void) => void) => void } }) {
      server.middlewares.use(async (request, response, next) => {
        const prefix = '/__stitchtracker/progress/'
        if (!request.url?.startsWith(prefix)) return next()
        const key = decodeURIComponent(request.url.slice(prefix.length).split('?')[0])
        try {
          let records: Record<string, unknown> = {}
          try {
            records = JSON.parse(await readFile(progressFile, 'utf8')) as Record<string, unknown>
          } catch (reason) {
            if ((reason as { code?: string }).code !== 'ENOENT') throw reason
          }

          if (request.method === 'GET') {
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify(records[key] ?? null))
            return
          }

          if (request.method === 'PUT') {
            let body = ''
            for await (const chunk of request) body += String(chunk)
            records[key] = JSON.parse(body)
            await writeFile(progressFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
            response.statusCode = 204
            response.end()
            return
          }

          response.statusCode = 405
          response.end()
        } catch (reason) {
          response.statusCode = 500
          response.end(reason instanceof Error ? reason.message : 'Progress storage failed.')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localProgressStore()],
  base: '/stitchtracker/',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/stitchtracker.progress.json'],
    },
  },
})
