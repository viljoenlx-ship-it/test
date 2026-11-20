# UI standard

The company app and the control panel are one program. Every screen uses `@omnivate/ui` and the tokens in `packages/ui/src/styles.css`. Do not add a second stylesheet, a one-off theme, or a page that invents its own buttons, tables, or sidebar.

The look follows a calm light workspace: near-white background, soft grey surfaces, near-black text, hairline borders, and generous space. The indigo-to-teal Omnivate mark stays on the logo. Indigo is used for the one primary button and for the focus ring. Teal stays in the logo.

## Tokens

| Token          | Use                       |
| -------------- | ------------------------- |
| `--ui-bg`      | Page background           |
| `--ui-surface` | Cards, sidebar, dialogs   |
| `--ui-ink`     | Text                      |
| `--ui-muted`   | Secondary text            |
| `--ui-line`    | Hairline borders          |
| `--ui-primary` | The single primary button |
| `--ui-focus`   | Focus ring                |
| `--ui-radius`  | Cards and dialogs         |
| `--ui-font`    | Inter                     |

Buttons and inputs are pills. Cards use a large radius. Shadows stay barely there.

## Components

Import these from `@omnivate/ui`. Do not rebuild them on a page.

| Component                                   | Use                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `AppShell`                                  | Sidebar, search, and the working area                                                                          |
| `PageHeader`                                | One title, one short description, one primary action                                                           |
| `Button`                                    | `primary` for the single main action. `secondary` and `ghost` for the rest. `danger` for a destructive confirm |
| `TextField`, `TextAreaField`, `SelectField` | Labelled fields                                                                                                |
| `SearchBar`                                 | The jump field. It opens the command palette                                                                   |
| `Card`                                      | A quiet group of content                                                                                       |
| `DataTable`                                 | Airy rows, a sticky header, no zebra stripes                                                                   |
| `Chip`                                      | A quiet filter                                                                                                 |
| `DialogFrame`                               | A short modal. `Sheet` is the same pattern from the side                                                       |
| `TabsBar`                                   | One row of sections on a page                                                                                  |
| `EmptyState`                                | What is missing, and the next thing to do                                                                      |
| `ToastProvider` / `useToast`                | A short confirmation                                                                                           |
| `Skeleton`                                  | Loading                                                                                                        |
| `Badge`                                     | A small status                                                                                                 |

`/design-preview` shows the set. It is available in local development and on the preview build, and on the control panel for a signed-in operator.

## Layout

- One full-width working area. Do not split a task into side-by-side panels.
- One primary button on a screen.
- Labels are Title Case.
- The sidebar is a slim list of icon and label. It collapses to icons. Groups collapse. The groups that contain something the person can open start open.
- Search sits at the top of the working area.

## Module index

The sidebar lists every module in the blueprint, grouped by area: Company, Finance, Sales, Supply Chain, Operations, HR, Compliance, Analytics. Company is the client name for the kernel group. The list comes from `moduleIndex()` in `@omnivate/shared`. Clients do not see module codes or blueprint words such as Kernel.

- A module with a screen in `BUILT_SCREENS`, switched on for the company, opens that screen.
- A module without a screen opens a one-page overview: the name, what it does, and Coming Soon. The row is faded, and the hint says Coming Soon.
- A module with a screen that is switched off stays faded and does not open. The hint says Not In Your Package.
- Adding a screen to `BUILT_SCREENS` is what makes a module light up. The same id is in the blueprint and, when the work is tracked, in `docs/progress/roadmap.json`.

The control panel Modules tab uses the same index, with an on/off switch for each module.

## What clients see

The company app does not show Build Progress, module codes, or notes that the product is unfinished. No stub, TODO, beta, prototype, placeholder text, or debug detail. Build Progress stays on the control panel Overview.

Empty screens say what to do next. Loading uses `Skeleton`. A failed load says what happened in a sentence.

## Mobile

Below 768px the phone layout is its own shell. It uses the same tokens, colours, and type. It does not squeeze the desk layout down. Check every new screen at 390px width.

A real phone still uses that shell when the layout viewport is wider than the screen. Chrome can stretch the layout to fit a wide table, and a desktop-site request uses a layout near 980px. The shell also checks the screen's short side, a coarse pointer, and a phone browser, up to a layout width of 1040px. A desk window wider than that stays on the desk layout.

The top app bar shows the page title, one search icon, and the account avatar. Search opens a full-screen sheet. There is no breadcrumb, no Ctrl K hint, and no branch or VAT chip in that bar. Branch and VAT live in the account sheet, with sign out and alerts.

A bottom tab bar keeps the on-the-go work in thumb reach: Home, Sales, Stock, Scan, and More. Scan is the centre action. It opens the camera to snap a document or scan a barcode. More lists Home, Sales, Stock, Documents, Contacts, and Reports, and says that company setup stays on a computer. People, branches, approvals, import, and the control panel open a short note to use a computer.

The page title lives in the app bar. A phone screen does not repeat a subtitle under it. Lists are edge-to-edge rows with a hairline between them, and a list should show at least seven rows at 390px wide. A table does not scroll sideways. Detail sections are full width, with tight padding. A form is one column, with touch targets of at least 44px. The primary action sticks to the bottom only on a form. A list or an overview puts that action in the app bar, as a short button. Secondary actions sit in a bottom sheet. A modal is a bottom sheet.

`DataTable`, `PageHeader`, `Form`, and `Sheet` carry this layout, so a module that is still being built (quotes, invoices, and the rest) gets a usable phone screen by using them. People, contacts, stock, receiving stock, labels, documents, reports, and approvals follow the same patterns. On a phone, reports are for opening a saved report and exporting it. Building a report stays the shorter editor.
