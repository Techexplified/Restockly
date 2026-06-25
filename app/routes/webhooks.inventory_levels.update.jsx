import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import webpush from "web-push";
import { getOrGenerateVapidKeys } from "../vapid.server";
import fs from "fs";

export const action = async ({ request }) => {
  try {
    const rawBody = await request.clone().text();
    fs.appendFileSync(
      "webhook_log.txt",
      `[${new Date().toISOString()}] Incoming INVENTORY_LEVELS_UPDATE Webhook:\n` +
      `Method: ${request.method}\n` +
      `Headers: ${JSON.stringify(Object.fromEntries(request.headers.entries()), null, 2)}\n` +
      `Body: ${rawBody}\n\n`
    );
  } catch (err) {
    fs.appendFileSync("webhook_log.txt", `[${new Date().toISOString()}] Error reading request: ${err.message}\n\n`);
  }

  const { payload, topic, shop, admin } = await authenticate.webhook(request);

  if (topic !== "INVENTORY_LEVELS_UPDATE") {
    return new Response("Invalid topic", { status: 400 });
  }

  const { inventory_item_id: inventoryItemId, available } = payload;

  if (available > 0) {
    try {
      // 1. Query the variant ID and product handle for this inventory item
      const response = await admin.graphql(`
        query {
          inventoryItem(id: "gid://shopify/InventoryItem/${inventoryItemId}") {
            variant {
              id
              product {
                handle
              }
            }
          }
        }
      `);
      const data = await response.json();
      const variantGid = data.data?.inventoryItem?.variant?.id;
      const productHandle = data.data?.inventoryItem?.variant?.product?.handle;
      if (!variantGid) {
        console.error(`No variant found for inventory item ${inventoryItemId}`);
        return new Response("Variant not found", { status: 404 });
      }

      // Convert GraphQL ID "gid://shopify/ProductVariant/12345" to "12345"
      const variantId = variantGid.split("/").pop();

      // 2. Find all pending subscriptions for this variant
      const pendingSubscriptions = await prisma.subscription.findMany({
        where: {
          shop,
          variantId,
          status: "PENDING",
        },
      });

      if (pendingSubscriptions.length === 0) {
        return new Response("No pending subscriptions", { status: 200 });
      }

      // 3. Load VAPID keys and shop settings
      const [vapidKeys, settings] = await Promise.all([
        getOrGenerateVapidKeys(),
        prisma.settings.findUnique({ where: { shop } }),
      ]);
      webpush.setVapidDetails(
        "mailto:support@restockly.com",
        vapidKeys.publicKey,
        vapidKeys.privateKey
      );

      const titleTemplate = settings?.pushTitle || "{product_name} is back in stock!";
      const bodyTemplate = settings?.pushBody || "Grab it before it sells out again — tap to shop now.";

      // 4. Claim the pending subscriptions by updating them to SENT first to prevent concurrent sends
      const claim = await prisma.subscription.updateMany({
        where: {
          shop,
          variantId,
          status: "PENDING",
        },
        data: {
          status: "SENT",
        },
      });

      if (claim.count === 0) {
        console.log(`[Inventory Webhook] Pending subscriptions for variant ${variantId} already processed. Skipping.`);
        return new Response("Already processed", { status: 200 });
      }

      // 5. Send push notifications
      const pushSubscriptions = pendingSubscriptions.filter(
        (sub) => sub.channel.includes("push") && sub.pushSubscriptionJson
      );

      const sentEndpoints = new Set();
      for (const sub of pushSubscriptions) {
        try {
          const pushSubscription = JSON.parse(sub.pushSubscriptionJson);
          if (pushSubscription && pushSubscription.endpoint) {
            if (sentEndpoints.has(pushSubscription.endpoint)) {
              continue;
            }
            sentEndpoints.add(pushSubscription.endpoint);
          }
          const productTitle = sub.productTitle || "Product";
          const variantTitle = sub.variantTitle || "";

          const formattedTitle = titleTemplate
            .replace(/{product_name}/g, productTitle)
            .replace(/{variant_name}/g, variantTitle);

          const formattedBody = bodyTemplate
            .replace(/{product_name}/g, productTitle)
            .replace(/{variant_name}/g, variantTitle);

          const payloadData = JSON.stringify({
            title: formattedTitle,
            body: formattedBody,
            url: `https://${shop}/products/${productHandle || sub.productId}?variant=${variantId}&restockly_sub_id=${sub.id}`,
          });

          await webpush.sendNotification(pushSubscription, payloadData);
        } catch (err) {
          console.error(`Failed to send push notification to subscription ${sub.id}:`, err);
        }
      }

      console.log(`Successfully processed inventory level update for variant ${variantId}. Status updated to SENT.`);
    } catch (err) {
      console.error("Error processing inventory levels update:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  return new Response(null, { status: 200 });
};
