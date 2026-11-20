# Finance modules FIN-03 to FIN-06 — implementation status

FIN-03, FIN-04, FIN-05 and FIN-06 are separate workspace packages with independent module IDs, domain rules, API registrations and company-app screens. They share one ordered database migration file because the schema is deployed together; the module logic and permissions remain separate.

## FIN-02 — Debtors / Accounts Receivable

- Separate module identity and permission checks are retained inside the shared order-to-cash engine; FIN-01 owns the ledger and posts sales documents and receipts.
- Customer account terms now include optional credit limits and explicit credit holds with an audited reason. Invoice issue and accepted-quote conversion both enforce the customer credit policy against current open debtor balances.
- Overdue reminders can be generated into an idempotent, auditable queue at first (1–6 days), second (7–29 days) and final (30+ days) stages. Operators review and send the prepared message through their normal email process, then mark the queue item sent. The API does not send email.
- Accepted quote conversion already creates and issues the corresponding tax invoice; recurring/scheduled invoice templates are not implemented.

## FIN-03 — Creditors / Accounts Payable

- Draft supplier bills with multiple lines, supplier/document references, dates, integer-cent totals and expense-account allocation.
- Bill posting creates a balanced FIN-01 journal: expense debits, VAT-input debit and creditors-control credit. Posted bills are protected by the database immutability trigger.
- Supplier payments create a balanced creditors-control/bank journal and can allocate amounts to posted bills without exceeding bill balances. Unallocated payment amounts are retained in the response.
- Supplier ageing list and basic company-app capture/list/post/payment screens.
- Remaining: supplier credit notes, purchase-order/GRN source adapters and enforced three-way match on bill posting, payment-run approvals/SoD, EFT file export, remittance advice, supplier statement reconciliation and fuller workflow tests.

## FIN-04 — Cashbook & Bank Reconciliation

- Bank-account setup linked to FIN-01 accounts, statement transaction import with content-hash duplicate protection, and unmatched transaction listing.
- Matching requires an open reconciliation and a posted FIN-01 journal whose net effect on the selected bank GL account equals the bank transaction amount.
- Reconciliation stores statement/book closing balances and difference; completion is blocked until the difference is zero and imported transactions through the statement date are matched. Completed reconciliations are immutable.
- Company-app screens cover bank accounts, manual statement-line import, journal matching and reconciliation completion.
- Remaining: direct file-upload flow, bank-feed provider connectors, split journal allocations, matching adapters for FIN-02/03 receipts and payments, cash-flow forecast and full integration tests.

## FIN-05 — Petty Cash, Till Floats & Expense Claims

- Cash funds and float limits, cash-in/out movements with balanced FIN-01 postings, receipt-backed expense claims and submitted/approved/rejected/paid state transitions.
- Claim approval posts expense/VAT-input debits against creditors control; payment posts creditors control against the selected bank account.
- Company-app screens cover funds, movements, claim submission, approval/rejection and payment.
- Remaining: document-capture receipt linking and verification, KRN-04 approval workflow/approval-limit integration, payroll payout adapter, richer till-float close-out and end-to-end tests.

## FIN-06 — Tax, VAT & Statutory Audit

- Tenant-specific tax codes with configurable basis-point rates, VAT transaction validation, period totals, prepare/file/lock transitions and immutable filed/locked records.
- Database guard permits only the explicit filed-to-locked status transition; other changes to a filed period are rejected.
- Company-app screens cover tax-code setup, manual VAT transactions, period preparation, filing reference capture and locking.
- Remaining: authoritative VAT201 box mapping, SARS-compatible export/API, automatic tax transaction adapters from FIN-02/03/05, GL VAT-control reconciliation, audit pack export and tax compliance review.

## Integration and verification notes

- API routes are registered in the main Fastify application and use session authentication, tenant-scoped transactions and the existing RBAC scopes (`fin.ledger`, `fin.petty`, `fin.tax`).
- FIN-03, FIN-04 and FIN-05 postings use FIN-01's balanced-journal service. FIN-06 calculates and snapshots VAT but does not yet post a VAT-control journal.
- All persisted monetary amounts are integer cents. RLS and posted/filed/completed-record database protections remain in place.
- Domain smoke checks and static TypeScript syntax checks have been run, including FIN-02 credit-limit and reminder-stage rules. Full pnpm install, typecheck, lint, Vitest, database migration and browser workflow tests have not been run in this environment because dependencies and PostgreSQL are unavailable. These modules are an integrated first implementation, not production-certified accounting software.
