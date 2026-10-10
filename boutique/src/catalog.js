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
      { src: "/images/throw-lifestyle.webp", thumb: "/images/throw-lifestyle-800.webp", width: 1400, height: 700, alt: "USB heated throw blanket in Camel Brown, draped over a person relaxing on a sofa" },
      { src: "/images/throw-texture.webp", thumb: "/images/throw-texture-800.webp", width: 900, height: 727, alt: "Close-up of the heated throw's raised square plush texture" },
      { src: "/images/throw-detail.webp", thumb: "/images/throw-detail-800.webp", width: 900, height: 822, alt: "Detail of the heated throw with its control button visible on the fabric" },
    ],
    variants: [
      { id: "camel-brown", name: "Camel Brown", supplierVariant: "Camel Brown", available: true, swatch: "#b38e6d" },
      { id: "pearl-white", name: "Pearl White", supplierVariant: "Pearl White", available: false, swatch: "#efe8dc" },
    ],
  };
}

module.exports = { catalog, cents };
