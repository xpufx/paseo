import { useState } from "react";
import { FormRow } from "./vendor/paseo-plugin-helper/index";
import { TextInput, Toggle } from "./vendor/paseo-plugin-helper/index";
import { usePluginSettings } from "./vendor/paseo-plugin-helper/index";
import {
  SUGGESTED_PREFIX,
  exportBundleRpc,
  slashSettingsContract,
} from "../shared/resources";

export function SlashConsole() {
  const { settings, updateSettings, resetSettings } = usePluginSettings(slashSettingsContract);
  const [bundleJson, setBundleJson] = useState("");
  const prefix = settings.prefix ?? "";
  const commands = settings.commands ?? [];

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
          onChangeText={setBundleJson}
        />
      </FormRow>
      <FormRow label="Danger zone" description="Restore the seeded repository set">
        <Toggle value={false} disabled={true} onValueChange={() => {}} />
      </FormRow>
      {void exportBundleRpc}
      {void resetSettings}
    </>
  );
}
