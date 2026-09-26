/**
 * Tool-facing view of a daemon's target value (#606).
 *
 * A relay target carries its pairing offer after `#offer=`, and that offer is a
 * control token: it authenticates a dial to that peer. Returning it in a normal
 * tool result hands the token to any agent that can call the tool, including an
 * agent for whom the offer was never in context — an operator who hand-edited
 * registry.json, or added the daemon from another session, never put it there.
 *
 * Only the offer token is removed. The URL around it stays, so a result still
 * says *which* relay this is and whether it is reachable, and a direct
 * tcp://host:port target is returned untouched because it contains no token.
 *
 * This lives in its own module rather than in the server bin because the bin
 * starts a server on import, which makes it untestable in-process.
 */

/** The marker the redacted offer is replaced with. */
export const REDACTED_OFFER = "[REDACTED]";

/**
 * Keyed on `#offer=` alone rather than reusing redact.mjs: that helper matches
 * `https://app.paseo.sh/#offer=` specifically, while validateDaemonHost accepts
 * a pairing URL on any https host. Keying on the host would pass every
 * self-hosted relay straight through — the case most likely to be a private
 * deployment. `includes("#offer=")` is the same test the rest of the plugin
 * uses to classify a value as a relay offer.
 */
export function redactDaemonTarget(value) {
  const raw = String(value ?? "");
  const idx = raw.indexOf("#offer=");
  if (idx === -1) return raw;
  // Everything from the marker onwards goes, so a trailing path cannot smuggle
  // the token past a match that only covered part of it.
  return `${raw.slice(0, idx)}#offer=${REDACTED_OFFER}`;
}
