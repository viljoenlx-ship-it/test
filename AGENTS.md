# Agent notes

The product map is `docs/blueprint/`. Do not invent a second one.

## Build progress

`docs/progress/roadmap.json` is what the control panel Overview shows under Build Progress.

Update that file in every pull request:

- Add a row for the work, or change the row if it is already there.
- Set `status` to `in_progress`.
- Put this pull request's number in `prs`.
- `title` is Title Case. `description` is one plain sentence.
- `phase` is one of: Phase 1 MVP, Phase 1b, Tier 1 Kernel, Tier 2 Commercial Core, Tier 3 Operational, Tier 4 Back-Office.

Leave `status` as `in_progress` while the pull request is open. After it merges, Overview marks the row Done and shows the merge date from GitHub. You do not have to edit the file again for that.

An open pull request with no row still shows under In Progress, using the pull request title. Add the row so the description and phase are right.

Demo data stays fictional. Do not put real client names in the roadmap or in tests.

## User interface

All new UI uses `@omnivate/ui` and follows `docs/design/UI-STANDARD.md`. Do not add a one-off stylesheet or a second visual style. The company app and the control panel share that standard.

The company app does not show Build Progress, module codes, or notes that something is unfinished. A module that has no screen yet opens its overview. A module that is switched off stays in the sidebar and does not open. The index is `moduleIndex()` in `@omnivate/shared`.

Every new screen must be checked at 390px width. The phone layout is its own shell, in the Mobile section of `docs/design/UI-STANDARD.md`.
