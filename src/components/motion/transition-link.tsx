"use client";

import Link, { type LinkProps } from "next/link";
import { type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useRouteTransition } from "@/components/motion/route-transition-provider";

type TransitionLinkProps = LinkProps & {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  label?: string;
  target?: string;
  rel?: string;
};

export function TransitionLink({
  children,
  href,
  className,
  style,
  onClick,
  label,
  ...props
}: TransitionLinkProps) {
  const { navigate } = useRouteTransition();

  return (
    <Link
      {...props}
      href={href}
      className={className}
      style={style}
      onClick={(event) => {
        onClick?.(event);

        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target === "_blank"
        ) {
          return;
        }

        event.preventDefault();
        navigate({
          href: typeof href === "string" ? href : href.pathname || "/",
          label,
        });
      }}
    >
      {children}
    </Link>
  );
}
