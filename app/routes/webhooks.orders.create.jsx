import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return new Response("Invalid topic", { status: 400 });
  }

  try {
    const { note_attributes: noteAttributes, email, line_items: lineItems } = payload;
    let subIdFromNote = null;

    // 1. Try to find restockly_sub_id from note_attributes
    if (Array.isArray(noteAttributes)) {
      const subIdAttr = noteAttributes.find((attr) => attr.name === "restockly_sub_id");
      if (subIdAttr && subIdAttr.value) {
        subIdFromNote = parseInt(subIdAttr.value, 10);
      }
    }

    // 2. If subIdFromNote is found, mark that specific subscription as BOUGHT
    if (subIdFromNote && !isNaN(subIdFromNote)) {
      const updated = await prisma.subscription.updateMany({
        where: {
          id: subIdFromNote,
          shop,
        },
        data: {
          status: "BOUGHT",
        },
      });
      console.log(`[orders/create Webhook] Sub ID ${subIdFromNote} marked as BOUGHT. Count: ${updated.count}`);
    }


  } catch (err) {
    console.error("[orders/create Webhook] Error processing order webhook:", err);
    return new Response("Internal Server Error", { status: 500 });
  }

  return new Response(null, { status: 200 });
};
