// `paseo daemon status --json` reports `relay` as a string: the literal
// "disabled" when no relay is configured, otherwise the public relay URL
// (e.g. "wss://relay.paseo.sh:443").
export function readRelayStatus(raw: unknown): { enabled: boolean | null; endpoints: string[] | null } {
  if (typeof raw !== "string") return { enabled: null, endpoints: null };
  const endpoint = raw.trim();
  if (endpoint === "" || endpoint === "disabled") return { enabled: false, endpoints: null };
  return { enabled: true, endpoints: [endpoint] };
}
