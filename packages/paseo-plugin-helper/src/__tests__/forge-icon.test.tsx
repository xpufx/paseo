import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Image } from "react-native";
import { initClientHelpers } from "../client/host.js";
import { ForgeIcon } from "../client/forge-icon.js";
import {
  forgeKindFromHost,
  isForgeKind,
  normalizeForgeHost,
  resolveForgeMark,
} from "../shared/forge.js";

let hostIcons: Array<Record<string, unknown>> = [];

beforeEach(() => {
  hostIcons = [];
  initClientHelpers({
    Icon: ((props: Record<string, unknown>) => {
      hostIcons.push(props);
      return null;
    }) as never,
    Modal: (() => null) as never,
    useRpc: (() => () => Promise.resolve(null)) as never,
    useToast: (() => ({})) as never,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("forge host normalization", () => {
  it("strips scheme, userinfo, port, path and www", () => {
    expect(normalizeForgeHost("https://WWW.GitHub.com:443/x/y.git")).toBe("github.com");
    expect(normalizeForgeHost("git@codeberg.org:owner/repo.git")).toBe("codeberg.org");
    expect(normalizeForgeHost("  forgejo.org.  ")).toBe("forgejo.org");
    expect(normalizeForgeHost("ssh://git@gitea.com:222/owner/repo")).toBe("gitea.com");
  });

  it("returns null for empty or non-string input", () => {
    expect(normalizeForgeHost(null)).toBeNull();
    expect(normalizeForgeHost(undefined)).toBeNull();
    expect(normalizeForgeHost("   ")).toBeNull();
  });
});

describe("forgeKindFromHost", () => {
  it("maps the known forge hosts", () => {
    expect(forgeKindFromHost("github.com")).toBe("github");
    expect(forgeKindFromHost("gitlab.com")).toBe("gitlab");
    expect(forgeKindFromHost("codeberg.org")).toBe("codeberg");
    expect(forgeKindFromHost("forgejo.org")).toBe("forgejo");
    expect(forgeKindFromHost("gitea.com")).toBe("gitea");
    expect(forgeKindFromHost("gitea.io")).toBe("gitea");
  });

  it("recognises self-hosted instances that carry the project name", () => {
    expect(forgeKindFromHost("forgejo.example.test")).toBe("forgejo");
    expect(forgeKindFromHost("git.example-gitea.test")).toBe("gitea");
  });

  it("falls back to generic for unknown hosts", () => {
    expect(forgeKindFromHost("forge.mrs.aager.de")).toBe("generic");
    expect(forgeKindFromHost("example.test")).toBe("generic");
    expect(forgeKindFromHost(null)).toBe("generic");
    expect(forgeKindFromHost("")).toBe("generic");
  });
});

describe("resolveForgeMark", () => {
  it("resolves GitHub and GitLab to Lucide marks", () => {
    const github = resolveForgeMark("github.com");
    expect(github).toMatchObject({ kind: "github", label: "GitHub", lucideName: "Github", custom: false });
    const gitlab = resolveForgeMark("gitlab.com");
    expect(gitlab).toMatchObject({ kind: "gitlab", label: "GitLab", lucideName: "Gitlab", custom: false });
  });

  it("resolves Codeberg/Forgejo/Gitea to custom marks", () => {
    expect(resolveForgeMark("codeberg.org")).toMatchObject({ kind: "codeberg", custom: true });
    expect(resolveForgeMark("forgejo.org")).toMatchObject({ kind: "forgejo", custom: true });
    expect(resolveForgeMark("gitea.com")).toMatchObject({ kind: "gitea", custom: true });
  });

  it("resolves an unknown host to the generic fallback", () => {
    expect(resolveForgeMark("forge.mrs.aager.de")).toMatchObject({
      kind: "generic",
      lucideName: "Globe",
      custom: false,
    });
  });

  it("lets an explicit kind win over the host and ignores unknown kinds", () => {
    expect(resolveForgeMark({ host: "github.com", kind: "forgejo" }).kind).toBe("forgejo");
    expect(resolveForgeMark({ host: "codeberg.org", kind: "  GITEA " }).kind).toBe("gitea");
    expect(resolveForgeMark({ host: "codeberg.org", kind: "bogus" }).kind).toBe("codeberg");
  });

  it("accepts null/undefined input", () => {
    expect(resolveForgeMark(undefined).kind).toBe("generic");
    expect(resolveForgeMark(null).kind).toBe("generic");
  });

  it("isForgeKind narrows only known kinds", () => {
    expect(isForgeKind("codeberg")).toBe(true);
    expect(isForgeKind("generic")).toBe(true);
    expect(isForgeKind("GitHub")).toBe(false);
    expect(isForgeKind(3)).toBe(false);
  });
});

function render(mark: React.ReactElement) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(mark);
  });
  return renderer!;
}

describe("ForgeIcon", () => {
  it("delegates GitHub/GitLab/unknown to the host Lucide icon set", () => {
    render(React.createElement(ForgeIcon, { host: "github.com" }));
    render(React.createElement(ForgeIcon, { host: "gitlab.com" }));
    render(React.createElement(ForgeIcon, { host: "forge.mrs.aager.de" }));
    expect(hostIcons.map((p) => p.name)).toEqual(["Github", "Gitlab", "Globe"]);
  });

  it("passes size and color through to the host icon", () => {
    render(React.createElement(ForgeIcon, { host: "github.com", size: 22, color: "#ff0000" }));
    expect(hostIcons[0]).toMatchObject({ name: "Github", size: 22, color: "#ff0000" });
  });

  it("draws an inline SVG mark for Codeberg on web", () => {
    const renderer = render(React.createElement(ForgeIcon, { host: "codeberg.org", size: 20 }));
    const image = renderer.root.findByType(Image);
    const uri = String((image.props.source as { uri: string }).uri);
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(uri)).toContain("<path fill=");
    expect(image.props.style).toEqual([{ width: 20, height: 20 }, undefined]);
    expect(image.props.accessibilityLabel).toBe("Codeberg");
    expect(hostIcons).toHaveLength(0);
  });

  it("draws distinct marks for Forgejo and Gitea", () => {
    const forgejo = String(
      (render(React.createElement(ForgeIcon, { host: "forgejo.org" })).root.findByType(Image).props
        .source as { uri: string }).uri,
    );
    const gitea = String(
      (render(React.createElement(ForgeIcon, { host: "gitea.com" })).root.findByType(Image).props
        .source as { uri: string }).uri,
    );
    expect(forgejo).not.toBe(gitea);
  });

  it("honours an explicit kind over the host", () => {
    const renderer = render(
      React.createElement(ForgeIcon, { host: "forge.mrs.aager.de", kind: "gitea" }),
    );
    expect(renderer.root.findByType(Image).props.accessibilityLabel).toBe("Gitea");
  });
});
