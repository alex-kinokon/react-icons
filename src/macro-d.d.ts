import type * as icons from "./icons";

export type IconKey = keyof typeof icons;

export interface IconMacroProps extends React.SVGAttributes<SVGElement> {
  icon: IconKey;
  size?: string | number;
  color?: string;
  title?: string;
}

export type IconType = (props: IconMacroProps) => React.ReactElement;
export default function Icon(props: IconMacroProps): React.ReactElement;

export {};
