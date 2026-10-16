export function detectPlatform(): { os: string; arch: string; exe?: boolean };
export function fetchBuffer(url: string): Promise<Buffer>;
export function verifySha256(data: Buffer, expectedHash: string): string;
export function parseChecksumManifest(manifestText: string, filename: string): string;
export function resolveCompanionBinDir(options?: { binDir?: string }): string;
export function installCompanion(options?: {
  binDir?: string;
  force?: boolean;
  version?: string;
  baseUrl?: string;
  log?: (msg: string) => void;
}): Promise<{ binPath: string; status: string; version: string }>;
export function resolvePaseoHome(env?: NodeJS.ProcessEnv): string;
