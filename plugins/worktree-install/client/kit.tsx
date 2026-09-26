import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Linking, Pressable, Text, View, type ViewStyle } from "react-native";
import { Icon, TextInput, copyText } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { agentHref, statePresentation, type SignalTone } from "../shared/derive.js";
import { paletteFor, type Palette, type Tone } from "./theme.js";

/**
 * The host hands every surface a layout descriptor. It is structural on purpose:
 * the SDK types it loosely, so the plugin pins the shape it actually reads.
 */
export interface SurfaceLayout {
  compact: boolean;
  platform: "ios" | "android" | "web";
  width?: number;
  height?: number;
}

/**
 * The layout kit for this surface.
 *
 * Deliberately hand-built and local. The operator lifted the constraint of
 * using the shared helper's UI kit, so nothing here is imported from it — these
 * are plain `react-native` primitives, the host's own `Icon`/`TextInput`/
 * `copyText`, and the two-palette theme in `./theme.ts`.
 */

// --- Type scale -----------------------------------------------------------

export interface TypeProps {
  children: ReactNode;
  size?: number;
  weight?: "400" | "500" | "600" | "700";
  color?: string;
  mono?: boolean;
  upper?: boolean;
  numberOfLines?: number;
  style?: ViewStyle;
  testID?: string;
}

export function Type({
  children,
  size = 12,
  weight = "500",
  color,
  mono,
  upper,
  numberOfLines,
  style,
  testID,
}: TypeProps) {
  const { palette } = useSkin();
  return (
    <Text
      testID={testID}
      numberOfLines={numberOfLines}
      style={[
        {
          color: color ?? palette.text,
          fontSize: size,
          fontWeight: weight,
          ...(mono ? { fontFamily: palette.mono } : null),
          ...(upper ? { letterSpacing: 0.7, textTransform: "uppercase" } : null),
        },
        style as never,
      ]}
    >
      {children}
    </Text>
  );
}

// --- Boxes ----------------------------------------------------------------

export interface StackProps {
  children: ReactNode;
  gap?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  grow?: boolean;
  style?: ViewStyle;
  testID?: string;
}

const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as const;
const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" } as const;

export function Stack({
  children,
  gap = 0,
  align = "start",
  justify = "start",
  wrap,
  grow,
  style,
  testID,
}: StackProps) {
  return (
    <View
      testID={testID}
      style={[
        {
          flexDirection: "column",
          gap,
          alignItems: ALIGN[align],
          justifyContent: JUSTIFY[justify],
          ...(wrap ? { flexWrap: "wrap" } : null),
          ...(grow ? { flex: 1, minWidth: 0, minHeight: 0 } : null),
        },
        style as never,
      ]}
    >
      {children}
    </View>
  );
}

export function Cluster({
  children,
  gap = 6,
  align = "center",
  justify = "start",
  wrap = true,
  grow,
  style,
  testID,
}: StackProps) {
  return (
    <View
      testID={testID}
      style={[
        {
          flexDirection: "row",
          gap,
          alignItems: ALIGN[align],
          justifyContent: JUSTIFY[justify],
          ...(wrap ? { flexWrap: "wrap" } : null),
          ...(grow ? { flex: 1, minWidth: 0, minHeight: 0 } : null),
        },
        style as never,
      ]}
    >
      {children}
    </View>
  );
}

// --- Press ----------------------------------------------------------------

export interface PressProps {
  children: ReactNode;
  onPress?: () => void;
  onHoverChange?: (hovered: boolean) => void;
  tone?: Tone;
  /** Renders a filled wash behind the row while hovered. */
  hover?: boolean;
  selected?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link";
  testID?: string;
  style?: ViewStyle;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  gap?: number;
}

export function Press({
  children,
  onPress,
  onHoverChange,
  tone,
  hover = true,
  selected,
  disabled,
  accessibilityLabel,
  accessibilityRole = "button",
  testID,
  style,
  align = "center",
  justify = "start",
  wrap = true,
  gap = 6,
}: PressProps) {
  const { palette } = useSkin();
  const [hovered, setHovered] = useState(false);
  const set = (next: boolean) => {
    setHovered(next);
    onHoverChange?.(next);
  };
  // React Native's types omit the DOM hover handlers the web host does supply.
  // Hover is progressive enhancement here, so the handlers are added through a
  // single deliberate widening rather than four suppressions.
  const webHover = {
    onMouseEnter: () => set(true),
    onMouseLeave: () => set(false),
  } as Partial<React.ComponentProps<typeof Pressable>>;

  const toneColor = tone ? toneColorOf(palette, tone) : palette.accent;
  const background = selected
    ? palette.wash(tone ?? "accent", 0.18)
    : hovered && hover
      ? palette.wash(tone ?? "accent", 0.09)
      : "transparent";

  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      {...webHover}
      style={({ pressed }: { pressed: boolean }) => [
        {
          flexDirection: "row",
          alignItems: ALIGN[align],
          justifyContent: JUSTIFY[justify],
          flexWrap: wrap ? "wrap" : "nowrap",
          gap,
          paddingVertical: 3,
          paddingHorizontal: 5,
          marginVertical: -3,
          borderRadius: 4,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
          backgroundColor: background,
          ...(selected ? { boxShadow: `inset 2px 0 0 ${toneColor}` } : null),
        },
        style as never,
      ]}
    >
      {children}
    </Pressable>
  );
}

// --- Chips, stats, dots ---------------------------------------------------

export interface ChipProps {
  label: string;
  tone?: Tone;
  dot?: boolean;
  mono?: boolean;
  size?: number;
  strong?: boolean;
  onPress?: () => void;
  title?: string;
  testID?: string;
}

export function Chip({ label, tone = "muted", dot, mono, size = 10, strong, onPress, title, testID }: ChipProps) {
  const { palette } = useSkin();
  const color = toneColorOf(palette, tone);
  const body = (
    <>
      {dot ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} /> : null}
      <Type size={size} weight={strong ? "700" : "600"} color={color} mono={mono} numberOfLines={1}>
        {label}
      </Type>
    </>
  );
  const style = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: palette.wash(tone, 0.4),
    backgroundColor: palette.wash(tone, 0.1),
    maxWidth: 220,
  };
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={title ?? label}
        onPress={onPress}
        style={style as never}
      >
        {body}
      </Pressable>
    );
  }
  return (
    <View testID={testID} accessibilityLabel={title} style={style as never}>
      {body}
    </View>
  );
}

export function Stat({
  label,
  value,
  tone = "muted",
  onPress,
  testID,
}: {
  label: string;
  value: number | string;
  tone?: Tone;
  onPress?: () => void;
  testID?: string;
}) {
  const { palette } = useSkin();
  const color = toneColorOf(palette, tone);
  const inner = (
    <>
      <Type size={9} weight="700" color={palette.textFaint} upper>
        {label}
      </Type>
      <Type size={16} weight="700" color={color} testID={testID ? `${testID}-value` : undefined}>
        {value}
      </Type>
    </>
  );
  const style: ViewStyle = {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: onPress ? palette.wash(tone, 0.08) : "transparent",
  };
  if (onPress) {
    return (
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`Filter ${label}`} onPress={onPress} style={style as never}>
        {inner}
      </Pressable>
    );
  }
  return <View testID={testID} style={style}>{inner}</View>;
}

export interface LiveDotProps {
  tone?: Tone;
  size?: number;
  pulse?: boolean;
  testID?: string;
}

/** A dot that breathes while the thing it marks is doing work. */
export function LiveDot({ tone = "ok", size = 7, pulse, testID }: LiveDotProps) {
  const { palette } = useSkin();
  const color = toneColorOf(palette, tone);
  const value = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) {
      value.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 0.3, duration: 850, useNativeDriver: true }),
        Animated.timing(value, { toValue: 1, duration: 850, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, value]);

  return (
    <Animated.View
      testID={testID}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: value,
      }}
    />
  );
}

/** Slow expanding ring, used to mark an agent that cannot proceed unaided. */
export function Beacon({ tone = "warn", children, testID }: { tone?: Tone; children: ReactNode; testID?: string }) {
  const { palette } = useSkin();
  const color = toneColorOf(palette, tone);
  const halo = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(halo, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(halo, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [halo]);

  return (
    <View testID={testID} style={{ position: "relative" }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -2,
          left: -2,
          width: 11,
          height: 11,
          borderRadius: 6,
          borderWidth: 1.5,
          borderColor: color,
          opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
          transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.7, 2.1] }) }],
        }}
      />
      <View style={{ position: "relative" }}>
        <LiveDot tone={tone} size={7} />
      </View>
      <View style={{ position: "absolute", left: 12, right: 0, top: 0 }}>{children}</View>
    </View>
  );
}

// --- Rows and fields ------------------------------------------------------

export function Field({
  label,
  value,
  mono,
  copyable,
  tone,
  testID,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
  tone?: Tone;
  testID?: string;
}) {
  const { palette, onCopy } = useSkin();
  return (
    <View testID={testID} style={{ minWidth: 96, flexGrow: 1, flexBasis: 120 }}>
      <Type size={9} weight="700" color={palette.textFaint} upper>
        {label}
      </Type>
      <Cluster gap={5}>
        <Type size={11} weight="600" color={tone ? toneColorOf(palette, tone) : palette.text} mono={mono} numberOfLines={2}>
          {value}
        </Type>
        {copyable ? (
          <Press onPress={() => onCopy(value)} accessibilityLabel={`Copy ${label}`} style={{ padding: 2 }}>
            <Type size={9} color={palette.textFaint} mono>
              copy
            </Type>
          </Press>
        ) : null}
      </Cluster>
    </View>
  );
}

export function Banner({
  tone = "warn",
  title,
  detail,
  actions,
  testID,
}: {
  tone?: Tone;
  title: string;
  detail?: string;
  actions?: ReactNode;
  testID?: string;
}) {
  const { palette } = useSkin();
  const color = toneColorOf(palette, tone);
  return (
    <View
      testID={testID}
      style={{
        borderWidth: 1,
        borderColor: palette.wash(tone, 0.5),
        backgroundColor: palette.wash(tone, 0.09),
        borderRadius: 4,
        paddingHorizontal: 8,
        paddingVertical: 6,
        gap: 4,
      }}
    >
      <Cluster gap={6}>
        <LiveDot tone={tone} size={6} />
        <Type size={10} weight="700" color={color} testID={testID ? `${testID}-title` : undefined}>
          {title}
        </Type>
        {actions}
      </Cluster>
      {detail ? (
        <Type size={11} color={palette.textDim}>
          {detail}
        </Type>
      ) : null}
    </View>
  );
}

/** Monospace command line with a copy affordance. */
export function Command({ value, label, testID }: { value: string; label: string; testID?: string }) {
  const { palette, onCopy } = useSkin();
  return (
    <Cluster gap={6} style={{ flexGrow: 1, minWidth: 0 }}>
      <View
        style={{
          flexGrow: 1,
          minWidth: 0,
          backgroundColor: palette.wash("muted", 0.1),
          borderRadius: 3,
          paddingHorizontal: 6,
          paddingVertical: 3,
        }}
      >
        <Type size={10} mono color={palette.textDim} numberOfLines={1} testID={testID}>
          {value}
        </Type>
      </View>
      <Press onPress={() => onCopy(value)} accessibilityLabel={label} style={{ padding: 2 }}>
        <Type size={9} color={palette.accent} upper>
          copy
        </Type>
      </Press>
    </Cluster>
  );
}

export function Empty({
  title,
  detail,
  action,
  testID,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  testID?: string;
}) {
  const { palette } = useSkin();
  return (
    <Stack gap={4} align="center" style={{ paddingVertical: 18 }} testID={testID}>
      <Type size={12} weight="700" color={palette.textDim}>
        {title}
      </Type>
      {detail ? (
        <Type size={11} color={palette.textFaint} style={{ textAlign: "center" } as never}>
          {detail}
        </Type>
      ) : null}
      {action}
    </Stack>
  );
}

// --- Composite ------------------------------------------------------------

/** Horizontal section switcher. Underlined on desktop, filled on narrow. */
export function SectionTabs<T extends string>({
  tabs,
  active,
  onChange,
  counts,
  testID,
}: {
  tabs: Array<{ id: T; label: string }>;
  active: T;
  onChange: (id: T) => void;
  counts?: Partial<Record<T, number>>;
  testID?: string;
}) {
  const { palette } = useSkin();
  return (
    <Cluster gap={2} wrap={false} style={{ flexGrow: 0 }} testID={testID}>
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        const count = counts?.[tab.id];
        return (
          <Pressable
            key={tab.id}
            testID={testID ? `${testID}-${tab.id}` : undefined}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
            onPress={() => onChange(tab.id)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingHorizontal: 9,
              paddingVertical: 5,
              borderRadius: 4,
              backgroundColor: isActive ? palette.wash("accent", 0.16) : "transparent",
              borderBottomWidth: 2,
              borderBottomColor: isActive ? palette.accent : "transparent",
            }}
          >
            <Type size={11} weight="700" color={isActive ? palette.accent : palette.textDim}>
              {tab.label}
            </Type>
            {count !== undefined ? (
              <Type size={9} weight="700" color={isActive ? palette.accent : palette.textFaint}>
                {count}
              </Type>
            ) : null}
          </Pressable>
        );
      })}
    </Cluster>
  );
}

/** Single-select scope control: a wrapping chip row, one per repository. */
export function ScopeChips<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (value: T) => void;
  testID?: string;
}) {
  const { palette } = useSkin();
  return (
    <Cluster gap={4} testID={testID}>
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <Press
            key={option.value}
            testID={testID ? `${testID}-${option.value}` : undefined}
            onPress={() => onChange(option.value)}
            selected={isActive}
            tone="accent"
            style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 3 }}
          >
            <Type size={10} weight={isActive ? "700" : "500"} color={isActive ? palette.accent : palette.textDim} numberOfLines={1}>
              {option.label}
            </Type>
          </Press>
        );
      })}
    </Cluster>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  testID,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testID?: string;
}) {
  const { palette } = useSkin();
  return (
    <View
      style={{
        flexGrow: 1,
        minWidth: 160,
        borderWidth: 1,
        borderColor: palette.rule,
        backgroundColor: palette.panel,
        borderRadius: 3,
        paddingHorizontal: 7,
      }}
    >
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.textFaint}
        style={{
          color: palette.text,
          fontSize: 11,
          paddingVertical: 4,
          minHeight: 24,
            outlineStyle: "none",
        } as never}
      />
    </View>
  );
}

/** Tree connector glyph. Box-drawing rather than an icon so depth reads. */
export function Guide({ last, compact }: { last: boolean; compact?: boolean }) {
  const { palette } = useSkin();
  return (
    <View style={{ width: 16, alignItems: "flex-end", paddingRight: 2 }}>
      <Type size={10} mono color={palette.ruleStrong} testID={compact ? "guide-compact" : "guide"}>
        {last ? "└" : "├"}
      </Type>
    </View>
  );
}

export function Hairline({ color, inset = 0 }: { color?: string; inset?: number }) {
  const { palette } = useSkin();
  return <View style={{ height: 1, marginLeft: inset, backgroundColor: color ?? palette.rule }} />;
}

// --- Skin -----------------------------------------------------------------

export interface Skin {
  palette: Palette;
  layout: SurfaceLayout;
  /** Wide enough for a two-pane split. */
  wide: boolean;
  /** Narrow enough that a table must become a list. */
  narrow: boolean;
  isMobile: boolean;
  touchTarget: number;
  Icon: typeof import("@getpaseo/plugin/client/react-native").Icon;
  onCopy: (value: string) => void;
}

const SkinContext = React.createContext<Skin | null>(null);

/** Width at which the surface splits into two panes. */
const WIDE_BREAKPOINT = 900;
/** Width at which dense rows must drop their secondary fields. */
const NARROW_BREAKPOINT = 620;
/** Minimum comfortable finger target, and the dense one a pointer can live with. */
const MOBILE_TOUCH_TARGET = 44;
const DESKTOP_TOUCH_TARGET = 28;

/**
 * Resolves the mobile signal once, from the width the host actually reports.
 *
 * #684: `isMobile` and `touchTarget` were read off `layout.platform` alone, so a
 * phone-shaped *browser window* — `platform: "web"` at 390px — claimed
 * `isMobile: false` with 28pt targets directly beside `narrow: true` and
 * `wide: false`. Three signals, two answers. A viewport that narrow is a phone
 * whatever runtime is drawing it, so the width decides and the platform is an
 * additional way in rather than the only one: a device the host names
 * ios/android is mobile whatever width it reports. `touchTarget` falls out of
 * the same answer so the two cannot drift apart again.
 */
function mobileSignals(width: number, platform: SurfaceLayout["platform"]) {
  const isMobile = width <= NARROW_BREAKPOINT || platform === "ios" || platform === "android";
  return { isMobile, touchTarget: isMobile ? MOBILE_TOUCH_TARGET : DESKTOP_TOUCH_TARGET };
}

export function SkinProvider({
  theme,
  layout,
  onCopy,
  children,
}: {
  theme: PluginTheme;
  layout: SurfaceLayout;
  onCopy: (value: string) => void;
  children: ReactNode;
}) {
  const palette = paletteFor(theme?.colors?.surface0);
  const width = typeof layout.width === "number" && layout.width > 0 ? layout.width : 1024;
  const value: Skin = {
    palette,
    layout,
    wide: width >= WIDE_BREAKPOINT && !layout.compact,
    narrow: width <= NARROW_BREAKPOINT,
    ...mobileSignals(width, layout.platform),
    Icon,
    onCopy,
  };
  return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>;
}

export function useSkin(): Skin {
  const skin = React.useContext(SkinContext);
  if (skin) return skin;
  // Rendered outside a provider (isolated unit tests): dark, desktop-wide.
  return {
    palette: paletteFor(undefined),
    layout: { compact: false, platform: "web", width: 1280 },
    wide: true,
    narrow: false,
    ...mobileSignals(1280, "web"),
    Icon: (() => null) as Skin["Icon"],
    onCopy: () => {},
  };
}

export function toneColorOf(palette: Palette, tone: Tone): string {
  switch (tone) {
    case "ok":
      return palette.ok;
    case "warn":
      return palette.warn;
    case "critical":
      return palette.critical;
    case "accent":
      return palette.accent;
    case "muted":
      return palette.textDim;
  }
}

/** Maps a derived agent state onto a palette tone. */
export function stateTone(state?: string | null): Tone {
  const tone: SignalTone = statePresentation(state).tone;
  return tone === "critical" ? "critical" : tone === "warn" ? "warn" : "ok";
}

/** Opens a Paseo session, degrading through a deep link to the clipboard. */
export async function openAgent(
  agent: { id: string; url?: string | null },
  openAgentNav?: (input: { agentId: string }) => void,
): Promise<void> {
  if (openAgentNav) {
    openAgentNav({ agentId: agent.id });
    return;
  }
  try {
    await Linking.openURL(agentHref(agent));
  } catch {
    await copyText(agentHref(agent)).catch(() => {});
  }
}
