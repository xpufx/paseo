import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Badge, Button, Card, Icon, TextInput, usePluginTheme } from "paseo-plugin-helper/client";
import type { ApprovalOption } from "../shared/approval";

const EXPIRY_URGENT_S = 30;

export interface AskPetitionItem {
  id: string;
  question?: string;
  options?: ApprovalOption[];
  multiSelect?: boolean;
  allowWriteIn?: boolean;
  recommendedIndex?: number;
  selection?: string;
  selectionIdx?: number;
  expiresIn: number;
  host?: string;
  caller?: string;
  link?: string;
  summary?: string;
}

export interface AskSelectionPayload {
  selection: string;
  selectionIdx?: number;
  writeIn?: boolean;
}

export type AskSelectionResult =
  | { payload: AskSelectionPayload; error?: undefined }
  | { payload?: undefined; error: string };

/**
 * Resolve the operator's local picks into the exact selection 2fado expects.
 *
 * Single-select mirrors the daemon's verbatim `SelectionRecord`: the option's
 * label plus its 0-based index. A write-in carries the free text and no index.
 * Multi-select is joined with ", " (2fado's runtime evaluates a single option
 * today, so the daemon may reject it — the caller surfaces that honestly rather
 * than silently collapsing the answer).
 */
export function buildSelectionPayload(
  item: Pick<AskPetitionItem, "options" | "multiSelect">,
  selectedIds: string[],
  writeInText: string,
): AskSelectionResult {
  const options = item.options ?? [];
  const trimmedWriteIn = writeInText.trim();

  if (item.multiSelect) {
    if (selectedIds.length === 0) {
      return trimmedWriteIn
        ? { payload: { selection: trimmedWriteIn, writeIn: true } }
        : { error: "Pick at least one option." };
    }
    const labels = selectedIds
      .map((id) => options.find((option) => option.id === id)?.label)
      .filter((label): label is string => Boolean(label));
    if (labels.length === 0) return { error: "Selected option is no longer available." };
    return { payload: { selection: labels.join(", ") } };
  }

  if (selectedIds.length === 1) {
    const index = options.findIndex((option) => option.id === selectedIds[0]);
    if (index < 0) return { error: "Selected option is no longer available." };
    return { payload: { selection: options[index].label, selectionIdx: index } };
  }

  if (trimmedWriteIn.length > 0) {
    return { payload: { selection: trimmedWriteIn, writeIn: true } };
  }

  return { error: "Choose an option or write an answer." };
}

/**
 * The option 2fado flagged as recommended. The wire field is 1-based with
 * 0 = none; the UI matches it against the 0-based option index.
 */
export function recommendedOption(
  item: Pick<AskPetitionItem, "options" | "recommendedIndex">,
): ApprovalOption | undefined {
  const options = item.options ?? [];
  const index = item.recommendedIndex;
  if (typeof index !== "number" || index < 1) return undefined;
  return options[index - 1];
}

export function isAskAnswered(item: Pick<AskPetitionItem, "selection">): boolean {
  return typeof item.selection === "string" && item.selection.length > 0;
}

function OptionButton({
  option,
  selected,
  recommended,
  disabled,
  onPress,
}: {
  option: ApprovalOption;
  selected: boolean;
  recommended: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = usePluginTheme();
  const icon = selected ? "CheckCircle2" : "CircleDot";
  return (
    <View style={{ gap: 4 }}>
      <Button
        label={option.label}
        variant={selected ? "primary" : "secondary"}
        size="sm"
        icon={icon}
        iconPosition="left"
        accessibilityLabel={`Option ${option.label}${selected ? " (selected)" : ""}`}
        disabled={disabled}
        onPress={onPress}
        textStyle={{ textAlign: "left" }}
      />
      {recommended ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name="Star" size={11} color={colors.statusWarning} />
          <Text style={{ color: colors.statusWarning, fontSize: 10, fontWeight: "600" }}>
            Recommended
          </Text>
        </View>
      ) : null}
      {option.description ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{option.description}</Text>
      ) : null}
    </View>
  );
}

export function AskItem({
  item,
  submitting = false,
  selectSupported = true,
  errorText,
  onSubmit,
}: {
  item: AskPetitionItem;
  submitting?: boolean;
  selectSupported?: boolean;
  errorText?: string;
  onSubmit(payload: AskSelectionPayload): void;
}) {
  const { colors, fonts } = usePluginTheme();
  const [picked, setPicked] = useState<string[]>([]);
  const [writeIn, setWriteIn] = useState("");
  const [showWriteIn, setShowWriteIn] = useState(false);

  const answered = isAskAnswered(item);
  const urgent = item.expiresIn <= EXPIRY_URGENT_S;
  const options = item.options ?? [];
  const recommended = recommendedOption(item);
  const multiSelect = Boolean(item.multiSelect);
  const allowWriteIn = Boolean(item.allowWriteIn);
  const disabled = submitting || answered;
  const accent = answered ? colors.statusSuccess : urgent ? colors.statusDanger : colors.accent;

  // A refetch can resolve the petition (Telegram or another client won the
  // first-selection race); drop stale local picks so the card shows the
  // authoritative verdict instead of a now-meaningless selection.
  useEffect(() => {
    if (answered) {
      setPicked([]);
      setWriteIn("");
    }
  }, [answered, item.selection]);

  const submit = () => {
    const result = buildSelectionPayload(item, picked, writeIn);
    if (result.error !== undefined) return;
    onSubmit(result.payload);
  };

  const toggle = (option: ApprovalOption) => {
    if (disabled) return;
    if (multiSelect) {
      setPicked((prev) =>
        prev.includes(option.id) ? prev.filter((id) => id !== option.id) : [...prev, option.id],
      );
      return;
    }
    setPicked([option.id]);
    // Single-select without a write-in fallback resolves on tap, matching the
    // daemon's "one tap confirms" semantics. With write-in exposed, the
    // operator may still want "other", so require an explicit submit.
    if (!allowWriteIn) {
      const result = buildSelectionPayload(item, [option.id], "");
      if (result.error === undefined) onSubmit(result.payload);
    }
  };

  const canSubmit = !disabled && (picked.length > 0 || writeIn.trim().length > 0);

  return (
    <Card
      variant="elevated"
      style={{ borderLeftWidth: 4, borderLeftColor: accent, gap: 8, padding: 12 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              backgroundColor: accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name={answered ? "Check" : "MessageSquare"} size={12} color="#ffffff" />
          </View>
          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700", flex: 1 }}>
            {answered ? "Answered" : multiSelect ? "Select one or more" : "Choose an option"}
          </Text>
        </View>
        <Badge
          label={urgent ? `expires in ${item.expiresIn}s` : `${item.expiresIn}s left`}
          variant={urgent && !answered ? "danger" : answered ? "success" : "accent"}
          styleVariant="solid"
          icon="Timer"
        />
      </View>

      {item.question ? (
        <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>
          {item.question}
        </Text>
      ) : null}

      {item.summary ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{item.summary}</Text>
      ) : null}

      {item.link ? (
        <Text
          selectable
          numberOfLines={2}
          style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: 11 }}
        >
          {item.link}
        </Text>
      ) : null}

      {answered ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: colors.statusSuccess + "15",
            borderColor: colors.statusSuccess + "40",
            borderWidth: 1,
            borderRadius: 6,
            padding: 8,
          }}
        >
          <Icon name="Check" size={13} color={colors.statusSuccess} />
          <Text style={{ color: colors.statusSuccess, fontSize: 12, fontWeight: "600", flex: 1 }}>
            Chosen: {item.selection}
          </Text>
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          {options.map((option) => (
            <OptionButton
              key={option.id}
              option={option}
              selected={picked.includes(option.id)}
              recommended={recommended?.id === option.id}
              disabled={disabled}
              onPress={() => toggle(option)}
            />
          ))}

          {allowWriteIn ? (
            showWriteIn ? (
              <TextInput
                value={writeIn}
                onChangeText={setWriteIn}
                placeholder="Write your own answer…"
                multiline
                disabled={disabled}
              />
            ) : (
              <Button
                label="Write an answer"
                variant="ghost"
                size="sm"
                icon="Pencil"
                disabled={disabled}
                onPress={() => setShowWriteIn(true)}
              />
            )
          ) : null}

          {multiSelect || allowWriteIn ? (
            <Button
              label={submitting ? "Submitting…" : "Submit answer"}
              variant="primary"
              size="sm"
              icon="Send"
              loading={submitting}
              disabled={!canSubmit}
              onPress={submit}
            />
          ) : null}
        </View>
      )}

      {!selectSupported && !answered ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="AlertTriangle" size={12} color={colors.statusWarning} />
          <Text style={{ color: colors.statusWarning, fontSize: 11, flex: 1 }}>
            2fadod does not advertise a selection op yet — answers cannot be submitted.
          </Text>
        </View>
      ) : null}

      {errorText ? (
        <Text style={{ color: colors.statusDanger, fontSize: 11 }}>{errorText}</Text>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Icon name="User" size={11} color={colors.foregroundMuted} />
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
          From{" "}
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>{item.caller ?? "local"}</Text>
          {item.host ? (
            <>
              {" on "}
              <Text style={{ color: colors.foreground, fontWeight: "600" }}>{item.host}</Text>
            </>
          ) : null}
        </Text>
      </View>
    </Card>
  );
}
