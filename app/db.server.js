import { PrismaClient } from "@prisma/client";
import webpush from "web-push";
import { getOrGenerateVapidKeys } from "./vapid.server.js";

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

function getDelayMs(delayStr) {
  const num = parseInt(delayStr, 10);
  if (isNaN(num)) return 3 * 24 * 60 * 60 * 1000;
  if (delayStr.includes("day")) {
    return num * 24 * 60 * 60 * 1000;
  }
  if (delayStr.includes("hour")) {
    return num * 60 * 60 * 1000;
  }
  if (delayStr.includes("min")) {
    return num * 60 * 1000;
  }
  return num * 24 * 60 * 60 * 1000;
}

let isJobRunning = false;
async function runReminderJob() {
  if (isJobRunning) {
    console.log("[Reminder Scheduler] Job is already running, skipping concurrent execution.");
    return;
  }
  isJobRunning = true;
  try {
    const allSettings = await prisma.settings.findMany({
      where: {
        pushReminderEnabled: true,
      },
    });

    for (const settings of allSettings) {
      const { shop, pushReminderDelay, pushReminderMax, pushTitle, pushBody } = settings;
      const delayMs = getDelayMs(pushReminderDelay);
      const thresholdDate = new Date(Date.now() - delayMs);

      const eligibleSubs = await prisma.subscription.findMany({
        where: {
          shop,
          status: "SENT",
          reminderCount: { lt: pushReminderMax },
          updatedAt: { lt: thresholdDate },
          channel: { contains: "push" },
          pushSubscriptionJson: { not: null },
        },
      });

      if (eligibleSubs.length === 0) continue;

      const vapidKeys = await getOrGenerateVapidKeys();
      webpush.setVapidDetails(
        "mailto:support@restockly.com",
        vapidKeys.publicKey,
        vapidKeys.privateKey
      );

      const sentEndpoints = new Set();
      for (const sub of eligibleSubs) {
        try {
          const pushSubscription = JSON.parse(sub.pushSubscriptionJson);
          if (pushSubscription && pushSubscription.endpoint) {
            if (sentEndpoints.has(pushSubscription.endpoint)) {
              // Silently mark duplicate db records as processed in this run to clean up
              await prisma.subscription.updateMany({
                where: {
                  id: sub.id,
                  status: "SENT",
                  reminderCount: sub.reminderCount,
                },
                data: {
                  reminderCount: { increment: 1 },
                  updatedAt: new Date(),
                },
              });
              continue;
            }
            sentEndpoints.add(pushSubscription.endpoint);
          }

          // Claim this subscription using Compare-And-Swap (CAS) to prevent duplicate runs
          const claim = await prisma.subscription.updateMany({
            where: {
              id: sub.id,
              status: "SENT",
              reminderCount: sub.reminderCount,
            },
            data: {
              reminderCount: { increment: 1 },
              updatedAt: new Date(),
            },
          });

          if (claim.count === 0) {
            console.log(`[Reminder Scheduler] Sub ID ${sub.id} already claimed by another process. Skipping.`);
            continue;
          }

          const productTitle = sub.productTitle || "Product";
          const variantTitle = sub.variantTitle || "";

          // Resolve product handle with database cache and dynamic API fallback
          let productHandle = sub.productHandle;
          if (!productHandle) {
            try {
              const session = await prisma.session.findFirst({
                where: { shop: sub.shop, isOnline: false }
              });
              if (session && session.accessToken) {
                const response = await fetch(
                  `https://${sub.shop}/admin/api/2026-07/graphql.json`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "X-Shopify-Access-Token": session.accessToken,
                    },
                    body: JSON.stringify({
                      query: `
                        query {
                          product(id: "gid://shopify/Product/${sub.productId}") {
                            handle
                          }
                        }
                      `
                    })
                  }
                );
                const result = await response.json();
                productHandle = result.data?.product?.handle;
                
                if (productHandle) {
                  await prisma.subscription.update({
                    where: { id: sub.id },
                    data: { productHandle }
                  });
                  console.log(`[Reminder Scheduler] Successfully backfilled product handle for subscription ${sub.id}: ${productHandle}`);
                }
              }
            } catch (err) {
              console.error(`[Reminder Scheduler] Fallback handle fetch failed for sub ${sub.id}:`, err);
            }
          }

          const formattedTitle = (pushTitle || "{product_name} is back in stock!")
            .replace(/{product_name}/g, productTitle)
            .replace(/{variant_name}/g, variantTitle);

          const formattedBody = (pushBody || "Grab it before it sells out again — tap to shop now.")
            .replace(/{product_name}/g, productTitle)
            .replace(/{variant_name}/g, variantTitle);

          const payloadData = JSON.stringify({
            title: `Reminder: ${formattedTitle}`,
            body: formattedBody,
            url: `https://${shop}/products/${productHandle || sub.productId}?variant=${sub.variantId}&restockly_sub_id=${sub.id}`,
          });

          await webpush.sendNotification(pushSubscription, payloadData);
          console.log(`[Reminder Scheduler] Sent reminder push to subscriber ID: ${sub.id}`);
        } catch (err) {
          console.error(`[Reminder Scheduler] Failed to send reminder to sub ID ${sub.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[Reminder Scheduler] Error running reminder job:", err);
  } finally {
    isJobRunning = false;
  }
}

// Background scheduler
if (process.env.NODE_ENV !== "test") {
  // Clear any existing timers to prevent duplicates on Hot Module Replacement (HMR)
  if (global.reminderTimeoutId) {
    clearTimeout(global.reminderTimeoutId);
  }
  if (global.reminderIntervalId) {
    clearInterval(global.reminderIntervalId);
  }

  global.reminderTimeoutId = setTimeout(() => {
    runReminderJob().catch(console.error);
  }, 15000);

  const intervalMs = process.env.NODE_ENV === "production" ? 1000 * 60 * 60 : 1000 * 60; // 1 min in dev, 1 hour in prod
  global.reminderIntervalId = setInterval(() => {
    runReminderJob().catch(console.error);
  }, intervalMs);
}

export default prisma;
