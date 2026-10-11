// Review form rules shared by the browser (window.HLReviewRules) and the server
// (require("../public/js/review-rules.js")). The server always re-validates.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HLReviewRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LIMITS = { nameMin: 2, nameMax: 40, titleMax: 100, commentMin: 20, commentMax: 1500 };
  const PURCHASED = ["yes", "no"];
  const RECOMMEND = ["yes", "no", "not_sure_yet"];
  // Demo starting state of the form (never stored, never displayed as a review).
  const INITIAL = { rating: 5, displayName: "", title: "", comment: "", purchasedFromHavenLume: "yes", wouldRecommend: "yes", publicationConsent: false };

  // Collapses runs of spaces/tabs, trims each line and limits blank lines; removes control characters.
  function normalize(value, multiline) {
    let s = String(value == null ? "" : value).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, "");
    if (!multiline) return s.replace(/\s+/g, " ").trim();
    return s.split("\n").map(l => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  const length = s => Array.from(s).length; // counts characters, not UTF-16 units

  /** Returns { value, errors } — errors maps field name to a message. */
  function validate(input) {
    const i = input || {};
    const errors = {};
    const rating = i.rating;
    if (!(typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5)) errors.rating = "Choose a rating from 1 to 5 stars.";
    const displayName = normalize(i.displayName, false);
    if (length(displayName) < LIMITS.nameMin || length(displayName) > LIMITS.nameMax) errors.displayName = `Enter a public name of ${LIMITS.nameMin} to ${LIMITS.nameMax} characters.`;
    const title = normalize(i.title, false);
    if (length(title) > LIMITS.titleMax) errors.title = `Keep the title to ${LIMITS.titleMax} characters or fewer.`;
    const comment = normalize(i.comment, true);
    if (length(comment) < LIMITS.commentMin) errors.comment = `Please write at least ${LIMITS.commentMin} characters about your experience.`;
    else if (length(comment) > LIMITS.commentMax) errors.comment = `Keep your review to ${LIMITS.commentMax} characters or fewer.`;
    if (!PURCHASED.includes(i.purchasedFromHavenLume)) errors.purchasedFromHavenLume = "Tell us whether you bought it from HavenLume.";
    const wouldRecommend = i.wouldRecommend == null || i.wouldRecommend === "" ? null : i.wouldRecommend;
    if (wouldRecommend !== null && !RECOMMEND.includes(wouldRecommend)) errors.wouldRecommend = "Choose Yes, No or Not sure yet.";
    if (i.publicationConsent !== true) errors.publicationConsent = "Please confirm your review is honest and that you accept the publication rules.";
    return { errors, value: { rating, displayName, title: title || null, comment, purchasedFromHavenLume: i.purchasedFromHavenLume, wouldRecommend, publicationConsent: i.publicationConsent === true } };
  }

  return { LIMITS, PURCHASED, RECOMMEND, INITIAL, normalize, length, validate };
});
