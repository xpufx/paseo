// Test fixture: registers a custom tool on the same McpServer instance.
export default function register(api) {
  api.registerTool(
    "x_comms_ext_echo",
    {
      title: "Extension echo",
      description: "Test-only tool registered by an extension.",
      inputSchema: {},
    },
    () => ({ content: [{ type: "text", text: "echo-from-extension" }] }),
  );
}
