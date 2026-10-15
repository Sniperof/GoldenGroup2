import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Shared proxy: forward API/tRPC/uploads/media to the Express backend on 3000.
// Reused by both the dev server and `vite preview` (production-bundle preview,
// used for reliable phone viewing over a tunnel where the dev HMR client fails).
const apiProxy = {
    '/api': { target: 'http://localhost:3000', changeOrigin: true },
    '/trpc': { target: 'http://localhost:3000', changeOrigin: true },
    '/uploads': { target: 'http://localhost:3000', changeOrigin: true },
    '/m': { target: 'http://localhost:3000', changeOrigin: true },
}

export default defineConfig({
    resolve: {
        alias: {
            '@golden-crm/shared': path.resolve(__dirname, '../shared/index.ts'),
        },
    },
    plugins: [
        react(),
        tailwindcss(),
    ],
    server: {
        host: '0.0.0.0',
        // Honor a harness/CI-assigned port (PORT env) so the preview can find
        // the server; fall back to 5000 for normal local dev.
        port: Number(process.env.PORT) || 5000,
        strictPort: !!process.env.PORT,
        allowedHosts: true,
        watch: {
            ignored: ['**/.local/**', '**/.cache/**', '**/.git/**', '**/server/**'],
        },
        proxy: apiProxy,
    },
    // Production-bundle preview server (`vite preview`). Static assets load
    // reliably over a public tunnel (no dev HMR websocket), with the same API
    // proxy so the phone preview reaches the backend.
    preview: {
        host: '0.0.0.0',
        port: Number(process.env.PORT) || 5000,
        strictPort: false,
        allowedHosts: true,
        proxy: apiProxy,
    },
})
