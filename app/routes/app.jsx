import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  // Dynamically register/update the webhook subscriptions
  try {
    const url = new URL(request.url);
    const appUrl = `${url.protocol}//${url.host}`;

    const webhooksRes = await admin.graphql(`
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
    `);
    const webhooksData = await webhooksRes.json();
    const existingSubs = webhooksData.data?.webhookSubscriptions?.edges || [];
    
    const requiredWebhooks = [
      { topic: "PRODUCTS_UPDATE", callbackUrl: `${appUrl}/webhooks/products/update` },
      { topic: "INVENTORY_LEVELS_UPDATE", callbackUrl: `${appUrl}/webhooks/inventory_levels/update` },
    ];

    for (const req of requiredWebhooks) {
      let hasValidWebhook = false;
      for (const edge of existingSubs) {
        const sub = edge.node;
        if (sub.topic === req.topic) {
          if (sub.endpoint?.callbackUrl === req.callbackUrl) {
            hasValidWebhook = true;
          } else {
            // Delete old/mismatched webhook
            await admin.graphql(`
              mutation webhookSubscriptionDelete($id: ID!) {
                webhookSubscriptionDelete(id: $id) {
                  userErrors {
                    field
                    message
                  }
                  deletedWebhookSubscriptionId
                }
              }
            `, {
              variables: { id: sub.id }
            });
            console.log(`Deleted outdated webhook subscription: ${sub.id} for ${req.topic}`);
          }
        }
      }

      if (!hasValidWebhook) {
        const createRes = await admin.graphql(`
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
        `, {
          variables: {
            topic: req.topic,
            webhookSubscription: {
              callbackUrl: req.callbackUrl,
              format: "JSON"
            }
          }
        });
        const createData = await createRes.json();
        const errors = createData.data?.webhookSubscriptionCreate?.userErrors || [];
        if (errors.length > 0) {
          console.error(`Failed to create ${req.topic} webhook subscription:`, errors);
        } else {
          console.log(`Successfully registered ${req.topic} webhook to ${req.callbackUrl}`);
        }
      }
    }
  } catch (err) {
    console.error("Error managing dynamic webhook registration:", err);
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
