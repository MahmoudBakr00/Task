// Service Worker بسيط - غرضه الوحيد إنه يخلي الإشعارات شغالة على الموبايل
// (متصفحات الموبايل زي Chrome Android بترفض new Notification() مباشرة من الصفحة
// وبتشترط استخدام ServiceWorkerRegistration.showNotification() بدالها)
const CACHE_NAME = 'task-tracker-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// لما المستخدم يدوس على الإشعار، نفتحله التاب بتاع الداشبورد (أو نركّز عليه لو مفتوح خلاص)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./dashboard.html');
    })
  );
});
