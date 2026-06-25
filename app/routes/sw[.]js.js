export const loader = async () => {
  const swCode = `
self.addEventListener('push', function(event) {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.title || "Restock Alert";
    const options = {
      body: data.body || "A product you waitlisted is back in stock!",
      icon: data.icon || "https://cdn.shopify.com/s/files/1/0000/0000/files/logo.png?v=1",
      badge: data.badge || "",
      data: {
        url: data.url || "/"
      }
    };
    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } catch (err) {
    console.error('Error in push event handler:', err);
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.openWindow(url)
  );
});
  `;

  return new Response(swCode, {
    headers: {
      "Content-Type": "application/javascript",
      "Service-Worker-Allowed": "/apps/restockly-api/",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
};
