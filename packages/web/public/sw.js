// Star-WebCNC Service Worker — Web Push 알림 수신

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Star-WebCNC 알람', body: event.data.text() };
  }

  const title = data.title || 'Star-WebCNC 알람';
  const options = {
    body: data.body || '',
    icon: '/star.png',
    badge: '/star.png',
    tag: `alarm-${data.machineId || 'unknown'}`,
    renotify: true,
    requireInteraction: true,
    data: { url: '/', machineId: data.machineId },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
