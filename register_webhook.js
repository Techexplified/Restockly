import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Error: Please provide your current app tunnel URL.");
    console.error("Usage: node register_webhook.js https://your-tunnel-url.trycloudflare.com");
    process.exit(1);
  }

  let appUrl = args[0].trim();
  // Strip trailing slash if present
  if (appUrl.endsWith('/')) {
    appUrl = appUrl.slice(0, -1);
  }

  const requiredWebhooks = [
    { topic: "PRODUCTS_UPDATE", callbackUrl: `${appUrl}/webhooks/products/update` },
    { topic: "INVENTORY_LEVELS_UPDATE", callbackUrl: `${appUrl}/webhooks/inventory_levels/update` },
    { topic: "ORDERS_CREATE", callbackUrl: `${appUrl}/webhooks/orders/create` },
  ];

  const sessions = await prisma.session.findMany({
    where: { isOnline: false }
  });
  if (sessions.length === 0) {
    console.log("No offline sessions found!");
    return;
  }

  const session = sessions[0];
  console.log("Using session for shop:", session.shop);

  // 1. Fetch current webhook subscriptions
  const listQuery = `
    query {
      webhookSubscriptions(first: 50) {
        edges {
          node {
            id
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
        }
      }
    }
  `;

  let res = await fetch(`https://${session.shop}/admin/api/2026-07/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": session.accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query: listQuery })
  });

  let data = await res.json();
  const existingSubs = data.data?.webhookSubscriptions?.edges || [];

  for (const req of requiredWebhooks) {
    // 2. Delete existing webhooks for this topic
    for (const edge of existingSubs) {
      const sub = edge.node;
      if (sub.topic === req.topic) {
        console.log(`Deleting existing webhook: ${sub.id} (${sub.endpoint?.callbackUrl}) for ${req.topic}`);
        const deleteMutation = `
          mutation webhookSubscriptionDelete($id: ID!) {
            webhookSubscriptionDelete(id: $id) {
              userErrors {
                field
                message
              }
              deletedWebhookSubscriptionId
            }
          }
        `;
        await fetch(`https://${session.shop}/admin/api/2026-07/graphql.json`, {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": session.accessToken,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: deleteMutation,
            variables: { id: sub.id }
          })
        });
      }
    }

    // 3. Register the new webhook
    console.log(`Registering new ${req.topic} webhook...`);
    const createMutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          webhookSubscription {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    res = await fetch(`https://${session.shop}/admin/api/2026-07/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: createMutation,
        variables: {
          topic: req.topic,
          webhookSubscription: {
            callbackUrl: req.callbackUrl,
            format: "JSON"
          }
        }
      })
    });

    data = await res.json();
    const errors = data.data?.webhookSubscriptionCreate?.userErrors || [];
    if (errors.length > 0) {
      console.error(`Failed to register ${req.topic} webhook:`, JSON.stringify(errors, null, 2));
    } else {
      const newId = data.data?.webhookSubscriptionCreate?.webhookSubscription?.id;
      console.log(`Successfully registered ${req.topic} webhook! ID: ${newId}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
