import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
