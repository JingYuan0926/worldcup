/**
 * One icon family, drawn on a 20px grid at a uniform 1.5px stroke.
 *
 * These replace the emoji-flavoured shapes: the ball carries a real
 * truncated-icosahedron seam pattern rather than a dot, the corner is a planted
 * flag over its quarter-arc, and the cards are outlined rounded rectangles at a
 * slight rotation — legible by shape, not by colour alone.
 */

export interface IconProps {
  size?: number;
  color?: string;
  /** Cards only: the restrained fill inside the outline. */
  fill?: string;
  strokeWidth?: number;
}

function frame(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    style: { display: "block", flexShrink: 0 },
  } as const;
}

/** Football: circle plus the centre pentagon and its radiating seams. */
export function BallIcon({ size = 16, color = "currentColor", strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...frame(size)} aria-hidden="true">
      <g
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="10" cy="10" r="7.5" />
        <path d="M10 6.3 L12.9 8.4 L11.8 11.8 L8.2 11.8 L7.1 8.4 Z" />
        <path d="M10 6.3 V2.5" />
        <path d="M12.9 8.4 L16.9 7.2" />
        <path d="M11.8 11.8 L14.2 15.2" />
        <path d="M8.2 11.8 L5.8 15.2" />
        <path d="M7.1 8.4 L3.1 7.2" />
      </g>
    </svg>
  );
}

/** Corner: flag on a planted pole with the quarter-arc of the corner zone. */
export function CornerIcon({ size = 16, color = "currentColor", strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...frame(size)} aria-hidden="true">
      <g
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 3.2 V16.8" />
        <path d="M6 3.9 L13.4 6.2 L6 8.6" />
        <path d="M2.6 16.8 H16.4" />
        <path d="M2.6 13.4 A3.4 3.4 0 0 0 6 16.8" />
      </g>
    </svg>
  );
}

function Card({
  size,
  color,
  fill,
  strokeWidth,
}: {
  size: number;
  color: string;
  fill: string;
  strokeWidth: number;
}) {
  return (
    <svg {...frame(size)} aria-hidden="true">
      <rect
        x="6.4"
        y="3.2"
        width="8.2"
        height="12"
        rx="1.4"
        transform="rotate(11 10 10)"
        fill={fill}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function YellowCardIcon({
  size = 16,
  color = "currentColor",
  fill = "#f2c94c",
  strokeWidth = 1.5,
}: IconProps) {
  return <Card size={size} color={color} fill={fill} strokeWidth={strokeWidth} />;
}

export function RedCardIcon({
  size = 16,
  color = "currentColor",
  fill = "#cf2e3a",
  strokeWidth = 1.5,
}: IconProps) {
  return <Card size={size} color={color} fill={fill} strokeWidth={strokeWidth} />;
}

/** Substitution: the standard paired arrows. */
export function SubIcon({ size = 16, color = "currentColor", strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...frame(size)} aria-hidden="true">
      <g
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.2 6.6 H13.6" />
        <path d="M10.8 3.8 L13.6 6.6 L10.8 9.4" />
        <path d="M15.8 13.4 H6.4" />
        <path d="M9.2 10.6 L6.4 13.4 L9.2 16.2" />
      </g>
    </svg>
  );
}

export function CheckIcon({ size = 16, color = "currentColor", strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...frame(size)} aria-hidden="true">
      <g stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="7.5" />
        <path d="M6.6 10.2 L8.9 12.5 L13.4 7.8" />
      </g>
    </svg>
  );
}

export function LockIcon({ size = 16, color = "currentColor", strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...frame(size)} aria-hidden="true">
      <g stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <rect x="4.2" y="8.8" width="11.6" height="8" rx="1.6" />
        <path d="M6.8 8.8 V6.4 A3.2 3.2 0 0 1 13.2 6.4 V8.8" />
      </g>
    </svg>
  );
}

export function DeniedIcon({ size = 16, color = "currentColor", strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...frame(size)} aria-hidden="true">
      <g stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="7.5" />
        <path d="M4.9 4.9 L15.1 15.1" />
      </g>
    </svg>
  );
}

export function VoidIcon({ size = 16, color = "currentColor", strokeWidth = 1.5 }: IconProps) {
  return (
    <svg {...frame(size)} aria-hidden="true">
      <g stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="10" r="7.5" />
        <path d="M6.4 10 H13.6" />
      </g>
    </svg>
  );
}

export type EventKind = "goal" | "corner" | "yellow" | "red" | "sub";

export function EventIcon({
  kind,
  size = 16,
  color = "currentColor",
}: {
  kind: EventKind;
  size?: number;
  color?: string;
}) {
  switch (kind) {
    case "goal":
      return <BallIcon size={size} color={color} />;
    case "corner":
      return <CornerIcon size={size} color={color} />;
    case "yellow":
      return <YellowCardIcon size={size} color={color} />;
    case "red":
      return <RedCardIcon size={size} color={color} />;
    case "sub":
      return <SubIcon size={size} color={color} />;
  }
}
