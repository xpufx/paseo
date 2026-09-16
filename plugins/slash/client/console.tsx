import { useState } from "react";
import { View } from "react-native";
import {
  ActionBar,
  Badge,
  Button,
  Card,
  Collapsible,
  EmptyState,
  FormRow,
  ModalBody,
  Row,
  SectionHeader,
  Select,
  Stack,
  Tabs,
  TextInput,
  Toggle,
  spacing,
  usePluginSettings,
  useRpcMutation,
  useRpcQuery,
  type TabItem,
} from "./vendor/paseo-plugin-helper/index";
import {
  COMMAND_NAME_HINT,
  SUGGESTED_PREFIX,
  actionSummary,
  catalogRpc,
  draftFromCommand,
  emptyCommandDraft,
  exportBundleRpc,
  importBundleRpc,
  missingCatalogCommands,
  operationsListRpc,
  removeCommandByName,
  slashSettingsContract,
  upsertCommand,
  validateCommandDraft,
  type CommandDraftErrors,
  type CommandDraftWarnings,
  type OperationCatalog,
  type SlashCommand,
  type SlashCommandDraft,
  type SlashVerb,
} from "../shared/resources";

const ACTION_TABS: TabItem[] = [
  { id: "send", label: "Send", icon: "Send" },
  { id: "open", label: "Open", icon: "ExternalLink" },
  { id: "rpc", label: "RPC", icon: "Zap" },
];

const VERB_ICON: Record<SlashVerb, string> = {
  send: "Send",
  open: "ExternalLink",
  rpc: "Zap",
};

const VERB_VARIANT = {
  send: "accent",
  open: "info",
  rpc: "warning",
} as const;

// Keep the console a readable centered column instead of stretching edge-to-edge
// on large viewports. The cap lives in the helper (`ModalBody maxContentWidth`);
// this is the only place the console picks the value.
const CONSOLE_CONTENT_MAX_WIDTH = 600;

// Header-only rows: the helper reserves an 8px bottom margin for content that
// follows. Command rows have none, so reclaim it and use the token scale for
// the row's own inset instead of Card's full surface padding.
const ROW_HEADER_STYLE = {
  marginBottom: 0,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
};

interface CommandRowProps {
  prefix: string;
  command: SlashCommand;
  /** True when the command is one of the plugin's bundled (shipped) seeds. */
  shipped?: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
}

function CommandRow({ prefix, command, shipped, onToggle, onEdit, onRemove }: CommandRowProps) {
  const label = `/${prefix}${command.name}`;
  return (
    <Card variant="elevated" noPadding>
      <Card.Header
        icon={VERB_ICON[command.action.verb]}
        title={label}
        subtitle={command.description || command.title}
        badge={
          <Row gap="xs" align="center">
            <Badge
              size="sm"
              label={actionSummary(command.action)}
              variant={VERB_VARIANT[command.action.verb]}
            />
            {shipped ? <Badge size="sm" label="Shipped" variant="neutral" /> : null}
          </Row>
        }
        action={
          <Row gap="xs" align="center">
            <Toggle value={command.enabled} onValueChange={onToggle} />
            <Button
              size="sm"
              variant="ghost"
              icon="Pencil"
              accessibilityLabel={`Edit ${label}`}
              onPress={onEdit}
            />
            <Button
              size="sm"
              variant="danger"
              icon="Trash2"
              accessibilityLabel={`Remove ${label}`}
              onPress={onRemove}
            />
          </Row>
        }
        style={ROW_HEADER_STYLE}
      />
    </Card>
  );
}

interface CommandFormProps {
  draft: SlashCommandDraft;
  errors: CommandDraftErrors;
  warnings: CommandDraftWarnings;
  catalog: OperationCatalog;
  onChange: (patch: Partial<SlashCommandDraft>) => void;
}

function CommandForm({ draft, errors, warnings, catalog, onChange }: CommandFormProps) {
  const rpcOptions = catalog.rpc ?? [];
  const openOptions = catalog.open ?? [];
  const rpcChoices = rpcOptions.map((operation) => ({ label: operation, value: operation }));
  const openChoices = openOptions.map((target) => ({ label: target, value: target }));

  return (
    <Stack gap="sm">
      <FormRow label="Name" description={COMMAND_NAME_HINT}>
        <TextInput
          value={draft.name}
          errorText={errors.name}
          placeholder="my-command"
          onChangeText={(name) => onChange({ name })}
        />
      </FormRow>
      <FormRow label="Title">
        <TextInput
          value={draft.title}
          errorText={errors.title}
          placeholder="My command"
          onChangeText={(title) => onChange({ title })}
        />
      </FormRow>
      <FormRow label="Description">
        <TextInput
          value={draft.description}
          errorText={errors.description}
          placeholder="Optional one-line summary"
          multiline
          numberOfLines={2}
          onChangeText={(description) => onChange({ description })}
        />
      </FormRow>
      <FormRow label="Action">
        <Tabs
          tabs={ACTION_TABS}
          activeTab={draft.verb}
          onTabChange={(verb) => onChange({ verb: verb as SlashVerb })}
        />
      </FormRow>
      {draft.verb === "send" ? (
        <FormRow label="Prompt template">
          <TextInput
            value={draft.template}
            errorText={errors.action}
            placeholder="Review the current changes: {args}"
            multiline
            numberOfLines={3}
            onChangeText={(template) => onChange({ template })}
          />
        </FormRow>
      ) : draft.verb === "open" ? (
        <FormRow label="Target surface">
          <Stack gap="xs">
            {openOptions.length > 0 ? (
              <Select
                value={draft.target}
                options={openChoices}
                placeholder="Choose a shipped surface…"
                onValueChange={(target) => onChange({ target })}
              />
            ) : null}
            <TextInput
              value={draft.target}
              errorText={errors.action}
              helperText={warnings.action}
              placeholder="slash-console"
              onChangeText={(target) => onChange({ target })}
            />
          </Stack>
        </FormRow>
      ) : (
        <FormRow label="RPC operation">
          <Stack gap="xs">
            {rpcOptions.length > 0 ? (
              <Select
                value={draft.operation}
                options={rpcChoices}
                placeholder="Choose a catalog operation…"
                onValueChange={(operation) => onChange({ operation })}
              />
            ) : null}
            <TextInput
              value={draft.operation}
              errorText={errors.action}
              helperText={warnings.action}
              placeholder="slash.ping"
              mono
              onChangeText={(operation) => onChange({ operation })}
            />
          </Stack>
        </FormRow>
      )}
      <FormRow label="Enabled">
        <Toggle value={draft.enabled} onValueChange={(enabled) => onChange({ enabled })} />
      </FormRow>
    </Stack>
  );
}

export function SlashConsole() {
  const { settings, updateSettings, resetSettings } = usePluginSettings(slashSettingsContract);
  const catalog = useRpcQuery(catalogRpc, {});
  const operations = useRpcQuery(operationsListRpc, {});
  const exportBundle = useRpcMutation(exportBundleRpc);
  const importBundle = useRpcMutation(importBundleRpc);
  const [form, setForm] = useState<{ originalName: string | null; draft: SlashCommandDraft } | null>(null);
  const [bundleJson, setBundleJson] = useState("");
  const [bundleError, setBundleError] = useState("");
  const prefix = settings.prefix ?? "";
  const commands = settings.commands ?? [];
  const operationCatalog: OperationCatalog = operations.data ?? {};

  const takenNames = commands
    .filter((command) => command.name !== form?.originalName)
    .map((command) => command.name);
  const validation = form
    ? validateCommandDraft(form.draft, takenNames, operationCatalog)
    : { errors: {} as CommandDraftErrors, warnings: {} as CommandDraftWarnings };
  const catalogCommands = catalog.data?.commands ?? [];
  const catalogNames = new Set(catalogCommands.map((command) => command.name));
  const presentNames = new Set(commands.map((command) => command.name));
  const missingFromCatalog = missingCatalogCommands(commands, catalogCommands);

  function updateDraft(patch: Partial<SlashCommandDraft>) {
    setForm((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev));
  }

  function saveForm() {
    if (!form || !validation.command) return;
    updateSettings({ commands: upsertCommand(commands, form.originalName, validation.command) });
    setForm(null);
  }

  async function handleExport() {
    setBundleError("");
    try {
      const out = await exportBundle.mutateAsync({});
      setBundleJson(JSON.stringify(out.bundle));
    } catch (e) {
      setBundleError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleImport() {
    setBundleError("");
    try {
      const parsed = JSON.parse(bundleJson) as unknown;
      const bundle = (parsed as { bundle?: unknown }).bundle ?? parsed;
      await importBundle.mutateAsync({ bundle: bundle as never, overwrite: false });
    } catch (e) {
      setBundleError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={{ flex: 1, minHeight: 0, width: "100%" }}>
      <ModalBody scrollMode="always" maxContentWidth={CONSOLE_CONTENT_MAX_WIDTH}>
        <Card variant="tinted">
          <FormRow label="Command prefix">
            <TextInput
              value={prefix}
              placeholder={`${SUGGESTED_PREFIX} (suggestion — leave empty for none)`}
              onChangeText={(val) => updateSettings({ prefix: val })}
            />
          </FormRow>
          {form ? null : (
            <ActionBar align="flex-start" direction="row" style={{ marginTop: spacing.sm }}>
              <Button
                label="Add command"
                size="sm"
                variant="primary"
                icon="Plus"
                onPress={() => setForm({ originalName: null, draft: emptyCommandDraft() })}
              />
            </ActionBar>
          )}
        </Card>

        {form ? (
          <Card variant="elevated">
            <Card.Header
              title={form.originalName ? `Edit /${prefix}${form.originalName}` : "New command"}
              badge={
                <Badge size="sm" label={form.draft.verb} variant={VERB_VARIANT[form.draft.verb]} />
              }
            />
            <CommandForm
              draft={form.draft}
              errors={validation.errors}
              warnings={validation.warnings}
              catalog={operationCatalog}
              onChange={updateDraft}
            />
            <ActionBar align="flex-end" style={{ marginTop: spacing.sm }}>
              <Button label="Cancel" size="sm" variant="ghost" onPress={() => setForm(null)} />
              <Button
                label={form.originalName ? "Save changes" : "Add command"}
                size="sm"
                variant="primary"
                icon="Check"
                disabled={!validation.command}
                onPress={saveForm}
              />
            </ActionBar>
          </Card>
        ) : null}

        <SectionHeader title="Commands" count={commands.length} />
        {commands.length === 0 ? (
          <EmptyState
            icon="Terminal"
            title="No slash commands"
            description="Add one above or pick a shipped command from the catalog."
          />
        ) : (
          <Stack gap="xs">
            {commands.map((command) => (
              <CommandRow
                key={command.name}
                prefix={prefix}
                command={command}
                shipped={catalogNames.has(command.name)}
                onToggle={(enabled) =>
                  updateSettings({
                    commands: commands.map((c) => (c.name === command.name ? { ...c, enabled } : c)),
                  })
                }
                onEdit={() => setForm({ originalName: command.name, draft: draftFromCommand(command) })}
                onRemove={() => updateSettings({ commands: removeCommandByName(commands, command.name) })}
              />
            ))}
          </Stack>
        )}

        <Collapsible
          title="Shipped catalog"
          subtitle={`${catalogCommands.length} commands bundled with the plugin`}
          icon="Package"
          badge={
            <Badge
              size="sm"
              label={
                missingFromCatalog.length > 0 ? `${missingFromCatalog.length} to add` : "All added"
              }
              variant={missingFromCatalog.length > 0 ? "warning" : "neutral"}
            />
          }
        >
          {catalog.isLoading ? (
            <EmptyState icon="Package" title="Loading the shipped catalog…" />
          ) : catalogCommands.length === 0 ? (
            <EmptyState
              icon="Package"
              title="Shipped catalog unavailable"
              description="The bundled command list could not be loaded."
            />
          ) : (
            <Stack gap="xs">
              {catalogCommands.map((command) => {
                const added = presentNames.has(command.name);
                return (
                  <Card key={command.name} variant="tinted" noPadding>
                    <Card.Header
                      title={`/${command.name}`}
                      subtitle={command.description || command.title}
                      badge={
                        <Badge
                          size="sm"
                          label={actionSummary(command.action)}
                          variant={VERB_VARIANT[command.action.verb]}
                        />
                      }
                      action={
                        added ? (
                          <Badge size="sm" label="Added" variant="neutral" />
                        ) : (
                          <Button
                            label="Add"
                            size="sm"
                            variant="secondary"
                            icon="Plus"
                            onPress={() => updateSettings({ commands: [...commands, command] })}
                          />
                        )
                      }
                      style={ROW_HEADER_STYLE}
                    />
                  </Card>
                );
              })}
            </Stack>
          )}
        </Collapsible>

        <Collapsible
          title="Advanced"
          subtitle="Bundle import/export and reset"
          icon="Wrench"
        >
          <FormRow label="Bundle JSON" description="Paste an exported bundle to import (validated server-side)">
            <TextInput
              value={bundleJson}
              placeholder='{"bundle":"slash-commands","version":1,"commands":[…]}'
              multiline
              numberOfLines={3}
              errorText={bundleError || undefined}
              onChangeText={(val) => {
                setBundleJson(val);
                setBundleError("");
              }}
            />
          </FormRow>
          <ActionBar align="flex-end" style={{ marginTop: spacing.sm }}>
            <Button
              label="Export"
              size="sm"
              variant="secondary"
              icon="Download"
              loading={exportBundle.isPending}
              onPress={handleExport}
            />
            <Button
              label="Import"
              size="sm"
              variant="secondary"
              icon="Upload"
              loading={importBundle.isPending}
              onPress={handleImport}
            />
            <Button
              label="Reset to seeds"
              size="sm"
              variant="danger"
              icon="RotateCcw"
              onPress={() => void resetSettings()}
            />
          </ActionBar>
        </Collapsible>
      </ModalBody>
    </View>
  );
}
