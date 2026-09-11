import React, { useState, type ReactNode } from "react";
import {
  Image,
  Linking,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { getClientHost } from "../host.js";
import { usePluginTheme } from "../theme/provider.js";
import { useResponsive } from "../theme/useResponsive.js";
import { Card } from "./Card.js";
import { Badge } from "./Badge.js";
import { Button } from "./Button.js";
import { KeyValue, KeyValueGroup } from "./KeyValue.js";
import { copyToClipboard } from "../utils/clipboard.js";
import { triggerHaptic } from "../utils/haptics.js";

export interface AboutLink {
  label: string;
  url: string;
  icon?: string;
}

export interface AboutSectionProps {
  /**
   * Name of the plugin.
   */
  name: string;

  /**
   * Short description or tagline.
   */
  description?: string;

  /**
   * Semantic version string (e.g. from `PLUGIN_VERSION` or package.json).
   */
  version: string;

  /**
   * Author or organization name.
   */
  author?: string;

  /**
   * Logo or icon to display.
   * - A React Native image source object: `{ uri: "https://..." }` or `require("./assets/logo.png")`
   * - A string starting with "http" (e.g. avatar/logo URL)
   * - A Paseo Lucide icon name (e.g. "Cpu", "Layers", "Sparkles")
   * - If omitted and `repository` or `author` is a GitHub link/username, defaults to the GitHub avatar!
   */
  logo?: ImageSourcePropType | string;

  /**
   * Repository URL (e.g. "https://github.com/xpufx/paseo-top").
   */
  repository?: string;

  /**
   * Issue tracker URL (e.g. "https://github.com/xpufx/paseo-top/issues").
   */
  issues?: string;

  /**
   * Documentation website or wiki URL.
   */
  homepage?: string;

  /**
   * License identifier (e.g. "MIT", "Apache-2.0").
   */
  license?: string;

  /**
   * Custom additional links.
   */
  links?: AboutLink[];

  /**
   * Extra diagnostic or environmental items to display in the details section.
   */
  extraItems?: Array<{
    label: string;
    value: string;
    subValue?: string;
    copyable?: boolean;
  }>;

  /**
   * Whether to display the "Copy Diagnostics" button. Default: true.
   */
  showDiagnosticsCopy?: boolean;

  /**
   * Optional custom container style.
   */
  style?: StyleProp<ViewStyle>;
}

/**
 * Extracts a GitHub owner/organization from a repository URL or author name.
 */
function resolveGitHubAvatarUrl(repo?: string, author?: string): string | null {
  if (repo) {
    const match = repo.match(/github\.com[/:]([a-zA-Z0-9_-]+)/);
    if (match?.[1]) {
      return `https://github.com/${match[1]}.png?size=128`;
    }
  }
  if (author && !author.includes(" ") && !author.includes("@")) {
    return `https://github.com/${author}.png?size=128`;
  }
  return null;
}

/**
 * `<AboutSection>` provides a standardized, responsive plugin information and diagnostics view.
 * 
 * Features:
 * - Displays plugin branding, author, description, version, and license badges.
 * - Supports custom logo images, local asset requires, Lucide icons, or auto-resolved GitHub avatars.
 * - One-click "Copy Diagnostics" button formatting system info for GitHub issue triage.
 * - Pre-styled external links with native browser launch via React Native `Linking`.
 */
export function AboutSection({
  name,
  description,
  version,
  author,
  logo,
  repository,
  issues,
  homepage,
  license = "MIT",
  links = [],
  extraItems = [],
  showDiagnosticsCopy = true,
  style,
}: AboutSectionProps) {
  const { Icon } = getClientHost();
  const { colors, resolveRadius } = usePluginTheme();
  const { isCompact, platform } = useResponsive();
  const [copied, setCopied] = useState(false);

  // 1. Resolve Logo / Avatar
  let resolvedLogoNode: ReactNode = null;
  const radius = resolveRadius("md");

  if (logo) {
    if (typeof logo === "string") {
      if (logo.startsWith("http://") || logo.startsWith("https://")) {
        resolvedLogoNode = (
          <Image
            source={{ uri: logo }}
            style={[styles.logoImage, { borderRadius: radius }]}
          />
        );
      } else {
        resolvedLogoNode = (
          <View
            style={[
              styles.logoIconFallback,
              {
                backgroundColor: colors.surface2,
                borderRadius: radius,
                borderColor: colors.border,
              },
            ]}
          >
            <Icon name={logo} size={26} color={colors.accent} />
          </View>
        );
      }
    } else {
      resolvedLogoNode = (
        <Image
          source={logo}
          style={[styles.logoImage, { borderRadius: radius }]}
        />
      );
    }
  } else {
    // Attempt automatic GitHub avatar resolution
    const githubAvatar = resolveGitHubAvatarUrl(repository, author);
    if (githubAvatar) {
      resolvedLogoNode = (
        <Image
          source={{ uri: githubAvatar }}
          style={[styles.logoImage, { borderRadius: radius }]}
        />
      );
    } else {
      resolvedLogoNode = (
        <View
          style={[
            styles.logoIconFallback,
            {
              backgroundColor: colors.surface2,
              borderRadius: radius,
              borderColor: colors.border,
            },
          ]}
        >
          <Icon name="Layers" size={26} color={colors.accent} />
        </View>
      );
    }
  }

  // 2. Open URL helper
  const handleOpenUrl = async (url: string) => {
    try {
      triggerHaptic("light");
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      }
    } catch {
      // Ignore linking errors
    }
  };

  // 3. Diagnostics copy helper
  const handleCopyDiagnostics = async () => {
    triggerHaptic("success");
    const lines = [
      `Plugin: ${name} v${version}`,
      author ? `Author: ${author}` : null,
      `License: ${license}`,
      `Platform: ${platform} (${isCompact ? "compact" : "regular"})`,
      repository ? `Repository: ${repository}` : null,
      ...extraItems.map((item) => `${item.label}: ${item.value}`),
    ].filter(Boolean);

    await copyToClipboard(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // 4. Assemble external links
  const allLinks: AboutLink[] = [
    ...(repository ? [{ label: "Repository", url: repository, icon: "ExternalLink" }] : []),
    ...(issues ? [{ label: "Report Issue", url: issues, icon: "Bug" }] : []),
    ...(homepage ? [{ label: "Documentation", url: homepage, icon: "BookOpen" }] : []),
    ...links,
  ];

  return (
    <View style={[styles.container, style]}>
      {/* Header Banner Card */}
      <Card variant="elevated">
        <Card.Header
          title={name}
          subtitle={description}
          badge={<Badge variant="accent" label={`v${version}`} />}
        />
        <View style={styles.headerRow}>
          {resolvedLogoNode}

          <View style={styles.metaColumn}>
            {author ? (
              <Text style={[styles.authorText, { color: colors.foregroundMuted }]}>
                by {author}
              </Text>
            ) : null}

            {license ? (
              <View style={styles.titleRow}>
                <Badge variant="neutral" label={license} />
              </View>
            ) : null}
          </View>
        </View>

        {/* Action Buttons: External Links & Diagnostics */}
        <View style={styles.actionsRow}>
          {allLinks.map((link) => (
            <Button
              key={link.url}
              size="sm"
              variant="secondary"
              icon={link.icon ?? "ExternalLink"}
              label={link.label}
              onPress={() => handleOpenUrl(link.url)}
            />
          ))}

          {showDiagnosticsCopy && (
            <Button
              size="sm"
              variant={copied ? "primary" : "ghost"}
              icon={copied ? "Check" : "Copy"}
              label={copied ? "Diagnostics Copied!" : "Copy Diagnostics"}
              onPress={handleCopyDiagnostics}
            />
          )}
        </View>
      </Card>

      {/* Environment & Extra Diagnostics Details */}
      <Card variant="elevated">
        <Card.Header
          title="Runtime Environment"
          subtitle="Diagnostics for issue reports and system verification"
        />
        <KeyValueGroup columns={isCompact ? 1 : 2}>
          <KeyValue label="Plugin Version" value={`v${version}`} copyable />
          <KeyValue label="Client Platform" value={platform} />
          {author ? <KeyValue label="Author" value={author} /> : null}
          {license ? <KeyValue label="License" value={license} /> : null}
          {extraItems.map((item, idx) => (
            <KeyValue
              key={idx}
              label={item.label}
              value={item.value}
              subValue={item.subValue}
              copyable={item.copyable}
            />
          ))}
        </KeyValueGroup>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  logoImage: {
    width: 48,
    height: 48,
    resizeMode: "cover",
  },
  logoIconFallback: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  metaColumn: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  authorText: {
    fontSize: 11,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128, 128, 128, 0.2)",
  },
});
