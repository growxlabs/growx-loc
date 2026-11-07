import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The API key stays in this Node process: the proxy adds it, the browser never sees it.
  const apiKey = loadEnv(mode, process.cwd(), '').VITE_API_KEY

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet')) return 'map'
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'https://api.location.growxlabs.tech',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          headers: {
            'User-Agent': 'GrowX-Explorer/1.0',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
        },
      },
    },
  }
})
