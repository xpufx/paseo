import React from "react";
import { getClientHost, type HostIconProps } from "./host.js";

export function Icon(props: HostIconProps) {
  const { Icon: HostIconComponent } = getClientHost();
  return <HostIconComponent {...props} />;
}
