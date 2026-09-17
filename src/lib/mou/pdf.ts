// src/lib/mou/pdf.ts
//
// Two things happen to the MOU PDF, at two different times:
//
//   1. fillMouDraft() — at sign-request creation time. Draws the
//      partner's actual organization name + commercial_fee_rate (from
//      partner_commercial_terms, see 098/111) onto the blank template,
//      producing the per-request document a signer will actually read.
//      Text-drawn, not re-typeset — the surrounding MOU wording itself
//      is untouched, only the two blanks get filled in. This is what
//      closes the "everyone saw the same % regardless of their actual
//      negotiated rate" gap (111's migration header has the full story).
//
//   2. stampSignatureOntoMou() — at actual signing time. Draws the
//      signature PNG + a small audit block onto whatever document was
//      shown to the signer (the filled draft from step 1, or — for
//      legacy sign requests created before dynamic drafts existed —
//      the raw blank template). Deliberately does NOT re-typeset MOU
//      text either, same reasoning: "the document the signer saw" and
//      "the document that gets signed" must be byte-for-byte the same
//      pages, which matters far more for enforceability than it costs
//      in engineering effort.
//
// loadMouBaseDocument() is what decides which bytes step 2 stamps
// onto: draft_storage_path if the sign request has one (the normal
// case going forward), else the blank on-disk template (legacy rows).
//
// Requires `pdf-lib` and `@pdf-lib/fontkit` (add both:
// npm install pdf-lib @pdf-lib/fontkit). fontkit is what lets pdf-lib
// embed an arbitrary .ttf — pdf-lib's own StandardFonts are the 14
// base-14 Latin fonts and cannot render Thai glyphs at all, which is
// why every Thai string below used to come out as boxes.
//
// The blank template file itself is NOT included here — drop the
// source MOU as a flat PDF (no form fields needed) at the path below,
// one file per template_version so old signed documents keep
// referring to the exact wording they were signed against even if the
// MOU text changes later.
//
// Thai font files also are not included in source control here — drop
// Sarabun-Regular.ttf and Sarabun-Bold.ttf at the paths FONT_DIR
// resolves below (see fetchThaiFonts()'s doc comment for where they
// came from and why that source is safe to embed/redistribute).

import { PDFDocument, degrees, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';

const TEMPLATE_DIR = path.join(process.cwd(), 'legal', 'mou-templates');
const FONT_DIR = path.join(process.cwd(), 'legal', 'fonts');

function templatePath(templateVersion: string): string {
  // templateVersion is always one of our own known strings (set server-
  // side when a sign request is created, never taken from the client at
  // sign time) — but resolve() + startsWith() guards against path
  // traversal regardless, same defensive posture as
  // src/lib/security/safe-url-fetch.ts elsewhere in this repo.
  const resolved = path.resolve(TEMPLATE_DIR, `${templateVersion}.pdf`);
  if (!resolved.startsWith(TEMPLATE_DIR)) {
    throw new Error('Invalid template_version');
  }
  return resolved;
}

/**
 * Reads the raw, blank template PDF bytes for a given template_version
 * — the un-filled, un-signed source file. Used as fillMouDraft()'s
 * input, and directly by the admin "preview before sending" endpoint
 * when no specific partner is given yet. Throws ENOENT (via fs) if the
 * template file hasn't been placed on disk yet — callers should catch
 * that and return a friendly "template not configured" response
 * rather than a raw 500.
 */
export async function readTemplateBytes(templateVersion: string): Promise<Buffer> {
  return fs.readFile(templatePath(templateVersion));
}

interface ThaiFonts {
  regular: PDFFont; // audit-trail labels (ลงนามโดย, วันเวลา, ...) — body weight
  bold: PDFFont; // organization name — matches the pre-printed bold "ห้างหุ้นส่วนจำกัด รอยัล บริดจ์99 (WOS)" it sits opposite
}

/**
 * Registers fontkit on the document and embeds both Sarabun weights.
 * Sarabun (SIL Open Font License, from Google Fonts / the Cadson Demak
 * "Sarabun Project") is the font used everywhere a Thai string is
 * drawn onto the MOU — organization name (page 1 box + page 2 label)
 * and the signing audit-trail lines. Throws ENOENT if the .ttf files
 * haven't been placed at FONT_DIR yet, same "let the caller turn this
 * into a friendly error" posture as readTemplateBytes.
 */
async function embedThaiFonts(pdfDoc: PDFDocument): Promise<ThaiFonts> {
  pdfDoc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await Promise.all([
    fs.readFile(path.join(FONT_DIR, 'Sarabun-Regular.ttf')),
    fs.readFile(path.join(FONT_DIR, 'Sarabun-Bold.ttf')),
  ]);
  const [regular, bold] = await Promise.all([
    pdfDoc.embedFont(regularBytes, { subset: true }),
    pdfDoc.embedFont(boldBytes, { subset: true }),
  ]);
  return { regular, bold };
}

export interface FillMouDraftParams {
  templateVersion: string;
  organizationName: string;
  commercialFeeRatePercent: number; // e.g. 12 for 12.00%
}

export interface FillMouDraftResult {
  pdfBytes: Uint8Array;
  sha256: string;
}

/**
 * Draws the partner's organization name + commercial fee % onto page 1
 * of the blank template, and mirrors the org name onto the page-2
 * "สถานประกอบการพันธมิตร" label next to the signature block (that
 * label sits blank/generic on the raw template — same role as WOS's
 * own pre-printed name opposite it — so it gets whited-out and
 * replaced per request, confirmed with the user 2026-09-16 rather
 * than left as-is). Returns a new, filled PDF — does not touch the
 * on-disk template.
 *
 * Coordinates below are VERIFIED against the real founding-partner-v1.pdf
 * (measured via pdfplumber word-bbox extraction + pixel-level ink/line
 * detection, not eyeballed — re-measure the same way if this ever
 * needs tuning against a new template_version). Confirmed with a
 * rendered preview; text sits flush on every target. Corrections vs.
 * the original placeholder assumptions, since the real layout turned
 * out to differ from the generic guess made before this file was
 * available:
 *
 *   1. There is no inline "...ทำขึ้นระหว่าง WOS และ ______" blank.
 *      The partner name goes on the dotted line inside the boxed
 *      "สถานประกอบการพันธมิตร" (Partner's Establishment) panel,
 *      top-right of page 1 — parallel to how "ห้างหุ้นส่วนจำกัด
 *      รอยัล บริดจ์99 (WOS)" is pre-printed in the panel opposite it.
 *   2. The ข้อ 3 Commercial Terms blank is a solid underline
 *      immediately before a pre-printed "%" glyph, not a
 *      "____%"-style blank you draw the percent sign into yourself —
 *      only the number gets drawn, right-aligned so it always sits
 *      snug against the printed "%" regardless of digit count.
 *   3. Page 2's "สถานประกอบการพันธมิตร" label (next to the signature
 *      block) needs to be whited out before redrawing, since it's
 *      pre-printed template text, not a blank — draw order matters:
 *      white rect first, org name on top.
 *
 * Font: organizationName is Thai in the normal case, so it's drawn
 * with the embedded Sarabun Bold (matches the weight of the
 * pre-printed WOS name it sits opposite/next to). The fee-rate number
 * is ASCII digits + a period, so it stays on Helvetica — no reason to
 * pull in Sarabun just for numerals.
 */
export async function fillMouDraft(params: FillMouDraftParams): Promise<FillMouDraftResult> {
  const { templateVersion, organizationName, commercialFeeRatePercent } = params;

  const templateBytes = await readTemplateBytes(templateVersion);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const thaiFonts = await embedThaiFonts(pdfDoc);

  const pages = pdfDoc.getPages();
  const firstPage = pages[0]; // partner-name panel + ข้อ 3 Commercial Terms are both page 1
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Boxed "สถานประกอบการพันธมิตร" panel, dotted name line.
  // Measured: dotted rule spans x 345.6–549.6 at y≈629. Text baseline
  // sits a few points above the rule.
  const orgNameX = 350;
  const orgNameY = 632;
  firstPage.drawText(organizationName, {
    x: orgNameX,
    y: orgNameY,
    size: 11,
    font: thaiFonts.bold,
    color: rgb(0.1, 0.1, 0.1),
  });

  // ข้อ 3 Commercial Terms — solid underline measured at x 245.3–521.3,
  // y≈290, immediately followed by a pre-printed "%" at x≈529.9–537.4.
  // Right-align the number so it always sits snug before the "%".
  const feeRateText = commercialFeeRatePercent.toFixed(2);
  const feeRateFontSize = 11;
  const feeRateLineEndX = 520; // just inside the printed "%" at 529.9
  const feeRateY = 293;
  const feeRateWidth = font.widthOfTextAtSize(feeRateText, feeRateFontSize);
  firstPage.drawText(feeRateText, {
    x: feeRateLineEndX - feeRateWidth,
    y: feeRateY,
    size: feeRateFontSize,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });

  // Page 2 — "สถานประกอบการพันธมิตร" label next to the signature block
  // (mirrors "ห้างหุ้นส่วนจำกัด รอยัล บริดจ์99 (WOS)" on the WOS side).
  // Ink measured tightly at x 383.5–486.2, y 372.0–378.7 — white-out a
  // slightly larger rect (clears ascenders/descenders) before redrawing,
  // then center the org name in the same rect the way the WOS-side
  // name sits under its caption.
  const secondPage = pages[1];
  const labelWhiteoutX = 378;
  const labelWhiteoutY = 368;
  const labelWhiteoutWidth = 114; // 380 -> 494
  const labelWhiteoutHeight = 13; // 368 -> 381
  secondPage.drawRectangle({
    x: labelWhiteoutX,
    y: labelWhiteoutY,
    width: labelWhiteoutWidth,
    height: labelWhiteoutHeight,
    color: rgb(1, 1, 1),
  });
  const labelFontSize = 11;
  const labelCenterX = labelWhiteoutX + labelWhiteoutWidth / 2; // 435
  const labelTextWidth = thaiFonts.bold.widthOfTextAtSize(organizationName, labelFontSize);
  secondPage.drawText(organizationName, {
    x: labelCenterX - labelTextWidth / 2,
    y: 372,
    size: labelFontSize,
    font: thaiFonts.bold,
    color: rgb(0.1, 0.1, 0.1),
  });

  const pdfBytes = await pdfDoc.save();
  const sha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex');

  return { pdfBytes, sha256 };
}

/**
 * Resolves which document bytes a given sign request's signer actually
 * sees / signs: the generated per-request draft in Storage if one
 * exists (draft_storage_path, set by create-sign-request for every
 * request created after 111), falling back to the blank on-disk
 * template for legacy requests that predate dynamic draft generation.
 * Both the template-preview routes and stampSignatureOntoMou's caller
 * (confirm/route.ts) MUST go through this rather than reading
 * template_version off disk directly, or a legacy request and a
 * dynamic one would silently diverge in behavior.
 */
export async function loadMouBaseDocument(signRequest: {
  templateVersion: string;
  draftStoragePath: string | null;
}): Promise<Buffer> {
  if (signRequest.draftStoragePath) {
    const supabase = createServiceClient();
    const { data, error } = await supabase.storage
      .from('mou-documents')
      .download(signRequest.draftStoragePath);
    if (error || !data) {
      throw new Error(`Failed to load draft from storage: ${error?.message ?? 'no data'}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }
  return readTemplateBytes(signRequest.templateVersion);
}

export interface StampSignatureParams {
  baseDocumentBytes: Uint8Array; // from loadMouBaseDocument() — the exact bytes the signer read
  signatureImagePng: Buffer; // decoded from the canvas's base64 PNG
  signerName: string;
  signedAtIso: string;
  signerIp: string;
  verificationMethod: string;
  organizationName: string;
}

export interface StampSignatureResult {
  pdfBytes: Uint8Array;
  sha256: string;
}

export async function stampSignatureOntoMou(
  params: StampSignatureParams
): Promise<StampSignatureResult> {
  const {
    baseDocumentBytes,
    signatureImagePng,
    signerName,
    signedAtIso,
    signerIp,
    verificationMethod,
    organizationName,
  } = params;

  const pdfDoc = await PDFDocument.load(baseDocumentBytes);
  const thaiFonts = await embedThaiFonts(pdfDoc);

  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1]; // signature block is page 2 of the MOU
  const { width } = lastPage.getSize();

  const pngImage = await pdfDoc.embedPng(signatureImagePng);

  // Partner-side signature rule, measured: x 349.9–549.6, y≈404 (the
  // WOS-side rule mirrors it at x 62.4–291.8). The old sigY=190 was
  // never checked against the real file and landed the signature near
  // the bottom margin, nowhere near the actual line — fixed here.
  // The image sits ON the rule (bottom edge at the line) and grows
  // upward into the blank gap below the "ลงนามเพื่อแสดงเจตจำนงร่วมกัน"
  // heading (that gap runs from y≈404 up to y≈465, ~60pt).
  const sigWidth = 140; // fits inside the ~200pt-wide rule with margin
  const sigHeight = (pngImage.height / pngImage.width) * sigWidth;
  const sigX = 355;
  const sigY = 406;

  lastPage.drawImage(pngImage, { x: sigX, y: sigY, width: sigWidth, height: sigHeight });

  // The audit-trail lines can't go directly under the rule — that
  // space is already occupied by the template's own
  // "(ผู้มีอำนาจลงนามฝ่ายพันธมิตร)" caption, the pre-printed
  // organization-name line, and the วันที่ (date) fields (y≈330–394,
  // all pre-printed). The nearest actual blank space is further down,
  // below the "เอกสารฉบับนี้จัดทำขึ้นสองฉบับ..." closing line
  // (y≈299–308) — verified blank down to the footer.
  //
  // Font: these are Thai labels (ลงนามโดย, วันเวลา, วิธียืนยันตัวตน),
  // so they use the embedded Sarabun Regular — Helvetica rendered them
  // as boxes.
  const auditX = 355;
  const auditStartY = 265;

  const stampLines = [
    `ลงนามโดย: ${signerName}`,
    `วันเวลา: ${new Date(signedAtIso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} (ICT)`,
    `วิธียืนยันตัวตน: ${verificationMethod}`,
    `IP Address: ${signerIp}`,
  ];

  stampLines.forEach((line, i) => {
    lastPage.drawText(line, {
      x: auditX,
      y: auditStartY - i * 11,
      size: 7,
      font: thaiFonts.regular,
      color: rgb(0.35, 0.35, 0.35),
    });
  });

  // Faint "e-signed" mark, placed in the same lower blank area (not
  // stacked above the signature block, which would now collide with
  // the "ลงนามเพื่อแสดงเจตจำนงร่วมกัน" heading at y≈471–483 once sigY
  // is correct) — cosmetic only, the real proof is the audit_log-style
  // mou_signatures row + hash below, not this watermark.
  //
  // Font: organizationName is interpolated in here and is typically
  // Thai, so this line also needs Sarabun, not Helvetica — it was
  // silently boxing out before the font work landed.
  lastPage.drawText(`e-Signed — ${organizationName}`, {
    x: width / 2 - 140,
    y: 150,
    size: 10,
    font: thaiFonts.regular,
    color: rgb(0.85, 0.85, 0.85),
    rotate: degrees(0),
  });

  const pdfBytes = await pdfDoc.save();
  const sha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex');

  return { pdfBytes, sha256 };
}
