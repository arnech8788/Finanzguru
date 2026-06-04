import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages serves from the domain root (CNAME), so base '/' is correct.
  base: '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // Registrierung erfolgt manuell in main.js via virtual:pwa-register
      workbox: {
        // .mjs/.wasm aufnehmen, damit der (lazy geladene) pdf.js-Worker offline verfügbar ist.
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,json,ico,wasm}'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      },
      manifest: false // bestehende public/manifest.json wird weiterverwendet
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
