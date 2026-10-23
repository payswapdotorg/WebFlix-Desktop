// Sidebar/card glyphs (WFX-UX-SHELL-1) — hand-drawn inline SVG icons.
//
// Why hand-rolled: the shell takes NO new package dependencies (work-order
// law) and imports nothing from @zcode/ui (freeze §9.4 CSS-isolation law,
// extended by the P9-UI-1 posture for the media surface). These are
// navigational glyphs, not artwork: 24px stroke icons, currentColor, no
// fills that would fight the WebFlix theme tokens.

import React from "react";

export type IconName =
  | "home"
  | "search"
  | "shorts"
  | "subscriptions"
  | "library"
  | "history"
  | "trending"
  | "accounts"
  | "ads"
  | "evaluation"
  | "settings"
  | "agent"
  | "collapse"
  | "expand"
  | "verified";

/** The stroke paths for each glyph (viewBox 0 0 24 24, stroke currentColor). */
const ICONS: Record<IconName, React.ReactNode> = {
  home: (
    <>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v10h12V10" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5 21 21" />
    </>
  ),
  shorts: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="4" />
      <path d="M10 9.5v5l4.5-2.5z" />
    </>
  ),
  subscriptions: (
    <>
      <path d="M6 4h12" />
      <path d="M4 7.5h16" />
      <rect x="3" y="10.5" width="18" height="10" rx="2" />
    </>
  ),
  library: (
    <>
      <rect x="3.5" y="4" width="4.5" height="16" rx="1" />
      <rect x="10" y="4" width="4.5" height="16" rx="1" />
      <path d="M17 5.5l3.5 1v11l-3.5 1z" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  trending: (
    <>
      <path d="M3 17l5.5-6 4 4L20 7" />
      <path d="M15 7h5v5" />
    </>
  ),
  accounts: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.9 3.8-6 8-6s8 2.1 8 6" />
    </>
  ),
  ads: (
    <>
      <path d="M3 6h10l8 6-8 6H3z" />
      <circle cx="8" cy="12" r="1.6" />
    </>
  ),
  evaluation: (
    <>
      <path d="M5 20V11" />
      <path d="M12 20V4" />
      <path d="M19 20v-7" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8" />
    </>
  ),
  agent: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 7V4" />
      <circle cx="9" cy="12.5" r="1" />
      <circle cx="15" cy="12.5" r="1" />
      <path d="M9.5 16h5" />
    </>
  ),
  collapse: <path d="M14 6l-6 6 6 6" />,
  expand: <path d="M10 6l6 6-6 6" />,
  verified: (
    <>
      <path d="M12 3l2.2 1.6 2.7-.3 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.3L12 21l-2.2-1.6-2.7.3-1-2.5-2.3-1.4.6-2.6-.6-2.6 2.3-1.4 1-2.5 2.7.3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
};

export interface IconProps {
  readonly name: IconName;
  /** Pixel size (width = height). */
  readonly size?: number;
  /** Decorative by default — pass a title when the glyph is meaningful alone. */
  readonly title?: string;
  readonly style?: React.CSSProperties;
}

/** One inline SVG glyph. Decorative (aria-hidden) unless a title is given. */
export function Icon(props: IconProps): React.ReactElement {
  const { name, size = 20, title, style } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title === undefined ? true : undefined}
      role={title === undefined ? undefined : "img"}
      focusable="false"
      style={{ flexShrink: 0, ...style }}
    >
      {title !== undefined && <title>{title}</title>}
      {ICONS[name]}
    </svg>
  );
}
