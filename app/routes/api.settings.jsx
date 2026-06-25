import prisma from "../db.server";
import { getOrGenerateVapidKeys } from "../vapid.server";

// CORS Headers Helper for cross-origin storefront requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
};

export const loader = async ({ request }) => {
  // Handle Preflight OPTIONS request
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (request.method !== "GET") {
    return new Response("Method not allowed", { 
      status: 405,
      headers: corsHeaders
    });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response(
      JSON.stringify({ error: "Missing required shop parameter" }),
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    let settings = await prisma.settings.findUnique({
      where: { shop },
    });

    if (!settings) {
      settings = await prisma.settings.create({
        data: { shop },
      });
    }

    const vapidKeys = await getOrGenerateVapidKeys();

    return new Response(
      JSON.stringify({
        ...settings,
        publicVapidKey: vapidKeys.publicKey,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error("Settings API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
};
