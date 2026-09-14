import React from "react";
import { getClientHost, type HostIconProps } from "./host.js";

let knownIconNames: Set<string> | undefined;
const warnedIconNames = new Set<string>();

/**
 * Optionally registers the set of valid icon names (e.g. Lucide names
 * supported by the host). When set, Icon warns once per unknown name
 * instead of rendering nothing silently.
 */
export function setKnownIconNames(names: Iterable<string>): void {
  knownIconNames = new Set(names);
}

export function clearKnownIconNames(): void {
  knownIconNames = undefined;
  warnedIconNames.clear();
}

export function reportUnknownIcon(name: string): void {
  const key = name.trim();
  if (warnedIconNames.has(key)) return;
  warnedIconNames.add(key);
  console.warn(
    `[paseo-plugin-helper Icon] unknown icon name "${name}" — renders nothing; check the Lucide name`,
  );
}

export function Icon(props: HostIconProps) {
  const rawName = typeof props.name === "string" ? props.name : "";
  if (!rawName.trim()) {
    reportUnknownIcon(String(props.name));
  } else if (knownIconNames && !knownIconNames.has(rawName.trim())) {
    reportUnknownIcon(rawName);
  }
  const { Icon: HostIconComponent } = getClientHost();
  return <HostIconComponent {...props} />;
}
