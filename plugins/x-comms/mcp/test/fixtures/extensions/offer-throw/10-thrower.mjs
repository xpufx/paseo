// Test fixture: a hook whose thrown message quotes the pairing offer, so the
// extension log line is redacted before it reaches the server log (#597).
const OFFER = "https://app.paseo.sh/#offer=eyJ2IjoyLCJzZXJ2ZXJJZCI6InNydl9vZmZlcnRocm93Iiwia2V5IjoieHh4In0=";

export default function register(api) {
  api.onSend(() => {
    throw new Error(`fixture hook failure for ${OFFER}`);
  });
}
