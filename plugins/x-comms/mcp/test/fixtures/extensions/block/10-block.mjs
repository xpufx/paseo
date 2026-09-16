// Test fixture: a hook that blocks with a reason.
export default function register(api) {
  api.onSend(() => ({ action: "block", reason: "blocked by fixture" }));
}
