# Document capture

Snap a Document stores a supplier tax invoice or delivery note and can post it as stock receipts. This page is for people who run or change the service. The company app does not name the reader. The control panel does, because that is where the extra fee is chosen.

## What is stored

The original file is kept by the document store, keyed by tenant id and document id. PostgreSQL stores the extracted header, lines, confidence, and the link to each SCM-01 receipt. Money is integer cents, VAT exclusive. The extracted JSON is kept so a later supplier bill (accounts payable, phase 1b) can be posted without reading the file again.

## Reader

`DocumentReader` is the server interface in `modules/doc-capture`. The company app never names a reader. The control panel, on the client's Modules tab, offers two choices. The default is Standard.

| Control panel choice       | `OPENAI_API_KEY` | Reader that runs                                                                   |
| -------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| Standard Reader (Included) | any              | Standard. Local text and character recognition. No paid call.                      |
| Premium Reader (Extra Fee) | set              | OpenAI vision, model `DOCUMENT_READER_MODEL` or `gpt-4o-mini`. Counted as premium. |
| Premium Reader (Extra Fee) | missing          | Standard. The control panel shows a note. Pages count as standard.                 |

`DOCUMENT_READER_PROVIDER=demo` is a local test switch. It ignores the picture and returns a fictional Silver Mango invoice, or a delivery note, mismatch, or unknown supplier when the file name contains `delivery`, `mismatch`, or `nomatch`. Leave it unset on Render.

`OPENAI_API_KEY` is the only secret. It is not committed. On Render it is `sync: false` in `render.yaml`. Set it only when a company should be able to use Premium Reader.

### What Standard reads well

A clean PDF that already has a text layer. A straight, high-contrast photo of a simple printed invoice. On those it finds a supplier name that looks like a company (`(Pty) Ltd`, `CC`), a South African VAT number (10 digits starting with 4), a document number, a date written as `4 March 2026`, `2026-03-04`, or day/month/year, and the Subtotal, VAT, and Total lines. Item rows are one line each: description, then quantity, unit price, and line total.

Every confidence is kept under 0.75, so the review screen highlights the fields for a person to check.

### What Standard does not read well

Handwriting, a skewed or dark photo, and a crowded or multi-column layout. A description that itself contains several prices can be split in the wrong place. A supplier code is kept only when it looks like `AB-123`. Line VAT is calculated at 15%. It is not read from a VAT column. A date with slashes is read as day, then month, then year.

A PDF that is only a scan, with no text layer, is not turned into a picture. The read stops and the company sees Could Not Read. HEIC is accepted as a file type, and the bytes are passed to the local reader, which expects a common picture format and often cannot read HEIC. Use a JPG, PNG, or a PDF with a text layer.

## Third-party processor

Premium Reader sends the file bytes to OpenAI's API (`https://api.openai.com`) to produce the structured fields. OpenAI is a third-party operator for that processing under POPIA. The request is the file and a short instruction. The response is the JSON fields. The API key is sent only as a bearer token. Standard Reader does not leave the server and does not use a third-party API.

The service does not write the file, the instruction, or the response body to logs. A failed read is logged as `document read failed` with no document text. The company app says "Could Not Read".

Do not point Premium Reader at real supplier invoices until the operator has a processing agreement with OpenAI and has told the client. The hosted preview should stay on fictional documents. Leaving the key unset keeps every company on Standard Reader.

## Limits

- 12 MB.
- JPG, PNG, HEIC, or PDF. A PDF can have more than one page. Pages Read counts the pages sent to the reader that actually ran, for the current month in `Africa/Johannesburg`. Standard and Premium are counted apart, so the extra-fee usage can be billed on its own.
- The control panel switch turns capture off for one company. Existing rows stay. Changing the reader writes an `audit_events` row.
- Post and undo each write an `audit_events` row. Undo is a reversing SCM-01 movement.
- `omnivate_app` cannot delete a document row.
