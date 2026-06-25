import prisma from "../db.server";

// CORS Headers Helper for cross-origin storefront requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export const loader = () => {
  return new Response("Method not allowed", { status: 405 });
};

export const action = async ({ request }) => {
  // Handle Preflight OPTIONS request
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const {
      shop,
      productId,
      variantId,
      variantTitle,
      productTitle,
      productImage,
      productHandle,
      pushSubscriptionJson,
    } = body;

    const channelValue = "push";

    if (!shop || !productId || !variantId) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: corsHeaders }
      );
    }

    let existingSub = null;

    // Check by push subscription endpoint if push is selected
    if (pushSubscriptionJson && pushSubscriptionJson.endpoint) {
      const targetEndpoint = pushSubscriptionJson.endpoint;
      const allSubs = await prisma.subscription.findMany({
        where: {
          shop,
          variantId: String(variantId),
          pushSubscriptionJson: { not: null },
        },
      });
      existingSub = allSubs.find((sub) => {
        try {
          const parsed = JSON.parse(sub.pushSubscriptionJson);
          return parsed && parsed.endpoint === targetEndpoint;
        } catch {
          return false;
        }
      });
    }

    let subscription;
    if (existingSub) {
      subscription = await prisma.subscription.update({
        where: { id: existingSub.id },
        data: {
          channel: channelValue,
          pushSubscriptionJson: pushSubscriptionJson
            ? JSON.stringify(pushSubscriptionJson)
            : existingSub.pushSubscriptionJson,
          status: "PENDING",
          reminderCount: 0,
          updatedAt: new Date(),
        },
      });
      console.log(`[Subscription API] Updated existing subscription ID: ${subscription.id}`);
    } else {
      subscription = await prisma.subscription.create({
        data: {
          shop,
          productId: String(productId),
          variantId: String(variantId),
          variantTitle: variantTitle || null,
          productTitle: productTitle || null,
          productImage: productImage || null,
          productHandle: productHandle || null,
          channel: channelValue,
          pushSubscriptionJson: pushSubscriptionJson
            ? JSON.stringify(pushSubscriptionJson)
            : null,
          status: "PENDING",
          reminderCount: 0,
        },
      });
      console.log(`[Subscription API] Created new subscription ID: ${subscription.id}`);
    }

    // Count total unique pending subscribers for this variant (one record = one person)
    const totalSubscribers = await prisma.subscription.count({
      where: { variantId: String(variantId), status: "PENDING" },
    });

    return new Response(
      JSON.stringify({
        success: true,
        subscriptionId: subscription.id,
        count: totalSubscribers,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error("Subscription API error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
};
