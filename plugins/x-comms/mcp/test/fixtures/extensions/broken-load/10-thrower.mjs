// Test fixture: throws during register(), so the loader must skip it.
export default function register() {
  throw new Error("fixture load failure");
}
