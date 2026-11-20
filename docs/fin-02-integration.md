# FIN-02 — Debtors (Accounts Receivable)

## Module identity

- Blueprint ID: `FIN-02`
- Display name: Invoices
- Blueprint domain: Finance & Accounting
- Runtime package: `@omnivate/module-o2c` (`modules/o2c-sales`)
- Company workspace: `/invoices`
- API registration: `registerO2c` from `apps/api/src/app.ts`
- Migration: `modules/o2c-sales/migrations/20261120030000_o2c_sales.sql`

The package name reflects the shared order-to-cash document engine. It serves
SAL-01 quotes and FIN-02 debtor records together; this does not merge their
module identities or permissions. Invoice entities, invoice routes, reporting
sources, and debtor access checks explicitly use `FIN-02`.

## Implemented FIN-02 capabilities

- Customer account records backed by KRN-02 parties, including VAT and billing
  details, contact information, and payment terms.
- Draft and issued customer tax invoices, including line-level quantities,
  pricing, discounts, VAT calculations, and per-tenant sequential numbering.
- Credit notes linked to original invoices. Issued tax documents are immutable;
  corrections are made through credit notes rather than editing posted records.
- Customer receipts by EFT, cash, or card, with allocations across open invoices.
- Open-balance calculations, invoice status filters, and customer statements.
- Statement ageing buckets and the ready-made aged-debtors report.
- Per-customer credit limits and administrator-managed credit holds, checked before a draft invoice or accepted quote is issued.
- An auditable overdue-reminder queue with first, second, and final reminder stages. Messages are generated for review and are not sent automatically; an operator marks them sent after using the company's email process.
- Branded PDF output for invoices and credit notes.
- FIN-01 posting for issued sales documents and customer receipts.
- SCM-01 stock movements for invoice lines that issue catalog stock.
- Tenant-scoped persistence, role permissions, audit integration, and report
  source registration.

## Integration boundaries

- KRN-02 owns the customer/party directory; FIN-02 stores debtor-specific terms
  and invoice-time customer snapshots, not a second customer master.
- FIN-01 owns the general ledger. FIN-02 calls its sales-document and customer
  payment posting functions rather than writing ledger tables directly.
- SCM-01 owns inventory quantities and movements. FIN-02 uses its stock movement
  interface when an invoice issues catalog items.
- ANA-03 consumes registered FIN-02 report sources for invoices, payments, and
  aged debtors.
- KRN-04 entity registration exposes invoice and credit-note totals to the
  shared workflow/custom-field machinery.

## Remaining work

Recurring/scheduled invoice templates and outbound email delivery remain follow-on
work. Accepted quote conversion already creates and issues the corresponding
invoice. The overdue reminder feature currently creates an auditable queue for
operator review; it does not send email. Customer credit limits and holds are
managed on the customer record and enforced before direct invoice issue and
accepted-quote conversion.

## Verification coverage

The repository includes FIN-02 coverage in `modules/o2c-sales/test/` for debtor
permissions, invoice/payment behaviour, and report source registration, plus
shared module-index and activation tests. Run the root `pnpm verify` command in
a Node 22 + pnpm 10 workspace to run lint, formatting, type checks, and tests.
