import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const CACHE_VERSION = 'escapement-cache-v1';

function escapementPwaPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'escapement-pwa-sw',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: string[] = ['./', './index.html'];
      const walk = (dir: string, relBase: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walk(full, rel);
          } else if (entry.name !== 'sw.js' && !entry.name.endsWith('.map')) {
            files.push(`./${rel.replace(/\\/g, '/')}`);
          }
        }
      };
      walk(outDir, '');
      const uniqueFiles = Array.from(new Set(files));

      const swCode = `/* Escapement Offline Service Worker (${CACHE_VERSION}) */
const CACHE_NAME = ${JSON.stringify(CACHE_VERSION)};
const PRECACHE_URLS = ${JSON.stringify(uniqueFiles, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { ignoreSearch: true })
        .then((cached) => cached || fetch(req))
        .catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      });
    })
  );
});
`;
      fs.writeFileSync(path.join(outDir, 'sw.js'), swCode, 'utf8');
    },
  };
}

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    assetsInlineLimit: 4096,
  },
  plugins: [escapementPwaPlugin()],
});
