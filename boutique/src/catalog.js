// Product catalog. Only list facts confirmed by the supplier for the exact SKU.
// A variant is offered for sale only when `available` is true.
// The product exists in two colors: brown (Camel Brown) and white (Pearl White), confirmed
// by the owner. Pearl White photos supplied by the owner (2026-10-11): three lifestyle/close-up
// photos, plus the supplier listing photo cropped so the model's face isn't shown. A fourth
// supplied photo (throw folded on a bed) is not used: the throw must not be used while sleeping.
// `aiGenerated`: AI-generated illustrations (owner-confirmed). Labeled in the gallery, tagged with IPTC
// DigitalSourceType=trainedAlgorithmicMedia, and never sent to Google (feed or structured data). `hasPhoto` is true only when photos of that color are in the gallery:
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
    // `variant` = the color shown in the photo (the gallery switches to it when that color is chosen).
    images: [
      { src: "/images/throw-lifestyle.webp", thumb: "/images/throw-lifestyle-800.webp", width: 1400, height: 700, variant: "camel-brown", alt: "USB heated throw blanket in Camel Brown, draped over a person relaxing on a sofa" },
      { src: "/images/throw-texture.webp", thumb: "/images/throw-texture-800.webp", width: 900, height: 727, variant: "camel-brown", alt: "Close-up of the heated throw's raised square plush texture in Camel Brown" },
      { src: "/images/throw-detail.webp", thumb: "/images/throw-detail-800.webp", width: 900, height: 822, variant: "camel-brown", alt: "Detail of the heated throw with a button visible on the fabric" },
      { aiGenerated: true, src: "/images/throw-white-reading.webp", thumb: "/images/throw-white-reading-800.webp", width: 541, height: 719, variant: "pearl-white", focus: "center 30%", alt: "Woman reading on a sofa, wrapped in the Pearl White heated throw" },
      { aiGenerated: true, src: "/images/throw-white-armchair.webp", thumb: "/images/throw-white-armchair-800.webp", width: 541, height: 719, variant: "pearl-white", focus: "center 35%", alt: "Woman in an armchair holding a mug, wrapped in the Pearl White heated throw" },
      { aiGenerated: true, src: "/images/throw-white-closeup.webp", thumb: "/images/throw-white-closeup-800.webp", width: 538, height: 719, variant: "pearl-white", alt: "Close-up of the Pearl White throw's raised square plush texture" },
      { src: "/images/throw-white-wrap.webp", thumb: "/images/throw-white-wrap-800.webp", width: 1080, height: 580, variant: "pearl-white", alt: "USB heated throw in Pearl White, worn as a wrap by a person sitting on a sofa" },
    ],
    variants: [
      { id: "camel-brown", name: "Camel Brown", supplierVariant: "Camel Brown", available: true, hasPhoto: true, swatch: "#b38e6d" },
      { id: "pearl-white", name: "Pearl White", supplierVariant: "Pearl White", available: true, hasPhoto: true, swatch: "#efe8dc" },
    ],
  };
}

module.exports = { catalog, cents };
