import React from "react";
import { getClientHost, type HostIconProps } from "./host";

export function Icon(props: HostIconProps) {
  const { Icon: HostIconComponent } = getClientHost();
  return <HostIconComponent {...props} />;
}
