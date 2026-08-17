import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Обычное Vite-SPA, деплой на Vercel.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Ручной manualChunks здесь был ошибкой: React уезжал в отдельный чанк и
    // инициализировался позже того, который его использует, — на проде это давало
    // белый экран с «Cannot read properties of undefined (reading 'createContext')».
    // Разделение по маршрутам уже обеспечивают React.lazy в src/App.jsx,
    // остальное Rollup раскладывает сам и с корректным порядком инициализации.
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
});
