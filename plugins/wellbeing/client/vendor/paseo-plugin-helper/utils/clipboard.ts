import type { HostToast } from "../host";
import { getOptionalClientHost } from "../host";

export interface CopyToClipboardOptions {
  toast?: HostToast;
  toastMessage?: string;
}

export type ClipboardTier = "navigator" | "host" | "rnAsync" | "rnSync" | "execCommand";

export interface ClipboardEnvironment {
  hasNavigatorClipboard: boolean;
  hasHostCopyText: boolean;
  hasRnClipboard: boolean;
  hasRnSetStringAsync: boolean;
  isDom: boolean;
}

/**
 * Deterministic tier order for an explicit copy.
 *
 * Web's `navigator.clipboard.writeText` is the only API that rejects when the
 * clipboard did not change, so it leads. The synchronous
 * `react-native-web` `Clipboard.setString` reports success even when its
 * `document.execCommand("copy")` fails, which leaves the previous clipboard
 * item in place while the UI claims success (xpufx-org/paseo#278); it is only
 * usable off-DOM (native), where it is the real platform clipboard. The same
 * applies to any `setStringAsync` whose DOM fallback is that unverified
 * `execCommand`. In a DOM the checked `execCommand` fallback is preferred to
 * those unverifiable paths.
 */
export function clipboardTierOrder(env: ClipboardEnvironment): ClipboardTier[] {
  const tiers: ClipboardTier[] = [];
  if (env.hasNavigatorClipboard) tiers.push("navigator");
  if (env.hasHostCopyText) tiers.push("host");
  // On a DOM both RN-web paths are unverifiable: `setString` reports success
  // even when its `execCommand` no-ops, and a `setStringAsync` that falls back
  // to it does the same. Off-DOM they are the real native clipboard, so they
  // lead there; on a DOM only the checked `execCommand` fallback is honest.
  const rnDomOk = !env.isDom;
  if (env.hasRnSetStringAsync && rnDomOk) {
    tiers.push("rnAsync");
  } else if (env.hasRnClipboard && rnDomOk) {
    tiers.push("rnSync");
  }
  tiers.push("execCommand");
  return tiers;
}

/**
 * Robust cross-platform clipboard copy helper for Paseo plugins.
 * Works seamlessly across React Native (mobile), web, and desktop.
 *
 * Tier order comes from `clipboardTierOrder`; every tier reports failure
 * honestly so a denied or blocked write never leaves the previous clipboard
 * item behind under a fake success.
 */
export async function copyToClipboard(
  text: string,
  options?: CopyToClipboardOptions,
): Promise<boolean> {
  if (text === null || text === undefined) return false;
  const str = String(text);

  const globalObj = typeof globalThis !== "undefined" ? (globalThis as any) : {};

  let rn: any;
  try {
    rn = require("react-native");
  } catch {
    // Ignore require error if not in RN context
  }
  const rnClipboard = rn?.Clipboard;
  const rnSetStringAsync =
    typeof rnClipboard?.setStringAsync === "function" ? rnClipboard.setStringAsync : undefined;
  const rnSetString =
    typeof rnClipboard?.setString === "function" ? rnClipboard.setString : undefined;
  const copyText = getOptionalClientHost()?.copyText;

  const isDom =
    typeof globalObj.document !== "undefined" &&
    typeof globalObj.document?.createElement === "function";

  const tiers = clipboardTierOrder({
    hasNavigatorClipboard: Boolean(globalObj.navigator?.clipboard?.writeText),
    hasHostCopyText: Boolean(copyText),
    hasRnClipboard: Boolean(rnSetStringAsync ?? rnSetString),
    hasRnSetStringAsync: Boolean(rnSetStringAsync),
    isDom,
  });

  let success = false;
  for (const tier of tiers) {
    if (success) break;
    try {
      switch (tier) {
        case "navigator":
          await globalObj.navigator.clipboard.writeText(str);
          success = true;
          break;
        case "host":
          if (copyText) {
            await copyText(str);
            success = true;
          }
          break;
        case "rnAsync":
          // Expo's async API returns a boolean; a rejected promise falls through.
          success = (await rnSetStringAsync(str)) !== false;
          break;
        case "rnSync":
          // Only reached off-DOM, where this is the native platform clipboard.
          rnSetString(str);
          success = true;
          break;
        case "execCommand": {
          const doc = globalObj.document;
          if (doc?.createElement && doc?.body) {
            const textarea = doc.createElement("textarea");
            textarea.value = str;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            textarea.style.left = "-9999px";
            doc.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const res = doc.execCommand("copy");
            doc.body.removeChild(textarea);
            success = res === true;
          }
          break;
        }
      }
    } catch {
      // Tier failed; try the next one.
    }
  }

  if (success && options?.toast) {
    try {
      const toastAny = options.toast as any;
      if (typeof toastAny.copied === "function") {
        toastAny.copied(options.toastMessage);
      } else if (typeof toastAny.show === "function") {
        const msg = options.toastMessage
          ? `Copied ${options.toastMessage} to clipboard`
          : "Copied to clipboard";
        toastAny.show(msg, { variant: "success" });
      }
    } catch {
      // Ignore toast failure
    }
  }

  return success;
}
