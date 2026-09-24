# Mobile Architecture & Cross-Platform Rules

> Guide to mobile runtime constraints, avoiding the double-scroll trap in modal bottom sheets, DOM isolation, and automated conformance audits.
>
> **References**:
> - [Upstream Client Runtime and Cross-Platform Rules](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#client-runtime-and-cross-platform-rules)
> - [Upstream Mobile Constraints](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#mobile-constraints)
> - [`paseo-plugin-helper` Conformance System](../../../packages/paseo-plugin-helper/README.md#mobile-modal-gesture-architecture--tabs)

---

## Table of Contents

1. [React Native Mobile Runtime Constraints](#1-react-native-mobile-runtime-constraints)
2. [The Mobile Modal Gesture Architecture](#2-the-mobile-modal-gesture-architecture)
   - [The Double-Scroll Trap](#the-double-scroll-trap)
   - [How `ModalBody` Eliminates the Trap](#how-modalbody-eliminates-the-trap)
   - [Horizontal Swipe Capture in `<Tabs>`](#horizontal-swipe-capture-in-tabs)
3. [Touch Targets & Safe Areas](#3-touch-targets--safe-areas)
4. [The DOM Isolation Pattern (`client/web.ts`)](#4-the-dom-isolation-pattern-clientwebts)
5. [Automated Conformance & Auditing CLI](#5-automated-conformance--auditing-cli)

---

## 1. React Native Mobile Runtime Constraints

Paseo client bundles execute across Desktop (Electron), iOS (Hermes/JSC), Android (Hermes), and Web browsers.

> [!CAUTION]
> On iOS and Android, there is **no browser DOM**, **no HTML rendering engine**, and **no `window` or `document` global object**.
>
> If a client bundle evaluates `window.location` or renders a `<div>`, the app crashes immediately on launch.

### Golden Rules:
1. **Never use HTML tags**:
   - Instead of `<div>`, use `<View>`.
   - Instead of `<p>` or `<span>`, use `<Text>`.
   - Instead of `<button>`, use `<Pressable>` or `<Button>`.
   - Instead of `<input>`, use `<TextInput>`.
2. **Never use DOM synthetic event handlers**:
   - `onClick` does not exist; use `onPress`.
   - `onChange` does not exist on text inputs; use `onChangeText`.
3. **No CSS files or inline style strings**:
   - Styles must be JavaScript objects created with `StyleSheet.create` or inline style objects.

---

## 2. The Mobile Modal Gesture Architecture

### The Double-Scroll Trap
On mobile (`isCompact: true`), Paseo displays dialogs using `@gorhom/bottom-sheet` (`AdaptiveModalSheet`). This sheet relies on a root `PanGestureHandler` to manage dragging, sheet expansion detents, and swipe-down dismissal.

When a plugin nests a standard vertical `<ScrollView>` inside a mobile bottom sheet:
1. **Touch Hijacking**: The bottom sheet’s pan recognizer and the inner scroll view fight for touch ownership.
2. **Double-Scroll Lock**: Scrolling velocity locks up, gestures fail to dismiss, and users become stuck inside the modal.

```text
[Mobile Screen]
  └─ AdaptiveModalSheet (Owns Root PanGestureHandler)
       └─ BottomSheetScrollView (Paseo Host Scroller)
            └─ [TRAP] Plugin <ScrollView>  <── CONFLICT: Double-Scroll Lock!
```

### How `ModalBody` Eliminates the Trap
[`ModalBody`](../../../packages/paseo-plugin-helper/src/client/layout/ModalBody.tsx) from `paseo-plugin-helper/client` solves this automatically:

- **On Desktop (`isCompact: false`)**: Renders a standard React Native `<ScrollView>` with bounded heights.
- **On Mobile (`isCompact: true`)**: Flattens into a simple `<View>` with safe bottom padding. Vertical scrolling is handed off entirely to Paseo’s outer `BottomSheetScrollView`.

```tsx
import { ModalBody, Card, Text } from "paseo-plugin-helper/client";

// Safe on both desktop and mobile bottom sheets:
<ModalBody>
  <Card>
    <Text>Content scrolls without gesture conflicts</Text>
  </Card>
</ModalBody>
```

### Horizontal Swipe Capture in `<Tabs>`
Horizontal tabs nested inside a vertical gesture sheet often get cancelled by the sheet’s pan gesture.
`<Tabs>` in `paseo-plugin-helper` attaches an active `PanResponder` configured with:
```ts
onMoveShouldSetPanResponderCapture: (_, gestureState) => {
  return Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
}
```
When horizontal movement is detected, `<Tabs>` claims the gesture during the capture phase before the parent bottom sheet can cancel it.

---

## 3. Touch Targets & Safe Areas

- **Minimum Size**: All touch targets (`Button`, `Pressable`, toggles) must maintain minimum dimensions of **44 × 44 pt** on mobile (`layout.compact === true`).
- **Insets**: Use Paseo’s safe bottom insets or `ModalBody` to avoid clipping against home indicators on modern mobile devices.

---

## 4. The DOM Isolation Pattern (`client/web.ts`)

If your plugin requires web-only browser APIs (e.g. downloading a file or interacting with browser canvas):
1. Create a dedicated `client/web.ts` file.
2. Wrap all DOM/window references inside exported functions.
3. Gate execution at runtime using `Platform.OS === "web"`.

```ts
// client/web.ts
import { Platform } from "react-native";

export function downloadFileWeb(filename: string, content: string) {
  if (Platform.OS !== "web") return;

  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

---

## 5. Automated Conformance & Auditing CLI

`paseo-plugin-helper` provides an audit scanner to catch mobile anti-patterns before release:

```bash
# Run automated scan across your plugin codebase
npx paseo-plugin-helper audit
```

### Manual Quick Audit Check:
Run ripgrep from your plugin directory:
```bash
rg -n "document\.|window\.|localStorage|navigator\.|<[a-z]+[ >]|className=|onClick=" client/
```
If this command produces any matches outside of gated `client/web.ts` files, fix them before deploying.
