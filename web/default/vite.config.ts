import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
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
      // Match the previous Rsbuild behavior: drop console.log only in production.
      pure: isProd ? ['console.log'] : [],
    },
    build: {
      outDir: 'dist',
      minify: isProd,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (/[\\/](react|react-dom)[\\/]/.test(id)) return 'vendor-react'
            if (/[\\/](@base-ui|@radix-ui)[\\/]/.test(id))
              return 'vendor-ui-primitives'
            if (/[\\/]@tanstack[\\/]/.test(id)) return 'vendor-tanstack'
          },
        },
      },
    },
  }
})
