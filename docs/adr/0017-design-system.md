# ADR 0017: One design system, Radix, no Tailwind

## Status

Accepted

## Context

The company app and the control panel must feel like the same product. The first screens were a large serif title, a full-width gradient button, and little structure. Liam asked for something simple, calm, and obvious the first time. Both apps need accessible dialogs, tabs, toasts, tables, and a command palette. Light theme only. A tenant's logo and colours must show on the company app without making text fail contrast.

shadcn/ui with Tailwind is the usual way to get that. shadcn copies components into each app. Tailwind needs a content scanner across the workspace. [ADR 0001](0001-monorepo-pnpm.md) keeps one TypeScript source tree and no second task runner. Two Vite apps need to import the same components, not two copies.

## Decision

`packages/ui` (`@omnivate/ui`) is the design system.

- Tokens are CSS variables: ink, muted grey, line, radius, shadow, and a brand mark. There is no dark theme and no toggle.
- Inter is bundled with `@fontsource/inter`. The page does not call a font host.
- Behaviour that is easy to get wrong (focus trap, tabs, toasts, dialog titles) uses Radix primitives.
- The command palette uses `cmdk`, which is the accessible listbox those palettes are built on.
- Icons are Lucide, one stroke weight.
- The page is a near-white workspace. Indigo is the primary button and the focus ring. Indigo-to-teal stays on the Omnivate mark. A tenant colour may replace that mark when it has at least 4.5:1 contrast on white. Otherwise the mark stays the Omnivate indigo.
- `docs/design/UI-STANDARD.md` is the rule for new screens, including the full module index.

The company app and the control panel both import `@omnivate/ui` and `@omnivate/ui/styles.css`. They do not keep a second stylesheet for the old theme.

## Consequences

- A new screen uses the components in `docs/design/UI-STANDARD.md` instead of new one-off CSS.
- Tailwind can be revisited if a later app needs utility classes. It should not fork the components.
- Screenshots of the light UI are in `docs/screenshots/`, including the login page before this change.
