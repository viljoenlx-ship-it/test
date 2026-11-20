# How to import contacts and stock

This is for Liam, and for a company owner. It takes a few minutes. Nothing here is a real customer. The examples are made up.

## In the company app

1. Sign in as the company owner.
2. Open **Import**.
3. Choose **Contacts** or **Stock items**. A manager can import stock. Only the owner can import contacts.
4. Download the Excel or CSV template, or use a file you already have. The first row must be the column names.
5. Say what to do when a row matches someone or something you already have: skip it, or update it. For stock, also say whether the prices include VAT.
6. Check the column match. Omnivate guesses from the heading. Change any that are wrong. The match is remembered for this company next time.
7. Read the preview. A problem looks like `Row 14: VAT number should be 10 digits`. Fix the file, or import the rows that are ready and leave the bad ones out.
8. Import. A long file shows progress and is saved as one batch.
9. Download the error report if any rows were skipped or need a fix.

Undo is on the summary. It archives the contacts and posts a reversing stock entry. It does not delete anything. If someone has edited those records since the import, undo is refused for the whole batch.

## Amounts and dates

These are all accepted:

- `R 1 234,56`
- `R1 234.50`
- `10,50`
- Dates as `19/11/2026`

In a CSV file, put quotes around an amount that contains a comma, or use the Excel file. A South African Excel CSV that uses semicolons is fine.

VAT numbers are 10 digits. A blank VAT number is allowed.

## Take a copy out

On the same Import screen, use **Take a copy out** to download contacts or stock as Excel or CSV. That file is yours. You can edit it and import it again.

## From the control panel

1. Sign in as the platform owner.
2. Open the company.
3. Click **Import data**.
4. Follow the same steps. The import is stored against that company, with your name on the audit record.

Platform support can look, but cannot import.
