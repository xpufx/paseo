import { ReactNode, ComponentType } from 'react';
import { S as SettingsContract } from './settings-CP1gv9q3.js';
import { o as HostSurfaceProps, P as PluginCleanup } from './host-Dk97D-ul.js';

interface HelperSettingsCardProps {
    children: ReactNode;
    testID?: string;
}
interface HelperSettingsSectionProps {
    title: string;
    info?: ReactNode;
    trailing?: ReactNode;
    children: ReactNode;
    testID?: string;
}
interface HelperSettingsRowBaseProps {
    label: string;
    hint?: string;
    error?: string | null;
    children?: ReactNode;
    testID?: string;
}
interface HelperSettingsSwitchProps extends HelperSettingsRowBaseProps {
    value: boolean;
    onValueChange(value: boolean): void;
    disabled?: boolean;
}
interface HelperSettingsSelectProps<Value extends string = string> extends HelperSettingsRowBaseProps {
    value: Value;
    options: readonly {
        label: string;
        value: Value;
    }[];
    onValueChange(value: Value): void;
    disabled?: boolean;
}
interface HelperSettingsInputProps extends HelperSettingsRowBaseProps {
    initialValue?: string;
    onChangeText(text: string): void;
    placeholder?: string;
    disabled?: boolean;
    secureTextEntry?: boolean;
}
type HelperSettingsSelectComponent = <Value extends string = string>(props: HelperSettingsSelectProps<Value>) => ReactNode;
interface HelperSettingsUiBundle {
    SettingsCard: ComponentType<HelperSettingsCardProps>;
    SettingsSection: ComponentType<HelperSettingsSectionProps>;
    SettingsSwitch: ComponentType<HelperSettingsSwitchProps>;
    SettingsSelect: HelperSettingsSelectComponent;
    SettingsInput: ComponentType<HelperSettingsInputProps>;
}
interface HelperSettingsScreenContribution {
    id: string;
    title: string;
    icon: string;
    Component: ComponentType<HostSurfaceProps>;
}
interface HelperSettingsScreenRegistrar {
    addSettingsScreen(contribution: HelperSettingsScreenContribution): PluginCleanup;
}
type HelperSettingsFieldKind = "boolean" | "enum" | "string" | "number";
interface HelperSettingsField {
    key: string;
    kind: HelperSettingsFieldKind;
    label: string;
    description?: string;
    options?: string[];
}
interface HelperSettingsFieldOverrides {
    labels?: Record<string, string>;
    descriptions?: Record<string, string>;
}
declare function contractSchemaToFields(schema: unknown, overrides?: HelperSettingsFieldOverrides): HelperSettingsField[];
interface RegisterHelperSettingsScreenOptions {
    ui: HelperSettingsUiBundle;
    id?: string;
    title?: string;
    icon?: string;
    labels?: Record<string, string>;
    descriptions?: Record<string, string>;
}
declare function registerHelperSettingsScreen<TSettings extends Record<string, any>>(client: HelperSettingsScreenRegistrar, contract: SettingsContract<TSettings>, options: RegisterHelperSettingsScreenOptions): PluginCleanup;

export { type HelperSettingsCardProps as H, type RegisterHelperSettingsScreenOptions as R, type HelperSettingsField as a, type HelperSettingsFieldKind as b, type HelperSettingsFieldOverrides as c, type HelperSettingsInputProps as d, type HelperSettingsRowBaseProps as e, type HelperSettingsScreenContribution as f, type HelperSettingsScreenRegistrar as g, type HelperSettingsSectionProps as h, type HelperSettingsSelectComponent as i, type HelperSettingsSelectProps as j, type HelperSettingsSwitchProps as k, type HelperSettingsUiBundle as l, contractSchemaToFields as m, registerHelperSettingsScreen as r };
