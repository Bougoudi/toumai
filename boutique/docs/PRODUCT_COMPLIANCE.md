# USB heated throw — documents to obtain before selling in the US

Live payments stay disabled (`PRODUCT_COMPLIANCE_VERIFIED=false`) until this list has been
reviewed. **Which rules apply to this exact model must be confirmed by a qualified US
product-compliance professional.** This list tells you what to ask the supplier for; it is
not legal advice and it does not certify anything.

Never publish "UL", "ETL", "FCC", "CPSC", "certified", "safe for…" or any medical claim
unless a document for this exact model (same model number) proves it.

## Ask the supplier for (exact model / SKU)
1. **Full specification sheet**: model number, dimensions, weight, fabric composition,
   heating element, USB input (voltage/current), heat levels, auto shut-off (only if real),
   what is in the box (is a power bank or adapter included?).
2. **Electrical safety test reports** from an accredited lab, and the standard they test
   against (for example IEC 60335-2-17, which covers blankets, pads and flexible heating
   appliances, or a UL standard). Ask whether a US NRTL listing (UL, ETL/Intertek, CSA)
   exists. Many US retailers and marketplaces require one even when it is not mandatory.
3. **FCC**: if the controller contains digital electronics, an FCC Part 15 test report or
   Supplier's Declaration of Conformity (SDoC).
4. **Flammability**: a test report against 16 CFR 1610 (flammability of clothing
   textiles). This matters because the product is sold as a *wearable* throw. A General
   Certificate of Conformity (GCC) is required for products subject to CPSC rules.
5. **Textile labelling** (FTC Textile Act): fiber content, country of origin, and the
   identity of the manufacturer or importer on the label.
6. **Batteries**, if a power bank is included: UN 38.3 test summary (needed for
   shipping) and a battery safety report (e.g. IEC/UL 62133).
7. **California Proposition 65**: a chemical assessment or test report, or a compliant
   warning.
8. **Instructions and warnings** in US English, including use and care, do-not-use-
   while-sleeping, and children/vulnerable-users warnings.
9. **Product liability insurance** for the seller (strongly recommended for heated
   products).
10. **Commercial rights to the product photos**, and photos of every colour actually sold.

## When everything is verified
- Update `src/catalog.js` (confirmed variants, supplier SKU) and the product details page.
- Set `PRODUCT_COMPLIANCE_VERIFIED=true` only after the review, then `LIVE_PAYMENTS_ENABLED=true`
  with your live iyzico keys.
