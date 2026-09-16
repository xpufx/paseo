// Test fixture: the good neighbour that must keep working next to a broken one.
export default function register(api) {
  api.onSend((message) => ({ ...message, prompt: `[GOOD] ${message.prompt}` }));
}
