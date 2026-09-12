import React8, { createContext, useMemo, useContext, useRef, useEffect, useState, useCallback } from 'react';
import { StyleSheet, Appearance, Animated, View, Pressable, ActivityIndicator, Text, ScrollView, Platform, TextInput as TextInput$1, Image, RefreshControl, Linking, Easing } from 'react-native';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/client/theme/flair.ts
var defaultFlair = {
  radius: "rounded",
  density: "comfortable",
  surfaceStyle: "flat",
  borderWidth: 1,
  headingTransform: "none"
};
function resolveRadius(radius, size = "md") {
  if (size === "pill" || radius === "pill") return 9999;
  if (radius === "sharp") {
    switch (size) {
      case "xs":
        return 1;
      case "sm":
        return 2;
      case "md":
        return 3;
      case "lg":
        return 4;
    }
  }
  switch (size) {
    case "xs":
      return 4;
    case "sm":
      return 6;
    case "md":
      return 8;
    case "lg":
      return 12;
  }
}

// src/client/theme/color-utils.ts
function alpha(color, opacity) {
  if (!color) return `rgba(0, 0, 0, ${opacity})`;
  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  if (color.startsWith("#")) {
    let cleanHex = color.replace("#", "");
    if (cleanHex.length === 3) {
      cleanHex = cleanHex.split("").map((c) => c + c).join("");
    } else if (cleanHex.length === 4) {
      cleanHex = cleanHex.slice(0, 3).split("").map((c) => c + c).join("");
    } else if (cleanHex.length === 8) {
      cleanHex = cleanHex.slice(0, 6);
    }
    const alphaHex = Math.round(clampedOpacity * 255).toString(16).padStart(2, "0");
    return `#${cleanHex}${alphaHex}`;
  }
  if (color.startsWith("rgb")) {
    const parts = color.replace(/[^\d,.]/g, "").split(",");
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${clampedOpacity})`;
    }
  }
  return color;
}
function getLuminance(hexColor) {
  let hex = hexColor.replace("#", "");
  if (hex.length === 3) {
    hex = hex.split("").map((c) => c + c).join("");
  }
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}
function getContrastColor(bgHex, lightText = "#ffffff", darkText = "#0f172a") {
  try {
    const lum = getLuminance(bgHex);
    return lum > 0.45 ? darkText : lightText;
  } catch {
    return lightText;
  }
}
function getStatusColor(variant, colors, customAccent) {
  const accent = customAccent || colors.accent;
  switch (variant) {
    case "success":
      return colors.statusSuccess;
    case "warning":
      return colors.statusWarning;
    case "danger":
      return colors.statusDanger;
    case "accent":
      return accent;
    case "info":
      return colors.accent;
    case "neutral":
    default:
      return colors.foregroundMuted;
  }
}
function getVariantPalette(variant, colors, customAccent) {
  const base = getStatusColor(variant, colors, customAccent);
  return {
    bg: alpha(base, 0.12),
    text: base,
    border: alpha(base, 0.3)
  };
}

// src/client/theme/responsive.ts
function isMobilePlatform(platform) {
  return platform === "ios" || platform === "android";
}
function getTouchTargetMin(layout) {
  return layout.compact || isMobilePlatform(layout.platform) ? 44 : 28;
}
function responsiveValue(layout, desktopVal, compactVal) {
  return layout.compact ? compactVal : desktopVal;
}
function resolvePadding(layout, density) {
  const isCompact = layout.compact;
  switch (density) {
    case "compact":
      return {
        horizontal: isCompact ? 10 : 12,
        vertical: isCompact ? 6 : 8,
        gap: isCompact ? 6 : 8
      };
    case "spacious":
      return {
        horizontal: isCompact ? 16 : 24,
        vertical: isCompact ? 14 : 20,
        gap: isCompact ? 12 : 16
      };
    case "comfortable":
    default:
      return {
        horizontal: isCompact ? 12 : 16,
        vertical: isCompact ? 10 : 14,
        gap: isCompact ? 8 : 12
      };
  }
}
function responsiveSelect(layout, options) {
  const isMobile = isMobilePlatform(layout.platform);
  const isCompact = Boolean(layout.compact);
  if (options.platform && layout.platform in options.platform) {
    const val = options.platform[layout.platform];
    if (val !== void 0) return val;
  }
  if (isMobile && options.mobile !== void 0) {
    return options.mobile;
  }
  if (isCompact && options.compact !== void 0) {
    return options.compact;
  }
  if (!isCompact && options.wide !== void 0) {
    return options.wide;
  }
  if (options.desktop !== void 0) {
    return options.desktop;
  }
  if (options.wide !== void 0) return options.wide;
  if (options.compact !== void 0) return options.compact;
  if (options.mobile !== void 0) return options.mobile;
  return void 0;
}

// src/client/theme/tokens.ts
var spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24
};
var FALLBACK_ACCENT_FOREGROUND = "#ffffff";
function resolveElevation(level) {
  switch (level) {
    case "none":
      return {
        shadowColor: "#000",
        shadowOpacity: 0,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: 0
      };
    case "sm":
      return {
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1
      };
    case "lg":
      return {
        shadowColor: "#000",
        shadowOpacity: 0.24,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4
      };
    case "md":
    default:
      return {
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2
      };
  }
}
function elevationForPlatform(level, platform) {
  const style = resolveElevation(level);
  if (platform !== "android") {
    return { ...style, elevation: 0 };
  }
  return style;
}

// src/client/theme/host-variables.ts
var PASEO_HOST_CSS_VARIABLES = {
  "--background": "surface0",
  "--foreground": "foreground",
  "--muted": "foregroundMuted",
  "--accent": "accent",
  "--accent-foreground": "accentForeground",
  "--border": "border"
};
var HOST_FONT_VARIABLES = {
  sans: ["--font-sans", "--font-family"],
  mono: ["--font-mono", "--font-family-monospace"]
};
function readVariable(names) {
  const runtime = globalThis;
  const doc = runtime.document;
  if (!doc?.documentElement) return void 0;
  const getStyle = runtime.getComputedStyle ?? doc.defaultView?.getComputedStyle.bind(doc.defaultView);
  if (!getStyle) return void 0;
  try {
    const computed = getStyle(doc.documentElement);
    for (const name of names) {
      const value = computed.getPropertyValue(name).trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  } catch {
  }
  return void 0;
}
function readHostThemeVariables() {
  const colors = {};
  for (const [variable, slot] of Object.entries(PASEO_HOST_CSS_VARIABLES)) {
    const value = readVariable([variable]);
    if (value) {
      colors[slot] = value;
    }
  }
  const fonts = {};
  const sans = readVariable(HOST_FONT_VARIABLES.sans);
  if (sans) fonts.sans = sans;
  const mono = readVariable(HOST_FONT_VARIABLES.mono);
  if (mono) fonts.mono = mono;
  return { colors, fonts };
}
function definedValues(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== void 0) {
      out[key] = value;
    }
  }
  return out;
}
function mergeThemeColors(defaults, hostVariables, injected, accentOverride) {
  return {
    ...defaults,
    ...definedValues(hostVariables),
    ...definedValues(injected),
    ...accentOverride ? { accent: accentOverride } : {}
  };
}
var defaultLayout = {
  compact: false,
  platform: "web"
};
var defaultDarkTheme = {
  colors: {
    surface0: "#18181b",
    surface1: "#27272a",
    surface2: "#3f3f46",
    border: "#3f3f46",
    foreground: "#fafafa",
    foregroundMuted: "#a1a1aa",
    accent: "#3b82f6",
    accentForeground: "#ffffff",
    statusSuccess: "#22c55e",
    statusWarning: "#eab308",
    statusDanger: "#ef4444"
  }
};
var defaultLightTheme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f4f4f5",
    surface2: "#e4e4e7",
    border: "#e4e4e7",
    foreground: "#09090b",
    foregroundMuted: "#71717a",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    statusSuccess: "#16a34a",
    statusWarning: "#ca8a04",
    statusDanger: "#dc2626"
  }
};
function getDefaultTheme() {
  try {
    const scheme = Appearance.getColorScheme?.();
    if (scheme === "light") {
      return defaultLightTheme;
    }
  } catch {
  }
  return defaultDarkTheme;
}
var initialDefaultTheme = getDefaultTheme();
var PluginThemeContext = createContext({
  theme: initialDefaultTheme,
  colors: initialDefaultTheme.colors,
  fonts: {},
  layout: defaultLayout,
  flair: defaultFlair,
  isCompact: false,
  isMobile: false,
  touchTargetMin: 28,
  alpha: (color, op) => alpha(color, op),
  getContrastColor: (bg, l, d) => getContrastColor(bg, l, d),
  getStatusColor: (v) => getStatusColor(v, initialDefaultTheme.colors),
  getVariantPalette: (v) => getVariantPalette(v, initialDefaultTheme.colors),
  resolveRadius: (s) => resolveRadius("rounded", s),
  padding: resolvePadding(defaultLayout, "comfortable")
});
function PluginThemeProvider({
  theme,
  layout = defaultLayout,
  flair: userFlair,
  children
}) {
  const value = useMemo(() => {
    const flair = { ...defaultFlair, ...userFlair };
    const hostVariables = readHostThemeVariables();
    const effectiveColors = mergeThemeColors(
      getDefaultTheme().colors,
      hostVariables.colors,
      theme.colors,
      flair.accentColor
    );
    const isCompact = Boolean(layout.compact);
    const isMobile = isMobilePlatform(layout.platform);
    const touchTargetMin = getTouchTargetMin(layout);
    const padding = resolvePadding(layout, flair.density);
    return {
      theme,
      colors: effectiveColors,
      fonts: hostVariables.fonts,
      layout,
      flair,
      isCompact,
      isMobile,
      touchTargetMin,
      alpha: (c, o) => alpha(c, o),
      getContrastColor: (bg, l, d) => getContrastColor(bg, l, d),
      getStatusColor: (v) => getStatusColor(v, effectiveColors, flair.accentColor),
      getVariantPalette: (v) => getVariantPalette(v, effectiveColors, flair.accentColor),
      resolveRadius: (size = "md") => resolveRadius(flair.radius, size),
      padding
    };
  }, [theme, layout, userFlair]);
  return /* @__PURE__ */ jsx(PluginThemeContext.Provider, { value, children });
}
function usePluginTheme() {
  return useContext(PluginThemeContext);
}

// src/client/theme/useResponsive.ts
function useResponsive() {
  const { layout, isCompact, isMobile, touchTargetMin } = usePluginTheme();
  return {
    isCompact,
    isMobile,
    platform: layout.platform,
    width: layout.width,
    height: layout.height,
    touchTargetMin,
    select: (options) => {
      return responsiveSelect(layout, options);
    }
  };
}

// src/client/host.ts
var deps;
function initClientHelpers(host) {
  deps = host;
}
function getClientHost() {
  if (!deps) {
    throw new Error(
      "paseo-plugin-helper/client used before initClientHelpers(). Call initClientHelpers({ Icon, Modal, useRpc, useToast }) in the plugin client entry."
    );
  }
  return deps;
}
function getOptionalClientHost() {
  return deps;
}
function selectHostScrollView(host, fallback) {
  return host?.ScrollView ?? fallback;
}
function isClientHostInitialized() {
  return deps !== void 0;
}
function normalizeBeaconMode(mode) {
  if (mode === "ring") return "radar";
  if (mode === "glow" || mode === "badge" || mode === "bounce" || mode === "radar") return mode;
  return "radar";
}
function resolveBeaconToneColor(colors, tone = "warning", customColor) {
  if (customColor) return customColor;
  if (tone === "danger") return colors.statusDanger;
  if (tone === "accent") return colors.accent;
  return colors.statusWarning;
}
function useLoop(driver, toValue, duration, active) {
  useEffect(() => {
    if (!active) return;
    driver.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(driver, { toValue, duration, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(driver, { toValue: 0, duration: 0, useNativeDriver: true })
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [driver, toValue, duration, active]);
}
function usePingPong(driver, duration, active) {
  useEffect(() => {
    if (!active) return;
    driver.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(driver, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(driver, { toValue: 0, duration, easing: Easing.linear, useNativeDriver: true })
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [driver, duration, active]);
}
function AttentionBeacon({
  children,
  mode = "radar",
  tone = "warning",
  color,
  active = true,
  style,
  haloStyle,
  badgeStyle,
  accessibilityLabel,
  testID,
  badgeIcon
}) {
  const { Icon: Icon2 } = getClientHost();
  const { colors } = usePluginTheme();
  const resolved = normalizeBeaconMode(mode);
  const beaconColor = resolveBeaconToneColor(colors, tone, color);
  const radar = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const pip = useRef(new Animated.Value(0)).current;
  const jiggle = useRef(new Animated.Value(0)).current;
  const isRadar = resolved === "radar" && active;
  const isGlow = resolved === "glow" && active;
  const isBadge = resolved === "badge" && active;
  const isBounce = resolved === "bounce" && active;
  useLoop(radar, 1, 1600, isRadar);
  usePingPong(breath, 900, isGlow);
  usePingPong(pip, 900, isBadge);
  usePingPong(jiggle, 350, isBounce);
  if (!active) {
    return /* @__PURE__ */ jsx(View, { style: [styles.wrapper, style], children });
  }
  if (resolved === "glow") {
    const opacity2 = breath.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
    return /* @__PURE__ */ jsxs(View, { style: [styles.wrapper, style], accessibilityLabel, testID, children: [
      children,
      /* @__PURE__ */ jsx(
        Animated.View,
        {
          pointerEvents: "none",
          testID: testID ? `${testID}-glow` : void 0,
          style: [styles.glowHalo, { borderColor: beaconColor, opacity: opacity2 }, haloStyle]
        }
      )
    ] });
  }
  if (resolved === "badge") {
    const opacity2 = pip.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
    const scale2 = pip.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] });
    const hasIcon = badgeIcon !== void 0 && badgeIcon !== null && badgeIcon !== "";
    const iconColor = colors.accentForeground || FALLBACK_ACCENT_FOREGROUND;
    return /* @__PURE__ */ jsxs(View, { style: [styles.wrapper, style], accessibilityLabel, testID, children: [
      children,
      /* @__PURE__ */ jsx(
        Animated.View,
        {
          pointerEvents: "none",
          testID: testID ? `${testID}-badge` : void 0,
          style: [
            styles.pip,
            { backgroundColor: beaconColor, opacity: opacity2, transform: [{ scale: scale2 }] },
            hasIcon && styles.pipWithIcon,
            badgeStyle
          ],
          children: hasIcon ? typeof badgeIcon === "string" ? /* @__PURE__ */ jsx(Icon2, { name: badgeIcon, size: 10, color: iconColor }) : badgeIcon : null
        }
      )
    ] });
  }
  if (resolved === "bounce") {
    const translateY = jiggle.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
    return /* @__PURE__ */ jsx(View, { style: [styles.wrapper, style], accessibilityLabel, testID, children: /* @__PURE__ */ jsx(Animated.View, { style: { transform: [{ translateY }] }, children }) });
  }
  const scale = radar.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const opacity = radar.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  return /* @__PURE__ */ jsxs(View, { style: [styles.wrapper, style], accessibilityLabel, testID, children: [
    /* @__PURE__ */ jsx(
      Animated.View,
      {
        pointerEvents: "none",
        testID: testID ? `${testID}-halo` : void 0,
        style: [
          styles.radarHalo,
          { borderColor: beaconColor, opacity, transform: [{ scale }] },
          haloStyle
        ]
      }
    ),
    children
  ] });
}
var styles = StyleSheet.create({
  wrapper: {
    position: "relative"
  },
  radarHalo: {
    position: "absolute",
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderWidth: 2,
    borderRadius: 12
  },
  glowHalo: {
    position: "absolute",
    top: -2,
    left: -2,
    right: -2,
    bottom: -2,
    borderWidth: 2,
    borderRadius: 10
  },
  pip: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5
  },
  pipWithIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  }
});
function resolveButtonAttentionMode(attention) {
  if (!attention) return null;
  if (attention === true) return "radar";
  return attention;
}
function resolveButtonAttentionTone(variant) {
  if (variant === "danger") return "danger";
  if (variant === "primary") return "accent";
  return "warning";
}
function Button({
  label,
  variant = "secondary",
  size = "md",
  icon,
  iconPosition = "left",
  onPress,
  disabled = false,
  loading = false,
  style,
  textStyle,
  accessibilityLabel,
  attention
}) {
  const { Icon: Icon2 } = getClientHost();
  const { colors, resolveRadius: resolveRadius2, touchTargetMin, isCompact, alpha: alpha2 } = usePluginTheme();
  const radius = resolveRadius2(size === "sm" ? "sm" : size === "lg" ? "lg" : "md");
  const py = size === "sm" ? isCompact ? 5 : 6 : size === "lg" ? 12 : isCompact ? 8 : 10;
  const px = size === "sm" ? isCompact ? 8 : 10 : size === "lg" ? 18 : isCompact ? 12 : 14;
  const fontSize = size === "sm" ? 12 : size === "lg" ? 15 : 13;
  const iconSize = size === "sm" ? 12 : size === "lg" ? 16 : 14;
  let bg = "transparent";
  let border = "transparent";
  let textColor = colors.foreground;
  switch (variant) {
    case "primary":
      bg = colors.accent;
      textColor = colors.accentForeground || FALLBACK_ACCENT_FOREGROUND;
      break;
    case "danger":
      bg = alpha2(colors.statusDanger, 0.15);
      border = alpha2(colors.statusDanger, 0.4);
      textColor = colors.statusDanger;
      break;
    case "ghost":
      bg = "transparent";
      textColor = colors.foregroundMuted;
      break;
    case "secondary":
    default:
      bg = colors.surface1;
      border = colors.border;
      textColor = colors.foreground;
      break;
  }
  const renderIcon = () => {
    if (!icon) return null;
    if (typeof icon === "string") {
      return /* @__PURE__ */ jsx(Icon2, { name: icon, size: iconSize, color: textColor });
    }
    return icon;
  };
  const attentionMode = resolveButtonAttentionMode(attention);
  const pressable = /* @__PURE__ */ jsx(
    Pressable,
    {
      onPress,
      disabled: disabled || loading,
      accessibilityRole: "button",
      accessibilityLabel: accessibilityLabel || label,
      hitSlop: Math.max(0, (touchTargetMin - 32) / 2),
      style: ({ pressed }) => [
        styles2.base,
        {
          backgroundColor: pressed && !disabled ? alpha2(bg, 0.8) : bg,
          borderColor: border,
          borderWidth: border !== "transparent" ? 1 : 0,
          borderRadius: radius,
          paddingVertical: py,
          paddingHorizontal: px,
          minHeight: Math.max(30, touchTargetMin - 4),
          opacity: disabled ? 0.45 : 1
        },
        style
      ],
      children: loading ? /* @__PURE__ */ jsx(ActivityIndicator, { size: "small", color: textColor }) : /* @__PURE__ */ jsxs(Fragment, { children: [
        iconPosition === "left" && renderIcon(),
        label ? /* @__PURE__ */ jsx(
          Text,
          {
            style: [
              styles2.text,
              {
                color: textColor,
                fontSize
              },
              textStyle
            ],
            children: label
          }
        ) : null,
        iconPosition === "right" && renderIcon()
      ] })
    }
  );
  if (!attentionMode) return pressable;
  return /* @__PURE__ */ jsx(AttentionBeacon, { mode: attentionMode, tone: resolveButtonAttentionTone(variant), children: pressable });
}
var styles2 = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6
  },
  text: {
    fontWeight: "600",
    textAlign: "center"
  }
});
function Badge({
  label,
  variant = "neutral",
  styleVariant = "tinted",
  icon,
  dot = false,
  style,
  textStyle
}) {
  const { Icon: Icon2 } = getClientHost();
  const { colors, flair, resolveRadius: resolveRadius2, getVariantPalette: getVariantPalette2, getStatusColor: getStatusColor2, isCompact } = usePluginTheme();
  const radius = resolveRadius2("pill");
  const palette = getVariantPalette2(variant);
  const solidColor = getStatusColor2(variant);
  let bg = palette.bg;
  let border = palette.border;
  let textColor = palette.text;
  if (styleVariant === "outline") {
    bg = "transparent";
    border = palette.border;
    textColor = palette.text;
  } else if (styleVariant === "solid") {
    bg = solidColor;
    border = "transparent";
    textColor = colors.accentForeground || FALLBACK_ACCENT_FOREGROUND;
  }
  const renderIcon = () => {
    if (dot) {
      return /* @__PURE__ */ jsx(
        View,
        {
          style: [
            styles3.dot,
            {
              backgroundColor: textColor
            }
          ]
        }
      );
    }
    if (!icon) return null;
    if (typeof icon === "string") {
      return /* @__PURE__ */ jsx(Icon2, { name: icon, size: isCompact ? 10 : 11, color: textColor });
    }
    return icon;
  };
  return /* @__PURE__ */ jsxs(
    View,
    {
      style: [
        styles3.badge,
        {
          backgroundColor: bg,
          borderColor: border,
          borderRadius: radius,
          paddingVertical: isCompact ? 2 : 3,
          paddingHorizontal: isCompact ? 6 : 8
        },
        style
      ],
      children: [
        renderIcon(),
        /* @__PURE__ */ jsx(
          Text,
          {
            style: [
              styles3.text,
              {
                color: textColor,
                fontSize: isCompact ? 10 : 11,
                textTransform: flair.headingTransform === "uppercase" ? "uppercase" : "none"
              },
              textStyle
            ],
            children: label
          }
        )
      ]
    }
  );
}
var styles3 = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    gap: 4
  },
  text: {
    fontWeight: "600"
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3
  }
});
function StatusDot({ variant = "neutral", size = "md", pulse = false, style }) {
  const { getStatusColor: getStatusColor2, alpha: alpha2 } = usePluginTheme();
  const color = getStatusColor2(variant);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 900,
          useNativeDriver: true
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true
        })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, pulseAnim]);
  const dimension = size === "sm" ? 6 : size === "lg" ? 10 : 8;
  return /* @__PURE__ */ jsx(
    View,
    {
      style: [
        styles4.container,
        {
          width: dimension,
          height: dimension
        },
        style
      ],
      children: /* @__PURE__ */ jsx(
        Animated.View,
        {
          style: [
            styles4.dot,
            {
              width: dimension,
              height: dimension,
              borderRadius: dimension / 2,
              backgroundColor: color,
              shadowColor: color,
              opacity: pulseAnim
            }
          ]
        }
      )
    }
  );
}
var styles4 = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center"
  },
  dot: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 3
  }
});
function CardHeader({
  title,
  subtitle,
  value,
  badge,
  action,
  icon,
  style,
  titleStyle
}) {
  const { Icon: Icon2 } = getClientHost();
  const { colors, flair, isCompact } = usePluginTheme();
  return /* @__PURE__ */ jsxs(View, { style: [styles5.headerContainer, style], children: [
    /* @__PURE__ */ jsxs(View, { style: styles5.headerLeft, children: [
      icon ? /* @__PURE__ */ jsx(Icon2, { name: icon, size: 15, color: colors.foregroundMuted }) : null,
      /* @__PURE__ */ jsxs(View, { style: styles5.titleColumn, children: [
        /* @__PURE__ */ jsx(
          Text,
          {
            style: [
              styles5.headerTitle,
              {
                color: colors.foreground,
                fontSize: isCompact ? 12 : 13,
                textTransform: flair.headingTransform === "uppercase" ? "uppercase" : "none"
              },
              titleStyle
            ],
            children: title
          }
        ),
        subtitle ? /* @__PURE__ */ jsx(
          Text,
          {
            style: [
              styles5.headerSubtitle,
              { color: colors.foregroundMuted, fontSize: 11 }
            ],
            children: subtitle
          }
        ) : null
      ] })
    ] }),
    /* @__PURE__ */ jsxs(View, { style: styles5.headerRight, children: [
      badge ? /* @__PURE__ */ jsx(View, { style: { marginRight: 6 }, children: badge }) : null,
      typeof value === "string" || typeof value === "number" ? /* @__PURE__ */ jsx(
        Text,
        {
          style: [
            styles5.headerValue,
            { color: colors.foreground, fontSize: isCompact ? 12 : 13 }
          ],
          children: value
        }
      ) : value,
      action
    ] })
  ] });
}
function Card({ children, variant, style, noPadding = false }) {
  const { colors, flair, resolveRadius: resolveRadius2, padding, alpha: alpha2 } = usePluginTheme();
  const effectiveVariant = variant || flair.surfaceStyle;
  const radius = resolveRadius2("md");
  let bg = colors.surface0;
  let border = colors.border;
  if (effectiveVariant === "tinted") {
    bg = alpha2(colors.accent, 0.04);
    border = alpha2(colors.accent, 0.2);
  } else if (effectiveVariant === "elevated") {
    bg = colors.surface1;
    border = colors.border;
  }
  return /* @__PURE__ */ jsx(
    View,
    {
      style: [
        styles5.card,
        {
          backgroundColor: bg,
          borderColor: border,
          borderRadius: radius,
          borderWidth: flair.borderWidth,
          paddingHorizontal: noPadding ? 0 : padding.horizontal,
          paddingVertical: noPadding ? 0 : padding.vertical
        },
        style
      ],
      children
    }
  );
}
Card.Header = CardHeader;
var styles5 = StyleSheet.create({
  card: {
    overflow: "hidden",
    width: "100%"
  },
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    marginBottom: 8,
    gap: 8,
    width: "100%"
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    flexShrink: 1
  },
  titleColumn: {
    gap: 1,
    flexShrink: 1
  },
  headerTitle: {
    fontWeight: "600"
  },
  headerSubtitle: {
    fontWeight: "400"
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0
  },
  headerValue: {
    fontWeight: "600"
  }
});
function Tabs({
  tabs,
  activeTab,
  onTabChange,
  mode = "auto",
  style
}) {
  const { Icon: Icon2 } = getClientHost();
  const ResolvedScrollView = selectHostScrollView(
    getClientHost(),
    ScrollView
  );
  const { colors, resolveRadius: resolveRadius2, touchTargetMin, isCompact, alpha: alpha2 } = usePluginTheme();
  const scrollRef = useRef(null);
  const tabLayouts = useRef({});
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const radius = resolveRadius2("sm");
  const shouldFit = mode === "fit" || mode === "auto" && (isCompact || tabs.length <= 4);
  const currentScrollX = useRef(0);
  const checkOverflow = (cWidth, vWidth, scrollX) => {
    if (vWidth <= 0 || cWidth <= 0) return;
    setCanScrollLeft(scrollX > 4);
    setCanScrollRight(scrollX + vWidth < cWidth - 4);
  };
  const prevActiveTab = useRef(activeTab);
  useEffect(() => {
    if (!shouldFit && scrollRef.current && tabLayouts.current[activeTab] && viewportWidth > 0) {
      if (prevActiveTab.current !== activeTab) {
        prevActiveTab.current = activeTab;
        const { x, width } = tabLayouts.current[activeTab];
        const targetX = Math.max(0, x - (viewportWidth - width) / 2);
        scrollRef.current.scrollTo({
          x: targetX,
          animated: true
        });
        currentScrollX.current = targetX;
        checkOverflow(contentWidth, viewportWidth, targetX);
      }
    }
  }, [activeTab, shouldFit, viewportWidth, contentWidth]);
  const handleTabLayout = (tabId, event) => {
    const { x, width } = event.nativeEvent.layout;
    tabLayouts.current[tabId] = { x, width };
  };
  const handleContainerLayout = (event) => {
    const width = event.nativeEvent.layout.width;
    setViewportWidth(width);
    checkOverflow(contentWidth, width, currentScrollX.current);
  };
  const handleContentSizeChange = (cWidth) => {
    setContentWidth(cWidth);
    checkOverflow(cWidth, viewportWidth, currentScrollX.current);
  };
  const handleScroll = (event) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const x = contentOffset.x;
    currentScrollX.current = x;
    checkOverflow(contentSize.width, layoutMeasurement.width, x);
  };
  const scrollByDelta = (delta) => {
    const nextX = Math.max(0, currentScrollX.current + delta);
    scrollRef.current?.scrollTo({
      x: nextX,
      animated: true
    });
    currentScrollX.current = nextX;
  };
  const renderTab = (tab) => {
    const isActive = tab.id === activeTab;
    const displayLabel = shouldFit && isCompact && tab.shortLabel ? tab.shortLabel : tab.label;
    return /* @__PURE__ */ jsxs(
      Pressable,
      {
        onPress: () => {
          onTabChange(tab.id);
        },
        onLayout: (e) => handleTabLayout(tab.id, e),
        accessibilityRole: "tab",
        accessibilityState: { selected: isActive },
        style: ({ pressed }) => [
          styles6.tab,
          shouldFit ? styles6.tabFit : styles6.tabScroll,
          {
            borderRadius: radius - 2,
            minHeight: Math.max(30, touchTargetMin - 8),
            backgroundColor: isActive ? colors.surface2 : pressed ? alpha2(colors.surface2, 0.5) : "transparent",
            paddingHorizontal: shouldFit ? isCompact ? spacing.sm : spacing.md : spacing.md,
            paddingVertical: isCompact ? spacing.xs : spacing.sm
          }
        ],
        children: [
          tab.icon ? /* @__PURE__ */ jsx(
            Icon2,
            {
              name: tab.icon,
              size: isCompact ? 11 : 13,
              color: isActive ? colors.foreground : colors.foregroundMuted
            }
          ) : null,
          /* @__PURE__ */ jsx(
            Text,
            {
              numberOfLines: 1,
              style: [
                styles6.tabText,
                {
                  color: isActive ? colors.foreground : colors.foregroundMuted,
                  fontSize: isCompact ? 11 : 12,
                  fontWeight: isActive ? "600" : "500"
                }
              ],
              children: displayLabel
            }
          ),
          tab.badge !== void 0 ? /* @__PURE__ */ jsx(
            View,
            {
              style: [
                styles6.badge,
                {
                  backgroundColor: isActive ? colors.accent : alpha2(colors.foregroundMuted, 0.2)
                }
              ],
              children: /* @__PURE__ */ jsx(
                Text,
                {
                  style: [
                    styles6.badgeText,
                    {
                      color: isActive ? colors.accentForeground || FALLBACK_ACCENT_FOREGROUND : colors.foregroundMuted
                    }
                  ],
                  children: tab.badge
                }
              )
            }
          ) : null
        ]
      },
      tab.id
    );
  };
  if (shouldFit) {
    return /* @__PURE__ */ jsx(
      View,
      {
        style: [
          styles6.frame,
          {
            backgroundColor: colors.surface1,
            borderRadius: radius,
            borderColor: colors.border
          },
          style
        ],
        children: /* @__PURE__ */ jsx(View, { style: styles6.trackFit, children: tabs.map((tab) => renderTab(tab)) })
      }
    );
  }
  return /* @__PURE__ */ jsxs(
    View,
    {
      onLayout: handleContainerLayout,
      style: [
        styles6.frame,
        {
          backgroundColor: colors.surface1,
          borderRadius: radius,
          borderColor: colors.border
        },
        style
      ],
      children: [
        canScrollLeft && /* @__PURE__ */ jsx(
          Pressable,
          {
            onPress: () => scrollByDelta(-(viewportWidth * 0.7 || 140)),
            style: [
              styles6.arrowButton,
              styles6.arrowLeft,
              {
                backgroundColor: alpha2(colors.surface2, 0.92),
                borderColor: colors.border
              }
            ],
            accessibilityLabel: "Scroll tabs left",
            children: /* @__PURE__ */ jsx(Icon2, { name: "ChevronLeft", size: 14, color: colors.foreground })
          }
        ),
        /* @__PURE__ */ jsx(
          ResolvedScrollView,
          {
            ref: scrollRef,
            horizontal: true,
            nestedScrollEnabled: true,
            directionalLockEnabled: true,
            keyboardShouldPersistTaps: "handled",
            onScroll: handleScroll,
            onContentSizeChange: handleContentSizeChange,
            scrollEventThrottle: 16,
            showsHorizontalScrollIndicator: !isCompact,
            style: styles6.scrollView,
            contentContainerStyle: styles6.scrollContent,
            children: tabs.map((tab) => renderTab(tab))
          }
        ),
        canScrollRight && /* @__PURE__ */ jsx(
          Pressable,
          {
            onPress: () => scrollByDelta(viewportWidth * 0.7 || 140),
            style: [
              styles6.arrowButton,
              styles6.arrowRight,
              {
                backgroundColor: alpha2(colors.surface2, 0.92),
                borderColor: colors.border
              }
            ],
            accessibilityLabel: "Scroll tabs right",
            children: /* @__PURE__ */ jsx(Icon2, { name: "ChevronRight", size: 14, color: colors.foreground })
          }
        )
      ]
    }
  );
}
var styles6 = StyleSheet.create({
  frame: {
    width: "100%",
    maxWidth: "100%",
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    justifyContent: "center"
  },
  trackFit: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    padding: 3,
    gap: 2
  },
  scrollView: {
    width: "100%",
    maxWidth: "100%"
  },
  scrollContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 3,
    gap: 4
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5
  },
  tabFit: {
    flex: 1
  },
  tabScroll: {
    flexShrink: 0
  },
  tabText: {
    textAlign: "center"
  },
  badge: {
    borderRadius: 9999,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700"
  },
  arrowButton: {
    position: "absolute",
    zIndex: 20,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    top: 5,
    ...resolveElevation("sm")
  },
  arrowLeft: {
    left: 4
  },
  arrowRight: {
    right: 4
  }
});

// src/client/utils/clipboard.ts
async function copyToClipboard(text, options) {
  if (text === null || text === void 0) return false;
  const str = String(text);
  let success = false;
  try {
    const copyText = getOptionalClientHost()?.copyText;
    if (copyText) {
      await copyText(str);
      success = true;
    }
  } catch {
  }
  if (!success) {
    try {
      const rn = __require("react-native");
      if (rn?.Clipboard?.setString) {
        rn.Clipboard.setString(str);
        success = true;
      }
    } catch {
    }
  }
  if (!success) {
    try {
      const globalObj = typeof globalThis !== "undefined" ? globalThis : {};
      if (globalObj.navigator?.clipboard?.writeText) {
        await globalObj.navigator.clipboard.writeText(str);
        success = true;
      }
    } catch {
    }
  }
  if (!success) {
    try {
      const globalObj = typeof globalThis !== "undefined" ? globalThis : {};
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
        if (res) {
          success = true;
        }
      }
    } catch {
    }
  }
  if (success && options?.toast) {
    try {
      const toastAny = options.toast;
      if (typeof toastAny.copied === "function") {
        toastAny.copied(options.toastMessage);
      } else if (typeof toastAny.show === "function") {
        const msg = options.toastMessage ? `Copied ${options.toastMessage} to clipboard` : "Copied to clipboard";
        toastAny.show(msg, { variant: "success" });
      }
    } catch {
    }
  }
  return success;
}
function CodeBlock({
  code,
  language,
  title,
  maxHeight = 320,
  copyable = true,
  style,
  textStyle
}) {
  const { Icon: Icon2, useToast } = getClientHost();
  const ResolvedScrollView = selectHostScrollView(
    getClientHost(),
    ScrollView
  );
  const { colors, resolveRadius: resolveRadius2, isCompact, touchTargetMin, alpha: alpha2 } = usePluginTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const radius = resolveRadius2("md");
  const handleCopy = async () => {
    const ok = await copyToClipboard(code, {
      toast,
      toastMessage: title || "Code"
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    }
  };
  const fontFamily = Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace"
  });
  return /* @__PURE__ */ jsxs(
    View,
    {
      style: [
        styles7.container,
        {
          backgroundColor: colors.surface0,
          borderColor: colors.border,
          borderRadius: radius
        },
        style
      ],
      children: [
        (title || language || copyable) && /* @__PURE__ */ jsxs(
          View,
          {
            style: [
              styles7.header,
              {
                borderBottomColor: alpha2(colors.border, 0.7)
              }
            ],
            children: [
              /* @__PURE__ */ jsx(View, { style: styles7.headerLeft, children: title ? /* @__PURE__ */ jsx(Text, { style: [styles7.title, { color: colors.foreground }], children: title }) : language ? /* @__PURE__ */ jsx(Text, { style: [styles7.language, { color: colors.foregroundMuted }], children: language.toUpperCase() }) : null }),
              copyable && /* @__PURE__ */ jsxs(
                Pressable,
                {
                  onPress: handleCopy,
                  hitSlop: Math.max(0, (touchTargetMin - 28) / 2),
                  style: ({ pressed }) => [
                    styles7.copyButton,
                    {
                      backgroundColor: pressed ? colors.surface2 : colors.surface1,
                      borderColor: colors.border,
                      borderRadius: radius - 2
                    }
                  ],
                  children: [
                    /* @__PURE__ */ jsx(
                      Icon2,
                      {
                        name: copied ? "Check" : "Copy",
                        size: 12,
                        color: copied ? colors.statusSuccess : colors.foregroundMuted
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      Text,
                      {
                        style: [
                          styles7.copyText,
                          { color: copied ? colors.statusSuccess : colors.foregroundMuted }
                        ],
                        children: copied ? "Copied!" : "Copy"
                      }
                    )
                  ]
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          ResolvedScrollView,
          {
            nestedScrollEnabled: true,
            style: { maxHeight },
            contentContainerStyle: styles7.scrollContent,
            children: /* @__PURE__ */ jsx(ResolvedScrollView, { horizontal: true, showsHorizontalScrollIndicator: true, children: /* @__PURE__ */ jsx(
              Text,
              {
                selectable: true,
                style: [
                  styles7.codeText,
                  {
                    color: colors.foreground,
                    fontFamily,
                    fontSize: isCompact ? 11 : 12
                  },
                  textStyle
                ],
                children: code
              }
            ) })
          }
        )
      ]
    }
  );
}
var styles7 = StyleSheet.create({
  container: {
    borderWidth: 1,
    overflow: "hidden"
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  title: {
    fontSize: 12,
    fontWeight: "600"
  },
  language: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1
  },
  copyText: {
    fontSize: 11,
    fontWeight: "500"
  },
  scrollContent: {
    padding: 10
  },
  codeText: {
    lineHeight: 18
  }
});
function SearchInput({
  value,
  onChangeText,
  placeholder = "Search...",
  onClear,
  style,
  inputStyle,
  testID
}) {
  const { Icon: Icon2 } = getClientHost();
  const ResolvedInput = getOptionalClientHost()?.TextInput ?? TextInput$1;
  const { colors, resolveRadius: resolveRadius2, isCompact } = usePluginTheme();
  const radius = resolveRadius2("sm");
  const handleClear = () => {
    onChangeText("");
    if (onClear) onClear();
  };
  return /* @__PURE__ */ jsxs(
    View,
    {
      style: [
        styles8.container,
        {
          backgroundColor: colors.surface1,
          borderColor: colors.border,
          borderRadius: radius,
          height: isCompact ? 36 : 40
        },
        style
      ],
      children: [
        /* @__PURE__ */ jsx(View, { style: styles8.iconWrapper, children: /* @__PURE__ */ jsx(Icon2, { name: "Search", size: 16, color: colors.foregroundMuted }) }),
        /* @__PURE__ */ jsx(
          ResolvedInput,
          {
            testID,
            value,
            onChangeText,
            placeholder,
            placeholderTextColor: colors.foregroundMuted,
            style: [
              styles8.input,
              {
                color: colors.foreground,
                fontSize: isCompact ? 13 : 14
              },
              inputStyle
            ],
            returnKeyType: "search",
            autoCapitalize: "none",
            autoCorrect: false
          }
        ),
        Boolean(value) && /* @__PURE__ */ jsx(
          Pressable,
          {
            onPress: handleClear,
            style: styles8.clearButton,
            hitSlop: 8,
            accessibilityLabel: "Clear search",
            children: /* @__PURE__ */ jsx(Icon2, { name: "X", size: 14, color: colors.foregroundMuted })
          }
        )
      ]
    }
  );
}
var styles8 = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    paddingHorizontal: 10
  },
  iconWrapper: {
    marginRight: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  input: {
    flex: 1,
    paddingVertical: 0,
    outlineWidth: 0
  },
  clearButton: {
    padding: 4,
    marginLeft: 4
  }
});
function TextInput({
  value,
  onChangeText,
  label,
  placeholder,
  helperText,
  errorText,
  secureTextEntry = false,
  keyboardType = "default",
  autoCapitalize = "none",
  autoCorrect = false,
  disabled = false,
  mono = false,
  multiline = false,
  numberOfLines = 1,
  style,
  inputStyle,
  onSubmitEditing
}) {
  const { colors, resolveRadius: resolveRadius2, isCompact, touchTargetMin, alpha: alpha2 } = usePluginTheme();
  const [isFocused, setIsFocused] = useState(false);
  const ResolvedInput = getOptionalClientHost()?.TextInput ?? TextInput$1;
  const radius = resolveRadius2("md");
  const hasError = Boolean(errorText);
  const borderColor = hasError ? colors.statusDanger : isFocused ? colors.accent : colors.border;
  const minHeight = multiline ? Math.max(touchTargetMin * 1.5, 64) : touchTargetMin;
  return /* @__PURE__ */ jsxs(View, { style: [styles9.container, style], children: [
    label ? /* @__PURE__ */ jsx(
      Text,
      {
        style: [
          styles9.label,
          {
            color: hasError ? colors.statusDanger : colors.foreground,
            fontSize: isCompact ? 12 : 13
          }
        ],
        children: label
      }
    ) : null,
    /* @__PURE__ */ jsx(
      ResolvedInput,
      {
        value,
        onChangeText,
        placeholder,
        placeholderTextColor: colors.foregroundMuted,
        secureTextEntry,
        keyboardType,
        autoCapitalize,
        autoCorrect,
        editable: !disabled,
        multiline,
        numberOfLines,
        onFocus: () => setIsFocused(true),
        onBlur: () => setIsFocused(false),
        onSubmitEditing,
        style: [
          styles9.input,
          {
            color: disabled ? colors.foregroundMuted : colors.foreground,
            backgroundColor: disabled ? alpha2(colors.surface1, 0.5) : colors.surface0,
            borderColor,
            borderRadius: radius,
            minHeight,
            paddingVertical: multiline ? 8 : 6,
            paddingHorizontal: 10,
            fontSize: isCompact ? 13 : 14,
            fontFamily: mono ? "monospace" : void 0
          },
          inputStyle
        ]
      }
    ),
    (errorText || helperText) && /* @__PURE__ */ jsx(
      Text,
      {
        style: [
          styles9.hint,
          {
            color: hasError ? colors.statusDanger : colors.foregroundMuted,
            fontSize: 11
          }
        ],
        children: errorText || helperText
      }
    )
  ] });
}
var styles9 = StyleSheet.create({
  container: {
    gap: 4
  },
  label: {
    fontWeight: "600"
  },
  input: {
    borderWidth: 1
  },
  hint: {
    marginTop: 2
  }
});
function Toggle({
  value,
  onValueChange,
  label,
  description,
  disabled = false,
  style,
  labelStyle
}) {
  const { colors, touchTargetMin, isCompact, alpha: alpha2 } = usePluginTheme();
  const handlePress = () => {
    if (!disabled) {
      onValueChange(!value);
    }
  };
  const trackWidth = 38;
  const trackHeight = 22;
  const thumbSize = 16;
  const thumbPadding = 3;
  const trackColor = value ? colors.accent : alpha2(colors.foregroundMuted, 0.35);
  const thumbPosition = value ? trackWidth - thumbSize - thumbPadding : thumbPadding;
  return /* @__PURE__ */ jsxs(
    Pressable,
    {
      onPress: handlePress,
      disabled,
      hitSlop: Math.max(0, (touchTargetMin - trackHeight) / 2),
      style: ({ pressed }) => [
        styles10.container,
        {
          minHeight: touchTargetMin,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1
        },
        style
      ],
      children: [
        (label || description) && /* @__PURE__ */ jsxs(View, { style: styles10.textContainer, children: [
          label && /* @__PURE__ */ jsx(
            Text,
            {
              style: [
                styles10.label,
                {
                  color: colors.foreground,
                  fontSize: isCompact ? 13 : 14
                },
                labelStyle
              ],
              children: label
            }
          ),
          description && /* @__PURE__ */ jsx(
            Text,
            {
              style: [
                styles10.description,
                {
                  color: colors.foregroundMuted,
                  fontSize: 11
                }
              ],
              children: description
            }
          )
        ] }),
        /* @__PURE__ */ jsx(
          View,
          {
            style: [
              styles10.track,
              {
                width: trackWidth,
                height: trackHeight,
                borderRadius: trackHeight / 2,
                backgroundColor: trackColor
              }
            ],
            children: /* @__PURE__ */ jsx(
              View,
              {
                style: [
                  styles10.thumb,
                  {
                    width: thumbSize,
                    height: thumbSize,
                    borderRadius: thumbSize / 2,
                    backgroundColor: colors.surface0,
                    transform: [{ translateX: thumbPosition }]
                  }
                ]
              }
            )
          }
        )
      ]
    }
  );
}
var styles10 = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  textContainer: {
    flex: 1,
    gap: 2
  },
  label: {
    fontWeight: "500"
  },
  description: {
    lineHeight: 15
  },
  track: {
    justifyContent: "center"
  },
  thumb: {
    ...resolveElevation("sm")
  }
});
function resolveCollapsibleChevron(expanded) {
  return expanded ? "ChevronDown" : "ChevronRight";
}
function resolveCollapsibleHeaderBackground(colors, pressed) {
  return pressed ? colors.surface1 : colors.surface0;
}
function renderTitle(title, titleStyle) {
  if (typeof title === "string" || title === void 0) {
    return title ? /* @__PURE__ */ jsx(Text, { style: titleStyle, children: title }) : null;
  }
  return /* @__PURE__ */ jsx(View, { style: styles11.titleSlot, children: title });
}
function renderSubtitle(subtitle, subtitleStyle) {
  if (typeof subtitle === "string") {
    return /* @__PURE__ */ jsx(Text, { style: subtitleStyle, children: subtitle });
  }
  return subtitle ?? null;
}
function Collapsible({
  title,
  subtitle,
  children,
  initiallyExpanded = false,
  isExpanded: controlledExpanded,
  onToggle,
  badge,
  headerRight,
  summary,
  icon,
  style,
  headerStyle,
  contentStyle,
  variant
}) {
  const { Icon: Icon2 } = getClientHost();
  const { colors, resolveRadius: resolveRadius2, isCompact, touchTargetMin, alpha: alpha2 } = usePluginTheme();
  const [internalExpanded, setInternalExpanded] = useState(initiallyExpanded);
  const isExpanded = controlledExpanded !== void 0 ? controlledExpanded : internalExpanded;
  const radius = resolveRadius2(variant === "elevated" ? "lg" : "md");
  const handlePress = () => {
    const next = !isExpanded;
    if (controlledExpanded === void 0) {
      setInternalExpanded(next);
    }
    onToggle?.(next);
  };
  const titleStyle = {
    color: colors.foreground,
    fontSize: isCompact ? 12 : 13
  };
  const subtitleStyle = {
    color: colors.foregroundMuted,
    fontSize: isCompact ? 11 : 12
  };
  return /* @__PURE__ */ jsxs(
    View,
    {
      style: [
        styles11.container,
        {
          borderColor: colors.border,
          borderRadius: radius,
          backgroundColor: colors.surface0
        },
        style
      ],
      children: [
        /* @__PURE__ */ jsxs(
          Pressable,
          {
            onPress: handlePress,
            accessibilityRole: "button",
            accessibilityState: { expanded: isExpanded },
            style: ({ pressed }) => [
              styles11.header,
              {
                minHeight: Math.max(touchTargetMin, 36),
                backgroundColor: resolveCollapsibleHeaderBackground(colors, pressed),
                cursor: "pointer"
              },
              headerStyle
            ],
            children: [
              /* @__PURE__ */ jsxs(View, { style: styles11.headerLeft, children: [
                /* @__PURE__ */ jsx(
                  View,
                  {
                    style: [
                      styles11.chevronBadge,
                      {
                        backgroundColor: alpha2(colors.accent, 0.12),
                        borderColor: alpha2(colors.accent, 0.25)
                      }
                    ],
                    children: /* @__PURE__ */ jsx(
                      Icon2,
                      {
                        name: resolveCollapsibleChevron(isExpanded),
                        size: 14,
                        color: colors.foregroundMuted
                      }
                    )
                  }
                ),
                icon && /* @__PURE__ */ jsx(Icon2, { name: icon, size: 14, color: colors.accent }),
                /* @__PURE__ */ jsxs(View, { style: styles11.titleBlock, children: [
                  /* @__PURE__ */ jsxs(View, { style: styles11.titleRow, children: [
                    renderTitle(title, [styles11.title, titleStyle]),
                    badge && /* @__PURE__ */ jsx(View, { style: styles11.badgeSlot, children: badge })
                  ] }),
                  subtitle ? /* @__PURE__ */ jsx(View, { style: styles11.subtitleSlot, children: renderSubtitle(subtitle, [styles11.subtitle, subtitleStyle]) }) : null,
                  summary ? /* @__PURE__ */ jsx(View, { style: styles11.summarySlot, children: summary }) : null
                ] })
              ] }),
              (headerRight || summary === void 0) && /* @__PURE__ */ jsx(View, { style: styles11.headerRight, children: headerRight })
            ]
          }
        ),
        isExpanded && /* @__PURE__ */ jsx(
          View,
          {
            style: [
              styles11.content,
              { borderTopColor: colors.border, borderTopWidth: 1 },
              contentStyle
            ],
            children
          }
        )
      ]
    }
  );
}
var styles11 = StyleSheet.create({
  container: {
    borderWidth: 1,
    overflow: "hidden"
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1
  },
  chevronBadge: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  titleBlock: {
    flex: 1
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  titleSlot: {
    flexDirection: "row",
    alignItems: "center"
  },
  badgeSlot: {
    flexDirection: "row",
    alignItems: "center"
  },
  subtitleSlot: {
    marginTop: 2
  },
  summarySlot: {
    marginTop: 4,
    flexDirection: "row"
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 8
  },
  title: {
    fontWeight: "600"
  },
  subtitle: {
    fontWeight: "400"
  },
  content: {
    padding: 12
  }
});

// src/shared/formatters.ts
function resolveMetricStatus(value, thresholds = {}) {
  const { warning = 75, danger = 90, invert = false } = thresholds;
  if (!invert) {
    if (value >= danger) return "danger";
    if (value >= warning) return "warning";
    return "success";
  } else {
    if (value <= danger) return "danger";
    if (value <= warning) return "warning";
    return "success";
  }
}
function truncate(text, maxLength, suffix = "\u2026") {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - suffix.length)) + suffix;
}
function truncateMiddle(text, maxLength, options) {
  if (!text || text.length <= maxLength) return text;
  const ellipsis = options?.ellipsis ?? "\u2026";
  if (maxLength <= ellipsis.length) return ellipsis.slice(0, maxLength);
  const available = maxLength - ellipsis.length;
  const headLength = Math.floor(available / 2);
  const tailLength = available - headLength;
  const head = text.slice(0, headLength);
  const tail = tailLength > 0 ? text.slice(-tailLength) : "";
  return `${head}${ellipsis}${tail}`;
}
function truncatePath(filePath, maxLength, options) {
  if (!filePath || filePath.length <= maxLength) return filePath;
  const sep = options?.separator ?? "/";
  const ellipsis = options?.ellipsis ?? "\u2026";
  let keepLeading = options?.keepLeading ?? 1;
  const keepTrailing = options?.keepTrailing ?? 1;
  if (filePath.startsWith(sep) && keepLeading === 1) {
    keepLeading = 2;
  }
  const parts = filePath.split(sep);
  if (parts.length <= keepLeading + keepTrailing) {
    return truncateMiddle(filePath, maxLength, { ellipsis });
  }
  const prefixParts = parts.slice(0, keepLeading);
  const suffixParts = parts.slice(parts.length - keepTrailing);
  let middleParts = parts.slice(keepLeading, parts.length - keepTrailing);
  while (middleParts.length > 0) {
    const candidate = [...prefixParts, ellipsis, ...middleParts, ...suffixParts].join(sep);
    if (candidate.length <= maxLength) {
      return candidate;
    }
    middleParts.shift();
  }
  const minimalCandidate = [...prefixParts, ellipsis, ...suffixParts].join(sep);
  if (minimalCandidate.length <= maxLength) {
    return minimalCandidate;
  }
  const filename = suffixParts.join(sep);
  const prefix = prefixParts.join(sep);
  const availableForFile = maxLength - prefix.length - sep.length - ellipsis.length - sep.length;
  if (availableForFile > 4) {
    return `${prefix}${sep}${ellipsis}${sep}${truncateMiddle(filename, availableForFile, { ellipsis })}`;
  }
  return truncateMiddle(filePath, maxLength, { ellipsis });
}
function ProgressBar({
  value,
  color,
  autoStatusColor = true,
  thresholds,
  label,
  showValueText = false,
  height = 8,
  style
}) {
  const { colors, resolveRadius: resolveRadius2, isCompact } = usePluginTheme();
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const radius = resolveRadius2("pill");
  let barColor = color || colors.accent;
  if (!color && autoStatusColor) {
    const status = resolveMetricStatus(clamped, thresholds);
    if (status === "danger") {
      barColor = colors.statusDanger;
    } else if (status === "warning") {
      barColor = colors.statusWarning;
    } else {
      barColor = colors.statusSuccess;
    }
  }
  return /* @__PURE__ */ jsxs(View, { style: [styles12.container, style], children: [
    (label || showValueText) && /* @__PURE__ */ jsxs(View, { style: styles12.labelRow, children: [
      label ? /* @__PURE__ */ jsx(
        Text,
        {
          style: [
            styles12.labelText,
            { color: colors.foregroundMuted, fontSize: isCompact ? 11 : 12 }
          ],
          children: label
        }
      ) : null,
      showValueText ? /* @__PURE__ */ jsxs(
        Text,
        {
          style: [
            styles12.valueText,
            { color: colors.foreground, fontSize: isCompact ? 11 : 12 }
          ],
          children: [
            Math.round(clamped),
            "%"
          ]
        }
      ) : null
    ] }),
    /* @__PURE__ */ jsx(
      View,
      {
        style: [
          styles12.track,
          {
            backgroundColor: colors.surface2,
            height,
            borderRadius: radius
          }
        ],
        children: /* @__PURE__ */ jsx(
          View,
          {
            style: [
              styles12.fill,
              {
                width: `${clamped}%`,
                backgroundColor: barColor,
                borderRadius: radius
              }
            ]
          }
        )
      }
    )
  ] });
}
var styles12 = StyleSheet.create({
  container: {
    gap: 4
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  labelText: {
    fontWeight: "500"
  },
  valueText: {
    fontWeight: "600"
  },
  track: {
    width: "100%",
    overflow: "hidden"
  },
  fill: {
    height: "100%"
  }
});
function MetricGauge({
  value,
  size = 76,
  strokeWidth = 7,
  thresholds,
  color,
  autoStatusColor = true,
  label,
  showPercent = true,
  centerSlot,
  style
}) {
  const { colors } = usePluginTheme();
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  let gaugeColor = color || colors.accent;
  if (!color && autoStatusColor) {
    const status = resolveMetricStatus(clamped, thresholds);
    if (status === "danger") {
      gaugeColor = colors.statusDanger;
    } else if (status === "warning") {
      gaugeColor = colors.statusWarning;
    } else {
      gaugeColor = colors.statusSuccess;
    }
  }
  const radius = size / 2;
  const innerSize = Math.max(0, size - strokeWidth * 2);
  const innerRadius = innerSize / 2;
  const trackColor = colors.surface2;
  if (Platform.OS === "web") {
    const webBackground = `conic-gradient(${gaugeColor} 0% ${clamped}%, ${trackColor} ${clamped}% 100%)`;
    return /* @__PURE__ */ jsxs(View, { style: [styles13.wrapper, style], children: [
      /* @__PURE__ */ jsx(
        View,
        {
          style: [
            styles13.gaugeBox,
            {
              width: size,
              height: size,
              borderRadius: radius
            },
            { background: webBackground }
          ],
          children: /* @__PURE__ */ jsx(
            View,
            {
              style: [
                styles13.centerHole,
                {
                  width: innerSize,
                  height: innerSize,
                  borderRadius: innerRadius,
                  backgroundColor: colors.surface0
                }
              ],
              children: centerSlot ? centerSlot : showPercent ? /* @__PURE__ */ jsxs(Text, { style: [styles13.percentText, { color: colors.foreground }], children: [
                Math.round(clamped),
                "%"
              ] }) : null
            }
          )
        }
      ),
      label ? /* @__PURE__ */ jsx(Text, { style: [styles13.labelText, { color: colors.foregroundMuted }], children: label }) : null
    ] });
  }
  const firstHalfRotation = Math.min(180, clamped * 3.6);
  const secondHalfRotation = clamped > 50 ? (clamped - 50) * 3.6 : 0;
  return /* @__PURE__ */ jsxs(View, { style: [styles13.wrapper, style], children: [
    /* @__PURE__ */ jsxs(View, { style: [styles13.gaugeBox, { width: size, height: size }], children: [
      /* @__PURE__ */ jsx(
        View,
        {
          style: [
            StyleSheet.absoluteFillObject,
            {
              borderRadius: radius,
              borderWidth: strokeWidth,
              borderColor: trackColor
            }
          ]
        }
      ),
      /* @__PURE__ */ jsx(
        View,
        {
          style: [
            styles13.halfCircleContainer,
            {
              width: size,
              height: size,
              transform: [{ rotate: `${firstHalfRotation}deg` }]
            }
          ],
          children: /* @__PURE__ */ jsx(
            View,
            {
              style: [
                styles13.halfCircle,
                {
                  width: size,
                  height: size,
                  borderRadius: radius,
                  borderWidth: strokeWidth,
                  borderColor: gaugeColor,
                  borderBottomColor: "transparent",
                  borderLeftColor: "transparent"
                }
              ]
            }
          )
        }
      ),
      clamped > 50 ? /* @__PURE__ */ jsx(
        View,
        {
          style: [
            styles13.halfCircleContainer,
            {
              width: size,
              height: size,
              transform: [{ rotate: `${secondHalfRotation + 180}deg` }]
            }
          ],
          children: /* @__PURE__ */ jsx(
            View,
            {
              style: [
                styles13.halfCircle,
                {
                  width: size,
                  height: size,
                  borderRadius: radius,
                  borderWidth: strokeWidth,
                  borderColor: gaugeColor,
                  borderBottomColor: "transparent",
                  borderLeftColor: "transparent"
                }
              ]
            }
          )
        }
      ) : null,
      /* @__PURE__ */ jsx(
        View,
        {
          style: [
            styles13.centerHole,
            {
              width: innerSize,
              height: innerSize,
              borderRadius: innerRadius,
              backgroundColor: colors.surface0
            }
          ],
          children: centerSlot ? centerSlot : showPercent ? /* @__PURE__ */ jsxs(Text, { style: [styles13.percentText, { color: colors.foreground }], children: [
            Math.round(clamped),
            "%"
          ] }) : null
        }
      )
    ] }),
    label ? /* @__PURE__ */ jsx(Text, { style: [styles13.labelText, { color: colors.foregroundMuted }], children: label }) : null
  ] });
}
var styles13 = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6
  },
  gaugeBox: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  },
  centerHole: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10
  },
  halfCircleContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    overflow: "hidden"
  },
  halfCircle: {
    position: "absolute",
    top: 0,
    left: 0
  },
  percentText: {
    fontSize: 13,
    fontWeight: "700"
  },
  labelText: {
    fontSize: 11,
    fontWeight: "500"
  }
});
function DataTable({
  data,
  columns,
  keyExtractor,
  emptyState,
  style
}) {
  const { colors, resolveRadius: resolveRadius2, isCompact } = usePluginTheme();
  const radius = resolveRadius2("sm");
  if (!data || data.length === 0) {
    return emptyState ? /* @__PURE__ */ jsx(View, { style, children: emptyState }) : null;
  }
  if (isCompact) {
    return /* @__PURE__ */ jsx(View, { style: [styles14.compactContainer, style], children: data.map((item, idx) => /* @__PURE__ */ jsx(
      View,
      {
        style: [
          styles14.compactCard,
          {
            backgroundColor: colors.surface1,
            borderColor: colors.border,
            borderRadius: radius
          }
        ],
        children: columns.map((col) => /* @__PURE__ */ jsxs(View, { style: styles14.compactRow, children: [
          /* @__PURE__ */ jsx(Text, { style: [styles14.compactHeader, { color: colors.foregroundMuted }], children: col.header }),
          /* @__PURE__ */ jsx(View, { style: styles14.compactValue, children: col.render(item) })
        ] }, col.key))
      },
      keyExtractor(item, idx)
    )) });
  }
  return /* @__PURE__ */ jsxs(
    View,
    {
      style: [
        styles14.table,
        {
          borderColor: colors.border,
          borderRadius: radius,
          backgroundColor: colors.surface0
        },
        style
      ],
      children: [
        /* @__PURE__ */ jsx(
          View,
          {
            style: [
              styles14.headerRow,
              {
                backgroundColor: colors.surface1,
                borderBottomColor: colors.border
              }
            ],
            children: columns.map((col) => /* @__PURE__ */ jsx(
              View,
              {
                style: [
                  styles14.cell,
                  col.flex !== void 0 ? { flex: col.flex } : { flex: 1 },
                  col.width !== void 0 ? { width: col.width } : void 0,
                  col.align === "right" ? styles14.alignRight : col.align === "center" ? styles14.alignCenter : styles14.alignLeft
                ],
                children: /* @__PURE__ */ jsx(Text, { style: [styles14.headerText, { color: colors.foregroundMuted }], children: col.header })
              },
              col.key
            ))
          }
        ),
        data.map((item, idx) => /* @__PURE__ */ jsx(
          View,
          {
            style: [
              styles14.row,
              idx < data.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 1 }
            ],
            children: columns.map((col) => /* @__PURE__ */ jsx(
              View,
              {
                style: [
                  styles14.cell,
                  col.flex !== void 0 ? { flex: col.flex } : { flex: 1 },
                  col.width !== void 0 ? { width: col.width } : void 0,
                  col.align === "right" ? styles14.alignRight : col.align === "center" ? styles14.alignCenter : styles14.alignLeft
                ],
                children: col.render(item)
              },
              col.key
            ))
          },
          keyExtractor(item, idx)
        ))
      ]
    }
  );
}
var styles14 = StyleSheet.create({
  table: {
    borderWidth: 1,
    overflow: "hidden"
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12
  },
  row: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center"
  },
  cell: {
    justifyContent: "center"
  },
  alignLeft: {
    alignItems: "flex-start"
  },
  alignCenter: {
    alignItems: "center"
  },
  alignRight: {
    alignItems: "flex-end"
  },
  headerText: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  compactContainer: {
    gap: 8
  },
  compactCard: {
    borderWidth: 1,
    padding: 12,
    gap: 6
  },
  compactRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  compactHeader: {
    fontSize: 12
  },
  compactValue: {
    alignItems: "flex-end"
  }
});
function KeyValue({
  label,
  value,
  subValue,
  mono = false,
  copyable = false,
  truncate: truncateProp = false,
  truncateMaxLength = 32,
  truncatePathOptions,
  stackOnCompact = true,
  style,
  labelStyle,
  valueStyle
}) {
  const { Icon: Icon2, useToast } = getClientHost();
  const { colors, flair, isCompact, touchTargetMin, fonts } = usePluginTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const rawString = value === null || value === void 0 ? "" : String(value);
  let displayValue = rawString || "-";
  if (truncateProp && rawString.length > truncateMaxLength) {
    const mode = typeof truncateProp === "string" ? truncateProp : "middle";
    switch (mode) {
      case "path":
        displayValue = truncatePath(rawString, truncateMaxLength, truncatePathOptions);
        break;
      case "end":
        displayValue = truncate(rawString, truncateMaxLength);
        break;
      case "middle":
      default:
        displayValue = truncateMiddle(rawString, truncateMaxLength);
        break;
    }
  }
  const handleCopy = async () => {
    if (!copyable || !rawString) return;
    const ok = await copyToClipboard(rawString, {
      toast,
      toastMessage: label
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    }
  };
  const fontFamily = mono ? fonts.mono ?? Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) : void 0;
  const shouldStack = stackOnCompact && isCompact;
  const copyButton = copyable && value ? /* @__PURE__ */ jsx(
    Pressable,
    {
      onPress: handleCopy,
      hitSlop: Math.max(8, (touchTargetMin - 20) / 2),
      style: styles15.copyBtn,
      accessibilityRole: "button",
      accessibilityLabel: `Copy ${label}`,
      children: /* @__PURE__ */ jsx(
        Icon2,
        {
          name: copied ? "Check" : "Copy",
          size: isCompact ? 12 : 13,
          color: copied ? colors.statusSuccess : colors.foregroundMuted
        }
      )
    }
  ) : null;
  if (shouldStack) {
    return /* @__PURE__ */ jsxs(
      View,
      {
        style: [
          styles15.container,
          styles15.stackedContainer,
          { paddingVertical: isCompact ? spacing.xs : spacing.sm },
          style
        ],
        children: [
          /* @__PURE__ */ jsxs(View, { style: styles15.stackedHeaderRow, children: [
            /* @__PURE__ */ jsx(
              Text,
              {
                style: [
                  styles15.label,
                  {
                    color: colors.foregroundMuted,
                    fontSize: 11,
                    textTransform: flair.headingTransform === "uppercase" ? "uppercase" : "none"
                  },
                  labelStyle
                ],
                children: label
              }
            ),
            copyButton
          ] }),
          /* @__PURE__ */ jsx(
            Text,
            {
              selectable: true,
              style: [
                styles15.stackedValueText,
                {
                  color: colors.foreground,
                  fontSize: 13,
                  lineHeight: 19,
                  fontFamily
                },
                valueStyle
              ],
              children: displayValue
            }
          ),
          subValue ? /* @__PURE__ */ jsx(
            Text,
            {
              style: [
                styles15.subValue,
                {
                  color: colors.foregroundMuted,
                  fontSize: 11,
                  lineHeight: 15
                }
              ],
              children: subValue
            }
          ) : null
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs(
    View,
    {
      style: [
        styles15.container,
        styles15.rowContainer,
        { paddingVertical: isCompact ? spacing.xs : spacing.sm },
        style
      ],
      children: [
        /* @__PURE__ */ jsx(
          Text,
          {
            style: [
              styles15.label,
              {
                color: colors.foregroundMuted,
                fontSize: 12,
                textTransform: flair.headingTransform === "uppercase" ? "uppercase" : "none"
              },
              labelStyle
            ],
            children: label
          }
        ),
        /* @__PURE__ */ jsxs(View, { style: styles15.rowValueWrapper, children: [
          /* @__PURE__ */ jsx(
            Text,
            {
              selectable: true,
              style: [
                styles15.rowValueText,
                {
                  color: colors.foreground,
                  fontSize: 13,
                  fontFamily
                },
                valueStyle
              ],
              children: displayValue
            }
          ),
          subValue && /* @__PURE__ */ jsx(Text, { style: [styles15.subValue, { color: colors.foregroundMuted, fontSize: 11 }], children: subValue }),
          copyButton
        ] })
      ]
    }
  );
}
function KeyValueGroup({
  children,
  columns = 2,
  gap = spacing.md,
  style
}) {
  const { isCompact } = usePluginTheme();
  const effectiveColumns = isCompact ? 1 : columns;
  const childArray = React8.Children.toArray(children).filter(Boolean);
  return /* @__PURE__ */ jsx(View, { style: [styles15.groupContainer, { gap }, style], children: childArray.map((child, index) => /* @__PURE__ */ jsx(
    View,
    {
      style: {
        flexGrow: 1,
        flexShrink: 0,
        flexBasis: `${Math.floor(100 / effectiveColumns) - 2}%`
      },
      children: child
    },
    index
  )) });
}
var styles15 = StyleSheet.create({
  container: {
    width: "100%"
  },
  rowContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  stackedContainer: {
    flexDirection: "column",
    gap: 3,
    width: "100%"
  },
  stackedHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%"
  },
  stackedValueText: {
    fontWeight: "600",
    width: "100%"
  },
  rowValueWrapper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexShrink: 1,
    gap: 6
  },
  rowValueText: {
    fontWeight: "600",
    flexShrink: 1
  },
  groupContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: "100%"
  },
  label: {
    fontWeight: "500"
  },
  subValue: {
    fontWeight: "400"
  },
  copyBtn: {
    padding: 3,
    alignItems: "center",
    justifyContent: "center"
  }
});
function EmptyState({
  icon = "Inbox",
  title,
  description,
  action,
  actionLabel,
  onAction,
  style
}) {
  const { Icon: Icon2 } = getClientHost();
  const { colors, isCompact } = usePluginTheme();
  const resolvedAction = action ? action : actionLabel && onAction ? { label: actionLabel, onPress: onAction, variant: "secondary" } : void 0;
  return /* @__PURE__ */ jsxs(View, { style: [styles16.container, { padding: isCompact ? 20 : 32 }, style], children: [
    icon ? typeof icon === "string" ? /* @__PURE__ */ jsx(View, { style: [styles16.iconWrapper, { backgroundColor: colors.surface1 }], children: /* @__PURE__ */ jsx(Icon2, { name: icon, size: isCompact ? 24 : 32, color: colors.foregroundMuted }) }) : icon : null,
    /* @__PURE__ */ jsx(Text, { style: [styles16.title, { color: colors.foreground, fontSize: isCompact ? 14 : 16 }], children: title }),
    description ? /* @__PURE__ */ jsx(
      Text,
      {
        style: [
          styles16.description,
          { color: colors.foregroundMuted, fontSize: isCompact ? 12 : 13 }
        ],
        children: description
      }
    ) : null,
    resolvedAction ? /* @__PURE__ */ jsx(View, { style: styles16.actionRow, children: /* @__PURE__ */ jsx(Button, { size: isCompact ? "sm" : "md", ...resolvedAction }) }) : null
  ] });
}
var styles16 = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  iconWrapper: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4
  },
  title: {
    fontWeight: "600",
    textAlign: "center"
  },
  description: {
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 18
  },
  actionRow: {
    marginTop: 8
  }
});
function Responsive({ desktop, mobile, compact, wide, children }) {
  const responsive = useResponsive();
  if (typeof children === "function") {
    return /* @__PURE__ */ jsx(Fragment, { children: children(responsive) });
  }
  const selected = responsive.select({
    desktop,
    mobile,
    compact,
    wide
  });
  return /* @__PURE__ */ jsx(Fragment, { children: selected ?? children ?? null });
}

// src/client/utils/haptics.ts
var PATTERNS = {
  light: 10,
  medium: 25,
  heavy: 45,
  success: [15, 40, 20],
  warning: [30, 50, 30],
  error: [40, 60, 40, 60, 40]
};
function triggerHaptic(type = "light") {
  try {
    const globalObj = typeof globalThis !== "undefined" ? globalThis : {};
    const nav = globalObj.navigator;
    if (typeof nav?.vibrate === "function") {
      const pattern = PATTERNS[type] ?? 15;
      return Boolean(nav.vibrate(pattern));
    }
  } catch {
  }
  return false;
}
function resolveGitHubAvatarUrl(repo, author) {
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
function AboutSection({
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
  style
}) {
  const { Icon: Icon2 } = getClientHost();
  const { colors, resolveRadius: resolveRadius2 } = usePluginTheme();
  const { isCompact, platform } = useResponsive();
  const [copied, setCopied] = useState(false);
  let resolvedLogoNode = null;
  const radius = resolveRadius2("md");
  if (logo) {
    if (typeof logo === "string") {
      if (logo.startsWith("http://") || logo.startsWith("https://")) {
        resolvedLogoNode = /* @__PURE__ */ jsx(
          Image,
          {
            source: { uri: logo },
            style: [styles17.logoImage, { borderRadius: radius }]
          }
        );
      } else {
        resolvedLogoNode = /* @__PURE__ */ jsx(
          View,
          {
            style: [
              styles17.logoIconFallback,
              {
                backgroundColor: colors.surface2,
                borderRadius: radius,
                borderColor: colors.border
              }
            ],
            children: /* @__PURE__ */ jsx(Icon2, { name: logo, size: 26, color: colors.accent })
          }
        );
      }
    } else {
      resolvedLogoNode = /* @__PURE__ */ jsx(
        Image,
        {
          source: logo,
          style: [styles17.logoImage, { borderRadius: radius }]
        }
      );
    }
  } else {
    const githubAvatar = resolveGitHubAvatarUrl(repository, author);
    if (githubAvatar) {
      resolvedLogoNode = /* @__PURE__ */ jsx(
        Image,
        {
          source: { uri: githubAvatar },
          style: [styles17.logoImage, { borderRadius: radius }]
        }
      );
    } else {
      resolvedLogoNode = /* @__PURE__ */ jsx(
        View,
        {
          style: [
            styles17.logoIconFallback,
            {
              backgroundColor: colors.surface2,
              borderRadius: radius,
              borderColor: colors.border
            }
          ],
          children: /* @__PURE__ */ jsx(Icon2, { name: "Layers", size: 26, color: colors.accent })
        }
      );
    }
  }
  const handleOpenUrl = async (url) => {
    try {
      triggerHaptic("light");
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      }
    } catch {
    }
  };
  const handleCopyDiagnostics = async () => {
    triggerHaptic("success");
    const lines = [
      `Plugin: ${name} v${version}`,
      author ? `Author: ${author}` : null,
      `License: ${license}`,
      `Platform: ${platform} (${isCompact ? "compact" : "regular"})`,
      repository ? `Repository: ${repository}` : null,
      ...extraItems.map((item) => `${item.label}: ${item.value}`)
    ].filter(Boolean);
    await copyToClipboard(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  const allLinks = [
    ...repository ? [{ label: "Repository", url: repository, icon: "ExternalLink" }] : [],
    ...issues ? [{ label: "Report Issue", url: issues, icon: "Bug" }] : [],
    ...homepage ? [{ label: "Documentation", url: homepage, icon: "BookOpen" }] : [],
    ...links
  ];
  return /* @__PURE__ */ jsxs(View, { style: [styles17.container, style], children: [
    /* @__PURE__ */ jsxs(Card, { variant: "elevated", children: [
      /* @__PURE__ */ jsx(
        Card.Header,
        {
          title: name,
          subtitle: description,
          badge: /* @__PURE__ */ jsx(Badge, { variant: "accent", label: `v${version}` })
        }
      ),
      /* @__PURE__ */ jsxs(View, { style: styles17.headerRow, children: [
        resolvedLogoNode,
        /* @__PURE__ */ jsxs(View, { style: styles17.metaColumn, children: [
          author ? /* @__PURE__ */ jsxs(Text, { style: [styles17.authorText, { color: colors.foregroundMuted }], children: [
            "by ",
            author
          ] }) : null,
          license ? /* @__PURE__ */ jsx(View, { style: styles17.titleRow, children: /* @__PURE__ */ jsx(Badge, { variant: "neutral", label: license }) }) : null
        ] })
      ] }),
      /* @__PURE__ */ jsxs(View, { style: styles17.actionsRow, children: [
        allLinks.map((link) => /* @__PURE__ */ jsx(
          Button,
          {
            size: "sm",
            variant: "secondary",
            icon: link.icon ?? "ExternalLink",
            label: link.label,
            onPress: () => handleOpenUrl(link.url)
          },
          link.url
        )),
        showDiagnosticsCopy && /* @__PURE__ */ jsx(
          Button,
          {
            size: "sm",
            variant: copied ? "primary" : "ghost",
            icon: copied ? "Check" : "Copy",
            label: copied ? "Diagnostics Copied!" : "Copy Diagnostics",
            onPress: handleCopyDiagnostics
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxs(Card, { variant: "elevated", children: [
      /* @__PURE__ */ jsx(
        Card.Header,
        {
          title: "Runtime Environment",
          subtitle: "Diagnostics for issue reports and system verification"
        }
      ),
      /* @__PURE__ */ jsxs(KeyValueGroup, { columns: isCompact ? 1 : 2, children: [
        /* @__PURE__ */ jsx(KeyValue, { label: "Plugin Version", value: `v${version}`, copyable: true }),
        /* @__PURE__ */ jsx(KeyValue, { label: "Client Platform", value: platform }),
        author ? /* @__PURE__ */ jsx(KeyValue, { label: "Author", value: author }) : null,
        license ? /* @__PURE__ */ jsx(KeyValue, { label: "License", value: license }) : null,
        extraItems.map((item, idx) => /* @__PURE__ */ jsx(
          KeyValue,
          {
            label: item.label,
            value: item.value,
            subValue: item.subValue,
            copyable: item.copyable
          },
          idx
        ))
      ] })
    ] })
  ] });
}
var styles17 = StyleSheet.create({
  container: {
    gap: 12
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14
  },
  logoImage: {
    width: 48,
    height: 48,
    resizeMode: "cover"
  },
  logoIconFallback: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1
  },
  metaColumn: {
    flex: 1,
    gap: 3
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6
  },
  authorText: {
    fontSize: 11
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128, 128, 128, 0.2)"
  }
});
function TruncatedText({
  text,
  maxLength = 32,
  mode = "middle",
  pathOptions,
  copyable = true,
  mono = true,
  toastMessage = "Copied",
  style,
  textStyle
}) {
  const { colors, fonts, isCompact, touchTargetMin } = usePluginTheme();
  const { Icon: Icon2, useToast } = getClientHost();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  if (!text) {
    return /* @__PURE__ */ jsx(Text, { style: [{ color: colors.foregroundMuted }, textStyle], children: "-" });
  }
  let formattedText = text;
  if (text.length > maxLength) {
    switch (mode) {
      case "path":
        formattedText = truncatePath(text, maxLength, pathOptions);
        break;
      case "end":
        formattedText = truncate(text, maxLength);
        break;
      case "middle":
      default:
        formattedText = truncateMiddle(text, maxLength);
        break;
    }
  }
  const handleCopy = async () => {
    if (!copyable || !text) return;
    const ok = await copyToClipboard(text, {
      toast,
      toastMessage
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    }
  };
  const fontFamily = mono ? fonts.mono ?? Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) : void 0;
  return /* @__PURE__ */ jsxs(View, { style: [styles18.container, style], children: [
    /* @__PURE__ */ jsx(
      Text,
      {
        selectable: true,
        numberOfLines: 1,
        ellipsizeMode: "clip",
        accessibilityLabel: text,
        style: [
          styles18.text,
          {
            color: colors.foreground,
            fontFamily
          },
          textStyle
        ],
        children: formattedText
      }
    ),
    copyable && /* @__PURE__ */ jsx(
      Pressable,
      {
        onPress: handleCopy,
        hitSlop: Math.max(8, (touchTargetMin - 20) / 2),
        style: styles18.copyBtn,
        accessibilityRole: "button",
        accessibilityLabel: `Copy ${text}`,
        children: /* @__PURE__ */ jsx(
          Icon2,
          {
            name: copied ? "Check" : "Copy",
            size: isCompact ? 12 : 13,
            color: copied ? colors.statusSuccess : colors.foregroundMuted
          }
        )
      }
    )
  ] });
}
var styles18 = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "100%",
    gap: 6
  },
  text: {
    fontSize: 12,
    lineHeight: 18,
    flexShrink: 1
  },
  copyBtn: {
    padding: 3,
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center"
  }
});
function ModalBody({
  children,
  style,
  contentContainerStyle,
  extraBottomInset = 0,
  refreshing = false,
  onRefresh,
  stickToEnd = false,
  scrollRef
}) {
  const { isCompact, padding, colors } = usePluginTheme();
  const hostScrollView = getOptionalClientHost()?.ScrollView;
  const ResolvedScrollView = selectHostScrollView(
    getOptionalClientHost(),
    ScrollView
  );
  const innerRef = useRef(null);
  const setRefs = (node) => {
    innerRef.current = node;
    if (typeof scrollRef === "function") {
      scrollRef(node);
    } else if (scrollRef) {
      scrollRef.current = node;
    }
  };
  const bottomPadding = (isCompact ? 48 : 20) + extraBottomInset;
  const refreshControl = onRefresh ? /* @__PURE__ */ jsx(
    RefreshControl,
    {
      refreshing,
      onRefresh,
      tintColor: colors.accent,
      colors: [colors.accent]
    }
  ) : void 0;
  if (isCompact && !hostScrollView) {
    return /* @__PURE__ */ jsx(
      View,
      {
        style: [
          styles19.content,
          {
            backgroundColor: colors.surface0,
            paddingHorizontal: padding.horizontal,
            paddingTop: padding.vertical,
            paddingBottom: bottomPadding,
            gap: padding.gap
          },
          style,
          contentContainerStyle
        ],
        children
      }
    );
  }
  return /* @__PURE__ */ jsx(
    ResolvedScrollView,
    {
      ref: setRefs,
      style: [{ backgroundColor: colors.surface0 }, styles19.container, style],
      nestedScrollEnabled: true,
      keyboardShouldPersistTaps: "handled",
      showsVerticalScrollIndicator: true,
      refreshControl,
      onContentSizeChange: stickToEnd ? () => innerRef.current?.scrollToEnd({ animated: true }) : void 0,
      contentContainerStyle: [
        styles19.content,
        {
          paddingHorizontal: padding.horizontal,
          paddingTop: padding.vertical,
          paddingBottom: bottomPadding,
          gap: padding.gap
        },
        contentContainerStyle
      ],
      children
    }
  );
}
var styles19 = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    maxWidth: "100%"
  },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: "100%"
  }
});
function ActionBar({
  children,
  align = "flex-end",
  direction = "auto",
  style
}) {
  const { isCompact, padding } = usePluginTheme();
  const isColumn = direction === "column" || direction === "auto" && isCompact;
  return /* @__PURE__ */ jsx(
    View,
    {
      style: [
        styles20.container,
        {
          flexDirection: isColumn ? "column" : "row",
          justifyContent: isColumn ? "flex-start" : align,
          alignItems: isColumn ? "stretch" : "center",
          gap: isCompact ? 8 : 10,
          marginTop: padding.vertical
        },
        style
      ],
      children
    }
  );
}
var styles20 = StyleSheet.create({
  container: {
    flexWrap: "wrap"
  }
});
function FormRow({ label, description, children, style }) {
  const { colors, flair, isCompact } = usePluginTheme();
  return /* @__PURE__ */ jsxs(View, { style: [styles21.container, style], children: [
    /* @__PURE__ */ jsx(
      Text,
      {
        style: [
          styles21.label,
          {
            color: colors.foreground,
            fontSize: isCompact ? 12 : 13,
            textTransform: flair.headingTransform === "uppercase" ? "uppercase" : "none"
          }
        ],
        children: label
      }
    ),
    description && /* @__PURE__ */ jsx(
      Text,
      {
        style: [
          styles21.description,
          { color: colors.foregroundMuted, fontSize: isCompact ? 11 : 12 }
        ],
        children: description
      }
    ),
    /* @__PURE__ */ jsx(View, { style: styles21.content, children })
  ] });
}
var styles21 = StyleSheet.create({
  container: {
    gap: 4,
    width: "100%"
  },
  label: {
    fontWeight: "600"
  },
  description: {
    lineHeight: 16
  },
  content: {
    marginTop: 2
  }
});
var probeSequence = 0;
function registerComposerPill(client, options) {
  const { Icon: Icon2, Modal } = getClientHost();
  const openers = /* @__PURE__ */ new Map();
  const pills = /* @__PURE__ */ new Map();
  let detectedShape = null;
  function PillPopoverContent(props) {
    const pillProps = {
      agentId: props.agentId,
      workspaceId: props.workspaceId,
      theme: props.theme,
      layout: props.layout,
      host: props.host ?? { id: "", label: "" }
    };
    return /* @__PURE__ */ jsx(PluginThemeProvider, { theme: props.theme, layout: props.layout, flair: options.flair, children: /* @__PURE__ */ jsx(View, { style: styles22.popoverContainer, children: options.renderModal({ ...pillProps, close: props.close }) }) });
  }
  function PillHost(props) {
    const [open, setOpen] = useState(false);
    const [payload, setPayload] = useState(void 0);
    useEffect(() => {
      openers.set(props.agentId, (incomingPayload) => {
        setPayload(incomingPayload);
        setOpen(true);
      });
      return () => {
        openers.delete(props.agentId);
      };
    }, [props.agentId]);
    const effectiveModalTitle = options.modalTitle ?? options.title;
    const modalIconElement = useMemo(() => {
      if (React8.isValidElement(options.modalIcon)) {
        return options.modalIcon;
      }
      const iconName = typeof options.modalIcon === "string" ? options.modalIcon : options.icon;
      if (iconName) {
        return /* @__PURE__ */ jsx(Icon2, { name: iconName, size: 16, color: props.theme.colors.foreground });
      }
      return void 0;
    }, [options.modalIcon, options.icon, props.theme.colors.foreground]);
    const renderPillProps = {
      ...props,
      isOpen: open,
      open: (customPayload) => {
        setPayload(customPayload);
        setOpen(true);
      },
      close: () => setOpen(false),
      toggle: (customPayload) => {
        setPayload(customPayload);
        setOpen((prev) => !prev);
      }
    };
    return /* @__PURE__ */ jsxs(PluginThemeProvider, { theme: props.theme, layout: props.layout, flair: options.flair, children: [
      options.renderPill ? options.renderPill(renderPillProps) : /* @__PURE__ */ jsx(
        DefaultPillBody,
        {
          title: options.title,
          compactTitle: options.compactTitle,
          icon: options.icon,
          compactIcon: options.compactIcon,
          badgeText: options.badgeText,
          compactBadgeText: options.compactBadgeText,
          theme: props.theme
        }
      ),
      /* @__PURE__ */ jsx(
        Modal,
        {
          title: effectiveModalTitle,
          icon: modalIconElement,
          open,
          onOpenChange: (nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) {
              setPayload(void 0);
            }
          },
          children: /* @__PURE__ */ jsx(Modal.Content, { children: open ? /* @__PURE__ */ jsx(PluginThemeProvider, { theme: props.theme, layout: props.layout, flair: options.flair, children: options.renderModal({
            ...props,
            close: () => setOpen(false),
            payload
          }) }) : null })
        }
      )
    ] });
  }
  function toCleanup(registration) {
    if (typeof registration === "function") return registration;
    return () => registration.remove();
  }
  function reportError(agentId, workspaceId, error) {
    pills.set(agentId, {
      dispose: () => {
      }
    });
    options.onError?.({
      agentId,
      workspaceId,
      error: error instanceof Error ? error : new Error(String(error))
    });
  }
  function resolveAndPushLabel(agentId, workspaceId, registration) {
    if (typeof registration === "function") return;
    if (!options.resolveLabel) return;
    Promise.resolve().then(() => options.resolveLabel({ agentId, workspaceId })).then((label) => {
      if (label !== void 0 && pills.has(agentId)) {
        registration.update({ label });
      }
    }).catch((error) => {
      options.onError?.({
        agentId,
        workspaceId,
        error: error instanceof Error ? error : new Error(String(error))
      });
    });
  }
  function detectShape(agentId, workspaceId) {
    probeSequence += 1;
    const probeId = `php-probe-${probeSequence}`;
    try {
      const registration = client.addComposerPill({
        id: probeId,
        workspaceId,
        agentId,
        button: {
          title: "probe",
          icon: "Activity",
          behavior: {
            kind: "action",
            onPress() {
            }
          }
        }
      });
      toCleanup(registration)();
      return "button";
    } catch {
      return "legacy";
    }
  }
  function addPill(agentId, workspaceId) {
    if (pills.has(agentId)) return;
    try {
      if (!detectedShape) {
        detectedShape = detectShape(agentId, workspaceId);
      }
      if (detectedShape === "button") {
        const registration = client.addComposerPill({
          id: options.id,
          workspaceId,
          agentId,
          button: {
            title: options.title,
            icon: options.icon ?? "Activity",
            label: options.title,
            behavior: {
              kind: "popover",
              Content: PillPopoverContent
            }
          }
        });
        const entry = {
          dispose: toCleanup(registration)
        };
        pills.set(agentId, entry);
        if (options.resolveLabel && typeof registration !== "function") {
          resolveAndPushLabel(agentId, workspaceId, registration);
          const intervalMs = options.refreshIntervalMs ?? 5e3;
          if (intervalMs > 0) {
            entry.timer = setInterval(() => {
              resolveAndPushLabel(agentId, workspaceId, registration);
            }, intervalMs);
          }
        }
        return;
      }
      const cleanup = client.addComposerPill({
        id: options.id,
        title: options.title,
        workspaceId,
        agentId,
        Component: PillHost,
        onPress() {
          const opener = openers.get(agentId);
          if (opener) {
            const defaultPayload = options.resolveDefaultPayload?.({ agentId, workspaceId });
            opener(defaultPayload);
          }
        }
      });
      pills.set(agentId, { dispose: toCleanup(cleanup) });
    } catch (error) {
      reportError(agentId, workspaceId, error);
    }
  }
  function removePill(agentId) {
    const entry = pills.get(agentId);
    if (entry?.timer) clearInterval(entry.timer);
    entry?.dispose();
    pills.delete(agentId);
    openers.delete(agentId);
  }
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if ("agentId" in update && update.kind === "remove") {
      removePill(update.agentId);
      return;
    }
    if ("agent" in update) {
      const { id, workspaceId } = update.agent;
      if (workspaceId) addPill(id, workspaceId);
    }
  });
  client.paseo.agents.list().then((result) => {
    for (const { agent } of result.entries) {
      if (agent.workspaceId) addPill(agent.id, agent.workspaceId);
    }
  }).catch(() => {
  });
  return () => {
    unsubscribe();
    for (const entry of pills.values()) {
      if (entry.timer) clearInterval(entry.timer);
      entry.dispose();
    }
    pills.clear();
    openers.clear();
  };
}
function DefaultPillBody({
  title,
  compactTitle,
  icon,
  compactIcon,
  badgeText,
  compactBadgeText,
  theme
}) {
  const { Icon: Icon2 } = getClientHost();
  const { isCompact } = useResponsive();
  const effectiveTitle = isCompact && compactTitle ? compactTitle : title;
  const effectiveIcon = isCompact && compactIcon ? compactIcon : icon;
  const effectiveBadge = isCompact && compactBadgeText !== void 0 ? compactBadgeText : badgeText;
  return /* @__PURE__ */ jsxs(View, { style: styles22.pillContainer, children: [
    effectiveIcon && /* @__PURE__ */ jsx(Icon2, { name: effectiveIcon, size: 13, color: theme.colors.foreground }),
    effectiveTitle ? /* @__PURE__ */ jsx(Text, { style: [styles22.title, { color: theme.colors.foreground }], children: effectiveTitle }) : null,
    effectiveBadge && /* @__PURE__ */ jsx(View, { style: [styles22.badge, { backgroundColor: theme.colors.surface1 }], children: /* @__PURE__ */ jsx(Text, { style: [styles22.badgeText, { color: theme.colors.foregroundMuted }], children: effectiveBadge }) })
  ] });
}
var styles22 = StyleSheet.create({
  popoverContainer: {
    width: "100%"
  },
  pillContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  title: {
    fontSize: 12,
    fontWeight: "500"
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 1
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600"
  }
});
function registerSidebarSurface(plugin, options) {
  const { id, title, icon, Component, flair } = options;
  const WrappedComponent = (props) => /* @__PURE__ */ jsx(PluginThemeProvider, { theme: props.theme, layout: props.layout, flair, children: /* @__PURE__ */ jsx(Component, { ...props }) });
  plugin.addSurface(id, WrappedComponent);
  plugin.addSidebarItem({
    id,
    title,
    icon,
    surface: id
  });
}
function registerWorkspacePanel(plugin, options) {
  const { id, title, icon, Component, flair } = options;
  const WrappedComponent = (props) => /* @__PURE__ */ jsx(PluginThemeProvider, { theme: props.theme, layout: props.layout, flair, children: /* @__PURE__ */ jsx(Component, { ...props }) });
  plugin.addWorkspacePanel({
    id,
    title,
    icon,
    context: "workspace",
    Component: WrappedComponent
  });
}
function registerAgentPanel(plugin, options) {
  const { id, title, icon, Component, flair } = options;
  const WrappedComponent = (props) => /* @__PURE__ */ jsx(PluginThemeProvider, { theme: props.theme, layout: props.layout, flair, children: /* @__PURE__ */ jsx(Component, { ...props }) });
  plugin.addWorkspacePanel({
    id,
    title,
    icon,
    context: "agent",
    Component: WrappedComponent
  });
}
function useRpcQuery(contract, input, options) {
  const { useRpc } = getClientHost();
  const callRpc = useRpc(contract);
  return useQuery({
    queryKey: [contract.name, input],
    queryFn: () => callRpc(input),
    ...options
  });
}
function useRpcMutation(contract, options) {
  const { useRpc } = getClientHost();
  const callRpc = useRpc(contract);
  return useMutation({
    mutationFn: (input) => callRpc(input),
    ...options
  });
}
var REFRESH_INTERVALS = {
  "1s": 1e3,
  "2s": 2e3,
  "5s": 5e3,
  "10s": 1e4,
  "15s": 15e3,
  "30s": 3e4,
  "60s": 6e4,
  "5m": 3e5,
  paused: false
};
function useAutoRefreshQuery(contract, input, options) {
  const { defaultRate = "2s", customIntervalMs, isOpen = true, ...queryOptions } = options ?? {};
  const [rate, setRate] = useState(defaultRate);
  const effectiveInterval = useMemo(() => {
    if (!isOpen || rate === "paused") return false;
    if (typeof customIntervalMs === "number" && customIntervalMs > 0) {
      return customIntervalMs;
    }
    return REFRESH_INTERVALS[rate] ?? false;
  }, [isOpen, rate, customIntervalMs]);
  const query = useRpcQuery(contract, input, {
    ...queryOptions,
    refetchInterval: effectiveInterval
  });
  return {
    ...query,
    rate,
    setRate,
    isPolling: effectiveInterval !== false,
    effectiveInterval
  };
}
function usePluginSettings(contract, options = {}) {
  const { useRpc } = getClientHost();
  const queryClient = useQueryClient();
  const queryKey = ["plugin-settings", contract.name];
  const callGet = useRpc(contract.get);
  const callUpdate = useRpc(contract.update);
  const callReset = useRpc(contract.reset);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await callGet({});
      return res;
    },
    // Use placeholderData so UI displays immediately without marking the cache as fresh forever
    placeholderData: options.initialData ?? contract.defaultSettings,
    // Ensure newly mounted components (e.g. Opening modal) immediately re-verify from daemon
    staleTime: options.staleTime ?? 0,
    refetchOnMount: options.refetchOnMount ?? "always",
    refetchOnWindowFocus: options.refetchOnWindowFocus ?? true,
    refetchInterval: options.refetchInterval
  });
  const updateMutation = useMutation({
    mutationFn: async (updates) => {
      const res = await callUpdate(updates);
      return res;
    },
    onMutate: async (newUpdates) => {
      await queryClient.cancelQueries({ queryKey });
      const previousSettings = queryClient.getQueryData(queryKey) ?? contract.defaultSettings;
      const optimistic = {
        ...previousSettings,
        ...newUpdates
      };
      queryClient.setQueryData(queryKey, optimistic);
      return { previousSettings };
    },
    onError: (err, _newUpdates, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(queryKey, context.previousSettings);
      }
      const error = err instanceof Error ? err : new Error(String(err));
      options.onError?.(error, context?.previousSettings);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      options.onSuccess?.(data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });
  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await callReset({});
      return res;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      options.onSuccess?.(data);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });
  const settings = query.data ?? options.initialData ?? contract.defaultSettings;
  return {
    settings,
    updateSettings: (updates) => {
      updateMutation.mutate(updates);
    },
    updateSettingsAsync: (updates) => {
      return updateMutation.mutateAsync(updates);
    },
    resetSettings: () => {
      return resetMutation.mutateAsync();
    },
    isLoading: query.isLoading,
    isUpdating: updateMutation.isPending || resetMutation.isPending,
    isError: query.isError || updateMutation.isError || resetMutation.isError,
    error: query.error || updateMutation.error || resetMutation.error,
    refetch: () => query.refetch()
  };
}
var WRAPPER_TYPES = /* @__PURE__ */ new Set([
  "default",
  "ZodDefault",
  "prefault",
  "ZodPrefault",
  "optional",
  "ZodOptional",
  "nullable",
  "ZodNullable",
  "readonly",
  "ZodReadonly",
  "catch",
  "ZodCatch",
  "nonoptional",
  "ZodNonOptional"
]);
function readDescription(schema) {
  if (!schema || typeof schema !== "object") return void 0;
  if (typeof schema.description === "string" && schema.description.length > 0) {
    return schema.description;
  }
  const def = schema._def ?? schema._zod?.def;
  if (def && typeof def.description === "string" && def.description.length > 0) {
    return def.description;
  }
  return void 0;
}
function readInnerType(schema) {
  if (!schema || typeof schema !== "object") return void 0;
  const def = schema._def ?? schema._zod?.def;
  const inner = def?.innerType ?? schema._def?.innerType ?? schema._zod?.def?.innerType;
  return inner;
}
function unwrapField(raw) {
  let current = raw;
  let description = readDescription(raw);
  let guard = 0;
  while (current && typeof current === "object" && guard++ < 20) {
    const def = current._def ?? current._zod?.def;
    const type = def?.type ?? def?.typeName;
    const ctor = current.constructor?.name;
    if (typeof type === "string" && WRAPPER_TYPES.has(type) || typeof ctor === "string" && WRAPPER_TYPES.has(ctor)) {
      const inner = readInnerType(current);
      if (!inner || inner === current) break;
      current = inner;
      if (!description) description = readDescription(current);
      continue;
    }
    break;
  }
  if (!description) description = readDescription(current);
  return { leaf: current, description };
}
function leafKind(leaf) {
  if (!leaf || typeof leaf !== "object") return void 0;
  const def = leaf._def ?? leaf._zod?.def ?? {};
  const type = def.type ?? def.typeName;
  const ctor = leaf.constructor?.name;
  if (type === "enum" || type === "ZodEnum" || ctor === "ZodEnum") return "enum";
  if (type === "boolean" || type === "ZodBoolean" || ctor === "ZodBoolean") return "boolean";
  if (type === "number" || type === "ZodNumber" || ctor === "ZodNumber") return "number";
  if (type === "string" || type === "ZodString" || type === "string_format" || ctor === "ZodString" || typeof ctor === "string" && ctor.startsWith("ZodString")) {
    return "string";
  }
  return void 0;
}
function enumValues(leaf) {
  const found = [];
  const sources = [leaf?._def, leaf?._zod?.def, leaf];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    if (Array.isArray(source.values)) found.push(...source.values);
    if (Array.isArray(source.options)) {
      for (const option of source.options) {
        if (typeof option === "string") found.push(option);
        else if (option && typeof option === "object" && typeof option.value === "string") {
          found.push(option.value);
        }
      }
    }
    if (source.entries && typeof source.entries === "object") {
      for (const value of Object.values(source.entries)) {
        if (typeof value === "string") found.push(value);
      }
    }
    if (source.enum && typeof source.enum === "object") {
      for (const value of Object.values(source.enum)) {
        if (typeof value === "string") found.push(value);
      }
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const candidate of found) {
    if (typeof candidate === "string" && !seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out.length > 0 ? out : void 0;
}
function getObjectShape(schema) {
  if (!schema || typeof schema !== "object") return void 0;
  const direct = schema.shape;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct;
  }
  const def = schema._def ?? schema._zod?.def;
  if (def && def.shape && typeof def.shape === "object") {
    return def.shape;
  }
  if (def && typeof def.shape === "function") {
    try {
      const resolved = def.shape();
      if (resolved && typeof resolved === "object") return resolved;
    } catch {
      return void 0;
    }
  }
  return void 0;
}
function contractSchemaToFields(schema, overrides = {}) {
  const shape = getObjectShape(schema);
  if (!shape) {
    console.warn("paseo-plugin-helper: settings schema has no object shape, no fields mapped");
    return [];
  }
  const fields = [];
  for (const key of Object.keys(shape)) {
    try {
      const { leaf, description } = unwrapField(shape[key]);
      const kind = leafKind(leaf);
      if (!kind) {
        console.warn(`paseo-plugin-helper: skipping unsupported settings field "${key}"`);
        continue;
      }
      let options;
      if (kind === "enum") {
        options = enumValues(leaf);
        if (!options || options.length === 0) {
          console.warn(`paseo-plugin-helper: skipping enum settings field "${key}" with no options`);
          continue;
        }
      }
      const label = overrides.labels?.[key] ?? description ?? key;
      const hint = overrides.descriptions?.[key] ?? description;
      fields.push({
        key,
        kind,
        label,
        ...hint !== void 0 ? { description: hint } : {},
        ...options ? { options } : {}
      });
    } catch {
      console.warn(`paseo-plugin-helper: skipping unreadable settings field "${key}"`);
    }
  }
  return fields;
}
function createSettingsScreenComponent(contract, ui, fields, sectionTitle) {
  const Select = ui.SettingsSelect;
  return function HelperSettingsScreen(_props) {
    const { settings, updateSettings } = usePluginSettings(contract);
    return /* @__PURE__ */ jsx(ui.SettingsCard, { children: /* @__PURE__ */ jsx(ui.SettingsSection, { title: sectionTitle, children: fields.map((field) => {
      if (field.kind === "boolean") {
        return /* @__PURE__ */ jsx(
          ui.SettingsSwitch,
          {
            label: field.label,
            hint: field.description,
            value: Boolean(settings[field.key]),
            onValueChange: (value) => updateSettings({ [field.key]: value })
          },
          field.key
        );
      }
      if (field.kind === "enum") {
        const selectOptions = (field.options ?? []).map((value) => ({ label: value, value }));
        const current = String(settings[field.key] ?? field.options?.[0] ?? "");
        return /* @__PURE__ */ jsx(
          Select,
          {
            label: field.label,
            hint: field.description,
            value: current,
            options: selectOptions,
            onValueChange: (value) => updateSettings({ [field.key]: value })
          },
          field.key
        );
      }
      const raw = settings[field.key];
      const currentText = raw === void 0 || raw === null ? "" : String(raw);
      if (field.kind === "number") {
        return /* @__PURE__ */ jsx(
          ui.SettingsInput,
          {
            label: field.label,
            hint: field.description,
            initialValue: currentText,
            onChangeText: (text) => {
              if (text.trim() === "") return;
              const next = Number(text);
              if (Number.isNaN(next)) return;
              updateSettings({ [field.key]: next });
            }
          },
          field.key
        );
      }
      return /* @__PURE__ */ jsx(
        ui.SettingsInput,
        {
          label: field.label,
          hint: field.description,
          initialValue: currentText,
          onChangeText: (text) => updateSettings({ [field.key]: text })
        },
        field.key
      );
    }) }) });
  };
}
function registerHelperSettingsScreen(client, contract, options) {
  const id = options.id ?? contract.name;
  const rawDescription = contract.description;
  const title = options.title ?? (typeof rawDescription === "string" && rawDescription.length > 0 ? rawDescription : contract.name);
  const icon = options.icon ?? "Settings";
  const fields = contractSchemaToFields(contract.schema, {
    labels: options.labels,
    descriptions: options.descriptions
  });
  const Component = createSettingsScreenComponent(contract, options.ui, fields, title);
  return client.addSettingsScreen({ id, title, icon, Component });
}
function CustomPillBody({ state }) {
  const { Icon: Icon2 } = getClientHost();
  const { colors } = usePluginTheme();
  const { isCompact } = useResponsive();
  const title = isCompact && state.compactTitle ? state.compactTitle : state.title;
  const icon = isCompact && state.compactIcon ? state.compactIcon : state.icon;
  return /* @__PURE__ */ jsxs(View, { style: styles23.pillContainer, children: [
    icon && /* @__PURE__ */ jsx(Icon2, { name: icon, size: 13, color: colors.foreground }),
    title ? /* @__PURE__ */ jsx(Text, { style: [styles23.pillTitle, { color: colors.foreground }], children: title }) : null,
    /* @__PURE__ */ jsx(
      Badge,
      {
        label: state.displayValue,
        variant: state.status,
        styleVariant: "tinted",
        style: styles23.pillBadge
      }
    )
  ] });
}
function CustomPillModalContent({
  state,
  onRefresh,
  isRefreshing = false
}) {
  const { colors, isCompact } = usePluginTheme();
  const displayText = state.modalOutput || state.rawValue || (state.error ? `Error: ${state.error}` : "No output");
  return /* @__PURE__ */ jsx(View, { style: styles23.modalContent, children: /* @__PURE__ */ jsxs(Card, { children: [
    /* @__PURE__ */ jsx(
      Card.Header,
      {
        title: state.modalTitle ?? state.title,
        subtitle: state.modalDescription,
        icon: state.icon,
        badge: /* @__PURE__ */ jsx(Badge, { label: state.displayValue, variant: state.status }),
        action: onRefresh ? /* @__PURE__ */ jsx(
          Button,
          {
            variant: "secondary",
            size: "sm",
            icon: "RefreshCw",
            loading: isRefreshing,
            label: !isCompact ? "Refresh" : void 0,
            onPress: () => onRefresh()
          }
        ) : void 0
      }
    ),
    /* @__PURE__ */ jsx(
      CodeBlock,
      {
        code: displayText,
        title: state.modalTitle ?? state.title,
        maxHeight: 280,
        copyable: true
      }
    ),
    /* @__PURE__ */ jsx(View, { style: styles23.footerRow, children: /* @__PURE__ */ jsxs(Text, { style: [styles23.timestampText, { color: colors.foregroundMuted }], children: [
      "Last updated: ",
      new Date(state.lastUpdated).toLocaleTimeString()
    ] }) })
  ] }) });
}
function registerCustomPills(client, options) {
  const cleanups = [];
  for (const pill of options.pills) {
    const cleanup = registerComposerPill(client, {
      id: pill.id,
      title: pill.title,
      compactTitle: pill.compactTitle,
      icon: pill.icon,
      compactIcon: pill.compactIcon,
      flair: options.flair,
      resolveLabel: () => pill.displayValue ? `${pill.title} ${pill.displayValue}` : pill.title,
      renderPill: () => /* @__PURE__ */ jsx(CustomPillBody, { state: pill }),
      renderModal: () => {
        const [refreshing, setRefreshing] = useState(false);
        const [currentOutput, setCurrentOutput] = useState(
          pill.modalOutput
        );
        const handleRefresh = useCallback(async () => {
          if (!options.onRefreshModal) return;
          setRefreshing(true);
          try {
            const res = await options.onRefreshModal(pill.id);
            if (res.output) {
              setCurrentOutput(res.output);
            }
          } finally {
            setRefreshing(false);
          }
        }, [pill.id]);
        const activeState = {
          ...pill,
          modalOutput: currentOutput ?? pill.modalOutput
        };
        return /* @__PURE__ */ jsx(
          CustomPillModalContent,
          {
            state: activeState,
            onRefresh: options.onRefreshModal ? handleRefresh : void 0,
            isRefreshing: refreshing
          }
        );
      }
    });
    cleanups.push(cleanup);
  }
  return () => {
    for (const dispose of cleanups) {
      dispose();
    }
  };
}
var styles23 = StyleSheet.create({
  modalContent: {
    width: "100%",
    padding: 12
  },
  pillContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  pillTitle: {
    fontSize: 12,
    fontWeight: "500"
  },
  pillBadge: {
    paddingVertical: 1,
    paddingHorizontal: 5
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: 8
  },
  timestampText: {
    fontSize: 11
  }
});
function Icon(props) {
  const { Icon: HostIconComponent } = getClientHost();
  return /* @__PURE__ */ jsx(HostIconComponent, { ...props });
}

export { AboutSection, ActionBar, AttentionBeacon, Badge, Button, Card, CardHeader, CodeBlock, Collapsible, CustomPillBody, CustomPillModalContent, DataTable, EmptyState, FALLBACK_ACCENT_FOREGROUND, FormRow, Icon, KeyValue, KeyValueGroup, MetricGauge, ModalBody, PASEO_HOST_CSS_VARIABLES, PluginThemeProvider, ProgressBar, REFRESH_INTERVALS, Responsive, SearchInput, StatusDot, Tabs, TextInput, Toggle, TruncatedText, alpha, contractSchemaToFields, copyToClipboard, defaultDarkTheme, defaultFlair, defaultLightTheme, elevationForPlatform, getClientHost, getContrastColor, getDefaultTheme, getLuminance, getOptionalClientHost, getStatusColor, getTouchTargetMin, getVariantPalette, initClientHelpers, isClientHostInitialized, isMobilePlatform, mergeThemeColors, normalizeBeaconMode, readHostThemeVariables, registerAgentPanel, registerComposerPill, registerCustomPills, registerHelperSettingsScreen, registerSidebarSurface, registerWorkspacePanel, resolveBeaconToneColor, resolveButtonAttentionMode, resolveButtonAttentionTone, resolveCollapsibleChevron, resolveCollapsibleHeaderBackground, resolveElevation, resolvePadding, resolveRadius, responsiveSelect, responsiveValue, selectHostScrollView, spacing, triggerHaptic, useAutoRefreshQuery, usePluginSettings, usePluginTheme, useResponsive, useRpcMutation, useRpcQuery };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map