import React from "react";

export type SubIconTree = [
  tag: string,
  attributes: { [key: string]: string },
  ...children: SubIconTree[],
];

export type IconTree = [
  attributes: { [key: string]: string }, //
  children: SubIconTree[],
];

function fromTree(tree?: SubIconTree[]): React.ReactElement[] | null {
  return (
    tree?.map(([Tag, attr, ...children], i) => (
      // @ts-expect-error `children` missing in props
      <Tag key={i} {...attr}>
        {fromTree(children)}
      </Tag>
    )) ?? null
  );
}

export interface IconProps extends React.SVGAttributes<SVGElement> {
  icon: IconTree;
  size?: string | number;
  color?: string;
  title?: string;
}

export type IconType = (props: IconProps) => React.ReactElement;

export function Icon(props: IconProps): React.ReactElement {
  const { size = "1em", title, icon, ...rest } = props;
  return (
    <svg
      stroke="currentColor"
      fill="currentColor"
      strokeWidth="0"
      {...icon[0]}
      {...rest}
      style={{
        color: props.color,
        ...props.style,
      }}
      height={size}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title != null && <title>{title}</title>}
      <>{fromTree(icon[1])}</>
    </svg>
  );
}
