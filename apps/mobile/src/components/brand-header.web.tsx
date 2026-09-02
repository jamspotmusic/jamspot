/**
 * On the Expo web build the floating nav bar in app-tabs.web.tsx already
 * carries the JAMSPOT mark and both destinations — the same composition
 * apps/web's sticky header has — so the per-screen brand header would be a
 * second copy of it directly underneath. Native has no such bar (the tabs
 * sit at the bottom), which is why this only stands down on web.
 */
export function BrandHeader(_props: { children?: React.ReactNode }) {
  return null;
}
