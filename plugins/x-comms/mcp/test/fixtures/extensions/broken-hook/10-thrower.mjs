// Test fixture: throws at call time, so the runner must isolate it and pass through.
export default function register(api) {
  api.onSend(() => {
    throw new Error("fixture hook failure");
  });
}
