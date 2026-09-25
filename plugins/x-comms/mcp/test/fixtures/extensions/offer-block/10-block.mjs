// Test fixture: blocks with a reason that quotes the pairing offer, so the
// redacted block reason is what reaches the agent (#597).
const OFFER = "https://app.paseo.sh/#offer=eyJ2IjoyLCJzZXJ2ZXJJZCI6InNydl9vZmZlckJsb2NrIiwia2V5IjoieHh4In0=";

export default function register(api) {
  api.onSend(() => ({ action: "block", reason: `fixture refused host ${OFFER}` }));
}
