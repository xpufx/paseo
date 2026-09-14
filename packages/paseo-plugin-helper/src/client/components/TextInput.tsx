import React, { useState, type ComponentType, type Ref } from "react";
import {
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps as RNTextInputProps,
  type TextInput as RNTextInputInstance,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { getOptionalClientHost } from "../host.js";
import { usePluginTheme } from "../theme/provider.js";

export interface TextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  placeholder?: string;
  helperText?: string;
  errorText?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  disabled?: boolean;
  mono?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  onSubmitEditing?: () => void;
}

export function TextInput({
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
  onSubmitEditing,
}: TextInputProps) {
  const { colors, resolveRadius, isCompact, touchTargetMin, alpha } = usePluginTheme();
  const [isFocused, setIsFocused] = useState(false);
  const ResolvedInput = (getOptionalClientHost()?.TextInput ??
    RNTextInput) as ComponentType<RNTextInputProps & { ref?: Ref<RNTextInputInstance> }>;

  const radius = resolveRadius("md");
  const hasError = Boolean(errorText);

  const borderColor = hasError
    ? colors.statusDanger
    : isFocused
      ? colors.accent
      : colors.border;

  const minHeight = multiline ? Math.max(touchTargetMin * 1.5, 64) : touchTargetMin;

  return (
    <View style={[styles.container, style]}>
      {label ? (
        <Text
          style={[
            styles.label,
            {
              color: hasError ? colors.statusDanger : colors.foreground,
              fontSize: isCompact ? 12 : 13,
            },
          ]}
        >
          {label}
        </Text>
      ) : null}

      <ResolvedInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        editable={!disabled}
        multiline={multiline}
        numberOfLines={numberOfLines}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onSubmitEditing={onSubmitEditing}
        style={[
          styles.input,
          {
            color: disabled ? colors.foregroundMuted : colors.foreground,
            backgroundColor: disabled ? alpha(colors.surface1, 0.5) : colors.surface0,
            borderColor,
            borderRadius: radius,
            minHeight,
            paddingVertical: multiline ? 8 : 6,
            paddingHorizontal: 10,
            fontSize: isCompact ? 13 : 14,
            fontFamily: mono ? "monospace" : undefined,
          },
          inputStyle,
        ]}
      />

      {(errorText || helperText) && (
        <Text
          style={[
            styles.hint,
            {
              color: hasError ? colors.statusDanger : colors.foregroundMuted,
              fontSize: 11,
            },
          ]}
        >
          {errorText || helperText}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  label: {
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
  },
  hint: {
    marginTop: 2,
  },
});
