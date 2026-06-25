-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "variantTitle" TEXT,
    "productTitle" TEXT,
    "productImage" TEXT,
    "productHandle" TEXT,
    "channel" TEXT NOT NULL,
    "pushSubscriptionJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "buttonText" TEXT NOT NULL DEFAULT 'Notify Me When Available',
    "confirmMsg" TEXT NOT NULL DEFAULT 'You''re on the list!',
    "theme" TEXT NOT NULL DEFAULT 'Standard',
    "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lowStockThreshold" INTEGER,
    "lowStockText" TEXT NOT NULL DEFAULT 'Only {quantity} units remaining',
    "lowStockTheme" TEXT NOT NULL DEFAULT 'Standard',
    "pushTitle" TEXT NOT NULL DEFAULT '{product_name} is back in stock!',
    "pushBody" TEXT NOT NULL DEFAULT 'Grab it before it sells out again — tap to shop now.',
    "pushCta" TEXT NOT NULL DEFAULT 'Direct to product page (default)',
    "pushReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushReminderDelay" TEXT NOT NULL DEFAULT '3 days',
    "pushReminderMax" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Settings_shop_key" ON "Settings"("shop");
