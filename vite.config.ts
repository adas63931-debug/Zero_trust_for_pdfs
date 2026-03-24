import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

function buildCsp(isDev: boolean): string {
  return [
    "default-src 'self'",
    isDev
      ? "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"
      : "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss: https://huggingface.co https://*.huggingface.co https://cdn-lfs.huggingface.co https://hf.co https://*.hf.co https://api.groq.com",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
}

function buildSharedHeaders(isDev: boolean) {
  return {
    'Content-Security-Policy': buildCsp(isDev),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff'
  };
}

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    assetsInclude: ['**/*.wasm', '**/*.onnx'],
    optimizeDeps: {
      exclude: ['@huggingface/transformers']
    },
    server: {
      headers: buildSharedHeaders(isDev)
    },
    preview: {
      headers: buildSharedHeaders(false)
    },
    worker: {
      format: 'es'
    },
    build: {
      target: 'esnext',
      sourcemap: true
    }
  };
});
