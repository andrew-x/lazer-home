# 0013 — Résumé is stored as text only; PDFs are parsed server-side, never persisted

**Status:** accepted · 2026-06-18

## Context

Staff profiles gained a free-text `resume` field (`staff.resume`/`resumeUpdatedAt`, mirroring the `clientIntro` pair). People keep their résumé as a PDF, so the editor needed a way to ingest one without forcing manual copy-paste. Two questions fell out: **do we store the file, and where does PDF→text extraction run?**

We also had to fit the PDF through a Next.js server action. base64 encoding inflates bytes ~33%, and this build caps server-action request bodies (default 1 MB), so a real résumé PDF wouldn't fit unchanged.

## Decision

- **Store text only — never the PDF file.** The DB column is `text`; there's no blob storage, no object store, no file column. An uploaded PDF is parsed to text and discarded. The user reviews/edits the extracted text before it's saved.
- **Extract server-side via `unpdf`** (new dependency). The client reads the file to base64 and calls `parseResumePdf` (`secureActionClient`, session required); the action runs `unpdf`'s `extractText(..., { mergePages: true })` and returns the text. **`parseResumePdf` does no DB write** — it's a pure parse step. Saving is a separate `updateStaffResume` call, so parse and persist stay decoupled (you can also type/paste with no upload at all).
- **Two-step UX:** upload → parse → text lands in the textarea → user reviews → save. Image-only/scanned PDFs (no extractable text) and unreadable files surface a `UserSafeActionError` telling the user to paste manually, rather than silently saving empty.
- **Raise the body limit to 8 MB.** `next.config.ts` sets `experimental.serverActions.bodySizeLimit: "8mb"`, sized so a ~6 MB raw PDF survives base64 inflation. Client- and server-side size guards (~6 MB) mirror each other.

## Consequences

- **No file artifacts to secure, back up, or garbage-collect** — the résumé is just text alongside the rest of the profile, inheriting its (currently open — ADR 0012) authz and its revalidation. This is the main win.
- **Extraction quality is `unpdf`'s.** Scanned/image PDFs yield nothing (no OCR); layout-heavy PDFs may extract messily. The review-before-save step is the mitigation — the user fixes it in the textarea.
- **The 8 MB limit is global to all server actions**, not just this one — a larger attack/cost surface for any action. Acceptable under the internal-only posture; revisit if untrusted input ever reaches actions.
- **PDF parsing runs in the server-action (Node) runtime.** `unpdf` is bundled there; keep an eye on cold-start/bundle cost if more actions pull it in.
- A `formatTimestamp(value: Date)` helper was added to `src/lib/format.ts` for the "Updated …" line (instants, vs. `formatDate` for `"YYYY-MM-DD"` calendar strings).

## Alternatives considered

- **Store the PDF (blob column or object storage), render/download it** — rejected: adds storage, lifecycle, and access-control surface for no current need; text is what downstream uses (search, client intros, future skill extraction) want anyway.
- **Parse the PDF in the browser** (pdf.js) — rejected: heavier client bundle and inconsistent across browsers; server-side keeps the client thin and the dependency in one place. The base64 round-trip is the cost we accepted for it.
- **Persist on parse (one step)** — rejected: extraction is imperfect, so a human review gate before write is worth the extra action; also lets people edit/paste without ever uploading.
