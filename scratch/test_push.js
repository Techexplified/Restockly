import { PrismaClient } from '@prisma/client';
import webpush from 'web-push';
import { getOrGenerateVapidKeys } from '../app/vapid.server.js';

const prisma = new PrismaClient();

async function main() {
  // Find a pending subscription that has push token
  const sub = await prisma.subscription.findFirst({
    where: {
      status: "PENDING",
      pushSubscriptionJson: { not: null }
    }
  });

  if (!sub) {
    console.log("No pending subscriptions with push credentials found in the database!");
    return;
  }

  console.log("Found subscription to test:", sub.id, "Product:", sub.productTitle);

  // Load VAPID keys
  const vapidKeys = await getOrGenerateVapidKeys();
  webpush.setVapidDetails(
    "mailto:support@restockly.com",
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );

  const pushSubscription = JSON.parse(sub.pushSubscriptionJson);
  const payloadData = JSON.stringify({
    title: `[Test] ${sub.productTitle || "Product"} is back in stock!`,
    body: `The ${sub.variantTitle || ""} variant is now available. Tap to shop now!`,
    url: `https://${sub.shop}/products/test-variant`,
  });

  console.log("Sending push notification...");
  try {
    const response = await webpush.sendNotification(pushSubscription, payloadData);
    console.log("Push notification sent successfully!");
    console.log("Response status:", response.statusCode);

    // Update status to SENT
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: "SENT" }
    });
    console.log("Subscription status updated to SENT in database!");
  } catch (err) {
    console.error("Error sending notification:", err);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
