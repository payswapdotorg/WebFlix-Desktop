/**
 * The Ad Center stores' shared identity-checksum helper (P5-STORES).
 *
 * NOT a store — a small internal shared by the five ads store modules
 * (ads-identity-store / ads-record-store / ads-claim-store /
 * ads-evidence-edge-store / ads-review-signal-store). Unlike the MI payload
 * stores' MIRRORED checksums (where the algorithm lives in the
 * platform-pure application layer and this lane mirrors it), the ads
 * checksum lives ONLY here: the application layer's ads import seam hands
 * over validated SHAPES (the 0.8.0 contracts — no checksum fields, and
 * none may be added: the shapes are frozen), so canonical serialization +
 * checksumming is a DURABLE-ROW concern this lane owns alone. The in-memory
 * doubles do not checksum at all (tamper detection is a serialized-row
 * concern; the doubles store validated objects).
 *
 * CHECKSUM HONESTY: FNV-1a 32-bit over the canonical JSON string, formatted
 * `fnv1a32:<8 hex digits>` — the same digest family every MI lineage uses.
 * It is an IDENTITY checksum (same canonical payload => same checksum,
 * forever), NOT a cryptographic integrity claim: it detects accidental
 * corruption and mistaken tampering, and the stores re-verify it on every
 * read so a mismatched row surfaces as a TYPED WebFlixError instead of
 * silently-mangled ads data.
 */

/** FNV-1a 32-bit over a string, formatted `fnv1a32:<8 hex digits>`. */
export function adsCanonicalChecksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}
