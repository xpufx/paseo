import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import {
  AboutSection,
  ActionBar,
  Card,
  EmptyState,
  FormRow,
  ModalBody,
  StatusDot,
  Tabs,
  Toggle,
  registerComposerPill,
  usePluginTheme,
  type ComposerPillRegistrar,
  type RenderModalProps,
  type RenderPillProps,
} from "./vendor/paseo-plugin-helper/index";
import { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { CrossDaemonConversation } from "./x-comms-conversation";
import { uiPrefsGetRpc, uiPrefsSetRpc } from "../shared/registry";

// Raw Text is retained only for the composer pill label and the muted
// reload-needed caption. Every tab, layout, settings row, toggle, status and
// empty state goes through a paseo-plugin-helper primitive.
function CrossDaemonPill(props: RenderPillProps) {
  const { theme } = props;
  const style = useMemo(
    () => ({ color: theme.colors.accent, flexShrink: 1, fontSize: 10 }),
    [theme],
  );
  return (
    <>
      <Icon name="PhoneOutgoing" size={9} color={theme.colors.accent} />
      <Text numberOfLines={1} style={style}>
        X-comms
      </Text>
    </>
  );
}

function XCommsSettings() {
  const callGet = useRpc(uiPrefsGetRpc);
  const callSet = useRpc(uiPrefsSetRpc);
  const { colors } = usePluginTheme();
  const [presence, setPresence] = useState<boolean | null>(null);
  const [injection, setInjection] = useState<boolean | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    callGet({})
      .then((prefs) => {
        if (!live) return;
        setPresence(prefs.presenceEnabled);
        setInjection(prefs.injectionEnabled);
        setCollapsed(prefs.prereqsCollapsed);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      live = false;
    };
  }, [callGet]);
  const save = (next: { presenceEnabled: boolean; injectionEnabled: boolean }) => {
    setSaving(true);
    setError(null);
    callSet({ prereqsCollapsed: collapsed, ...next })
      .then((prefs) => {
        setPresence(prefs.presenceEnabled);
        setInjection(prefs.injectionEnabled);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSaving(false));
  };
  const loading = presence === null || injection === null;
  return (
    <>
      {loading ? (
        error ? (
          <EmptyState icon="AlertTriangle" title="Couldn't load settings" description={error} />
        ) : (
          <EmptyState icon="Sliders" title="Loading settings…" />
        )
      ) : (
        <Card>
          <Card.Header title="Preferences" />
          <FormRow
            label="Presence"
            description="Announce local agent births and retracts to paired daemons."
          >
            <Toggle
              value={presence}
              onValueChange={(next) => {
                setPresence(next);
                save({ presenceEnabled: next, injectionEnabled: injection });
              }}
              disabled={saving}
            />
          </FormRow>
          <FormRow
            label="MCP injection"
            description="Add the x-comms server to every newborn agent."
          >
            <Toggle
              value={injection}
              onValueChange={(next) => {
                setInjection(next);
                save({ presenceEnabled: presence, injectionEnabled: next });
              }}
              disabled={saving}
            />
          </FormRow>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
            Changes take effect after the plugin reloads.
          </Text>
        </Card>
      )}
      {!loading && (saving || error) ? (
        <ActionBar align="flex-start">
          <StatusDot variant={error ? "danger" : "warning"} pulse={!error} />
          <Text
            selectable
            style={{
              color: error ? colors.statusDanger : colors.foregroundMuted,
              fontSize: 12,
              flexShrink: 1,
            }}
          >
            {error ?? "Saving…"}
          </Text>
        </ActionBar>
      ) : null}
    </>
  );
}

const X_COMMS_TABS = [
  { id: "chat", label: "Chat" },
  { id: "settings", label: "Settings" },
  { id: "about", label: "About" },
];

function XCommsModalContent({ theme, agentId }: { theme: RenderModalProps["theme"]; agentId: string }) {
  const [tab, setTab] = useState("chat");
  return (
    <ModalBody
      header={<Tabs tabs={X_COMMS_TABS} activeTab={tab} onTabChange={setTab} />}
      headerMode="pinned"
      headerStyle={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 }}
    >
      {tab === "about" ? (
        <AboutSection
          name="X-comms"
          description="Cross-daemon agent conversation over Paseo Relay."
          version="0.3.0"
          repository="https://github.com/xpufx/paseo-x-comms"
          license="MIT"
          density="tiny"
        />
      ) : tab === "settings" ? (
        <XCommsSettings />
      ) : (
        <CrossDaemonConversation theme={theme} agentId={agentId} />
      )}
    </ModalBody>
  );
}

/**
 * One composer pill per agent. Lifecycle (agent subscription, pill mount and
 * unmount, modal open state, theme) is managed by registerComposerPill; this
 * module only supplies the pill body and modal content.
 */
export function contributeClient(client: ComposerPillRegistrar) {
  return registerComposerPill(client, {
    id: "x-comms",
    title: "X-comms",
    icon: "PhoneOutgoing",
    modalTitle: "X-comms",
    presentation: "centered",
    renderPill: (props) => <CrossDaemonPill {...props} />,
    renderModal: (props) => <XCommsModalContent theme={props.theme} agentId={props.agentId} />,
  });
}
