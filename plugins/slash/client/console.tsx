import { useState } from "react";
import { Button } from "./vendor/paseo-plugin-helper/index";
import { FormRow } from "./vendor/paseo-plugin-helper/index";
import { TextInput, Toggle } from "./vendor/paseo-plugin-helper/index";
import { usePluginSettings } from "./vendor/paseo-plugin-helper/index";
import { useRpcMutation } from "./vendor/paseo-plugin-helper/index";
import {
  SUGGESTED_PREFIX,
  exportBundleRpc,
  importBundleRpc,
  slashSettingsContract,
} from "../shared/resources";

export function SlashConsole() {
  const { settings, updateSettings, resetSettings } = usePluginSettings(slashSettingsContract);
  const exportBundle = useRpcMutation(exportBundleRpc);
  const importBundle = useRpcMutation(importBundleRpc);
  const [bundleJson, setBundleJson] = useState("");
  const [bundleError, setBundleError] = useState("");
  const prefix = settings.prefix ?? "";
  const commands = settings.commands ?? [];

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
    <>
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
      {commands.map((command) => (
        <FormRow
          key={command.name}
          label={`/${prefix}${command.name}`}
          description={command.description || command.title}
        >
          <Toggle
            value={command.enabled}
            onValueChange={(val) =>
              updateSettings({
                commands: commands.map((c) => (c.name === command.name ? { ...c, enabled: val } : c)),
              })
            }
          />
        </FormRow>
      ))}
      <FormRow label="Bundle" description="Export shares enabled commands; paste a bundle to import (validated server-side)">
        <TextInput
          value={bundleJson}
          placeholder='{"bundle":"slash-commands","version":1,"commands":[…]}'
          onChangeText={(val) => {
            setBundleJson(val);
            setBundleError("");
          }}
        />
      </FormRow>
      <FormRow label="Export bundle" description={bundleError || "Copy the bundle JSON above to share"}>
        <Button label="Export" variant="secondary" loading={exportBundle.isPending} onPress={handleExport} />
      </FormRow>
      <FormRow label="Import bundle" description="Merge the pasted bundle (existing names kept)">
        <Button label="Import" variant="secondary" loading={importBundle.isPending} onPress={handleImport} />
      </FormRow>
      <FormRow label="Danger zone" description="Restore the seeded repository set">
        <Button label="Reset to seeds" variant="danger" onPress={() => void resetSettings()} />
      </FormRow>
    </>
  );
}
