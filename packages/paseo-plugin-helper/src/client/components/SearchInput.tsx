import React, { type ComponentType, type Ref } from "react";
import {
  StyleSheet,
  TextInput as RNTextInput,
  View,
  Pressable,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
  type TextInputProps as RNTextInputProps,
  type TextInput as RNTextInputInstance,
} from "react-native";
import { getClientHost, getOptionalClientHost } from "../host.js";
import { usePluginTheme } from "../theme/provider.js";

export interface SearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onClear?: () => void;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Standardized search input with search icon, clear button, and theme support.
 */
export function SearchInput({
  value,
  onChangeText,
  placeholder = "Search...",
  onClear,
  style,
  inputStyle,
  testID,
}: SearchInputProps) {
  const { Icon } = getClientHost();
  const ResolvedInput = (getOptionalClientHost()?.TextInput ??
    RNTextInput) as ComponentType<RNTextInputProps & { ref?: Ref<RNTextInputInstance> }>;
  const { colors, resolveRadius, isCompact } = usePluginTheme();
  const radius = resolveRadius("sm");

  const handleClear = () => {
    onChangeText("");
    if (onClear) onClear();
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface1,
          borderColor: colors.border,
          borderRadius: radius,
          height: isCompact ? 36 : 40,
        },
        style,
      ]}
    >
      <View style={styles.iconWrapper}>
        <Icon name="Search" size={16} color={colors.foregroundMuted} />
      </View>
      <ResolvedInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundMuted}
        style={[
          styles.input,
          {
            color: colors.foreground,
            fontSize: isCompact ? 13 : 14,
          },
          inputStyle,
        ]}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {Boolean(value) && (
        <Pressable
          onPress={handleClear}
          style={styles.clearButton}
          hitSlop={8}
          accessibilityLabel="Clear search"
        >
          <Icon name="X" size={14} color={colors.foregroundMuted} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  iconWrapper: {
    marginRight: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    paddingVertical: 0,
    outlineWidth: 0,
  },
  clearButton: {
    padding: 4,
    marginLeft: 4,
  },
});
