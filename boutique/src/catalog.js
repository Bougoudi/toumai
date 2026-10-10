// Product catalog. Only list facts confirmed by the supplier for the exact SKU.
// A variant is offered for sale only when `available` is true.
// The product exists in two colors: brown (Camel Brown) and white (Pearl White), confirmed
// by the owner. `hasPhoto` is true only when real photos of that color are in the gallery:
// customers are told otherwise, and the color is kept out of the Google Merchant feed.

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
      { src: "/images/throw-detail.webp", thumb: "/images/throw-detail-800.webp", width: 900, height: 822, alt: "Detail of the heated throw with a button visible on the fabric" },
    ],
    variants: [
      { id: "camel-brown", name: "Camel Brown", supplierVariant: "Camel Brown", available: true, hasPhoto: true, swatch: "#b38e6d" },
      { id: "pearl-white", name: "Pearl White", supplierVariant: "Pearl White", available: true, hasPhoto: false, swatch: "#efe8dc" },
    ],
  };
}

module.exports = { catalog, cents };
