import React from "react";

export interface IconTree {
  tag: string;
  attr: { [key: string]: string };
  child: IconTree[];
}

function fromTree(tree: IconTree[]): React.ReactElement[] {
  return tree?.map(({ tag: Tag, attr, child }, i) => (
    // @ts-expect-error
    <Tag key={i} {...attr}>
      {fromTree(child)}
    </Tag>
  ));
}

export interface IconProps extends React.SVGAttributes<SVGElement> {
  icon: IconTree;
  size?: string | number;
  color?: string;
  title?: string;
}

export type IconType = (props: IconProps) => React.ReactElement;

export function Icon(props: IconProps): React.ReactElement {
  const { size = "1em", title, className, icon, ...rest } = props;
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth="0"
      {...icon.attr}
      {...rest}
      className={className}
      style={{
        color: props.color,
        ...props.style,
      }}
      height={size}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title != null && <title>{title}</title>}
      {fromTree(icon.child)}
    </svg>
  );
}
