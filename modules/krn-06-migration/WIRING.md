# How KRN-06 is wired

KRN-06 does not read another module's tables. Each target is registered in one small file.

## Contacts — wired to KRN-02

`src/targets/register-contacts.ts` passes `krn02PartyDirectory` into the contacts target.

That adapter calls KRN-02:

- `listPartiesForImport` and `partyImportStamps` to find duplicates and to see whether a row was edited after the import
- `createParty` and `updateParty` to save rows (`confirmDuplicate` is set because the import already decided skip or update)
- `archiveParty` to undo a created contact

Undo is refused when `updated_at` or status no longer matches the import. Contacts are archived, not deleted.

An operator import is stored against the company owner, because KRN-02 records a user on the contact. The import batch itself still names the operator.

## Stock — wired to SCM-01

`src/targets/register-stock.ts` builds the stock target, which calls SCM-01 `importOpeningStock`.

- A new row is a catalog item plus a **receipt** when the opening quantity is above zero.
- The receipt updates the weighted-average cost.
- A smaller quantity on an update posts an issue. A larger quantity posts another receipt.
- Undo calls `reverseMovement` and then archives a created item. Movements stay in the ledger.

The Branch column uses KRN-03 `listImportBranches`. A blank branch is Head Office. A name or code must match a live branch. While the company is still on one branch, only Head Office is accepted.

## Custom fields (KRN-04)

Add keys to a target's `fields` array. The engine maps whatever the target declares. Persist them inside the module function the target already calls.
