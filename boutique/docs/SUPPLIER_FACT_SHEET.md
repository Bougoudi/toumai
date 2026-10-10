# HavenLume — supplier fact sheet (internal)

Everything a customer reads about the product comes from **`/admin` → Product info**
(stored in the database, defined in `src/product-facts.js`). A field stays empty until the
supplier confirms it **in writing for the exact SKU you sell**; the store then shows
"Being confirmed with our supplier" instead of a guess. The dashboard counts what is missing.

Reviews of *competing* USB heated throws show five recurring complaints: heat felt weak or
slow, power bank incompatible / faulty / short runtime, confusion about whether a power bank
is in the box, wrong item or color shipped, and unclear power / care / delivery / safety
information. They are not evidence about our product: use them to ask the right questions.

## Ask the supplier (copy/paste)

| Admin field | Question to send | Answers |
|---|---|---|
| Supplier SKU *(internal)* | What is the exact SKU / variant ID for Camel Brown and for Pearl White? | Must match `SUPPLIER_PRODUCT_SKU` on Render; the order checklist refuses a mismatch |
| Dimensions, Weight | Exact size (in and cm) and weight of the throw? | Objection 5 |
| Materials / fabric | Exact fiber composition, as on the care label? | |
| Power input | Required input: connector type, voltage (V), current (A), wattage (W)? | Objections 1, 2, 5 |
| Compatible power sources | Which power banks / adapters work (minimum output)? Does it work with any 5 V USB power bank, or only some? | Objection 2 |
| Power bank included? | Is a power bank included in the configuration we buy? Exactly which one? | Objection 3 |
| Power bank capacity / runtime | If included: capacity (mAh) and runtime **measured by the manufacturer** per heat level with that power bank? | Objection 2 — never estimate a runtime yourself |
| USB cable length | Length of the cable? | |
| Heat settings, Heating zones | Number of levels? Where are the heating elements? | Objection 1 |
| Temperature range, Warm-up time | Manufacturer's measured temperature per level and warm-up time, with the test conditions? | Objection 1 — publish only documented figures |
| Controls, Automatic shut-off | How is it switched on / adjusted? Is there an auto shut-off, after how long? | |
| What's in the box / Not included | Exact list of items in the retail box? Which accessories are sold separately? | Objection 3 |
| Machine washable?, Care | Exact care-label and manual instructions (wash method, temperature, remove the cable first?) | Objection 5 — never write "machine washable" without the label |
| Manufacturer's safety instructions | Send the manual (PDF) and every warning printed on it | Objection 5 |
| Manual received? *(internal)* | — | Tick only once you hold the manual |
| Order processing time | How many business days between our order and dispatch? | Objection 5 — shown separately from transit |
| Transit time to the US | Carrier and transit days to US addresses after dispatch? | Shown as an estimate, never a guaranteed date |
| Warranty, Country of origin | Warranty offered? Country of manufacture? | |
| Compliance documents *(internal)* | Which safety test reports / certificates exist for **this exact model** (e.g. electrical safety, battery transport UN38.3 if a battery is included)? | Never shown to customers; never claim a certification on the site — see `PRODUCT_COMPLIANCE.md` |

Also needed outside the admin: a real photo of the **Pearl White** color and a real
home-office photo (the home page shows a labeled placeholder).

## Order preparation checklist (admin → order)

Before **Save supplier order** is allowed, tick: SKU, color/variant, quantity, expected
accessories, shipping address. Tracking is ticked automatically when the shipment is
recorded; "Customer informed" is ticked by you once the shipment email is really sent.
These checks record what you compared against the order and the supplier's confirmation —
**not a physical inspection** of the parcel.

If the supplier reports an out-of-stock color, a changed reference or an address problem,
record an **anomaly** and tick **Put the order on hold**: the supplier order and shipment
steps are refused until the anomaly is resolved (refunds and cancellation stay possible).
