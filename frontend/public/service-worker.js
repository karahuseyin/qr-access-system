/**
 * QR Geçiş Sistemi - Service Worker
 * Amaç: Uygulama kabuğunu tamamen offline tutmak — telefon internete
 * bağlı değilken bile QR/TOTP ekranı çalışır (TOTP telefonda üretilir).
 *
 * Strateji:
 *   - Navigasyonlar : Network-First → offline'da önbellekteki index.html
 *   - Statik varlık : Stale-While-Revalidate (cache-first + arka plan tazeleme)
 */

const CACHE_NAME = 'qr-access-v2';

// Uygulamanın offline çalışması için zorunlu dosyalar.
// NOT: index.html kendi kendine yeterlidir (inline JS + Web Crypto/otpauth).
const PRECACHE = [
    '/',
    '/index.html',
    '/manifest.json',
    '/lib/otpauth.umd.min.js',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
];

// ── INSTALL ────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // addAll atomiktir: tek dosya sıkıntılı olsa hepsi düşer.
        // Bu yüzden dosyaları tek tek, hata toleransıyla ekliyoruz.
        await Promise.allSettled(
            PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })))
        );
        await self.skipWaiting();
    })());
});

// ── ACTIVATE ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
        );
        await self.clients.claim();
    })());
});

// ── FETCH ──────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Sadece aynı origin'deki GET istekleri. API (backend) başka origin'de
    // olduğu için SW'ye hiç uğramaz — offline'da tarayıcı hatası verir,
    // uygulama zaten offline'da API'ye ihtiyaç duymaz.
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Sayfa gezinmeleri: önce ağ, yoksa önbellek (offline açılış)
    if (request.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const fresh = await fetch(request);
                const cache = await caches.open(CACHE_NAME);
                cache.put('/index.html', fresh.clone());
                return fresh;
            } catch (_) {
                const cached = await caches.match('/index.html');
                return cached || new Response('<h1>Çevrimdışı</h1>', {
                    status: 503,
                    headers: { 'Content-Type': 'text/html; charset=utf-8' },
                });
            }
        })());
        return;
    }

    // Statik varlıklar: stale-while-revalidate
    event.respondWith((async () => {
        const cached = await caches.match(request);
        const refresh = fetch(request)
            .then((response) => {
                if (response && response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                }
                return response;
            })
            .catch(() => null);

        return cached || (await refresh) || new Response('', { status: 504 });
    })());
});
