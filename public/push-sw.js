/* Wird von der (Workbox-)Service-Worker-Datei via importScripts geladen.
   Behandelt eingehende Web-Push-Nachrichten und Klicks darauf. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Finanzguru';
  const options = {
    body: data.body || '',
    tag: data.tag,
    renotify: !!data.tag,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: (data.data && data.data.url) || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) { try { await client.navigate(url); } catch (e) {} return client.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
