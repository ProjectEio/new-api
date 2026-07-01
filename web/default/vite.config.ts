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
  let esmDirPosix = ''
  try {
    const require = createRequire(import.meta.url)
    const esmDir = path.join(
      path.dirname(require.resolve('lucide-react/package.json')),
      'dist/esm'
    )
    esmDirPosix = esmDir.replaceAll('\\', '/')
    iconsDir = path.join(esmDir, 'icons').replaceAll('\\', '/')
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
  // Non-icon *runtime* exports that live in their own default-exporting module
  // (e.g. @lobehub/ui's custom icons `import { createLucideIcon }`). Rewriting
  // these to their deep file keeps the barrel out of the graph entirely.
  const NONICON_DEFAULT = new Set(['createLucideIcon', 'Icon'])

  return {
    name: 'lucide-deep-imports',
    enforce: 'pre',
    apply: 'build',
    transform(code, id) {
      if (iconToFile.size === 0) return
      // Strip query suffixes (e.g. TanStack Router's `?tsr-split=component`)
      // and cover .mjs/.cjs so pre-built deps (e.g. @lobehub/ui) are rewritten.
      const clean = id.split('?')[0]
      if (
        !/\.(mjs|cjs|jsx?|tsx?)$/.test(clean) ||
        !code.includes('lucide-react')
      ) {
        return
      }

      let changed = false
      const out = code.replace(importRe, (full, typeKw, body: string) => {
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
          if (!isTypeOnly && NONICON_DEFAULT.has(name)) {
            deep.push(`import ${alias} from '${esmDirPosix}/${name}.mjs';`)
          } else if (file && !isTypeOnly) {
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

      if (changed) return { code: out, map: null }
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
