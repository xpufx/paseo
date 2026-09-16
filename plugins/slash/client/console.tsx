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
  SectionHeader,
  Tabs,
  TextInput,
  Toggle,
  usePluginSettings,
  useRpcMutation,
  useRpcQuery,
  type TabItem,
} from "paseo-plugin-helper/client";
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
  type SlashCommandDraft,
  type SlashVerb,
} from "../shared/resources";

const ACTION_TABS: TabItem[] = [
  { id: "send", label: "Send", icon: "Send" },
  { id: "open", label: "Open", icon: "ExternalLink" },
  { id: "rpc", label: "RPC", icon: "Zap" },
];

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
  const rpcTabs: TabItem[] = rpcOptions.map((operation) => ({ id: operation, label: operation }));
  const openTabs: TabItem[] = openOptions.map((target) => ({ id: target, label: target }));

  return (
    <>
      <FormRow label="Name" description={`Command is invoked as /${draft.name || "name"}. ${COMMAND_NAME_HINT}`}>
        <TextInput
          value={draft.name}
          errorText={errors.name}
          placeholder="my-command"
          onChangeText={(name) => onChange({ name })}
        />
      </FormRow>
      <FormRow label="Title" description="Human-readable label shown in the command list (max 120 chars)">
        <TextInput
          value={draft.title}
          errorText={errors.title}
          placeholder="My command"
          onChangeText={(title) => onChange({ title })}
        />
      </FormRow>
      <FormRow label="Description" description="Optional one-line summary (max 500 chars)">
        <TextInput
          value={draft.description}
          errorText={errors.description}
          placeholder="What this command does"
          multiline
          numberOfLines={2}
          onChangeText={(description) => onChange({ description })}
        />
      </FormRow>
      <FormRow label="Action" description="What running the command does">
        <Tabs
          tabs={ACTION_TABS}
          activeTab={draft.verb}
          onTabChange={(verb) => onChange({ verb: verb as SlashVerb })}
        />
      </FormRow>
      {draft.verb === "send" ? (
        <FormRow
          label="Prompt template"
          description="Sent to the agent; {args} is replaced with the typed arguments (max 8000 chars)"
        >
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
        <>
          {openOptions.length > 0 ? (
            <FormRow
              label="Target surface"
              description="Surface id opened when the command runs; pick a known surface or enter it below"
            >
              <Tabs
                tabs={openTabs}
                activeTab={draft.target}
                onTabChange={(target) => onChange({ target })}
              />
            </FormRow>
          ) : null}
          <FormRow
            label={openOptions.length > 0 ? "Surface id (advanced)" : "Target surface"}
            description="Surface id opened when the command runs (max 200 chars)"
          >
            <TextInput
              value={draft.target}
              errorText={errors.action}
              helperText={warnings.action}
              placeholder="slash-console"
              onChangeText={(target) => onChange({ target })}
            />
          </FormRow>
        </>
      ) : (
        <>
          {rpcOptions.length > 0 ? (
            <FormRow
              label="RPC operation"
              description="Allowlisted backend operation; pick one or type an advanced value below"
            >
              <Tabs
                tabs={rpcTabs}
                activeTab={draft.operation}
                onTabChange={(operation) => onChange({ operation })}
              />
            </FormRow>
          ) : null}
          <FormRow
            label={rpcOptions.length > 0 ? "RPC operation (advanced)" : "RPC operation"}
            description="Allowlisted backend operation (max 200 chars)"
          >
            <TextInput
              value={draft.operation}
              errorText={errors.action}
              helperText={warnings.action}
              placeholder="slash.ping"
              mono
              onChangeText={(operation) => onChange({ operation })}
            />
          </FormRow>
        </>
      )}
      <FormRow label="Enabled" description="Disabled commands stay configured but are not registered">
        <Toggle value={draft.enabled} onValueChange={(enabled) => onChange({ enabled })} />
      </FormRow>
    </>
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
      <ModalBody scrollMode="always">
        <FormRow
          label="Command prefix"
          description={`Common prefix applied to every command name. Suggestion (not default): ${SUGGESTED_PREFIX}`}
        >
          <TextInput
            value={prefix}
            placeholder={`${SUGGESTED_PREFIX} (suggestion — leave empty for none)`}
            onChangeText={(val) => updateSettings({ prefix: val })}
          />
        </FormRow>

        {form ? (
          <Card variant="tinted">
            <Card.Header
              title={form.originalName ? `Edit /${prefix}${form.originalName}` : "New command"}
              subtitle="Name, description, and action"
            />
            <CommandForm
              draft={form.draft}
              errors={validation.errors}
              warnings={validation.warnings}
              catalog={operationCatalog}
              onChange={updateDraft}
            />
            <ActionBar align="flex-end">
              <Button label="Cancel" variant="ghost" onPress={() => setForm(null)} />
              <Button
                label={form.originalName ? "Save changes" : "Add command"}
                variant="primary"
                icon="Check"
                disabled={!validation.command}
                onPress={saveForm}
              />
            </ActionBar>
          </Card>
        ) : (
          <ActionBar align="flex-start">
            <Button
              label="Add command"
              variant="primary"
              icon="Plus"
              onPress={() => setForm({ originalName: null, draft: emptyCommandDraft() })}
            />
          </ActionBar>
        )}

        <SectionHeader title="Commands" count={commands.length} />
        {commands.length === 0 ? (
          <EmptyState
            icon="Terminal"
            title="No slash commands"
            description="Add one above or pick a shipped command from the catalog."
          />
        ) : (
          commands.map((command) => (
            <Card key={command.name} variant="elevated">
              <Card.Header
                title={`/${prefix}${command.name}`}
                subtitle={command.description || command.title}
                badge={<Badge label={actionSummary(command.action)} variant="neutral" dot />}
              />
              <FormRow
                label="Enabled"
                description="Disabled commands stay configured but are not registered"
              >
                <Toggle
                  value={command.enabled}
                  onValueChange={(enabled) =>
                    updateSettings({
                      commands: commands.map((c) => (c.name === command.name ? { ...c, enabled } : c)),
                    })
                  }
                />
              </FormRow>
              <ActionBar align="flex-end">
                <Button
                  label="Edit"
                  size="sm"
                  variant="ghost"
                  icon="Pencil"
                  onPress={() => setForm({ originalName: command.name, draft: draftFromCommand(command) })}
                />
                <Button
                  label="Remove"
                  size="sm"
                  variant="danger"
                  icon="Trash2"
                  onPress={() => updateSettings({ commands: removeCommandByName(commands, command.name) })}
                />
              </ActionBar>
            </Card>
          ))
        )}

        <Collapsible
          title="Shipped catalog"
          subtitle={`Commands bundled with the plugin (${catalogCommands.length} available)`}
          icon="Package"
          badge={
            <Badge
              label={String(missingFromCatalog.length)}
              variant={missingFromCatalog.length > 0 ? "warning" : "neutral"}
            />
          }
        >
          {catalog.isLoading ? (
            <EmptyState icon="Package" title="Loading the shipped catalog…" />
          ) : missingFromCatalog.length === 0 ? (
            <EmptyState icon="PackageCheck" title="All shipped commands are present" />
          ) : (
            missingFromCatalog.map((command) => (
              <Card key={command.name} variant="tinted">
                <Card.Header
                  title={`/${command.name}`}
                  subtitle={command.description || command.title}
                  badge={<Badge label={actionSummary(command.action)} variant="neutral" />}
                />
                <ActionBar align="flex-end">
                  <Button
                    label="Add"
                    size="sm"
                    variant="secondary"
                    icon="Plus"
                    onPress={() => updateSettings({ commands: [...commands, command] })}
                  />
                </ActionBar>
              </Card>
            ))
          )}
        </Collapsible>

        <Collapsible
          title="Advanced"
          subtitle="Bundle import/export and reset — kept out of the primary console"
          icon="Wrench"
        >
          <FormRow
            label="Bundle JSON"
            description="Exported bundle of enabled commands; paste one here to import (validated server-side)"
          >
            <TextInput
              value={bundleJson}
              placeholder='{"bundle":"slash-commands","version":1,"commands":[…]}'
              multiline
              numberOfLines={3}
              onChangeText={(val) => {
                setBundleJson(val);
                setBundleError("");
              }}
            />
          </FormRow>
          {bundleError ? (
            <EmptyState icon="AlertTriangle" title="Bundle error" description={bundleError} />
          ) : null}
          <ActionBar align="flex-end">
            <Button
              label="Export"
              variant="secondary"
              icon="Download"
              loading={exportBundle.isPending}
              onPress={handleExport}
            />
            <Button
              label="Import"
              variant="secondary"
              icon="Upload"
              loading={importBundle.isPending}
              onPress={handleImport}
            />
            <Button label="Reset to seeds" variant="danger" icon="RotateCcw" onPress={() => void resetSettings()} />
          </ActionBar>
        </Collapsible>
      </ModalBody>
    </View>
  );
}
