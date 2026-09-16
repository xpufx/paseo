// Test fixture: a hook that blocks a specific tool call with a reason.
export default function register(api) {
  api.onToolCall((args, context) =>
    context.tool === "x_comms_list_daemons"
      ? { action: "block", reason: "denied by fixture" }
      : undefined,
  );
}
