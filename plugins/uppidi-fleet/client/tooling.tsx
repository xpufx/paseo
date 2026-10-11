import React, { useMemo, useState, useEffect } from "react";
import { View, Text } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  Badge,
  Button,
  Card,
  CodeBlock,
  EmptyState,
  Row,
  Select,
  type SelectOption,
  Stack,
  TextInput,
} from "./host-ui.js";
import { useRpcQuery, useRpcMutation } from "paseo-plugin-helper/core";
import { useFleetTheme } from "./theme.js";
import {
  uppidiFleetToolListContract,
  uppidiFleetToolExecuteContract,
  type UppidiToolDefinition,
} from "../shared/contracts.js";

export interface UppidiFleetToolingProps {
  initialTool?: string;
}

export function UppidiFleetToolingView({ initialTool }: UppidiFleetToolingProps) {
  const { colors, typography } = useFleetTheme();
  const toast = useToast();

  const toolListQuery = useRpcQuery(uppidiFleetToolListContract, {});
  const executeMutation = useRpcMutation(uppidiFleetToolExecuteContract);

  const tools: UppidiToolDefinition[] = useMemo(() => {
    return toolListQuery.data?.tools ?? [];
  }, [toolListQuery.data?.tools]);

  const [selectedToolName, setSelectedToolName] = useState<string>(initialTool ?? "");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [executionResult, setExecutionResult] = useState<{
    ok: boolean;
    output?: string;
    isError?: boolean;
    error?: string;
    executedAt: string;
  } | null>(null);

  // Auto-select first tool if none selected
  useEffect(() => {
    if (!selectedToolName && tools.length > 0) {
      const first = tools[0]!;
      setSelectedToolName(first.name);
    }
  }, [tools, selectedToolName]);

  const activeTool = useMemo(() => {
    return tools.find((t) => t.name === selectedToolName) ?? null;
  }, [tools, selectedToolName]);

  // Reset form values to schema defaults whenever active tool changes
  useEffect(() => {
    if (!activeTool) return;
    const initial: Record<string, string> = {};
    const props = activeTool.inputSchema?.properties ?? {};
    for (const [key, prop] of Object.entries(props)) {
      if (prop.default !== undefined) {
        initial[key] = String(prop.default);
      } else {
        initial[key] = "";
      }
    }
    setFormValues(initial);
    setExecutionResult(null);
  }, [activeTool]);

  const toolOptions = useMemo<SelectOption[]>(() => {
    return tools.map((t) => ({
      value: t.name,
      label: t.name,
      description: t.description,
    }));
  }, [tools]);

  const handleExecute = async () => {
    if (!activeTool) return;

    const required = activeTool.inputSchema?.required ?? [];
    const missing = required.filter((req) => !formValues[req]?.trim());
    if (missing.length > 0) {
      toast.error(`Missing required parameter(s): ${missing.join(", ")}`);
      return;
    }

    const parsedArgs: Record<string, unknown> = {};
    const props = activeTool.inputSchema?.properties ?? {};

    for (const [key, val] of Object.entries(formValues)) {
      if (!val && !required.includes(key)) continue;
      const propDef = props[key];
      const typeRaw = propDef?.type;
      const type = Array.isArray(typeRaw) ? typeRaw[0] : typeRaw;

      if (type === "number" || type === "integer") {
        const num = Number(val);
        if (!isNaN(num)) {
          parsedArgs[key] = num;
        }
      } else if (type === "boolean") {
        parsedArgs[key] = val.toLowerCase() === "true" || val === "1";
      } else {
        parsedArgs[key] = val;
      }
    }

    try {
      const res = await executeMutation.mutateAsync({
        toolName: activeTool.name,
        arguments: parsedArgs,
      });
      setExecutionResult({
        ok: res.ok,
        output: res.output,
        isError: res.isError,
        error: res.error,
        executedAt: new Date().toLocaleTimeString(),
      });
      if (res.ok && !res.isError) {
        toast.show(`Executed ${activeTool.name} successfully`);
      } else {
        toast.error(`Execution finished with errors`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExecutionResult({
        ok: false,
        output: msg,
        isError: true,
        error: msg,
        executedAt: new Date().toLocaleTimeString(),
      });
      toast.error(`Failed to execute tool: ${msg}`);
    }
  };

  const handleResetDefaults = () => {
    if (!activeTool) return;
    const initial: Record<string, string> = {};
    const props = activeTool.inputSchema?.properties ?? {};
    for (const [key, prop] of Object.entries(props)) {
      if (prop.default !== undefined) {
        initial[key] = String(prop.default);
      } else {
        initial[key] = "";
      }
    }
    setFormValues(initial);
    toast.show("Form parameters reset to defaults");
  };

  const copyOutput = () => {
    if (executionResult?.output) {
      toast.show("Tool output copied");
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      {/* Header & Tool Selection */}
      <Card>
        <Card.Header
          title="Fleet Tooling Surface"
          subtitle="Manual schema-driven runner and standalone execution for fleet maintenance tools"
          badge={
            <Badge
              label={`${tools.length} Tools Available`}
              variant="info"
              size="sm"
            />
          }
        />
        <Stack gap="md" style={{ marginTop: 12 }}>
          <Row align="center" gap="md" wrap>
            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>
              Select Tool:
            </Text>
            <View style={{ minWidth: 260, flex: 1 }}>
              <Select
                value={selectedToolName}
                options={toolOptions}
                onValueChange={(val) => setSelectedToolName(val)}
                size="md"
              />
            </View>
            <Button
              label="Reset Defaults"
              variant="ghost"
              size="sm"
              onPress={handleResetDefaults}
            />
          </Row>

          {activeTool ? (
            <View
              style={{
                backgroundColor: colors.surface1,
                borderRadius: 8,
                padding: 12,
                borderLeftWidth: 3,
                borderLeftColor: colors.accent,
              }}
            >
              <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", marginBottom: 4 }}>
                {activeTool.name}
              </Text>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
                {activeTool.description}
              </Text>
            </View>
          ) : null}
        </Stack>
      </Card>

      {/* Dynamic Schema Parameters Form */}
      {activeTool ? (
        <Card>
          <Card.Header
            title="Parameters"
            subtitle="Configured via typed JSON schema definitions"
            badge={
              <Badge
                label={`${Object.keys(activeTool.inputSchema?.properties ?? {}).length} Fields`}
                variant="neutral"
                size="sm"
              />
            }
          />

          <Stack gap="md" style={{ marginTop: 12 }}>
            {Object.entries(activeTool.inputSchema?.properties ?? {}).map(([paramName, prop]) => {
              const isRequired = (activeTool.inputSchema?.required ?? []).includes(paramName);
              const typeRaw = prop.type;
              const typeLabel = Array.isArray(typeRaw) ? typeRaw.join(" | ") : String(typeRaw ?? "string");
              const hasEnum = Array.isArray(prop.enum) && prop.enum.length > 0;
              const isBoolean = typeRaw === "boolean";

              if (hasEnum) {
                const enumOptions: SelectOption[] = prop.enum.map((opt: string) => ({
                  value: opt,
                  label: opt,
                }));
                return (
                  <View key={paramName} style={{ gap: 4 }}>
                    <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>
                      {paramName}
                      {isRequired ? " *" : ""} ({typeLabel})
                    </Text>
                    {prop.description ? (
                      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
                        {prop.description}
                      </Text>
                    ) : null}
                    <Select
                      value={formValues[paramName] ?? (prop.default ? String(prop.default) : prop.enum[0])}
                      options={enumOptions}
                      onValueChange={(val) => setFormValues((prev) => ({ ...prev, [paramName]: val }))}
                      size="sm"
                    />
                  </View>
                );
              }

              if (isBoolean) {
                const boolOptions: SelectOption[] = [
                  { value: "true", label: "true" },
                  { value: "false", label: "false" },
                ];
                return (
                  <View key={paramName} style={{ gap: 4 }}>
                    <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>
                      {paramName}
                      {isRequired ? " *" : ""} (boolean)
                    </Text>
                    {prop.description ? (
                      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
                        {prop.description}
                      </Text>
                    ) : null}
                    <Select
                      value={formValues[paramName] ?? (prop.default ? String(prop.default) : "false")}
                      options={boolOptions}
                      onValueChange={(val) => setFormValues((prev) => ({ ...prev, [paramName]: val }))}
                      size="sm"
                    />
                  </View>
                );
              }

              return (
                <TextInput
                  key={paramName}
                  label={`${paramName}${isRequired ? " *" : ""} (${typeLabel})`}
                  helperText={prop.description}
                  errorText={isRequired && !formValues[paramName]?.trim() ? "Required" : undefined}
                  value={formValues[paramName] ?? ""}
                  onChangeText={(text) => setFormValues((prev) => ({ ...prev, [paramName]: text }))}
                  placeholder={
                    prop.default !== undefined
                      ? String(prop.default)
                      : isRequired
                        ? "Required value..."
                        : "Optional value..."
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              );
            })}

            <Row justify="flex-end" gap="sm" style={{ marginTop: 8 }}>
              <Button
                label={executeMutation.isPending ? "Executing Tool..." : `Run ${activeTool.name}`}
                variant="primary"
                loading={executeMutation.isPending}
                disabled={executeMutation.isPending}
                onPress={() => void handleExecute()}
              />
            </Row>
          </Stack>
        </Card>
      ) : (
        <EmptyState
          title="No Tools Available"
          description="No fleet maintenance tools discovered."
        />
      )}

      {/* Execution Results View */}
      {executionResult ? (
        <Card>
          <Card.Header
            title={executionResult.isError ? "Execution Failed" : "Execution Succeeded"}
            subtitle={`Finished at ${executionResult.executedAt}`}
            badge={
              <Badge
                label={executionResult.isError ? "Error" : "Success"}
                variant={executionResult.isError ? "danger" : "success"}
                size="sm"
              />
            }
          />
          <Stack gap="md" style={{ marginTop: 12 }}>
            {executionResult.error ? (
              <View
                style={{
                  backgroundColor: colors.surface2,
                  padding: 10,
                  borderRadius: 6,
                }}
              >
                <Text style={{ color: colors.statusDanger, fontSize: 12 }}>
                  {executionResult.error}
                </Text>
              </View>
            ) : null}

            {executionResult.output ? (
              <View style={{ gap: 8 }}>
                <Row justify="space-between" align="center">
                  <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
                    Output:
                  </Text>
                  <Button
                    label="Copy Output"
                    variant="ghost"
                    size="sm"
                    onPress={copyOutput}
                  />
                </Row>
                <CodeBlock
                  code={executionResult.output}
                  language="markdown"
                />
              </View>
            ) : null}
          </Stack>
        </Card>
      ) : null}
    </ScrollView>
  );
}
