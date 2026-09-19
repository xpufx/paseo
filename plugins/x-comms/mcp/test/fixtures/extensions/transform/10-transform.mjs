// Test fixture: exercises all three filters, using both the bare-return and the
// explicit { action: "transform" } result forms.
export default function register(api) {
  api.onToolCall((args, context) => {
    if (context.tool !== "x_comms_inspect") return undefined;
    return { ...args, agentId: `${args.agentId}-rewritten` };
  });

  api.onSend((message) => ({ ...message, prompt: `[EXT] ${message.prompt}` }));

  api.onReceive((data, context) => {
    if (context.tool !== "x_comms_inspect") return undefined;
    return { action: "transform", value: { ...data, extTag: "seen" } };
  });
}
