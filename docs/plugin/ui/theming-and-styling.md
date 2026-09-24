# Theming, Design Tokens & Custom Themes

> Design system tokens, responsive density, the `paseo-plugin-helper` Visual Flair engine, and contributing custom themes to Paseo.
>
> **References**:
> - [Upstream Theme and Layout Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#theme-and-layout)
> - [Upstream Contribute a Theme Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#contribute-a-theme)
> - [Catppuccin Theme Example](file:///home/xpufx/code/3rdparty/paseo/paseo/plugin-examples/catppuccin)

---

## Table of Contents

1. [Paseo Color Tokens (`theme.colors`)](#1-paseo-color-tokens)
2. [Tokens Over Literals Rule](#2-tokens-over-literals-rule)
3. [Responsive Layout & Density (`layout.compact`)](#3-responsive-layout--density)
4. [Helper Visual Flair System (`VisualFlair`)](#4-helper-visual-flair-system)
5. [Elevation & Spacing Tokens](#5-elevation--spacing-tokens)
6. [Contributing Custom Themes (`addTheme`)](#6-contributing-custom-themes)

---

## 1. Paseo Color Tokens

Paseo maps every active theme into a strongly-typed `PluginTheme.colors` token dictionary. Always bind styles to these tokens:

| Token Category | Token Keys | Purpose |
| :--- | :--- | :--- |
| **Surfaces** | `background`, `surface0`, `surface1`, `surface2`, `surface3` | Nested card, modal, and pane backgrounds. |
| **Borders** | `border`, `borderMuted` | Dividers, card boundaries, and input borders. |
| **Typography** | `foreground`, `foregroundMuted`, `foregroundSubtle` | Primary text, secondary labels, and faint helper notes. |
| **Brand Accent** | `accent`, `accentForeground`, `accentMuted` | Call-to-action buttons, active tab indicators, focus rings. |
| **State: Success** | `success`, `successForeground`, `successMuted` | Passing tests, completed tasks, green badges. |
| **State: Warning** | `warning`, `warningForeground`, `warningMuted` | Cautionary notices, pending actions, amber badges. |
| **State: Error** | `error`, `errorForeground`, `errorMuted` | Failures, crashed processes, red badges. |
| **Selection & Focus**| `selection`, `selectionForeground`, `ring` | Active row selections and keyboard focus halos. |

---

## 2. Tokens Over Literals Rule

> [!WARNING]
> **Never use literal hex colors** like `#fff` or `#111` in plugin styles.
> Unstyled text defaults to black in React Native, which becomes completely invisible in Paseo’s dark themes.

```tsx
// Anti-pattern (breaks in dark mode):
<Text style={{ color: "#333333" }}>System Ready</Text>

// Correct:
<Text style={{ color: theme.colors.foreground }}>System Ready</Text>
```

---

## 3. Responsive Layout & Density (`layout.compact`)

The `layout` prop provided to surfaces and panels reflects viewport width:
- **`layout.compact === true`**: Phone displays or narrow desktop sidebar panes (< 600px width).
- **`layout.compact === false`**: Wide desktop screens.

### Design Conventions:
```tsx
const styles = useMemo(
  () => ({
    container: {
      padding: layout.compact ? 12 : 24,
      gap: layout.compact ? 8 : 16,
    },
    title: {
      fontSize: layout.compact ? 18 : 22,
    },
  }),
  [layout.compact],
);
```

---

## 4. Helper Visual Flair System

`paseo-plugin-helper/client` introduces `VisualFlair`, enabling authors to customize component corners and spacing without breaking theme consistency:

```tsx
export interface VisualFlair {
  radius?: "sharp" | "rounded" | "pill"; // 0px, 8px, or fully rounded
  density?: "compact" | "comfortable" | "spacious";
  accentColor?: string; // Optional custom brand accent override
}
```

### Accessing Flair via `usePluginTheme()`
```tsx
import { usePluginTheme } from "paseo-plugin-helper/client";
import { View } from "react-native";

function CustomBadge() {
  const { colors, resolveRadius, isCompact } = usePluginTheme();

  return (
    <View
      style={{
        backgroundColor: colors.surface1,
        borderRadius: resolveRadius(6), // Scales with current flair setting
        padding: isCompact ? 4 : 8,
      }}
    />
  );
}
```

---

## 5. Elevation & Spacing Tokens

Helper components share unified spacing and shadow scales:

```tsx
import { spacing, resolveElevation } from "paseo-plugin-helper/client";

// Spacing rungs:
// spacing.xxs = 2
// spacing.xs  = 4
// spacing.sm  = 8
// spacing.md  = 12
// spacing.lg  = 16
// spacing.xl  = 24

const cardStyle = {
  padding: spacing.md,
  gap: spacing.sm,
  ...resolveElevation("sm"), // Cross-platform shadow and elevation
};
```

---

## 6. Contributing Custom Themes

A plugin can contribute light or dark themes to Paseo via `client.addTheme`:

```tsx
// index.client.tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";

export default function contribute(client: PluginClientContext) {
  client.addTheme({
    id: "nordic-night",
    name: "Nordic Night",
    appearance: "dark",
    colors: {
      background: "#2e3440",
      foreground: "#eceff4",
      raised: "#3b4252",
      control: "#434c5e",
      border: "#4c566a",
      accent: "#88c0d0",
      mutedForeground: "#d8dee9",
      ring: "#81a1c1",
    },
  });

  return () => {};
}
```

### Architecture Notes:
1. **Unistyles Integration**: Paseo pre-allocates one light and one dark plugin theme slot in its Unistyles stylesheet runtime (`packages/app/src/styles/theme.ts`). Selecting a plugin theme dynamically rewrites the slot values without a full app reboot.
2. **Settings**: Contributed themes appear immediately in Paseo under **Settings → Appearance**.
3. **Multi-Host Persistence**: Theme selection persists as `theme: "plugin"` and `pluginThemeId: "<pluginId>/theme/<themeId>"`.
