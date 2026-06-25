import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.session.findMany({});
  console.log("Sessions count:", sessions.length);
  for (const s of sessions) {
    console.log(`ID: ${s.id}, Shop: ${s.shop}, IsOnline: ${s.isOnline}, Token snippet: ${s.accessToken.substring(0, 10)}...`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
