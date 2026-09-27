-- CreateEnum
CREATE TYPE "ToumaRole" AS ENUM ('BUYER', 'SELLER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ToumaOrderStatus" AS ENUM ('PENDING', 'PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'LABEL_CREATED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED_BUYER', 'RESOLVED_SELLER', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "AddressKind" AS ENUM ('SHIPPING', 'BILLING', 'PICKUP');

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'ebay',
    "shopName" TEXT NOT NULL,
    "shopUrl" TEXT,
    "followed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastScanAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorProduct" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'divers',
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "soldCount" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "url" TEXT,
    "favorited" BOOLEAN NOT NULL DEFAULT false,
    "foundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'divers',
    "keywords" TEXT NOT NULL DEFAULT '',
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "imageUrl" TEXT,
    "url" TEXT,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'meta',
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "budget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "method" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesChannel" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "config" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelListing" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "url" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recoveryCodes" TEXT,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "toumaRole" "ToumaRole" NOT NULL DEFAULT 'BUYER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "phone" TEXT,
    "countryCode" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "ip" TEXT,
    "userAgent" TEXT,
    "newDevice" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT 'Clé de sécurité',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketOpportunity" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '',
    "niche" TEXT,
    "region" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "demandScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "competitionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trendScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedCostPrice" DOUBLE PRECISION,
    "estimatedSalePrice" DOUBLE PRECISION,
    "estimatedMargin" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "rawMetrics" TEXT NOT NULL DEFAULT '{}',
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "costPrice" DOUBLE PRECISION,
    "salePrice" DOUBLE PRECISION,
    "margin" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "images" TEXT NOT NULL DEFAULT '',
    "targetUnitPrice" DOUBLE PRECISION,
    "targetQuantity" INTEGER,
    "region" TEXT,
    "requiredCertifications" TEXT NOT NULL DEFAULT '',
    "opportunityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'opportunities',
    "requested" INTEGER NOT NULL DEFAULT 0,
    "generated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "params" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "zip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "onHold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitSalePrice" DOUBLE PRECISION NOT NULL,
    "unitCostPrice" DOUBLE PRECISION,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "offerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "trackingNumber" TEXT,
    "carrier" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "certifications" TEXT NOT NULL DEFAULT '',
    "leadTimeDays" INTEGER,
    "minOrderValue" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '',
    "unitPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "moq" INTEGER,
    "leadTimeDays" INTEGER,
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRequest" (
    "id" TEXT NOT NULL,
    "productId" TEXT,
    "query" TEXT NOT NULL DEFAULT '',
    "category" TEXT,
    "keywords" TEXT NOT NULL DEFAULT '',
    "targetUnitPrice" DOUBLE PRECISION,
    "targetQuantity" INTEGER,
    "region" TEXT,
    "requiredCertifications" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SearchRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierMatch" (
    "id" TEXT NOT NULL,
    "searchRequestId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "offerId" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "breakdown" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_countries" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "dialCode" TEXT NOT NULL DEFAULT '',
    "buyingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sellingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "touma_addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AddressKind" NOT NULL DEFAULT 'SHIPPING',
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "postalCode" TEXT,
    "countryCode" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_stores" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "bannerUrl" TEXT,
    "countryCode" TEXT NOT NULL,
    "city" TEXT,
    "phone" TEXT,
    "status" "StoreStatus" NOT NULL DEFAULT 'DRAFT',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "ratingAverage" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_seller_verifications" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "registrationNo" TEXT,
    "taxId" TEXT,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewerComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_seller_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "segment" TEXT NOT NULL DEFAULT 'BOTH',
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_products" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "brand" TEXT,
    "sku" TEXT,
    "price" DECIMAL(18,4) NOT NULL,
    "compareAtPrice" DECIMAL(18,4),
    "currency" TEXT NOT NULL,
    "minOrderQty" INTEGER NOT NULL DEFAULT 1,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "countryCode" TEXT NOT NULL,
    "weightGrams" INTEGER NOT NULL DEFAULT 500,
    "keywords" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "touma_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_product_images" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "priceDelta" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_inventory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_carts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "ToumaOrderStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL,
    "subtotal" DECIMAL(18,4) NOT NULL,
    "shippingTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "commissionTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL,
    "shippingAddressId" TEXT,
    "shippingSnapshot" JSONB NOT NULL,
    "crossBorder" BOOLEAN NOT NULL DEFAULT false,
    "buyerCountry" TEXT,
    "sellerCountry" TEXT,
    "note" TEXT,
    "cancelReason" TEXT,
    "checkoutKey" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "titleSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "variantSnapshot" TEXT,
    "imageSnapshot" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "method" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "refundedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "succeededAt" TIMESTAMP(3),

    CONSTRAINT "touma_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_payment_events" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_commissions" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "rate" DECIMAL(6,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_seller_payouts" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_seller_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_shipping_providers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countries" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_shipping_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_shipping_quotes" (
    "id" TEXT NOT NULL,
    "providerId" TEXT,
    "providerCode" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "orderId" TEXT,
    "originCountry" TEXT NOT NULL,
    "originCity" TEXT,
    "destinationCountry" TEXT NOT NULL,
    "destinationCity" TEXT,
    "weightGrams" INTEGER NOT NULL,
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "etaMinDays" INTEGER NOT NULL,
    "etaMaxDays" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_shipping_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_shipments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "quoteId" TEXT,
    "providerId" TEXT,
    "providerCode" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "labelUrl" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "etaMinDays" INTEGER NOT NULL DEFAULT 0,
    "etaMaxDays" INTEGER NOT NULL DEFAULT 0,
    "originCountry" TEXT NOT NULL,
    "destinationCountry" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "touma_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_tracking_events" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "label" TEXT NOT NULL,
    "location" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_reviews" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_disputes" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "refundAmount" DECIMAL(18,4),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_dispute_messages" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_dispute_evidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_risk_scores" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "level" TEXT NOT NULL DEFAULT 'LOW',
    "signals" JSONB NOT NULL DEFAULT '[]',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "touma_risk_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_fraud_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "code" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_fraud_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "channels" TEXT NOT NULL DEFAULT 'IN_APP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_ai_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "useCase" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'OK',
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_ai_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_ai_recommendations" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "score" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_ai_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "touma_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touma_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Competitor_platform_idx" ON "Competitor"("platform");

-- CreateIndex
CREATE INDEX "CompetitorProduct_competitorId_idx" ON "CompetitorProduct"("competitorId");

-- CreateIndex
CREATE INDEX "CompetitorProduct_soldCount_idx" ON "CompetitorProduct"("soldCount");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorProduct_competitorId_externalId_key" ON "CompetitorProduct"("competitorId", "externalId");

-- CreateIndex
CREATE INDEX "Ad_productId_idx" ON "Ad"("productId");

-- CreateIndex
CREATE INDEX "Withdrawal_status_idx" ON "Withdrawal"("status");

-- CreateIndex
CREATE INDEX "SalesChannel_type_idx" ON "SalesChannel"("type");

-- CreateIndex
CREATE INDEX "SalesChannel_status_idx" ON "SalesChannel"("status");

-- CreateIndex
CREATE INDEX "ChannelListing_channelId_idx" ON "ChannelListing"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelListing_channelId_productId_key" ON "ChannelListing"("channelId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "LoginEvent_userId_idx" ON "LoginEvent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");

-- CreateIndex
CREATE INDEX "WebAuthnCredential_userId_idx" ON "WebAuthnCredential"("userId");

-- CreateIndex
CREATE INDEX "MarketOpportunity_status_idx" ON "MarketOpportunity"("status");

-- CreateIndex
CREATE INDEX "MarketOpportunity_opportunityScore_idx" ON "MarketOpportunity"("opportunityScore");

-- CreateIndex
CREATE UNIQUE INDEX "MarketOpportunity_source_externalId_key" ON "MarketOpportunity"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "GenerationRun_status_idx" ON "GenerationRun"("status");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_channel_externalId_key" ON "Order"("channel", "externalId");

-- CreateIndex
CREATE INDEX "SupportMessage_customerId_idx" ON "SupportMessage"("customerId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_orderId_idx" ON "PurchaseOrder"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "Supplier_region_idx" ON "Supplier"("region");

-- CreateIndex
CREATE INDEX "Supplier_rating_idx" ON "Supplier"("rating");

-- CreateIndex
CREATE INDEX "Offer_supplierId_idx" ON "Offer"("supplierId");

-- CreateIndex
CREATE INDEX "Offer_category_idx" ON "Offer"("category");

-- CreateIndex
CREATE INDEX "SearchRequest_status_idx" ON "SearchRequest"("status");

-- CreateIndex
CREATE INDEX "SupplierMatch_searchRequestId_idx" ON "SupplierMatch"("searchRequestId");

-- CreateIndex
CREATE INDEX "SupplierMatch_score_idx" ON "SupplierMatch"("score");

-- CreateIndex
CREATE INDEX "touma_addresses_userId_idx" ON "touma_addresses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_stores_slug_key" ON "touma_stores"("slug");

-- CreateIndex
CREATE INDEX "touma_stores_ownerId_idx" ON "touma_stores"("ownerId");

-- CreateIndex
CREATE INDEX "touma_stores_status_idx" ON "touma_stores"("status");

-- CreateIndex
CREATE INDEX "touma_stores_countryCode_idx" ON "touma_stores"("countryCode");

-- CreateIndex
CREATE INDEX "touma_seller_verifications_storeId_idx" ON "touma_seller_verifications"("storeId");

-- CreateIndex
CREATE INDEX "touma_seller_verifications_status_idx" ON "touma_seller_verifications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "touma_categories_slug_key" ON "touma_categories"("slug");

-- CreateIndex
CREATE INDEX "touma_categories_parentId_idx" ON "touma_categories"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_products_slug_key" ON "touma_products"("slug");

-- CreateIndex
CREATE INDEX "touma_products_storeId_idx" ON "touma_products"("storeId");

-- CreateIndex
CREATE INDEX "touma_products_categoryId_idx" ON "touma_products"("categoryId");

-- CreateIndex
CREATE INDEX "touma_products_status_idx" ON "touma_products"("status");

-- CreateIndex
CREATE INDEX "touma_products_countryCode_idx" ON "touma_products"("countryCode");

-- CreateIndex
CREATE INDEX "touma_product_images_productId_idx" ON "touma_product_images"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_product_variants_sku_key" ON "touma_product_variants"("sku");

-- CreateIndex
CREATE INDEX "touma_product_variants_productId_idx" ON "touma_product_variants"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_inventory_variantId_key" ON "touma_inventory"("variantId");

-- CreateIndex
CREATE INDEX "touma_inventory_productId_idx" ON "touma_inventory"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_inventory_productId_variantId_key" ON "touma_inventory"("productId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_carts_userId_key" ON "touma_carts"("userId");

-- CreateIndex
CREATE INDEX "touma_cart_items_cartId_idx" ON "touma_cart_items"("cartId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_cart_items_cartId_productId_variantId_key" ON "touma_cart_items"("cartId", "productId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_orders_orderNumber_key" ON "touma_orders"("orderNumber");

-- CreateIndex
CREATE INDEX "touma_orders_buyerId_idx" ON "touma_orders"("buyerId");

-- CreateIndex
CREATE INDEX "touma_orders_storeId_idx" ON "touma_orders"("storeId");

-- CreateIndex
CREATE INDEX "touma_orders_status_idx" ON "touma_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "touma_orders_buyerId_storeId_checkoutKey_key" ON "touma_orders"("buyerId", "storeId", "checkoutKey");

-- CreateIndex
CREATE INDEX "touma_order_items_orderId_idx" ON "touma_order_items"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_payments_idempotencyKey_key" ON "touma_payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "touma_payments_orderId_idx" ON "touma_payments"("orderId");

-- CreateIndex
CREATE INDEX "touma_payments_status_idx" ON "touma_payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "touma_payment_events_externalId_key" ON "touma_payment_events"("externalId");

-- CreateIndex
CREATE INDEX "touma_payment_events_paymentId_idx" ON "touma_payment_events"("paymentId");

-- CreateIndex
CREATE INDEX "touma_commissions_orderId_idx" ON "touma_commissions"("orderId");

-- CreateIndex
CREATE INDEX "touma_commissions_storeId_idx" ON "touma_commissions"("storeId");

-- CreateIndex
CREATE INDEX "touma_seller_payouts_storeId_idx" ON "touma_seller_payouts"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_shipping_providers_code_key" ON "touma_shipping_providers"("code");

-- CreateIndex
CREATE INDEX "touma_shipping_quotes_orderId_idx" ON "touma_shipping_quotes"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_shipments_trackingNumber_key" ON "touma_shipments"("trackingNumber");

-- CreateIndex
CREATE INDEX "touma_shipments_orderId_idx" ON "touma_shipments"("orderId");

-- CreateIndex
CREATE INDEX "touma_shipments_status_idx" ON "touma_shipments"("status");

-- CreateIndex
CREATE INDEX "touma_tracking_events_shipmentId_idx" ON "touma_tracking_events"("shipmentId");

-- CreateIndex
CREATE INDEX "touma_reviews_productId_idx" ON "touma_reviews"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_reviews_orderId_productId_key" ON "touma_reviews"("orderId", "productId");

-- CreateIndex
CREATE INDEX "touma_disputes_orderId_idx" ON "touma_disputes"("orderId");

-- CreateIndex
CREATE INDEX "touma_disputes_status_idx" ON "touma_disputes"("status");

-- CreateIndex
CREATE INDEX "touma_dispute_messages_disputeId_idx" ON "touma_dispute_messages"("disputeId");

-- CreateIndex
CREATE INDEX "touma_dispute_evidence_disputeId_idx" ON "touma_dispute_evidence"("disputeId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_risk_scores_userId_key" ON "touma_risk_scores"("userId");

-- CreateIndex
CREATE INDEX "touma_fraud_events_userId_idx" ON "touma_fraud_events"("userId");

-- CreateIndex
CREATE INDEX "touma_fraud_events_code_idx" ON "touma_fraud_events"("code");

-- CreateIndex
CREATE UNIQUE INDEX "touma_favorites_userId_productId_key" ON "touma_favorites"("userId", "productId");

-- CreateIndex
CREATE INDEX "touma_notifications_userId_idx" ON "touma_notifications"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "touma_refresh_tokens_tokenHash_key" ON "touma_refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "touma_refresh_tokens_userId_idx" ON "touma_refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "touma_refresh_tokens_familyId_idx" ON "touma_refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "touma_ai_requests_userId_idx" ON "touma_ai_requests"("userId");

-- CreateIndex
CREATE INDEX "touma_ai_recommendations_targetType_targetId_idx" ON "touma_ai_recommendations"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "touma_audit_logs_actorId_idx" ON "touma_audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "touma_audit_logs_entity_entityId_idx" ON "touma_audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "touma_audit_logs_action_idx" ON "touma_audit_logs"("action");

-- AddForeignKey
ALTER TABLE "CompetitorProduct" ADD CONSTRAINT "CompetitorProduct_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelListing" ADD CONSTRAINT "ChannelListing_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "SalesChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelListing" ADD CONSTRAINT "ChannelListing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "touma_countries"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "MarketOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchRequest" ADD CONSTRAINT "SearchRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMatch" ADD CONSTRAINT "SupplierMatch_searchRequestId_fkey" FOREIGN KEY ("searchRequestId") REFERENCES "SearchRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMatch" ADD CONSTRAINT "SupplierMatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMatch" ADD CONSTRAINT "SupplierMatch_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_addresses" ADD CONSTRAINT "touma_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_addresses" ADD CONSTRAINT "touma_addresses_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "touma_countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_stores" ADD CONSTRAINT "touma_stores_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_stores" ADD CONSTRAINT "touma_stores_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "touma_countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_seller_verifications" ADD CONSTRAINT "touma_seller_verifications_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_seller_verifications" ADD CONSTRAINT "touma_seller_verifications_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_categories" ADD CONSTRAINT "touma_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "touma_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_products" ADD CONSTRAINT "touma_products_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_products" ADD CONSTRAINT "touma_products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "touma_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_products" ADD CONSTRAINT "touma_products_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "touma_countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_product_images" ADD CONSTRAINT "touma_product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "touma_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_product_variants" ADD CONSTRAINT "touma_product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "touma_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_inventory" ADD CONSTRAINT "touma_inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "touma_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_inventory" ADD CONSTRAINT "touma_inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "touma_product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_carts" ADD CONSTRAINT "touma_carts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_cart_items" ADD CONSTRAINT "touma_cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "touma_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_cart_items" ADD CONSTRAINT "touma_cart_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "touma_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_cart_items" ADD CONSTRAINT "touma_cart_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "touma_product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_orders" ADD CONSTRAINT "touma_orders_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_orders" ADD CONSTRAINT "touma_orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_orders" ADD CONSTRAINT "touma_orders_shippingAddressId_fkey" FOREIGN KEY ("shippingAddressId") REFERENCES "touma_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_order_items" ADD CONSTRAINT "touma_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_order_items" ADD CONSTRAINT "touma_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "touma_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_order_items" ADD CONSTRAINT "touma_order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "touma_product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_payments" ADD CONSTRAINT "touma_payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_payment_events" ADD CONSTRAINT "touma_payment_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "touma_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_commissions" ADD CONSTRAINT "touma_commissions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_commissions" ADD CONSTRAINT "touma_commissions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_commissions" ADD CONSTRAINT "touma_commissions_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "touma_seller_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_seller_payouts" ADD CONSTRAINT "touma_seller_payouts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "touma_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_shipping_quotes" ADD CONSTRAINT "touma_shipping_quotes_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "touma_shipping_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_shipping_quotes" ADD CONSTRAINT "touma_shipping_quotes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_shipments" ADD CONSTRAINT "touma_shipments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_shipments" ADD CONSTRAINT "touma_shipments_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "touma_shipping_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_shipments" ADD CONSTRAINT "touma_shipments_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "touma_shipping_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_tracking_events" ADD CONSTRAINT "touma_tracking_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "touma_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_reviews" ADD CONSTRAINT "touma_reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_reviews" ADD CONSTRAINT "touma_reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "touma_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_reviews" ADD CONSTRAINT "touma_reviews_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_disputes" ADD CONSTRAINT "touma_disputes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "touma_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_disputes" ADD CONSTRAINT "touma_disputes_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_dispute_messages" ADD CONSTRAINT "touma_dispute_messages_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "touma_disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_dispute_messages" ADD CONSTRAINT "touma_dispute_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_dispute_evidence" ADD CONSTRAINT "touma_dispute_evidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "touma_disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_risk_scores" ADD CONSTRAINT "touma_risk_scores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_fraud_events" ADD CONSTRAINT "touma_fraud_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_favorites" ADD CONSTRAINT "touma_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_favorites" ADD CONSTRAINT "touma_favorites_productId_fkey" FOREIGN KEY ("productId") REFERENCES "touma_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_notifications" ADD CONSTRAINT "touma_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_refresh_tokens" ADD CONSTRAINT "touma_refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_requests" ADD CONSTRAINT "touma_ai_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_ai_recommendations" ADD CONSTRAINT "touma_ai_recommendations_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "touma_ai_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touma_audit_logs" ADD CONSTRAINT "touma_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

