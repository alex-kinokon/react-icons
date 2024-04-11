import type * as icons from "./all";

export type IconKey = keyof typeof icons;

export interface IconBaseMacroProps extends React.SVGAttributes<SVGElement> {
  size?: string | number;
  color?: string;
  title?: string;
}

export interface IconMacroProps extends IconBaseMacroProps {
  icon: IconKey;
}

declare const Icon: {
  (props: IconMacroProps): React.ReactElement;
  /**
   * Returns an icon component bound with the given icon name.
   */
  of(
    key: IconKey,
    props?: IconBaseMacroProps
  ): (props: IconBaseMacroProps) => React.ReactElement;
};

export default Icon;
