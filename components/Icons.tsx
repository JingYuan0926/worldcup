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
export function BallIcon({ size = 16 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/icons/ball.png" alt="" width={size} height={size} style={{ display: "block", objectFit: "contain" }} />;
}

/** Corner: flag on a planted pole with the quarter-arc of the corner zone. */
export function CornerIcon({ size = 16 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/icons/corner.png" alt="" width={size} height={size} style={{ display: "block", objectFit: "contain" }} />;
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

export function YellowCardIcon({ size = 16 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/icons/yellowcard.png" alt="" width={size} height={size} style={{ display: "block", objectFit: "contain" }} />;
}

export function RedCardIcon({ size = 16 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/icons/redcard.png" alt="" width={size} height={size} style={{ display: "block", objectFit: "contain" }} />;
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

/**
 * The four match events are real artwork (`/public/icons`), so they carry their own
 * colour and cannot be tinted — which is why there is no `color` prop. Anything
 * placing one needs a neutral background behind it; a filled team-coloured disc
 * swallows the icon whole.
 *
 * `sub` is still a line icon: there is no artwork for it, and no pool either.
 */
export function EventIcon({ kind, size = 16 }: { kind: EventKind; size?: number }) {
  switch (kind) {
    case "goal":
      return <BallIcon size={size} />;
    case "corner":
      return <CornerIcon size={size} />;
    case "yellow":
      return <YellowCardIcon size={size} />;
    case "red":
      return <RedCardIcon size={size} />;
    case "sub":
      return <SubIcon size={size} />;
  }
}
