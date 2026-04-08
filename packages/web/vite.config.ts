import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
        port: 5000,
        allowedHosts: true,
        watch: {
            ignored: ['**/.local/**', '**/.cache/**', '**/.git/**', '**/server/**'],
        },
        proxy: {
            // All API calls forwarded to Express backend on port 3000
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
            // tRPC contract layer (Roles PoC)
            '/trpc': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
            // Uploaded files (CVs, photos) also served by the API in dev
            '/uploads': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
})
