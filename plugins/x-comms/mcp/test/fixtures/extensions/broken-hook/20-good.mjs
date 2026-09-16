// Test fixture: the good neighbour that must still transform after a throwing hook.
export default function register(api) {
  api.onSend((message) => ({ ...message, prompt: `[GOOD] ${message.prompt}` }));
}
