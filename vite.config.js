import { fileURLToPath, URL } from 'url';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// When the dev server is exposed through an ngrok tunnel, the browser can't reach
// the Strapi backend on localhost:1337 directly. Run with VITE_API_URL="" so the
// stores make same-origin requests, and Vite forwards them to Strapi here.
const strapiProxy = {
    target: 'http://localhost:1337',
    changeOrigin: true,
};

// https://vitejs.dev/config/
export default defineConfig({
    server: {
        port: 3030,
        allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.app', '.ngrok.io'],
        proxy: {
            '/api': strapiProxy,
            '/uploads': strapiProxy,
            '/OAuth': strapiProxy,
        },
    },
    preview: {
        port: 8080,
    },
    plugins: [vue()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    }
});
