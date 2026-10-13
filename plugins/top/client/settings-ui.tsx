import React from "react";
import { Text } from "react-native";
import {
  HostButton,
  HostRow,
  HostStack,
  useHostTheme,
} from "./host-ui";

export interface ChipOption<T extends string | number> {
  id: T;
  label: string;
  icon?: string | React.ReactNode;
  description?: string;
  disabled?: boolean;
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
 * `ui/` Host primitives so the modal and the sidebar dashboard cannot drift
 * into two hand-rolled chip systems.
 */
export function ChoiceChips<T extends string | number>({
  options,
  value,
  onChange,
  showActiveDescription = false,
}: ChoiceChipsProps<T>) {
  const { colors } = useHostTheme();
  const selected = options.find((option) => option.id === value);
  return (
    <HostStack gap={6}>
      <HostRow wrap gap={6}>
        {options.map((option) => (
          <HostButton
            key={String(option.id)}
            label={option.label}
            icon={option.icon}
            size="sm"
            variant={option.id === value ? "primary" : "ghost"}
            disabled={option.disabled}
            onPress={() => onChange(option.id)}
          />
        ))}
      </HostRow>
      {showActiveDescription && selected?.description ? (
        <Text style={{ fontSize: 9, color: colors.foregroundMuted }}>{selected.description}</Text>
      ) : null}
    </HostStack>
  );
}

export interface MultiChoiceChipsProps<T extends string | number> {
  options: ChipOption<T>[];
  selected: T[];
  onToggle: (id: T) => void;
  /** Inactive button variant, defaults to "secondary". */
  inactiveVariant?: "secondary" | "ghost";
  /** Optional select-all callback to render a helper button. */
  onSelectAll?: () => void;
  /** Optional clear-all callback to render a helper button. */
  onClearAll?: () => void;
}

/**
 * Multi-select chip grid shared by Top settings surfaces for compact pill and
 * timeline metric selection. Wraps fluidly without vertical runaway.
 */
export function MultiChoiceChips<T extends string | number>({
  options,
  selected,
  onToggle,
  inactiveVariant = "secondary",
  onSelectAll,
  onClearAll,
}: MultiChoiceChipsProps<T>) {
  const selectedSet = new Set(selected);
  return (
    <HostStack gap={6}>
      {(onSelectAll || onClearAll) && (
        <HostRow gap={6} justify="end">
          {onSelectAll && (
            <HostButton
              label="All"
              size="sm"
              variant="ghost"
              onPress={onSelectAll}
            />
          )}
          {onClearAll && (
            <HostButton
              label="None"
              size="sm"
              variant="ghost"
              onPress={onClearAll}
            />
          )}
        </HostRow>
      )}
      <HostRow wrap gap={6}>
        {options.map((option) => {
          const isSelected = selectedSet.has(option.id);
          return (
            <HostButton
              key={String(option.id)}
              label={option.label}
              icon={option.icon}
              size="sm"
              variant={isSelected ? "primary" : inactiveVariant}
              disabled={option.disabled}
              onPress={() => onToggle(option.id)}
            />
          );
        })}
      </HostRow>
    </HostStack>
  );
}

