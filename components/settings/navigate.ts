/** Full navigation, so a deleted session and anon cookie are dropped from all client state. */
export function navigate(url: string): void {
  window.location.assign(url);
}
