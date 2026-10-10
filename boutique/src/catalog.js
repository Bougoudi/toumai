// Product catalog. Only list facts confirmed by the supplier for the exact SKU.
// A variant is offered for sale only when `available` is true.
// Camel Brown is the colour shown in the product photo we have. Pearl White stays
// unavailable until the supplier confirms stock and provides a real photo of it.

const cents = (usd) => Math.round(Number(usd) * 100);

function catalog(cfg) {
  return {
    id: "usb-heated-throw",
    name: "USB Heated Wearable Throw",
    sku: "HL-THROW",
    // Supplier's product reference, used in the "Copy Supplier Order" text.
    supplierSku: process.env.SUPPLIER_PRODUCT_SKU || "CONFIRM-WITH-SUPPLIER",
    priceCents: cents(cfg.priceUsd),
    maxQtyPerLine: 5,
    images: [
      { src: "/images/throw-lifestyle.jpg", alt: "The textured heated throw in Camel Brown, draped over a person relaxing on a sofa" },
      { src: "/images/throw-texture.jpg", alt: "Close-up of the throw's raised square plush texture" },
      { src: "/images/throw-detail.jpg", alt: "Detail of the throw with its control button visible on the fabric" },
    ],
    variants: [
      { id: "camel-brown", name: "Camel Brown", supplierVariant: "Camel Brown", available: true, swatch: "#b38e6d" },
      { id: "pearl-white", name: "Pearl White", supplierVariant: "Pearl White", available: false, swatch: "#efe8dc" },
    ],
  };
}

module.exports = { catalog, cents };
