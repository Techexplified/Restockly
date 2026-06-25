import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const subs = await prisma.subscription.findMany();
  console.log("Subscriptions:", JSON.stringify(subs, null, 2));
  const settings = await prisma.settings.findMany();
  console.log("Settings:", JSON.stringify(settings, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
