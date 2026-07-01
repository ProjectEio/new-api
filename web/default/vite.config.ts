import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// lucide-react ships a barrel whose leading directive + `import * as` namespace
// aggregator make Rollup pull all ~1600 icon modules into the build graph (they
// tree-shake from the OUTPUT but are still parsed — ~3300 modules, ~18% of the
// transform work). Bypass the barrel by rewriting `import { X } from
// 'lucide-react'` to deep per-icon imports. Export→file names aren't mechanical
// (e.g. SortDesc → arrow-down-wide-narrow.mjs), so the map is parsed from the
// barrel. Non-icon exports (the LucideIcon/LucideProps types, createLucideIcon,
// icons) are left on the barrel.
function lucideDeepImportsPlugin(): Plugin {
  const iconToFile = new Map<string, string>()
  // Absolute (posix) path to lucide's per-icon dir. Emitted imports use it so
  // they resolve to this exact lucide-react regardless of the importing file's
  // location — third-party deps (e.g. @lobehub/icons) can't resolve a bare
  // `lucide-react/...` specifier from their own pnpm context.
  let iconsDir = ''
  try {
    const require = createRequire(import.meta.url)
    const esmDir = path.join(
      path.dirname(require.resolve('lucide-react/package.json')),
      'dist/esm'
    )
    iconsDir = path.join(esmDir, 'icons').replace(/\\/g, '/')
    const src = fs.readFileSync(
      path.join(esmDir, 'lucide-react.mjs'),
      'utf8'
    )
    const lineRe = /export\s*\{([^}]*)\}\s*from\s*'\.\/icons\/([^']+)'/g
    for (const [, names, file] of src.matchAll(lineRe)) {
      for (const [, name] of names.matchAll(/default as (\w+)/g)) {
        iconToFile.set(name, file)
      }
    }
  } catch {
    // If the barrel can't be read, the plugin becomes a no-op and the normal
    // (un-optimized) barrel import path is used.
  }

  const importRe =
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s*['"]lucide-react['"]\s*;?/g
  // Non-icon exports of lucide-react that are type-only. Emitting them via
  // `import type` guarantees they're erased and never pull in the barrel.
  const LUCIDE_TYPE_EXPORTS = new Set(['LucideIcon', 'LucideProps', 'IconNode'])

  return {
    name: 'lucide-deep-imports',
    enforce: 'pre',
    apply: 'build',
    buildStart() {
      ;(globalThis as any).__lucideStats = { rewritten: 0, unmatched: [] }
    },
    transform(code, id) {
      if (iconToFile.size === 0) return
      if (!/\.[jt]sx?$/.test(id) || !code.includes('lucide-react')) return
      const stats = (globalThis as any).__lucideStats

      let changed = false
      const out = code.replace(importRe, (full, typeKw, body) => {
        const deep: string[] = []
        const typeResidual: string[] = []
        const valueResidual: string[] = []
        for (const rawSpec of body.split(',')) {
          const spec = rawSpec.trim()
          if (!spec) continue
          const isTypeOnly = Boolean(typeKw) || /^type\s+/.test(spec)
          const cleaned = spec.replace(/^type\s+/, '')
          const [name, alias = name] = cleaned
            .split(/\s+as\s+/)
            .map((s) => s.trim())
          const file = iconToFile.get(name)
          if (file && !isTypeOnly) {
            deep.push(`import ${alias} from '${iconsDir}/${file}';`)
          } else if (isTypeOnly || LUCIDE_TYPE_EXPORTS.has(name)) {
            typeResidual.push(cleaned)
          } else {
            valueResidual.push(cleaned)
          }
        }
        if (deep.length === 0) return full
        changed = true
        const parts = [...deep]
        if (typeResidual.length > 0) {
          parts.push(
            `import type { ${typeResidual.join(', ')} } from 'lucide-react';`
          )
        }
        if (valueResidual.length > 0) {
          parts.push(
            `import { ${valueResidual.join(', ')} } from 'lucide-react';`
          )
        }
        return parts.join('\n')
      })

      if (changed) {
        stats.rewritten++
        return { code: out, map: null }
      }
      // Referenced lucide-react but nothing was rewritten — a form the regex
      // missed or a pure type import. Record for diagnosis.
      if (/from ['"]lucide-react['"]/.test(code)) {
        stats.unmatched.push(id.split(/node_modules[\\/]/).pop())
      }
    },
    buildEnd() {
      const stats = (globalThis as any).__lucideStats
      console.log(
        `\n[lucide] rewritten=${stats.rewritten} unmatched=${stats.unmatched.length}`
      )
      for (const u of stats.unmatched.slice(0, 30)) console.log('  unmatched:', u)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const serverUrl =
    process.env.VITE_REACT_APP_SERVER_URL ||
    env.VITE_REACT_APP_SERVER_URL ||
    'http://localhost:3000'

  const isProd = mode === 'production'
  const proxy = Object.fromEntries(
    ['/api', '/mj', '/pg'].map((key) => [
      key,
      { target: serverUrl, changeOrigin: true },
    ]),
  )

  return {
    plugins: [
      // Router plugin must run before the React plugin.
      tanstackRouter({ target: 'react', autoCodeSplitting: isProd }),
      react(),
      lucideDeepImportsPlugin(),
      {
        name: 'module-count-probe',
        buildEnd() {
          const counts: Record<string, number> = {}
          for (const id of this.getModuleIds()) {
            if (!id.includes('node_modules')) {
              counts['(app src)'] = (counts['(app src)'] || 0) + 1
              continue
            }
            const last = id.split(/[\\/]node_modules[\\/]/).pop() || ''
            const parts = last.split(/[\\/]/)
            const pkg = parts[0].startsWith('@')
              ? `${parts[0]}/${parts[1]}`
              : parts[0]
            counts[pkg] = (counts[pkg] || 0) + 1
          }
          const top = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
          console.log('\n=== MODULE COUNT BY PACKAGE (top 12) ===')
          for (const [pkg, n] of top)
            console.log(String(n).padStart(6), pkg)
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      strictPort: false,
      proxy,
    },
    esbuild: {
      // esbuild handles the JS/TS transform and minification (fast, low-memory).
      // Drop console.log and license comments only in production.
      pure: isProd ? ['console.log'] : [],
      legalComments: isProd ? 'none' : 'inline',
    },
    build: {
      outDir: 'dist',
      // Use esbuild for minification instead of terser — much faster and
      // uses far less memory on this large module graph.
      minify: isProd ? 'esbuild' : false,
      // Skip gzip-size reporting to speed up production builds.
      reportCompressedSize: false,
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            // Keep ONLY react core here (react, react-dom, and react-dom's
            // scheduler dep) so vendor-react is a dependency-free leaf and
            // can't form a cross-chunk cycle — a cycle leaves React undefined
            // when a consumer chunk's top-level createContext() runs first.
            // Anchor to node_modules/ so we don't match scoped packages whose
            // name is literally "react" (e.g. @base-ui/react).
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
              return 'vendor-react'
            if (/[\\/](@base-ui|@radix-ui)[\\/]/.test(id))
              return 'vendor-ui-primitives'
            if (/[\\/]@tanstack[\\/]/.test(id)) return 'vendor-tanstack'
            // Heavy charting stack — isolate so it caches independently and
            // only loads with the (route-split) dashboard.
            if (/[\\/]@visactor[\\/]/.test(id)) return 'vendor-charts'
            // Curated provider icons (shared across channels/pricing/models).
            if (/[\\/]@lobehub[\\/]/.test(id)) return 'vendor-icons'
            // Markdown/math rendering used by chat & pricing.
            if (/[\\/](streamdown|marked|katex)[\\/]/.test(id))
              return 'vendor-markdown'
          },
        },
      },
    },
  }
})
