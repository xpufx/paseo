import React from "react";
import { Text } from "react-native";
import { Button, Row, Stack, usePluginTheme } from "paseo-plugin-helper/client";

export interface ChipOption<T extends string | number> {
  id: T;
  label: string;
  description?: string;
}

export interface ChoiceChipsProps<T extends string | number> {
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Show the selected option's description under the chips. */
  showActiveDescription?: boolean;
}

/**
 * Single-select chip row shared by every Top settings surface. Built from the
 * helper `Button`/`Row` primitives so the modal and the sidebar dashboard
 * cannot drift into two hand-rolled chip systems.
 */
export function ChoiceChips<T extends string | number>({
  options,
  value,
  onChange,
  showActiveDescription = false,
}: ChoiceChipsProps<T>) {
  const { colors } = usePluginTheme();
  const selected = options.find((option) => option.id === value);
  return (
    <Stack gap={6}>
      <Row wrap gap={6}>
        {options.map((option) => (
          <Button
            key={String(option.id)}
            label={option.label}
            size="sm"
            variant={option.id === value ? "primary" : "ghost"}
            onPress={() => onChange(option.id)}
          />
        ))}
      </Row>
      {showActiveDescription && selected?.description ? (
        <Text style={{ fontSize: 9, color: colors.foregroundMuted }}>{selected.description}</Text>
      ) : null}
    </Stack>
  );
}
