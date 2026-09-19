import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers } from "paseo-plugin-helper/client";
import { registerPluginUpdateHeaders } from "./client/updates";

export default function contribute(client: PluginClientContext) {
  initClientHelpers({ Icon, Modal, useRpc, ScrollView, useToast });
  return registerPluginUpdateHeaders(client);
}
