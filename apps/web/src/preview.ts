/** True only for the hosted preview build. Local `pnpm dev` leaves this unset. */
export function isPreviewBuild(): boolean {
  return import.meta.env.VITE_PREVIEW === 'true';
}

/** Sample sign-in hints for local development and the hosted preview. */
export function showDemoHints(): boolean {
  return import.meta.env.DEV || isPreviewBuild();
}
