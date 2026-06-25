import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.session.findMany({
    where: { isOnline: false }
  });
  if (sessions.length === 0) {
    console.log("No offline sessions found!");
    return;
  }

  const session = sessions[0];
  console.log("Using session for shop:", session.shop);

  const query = `
    query {
      productVariant(id: "gid://shopify/ProductVariant/43848598192231") {
        id
        title
        inventoryItem {
          id
          tracked
          inventoryLevels(first: 10) {
            edges {
              node {
                id
                quantities(names: ["available", "on_hand"]) {
                  name
                  quantity
                }
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch(`https://${session.shop}/admin/api/2026-07/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": session.accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query })
  });

  const data = await res.json();
  console.log("Variant Details:", JSON.stringify(data, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
