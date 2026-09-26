/**
 * The diagnostic for a registry-name miss (#672).
 *
 * This is not a pairing requirement. `validateDaemonHost` accepts a relay offer
 * *or* a direct `--host` — tcp://, unix://, pipe://, an absolute path, a bare
 * port, host:port — so the caller has usually misspelled a name or referenced a
 * host they never registered. Saying "pairing is required" sent them into a
 * relay/E2EE setup for what is a registry lookup, and one variant even told them
 * to use `x_comms_add_daemon`, which *is* the non-pairing route.
 *
 * It names both registration routes, in the order the plain reading suggests:
 * a direct host needs no pairing at all.
 *
 * Kept dependency-free on purpose — `handlers.ts` pulls in the vendored helper,
 * whose TypeScript parameter properties Node's strip-only loader cannot parse, so
 * a test could not import the diagnostic from there.
 */
export const UNKNOWN_DAEMON_HINT =
  "no registry entry for that name: register a direct host (host:port, tcp://…, unix://…, bare port) " +
  "via x_comms_add_daemon, or a relay pairing offer from `paseo daemon pair`; " +
  "list the registered names with x_comms_list_daemons";

export function unknownDaemonMessage(name: string): string {
  return `unknown daemon '${name}' — ${UNKNOWN_DAEMON_HINT}`;
}
