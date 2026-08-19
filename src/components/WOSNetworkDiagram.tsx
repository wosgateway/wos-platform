import {
  Hospital,
  Stethoscope,
  Leaf,
  BedDouble,
  Plane,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

/**
 * WOSNetworkDiagram — animated network diagram (Step 4 of the homepage rebuild).
 *
 * Standalone, presentational component: it renders whatever `nodes` it is
 * given orbiting a center hub and does not import next-intl or reach for any
 * real business data itself — that keeps it reusable outside the Hero too
 * (e.g. an "About the network" section later). `defaultNetworkNodes` below
 * is placeholder/mock content only, used by the preview page so this file
 * can be reviewed on its own before anything wires in real copy.
 *
 * Layout: nodes are placed evenly around a circle by index (12 o'clock,
 * clockwise), independent of how many are passed in, so the 6-node
 * Hospital/Clinic/Wellness/Hotel/Transport/Patient set from the brief is
 * just the default — not hard-coded into the geometry.
 *
 * Motion in this pass is intentionally restrained: a slow pulse on the
 * center hub and a slow dashed "flow" on the connecting lines (both
 * disabled under prefers-reduced-motion). The brief's Step 11 ("network
 * line motion" per item 20) is a later, more choreographed pass — this
 * gives it something sensible to refine rather than starting from nothing.
 *
 * Does not touch HeroV2.tsx. Once approved, dropping <WOSNetworkDiagram />
 * into HeroV2's `data-network-slot` container in place of the static badge
 * is a one-line swap — see the preview page for exactly what that looks
 * like at the same size/breakpoint.
 */

const NODE_ICONS = {
  hospital: Hospital,
  clinic: Stethoscope,
  wellness: Leaf,
  hotel: BedDouble,
  transport: Plane,
  patient: UserRound,
} satisfies Record<string, LucideIcon>;

export type NetworkNodeIcon = keyof typeof NODE_ICONS;

export interface NetworkNode {
  /** Stable key — used as the React key and in the diagram's sr-only summary. */
  id: string;
  /** Display label under the node icon. */
  label: string;
  icon: NetworkNodeIcon;
}

/** Placeholder content only — not real copy. Swap for translated labels when wiring this in. */
export const defaultNetworkNodes: NetworkNode[] = [
  { id: 'hospital', label: 'Hospital', icon: 'hospital' },
  { id: 'clinic', label: 'Clinic', icon: 'clinic' },
  { id: 'wellness', label: 'Wellness', icon: 'wellness' },
  { id: 'hotel', label: 'Hotel', icon: 'hotel' },
  { id: 'transport', label: 'Transport', icon: 'transport' },
  { id: 'patient', label: 'Patient', icon: 'patient' },
];

interface WOSNetworkDiagramProps {
  nodes?: NetworkNode[];
  centerLabel?: string;
  centerSubLabel?: string;
  className?: string;
}

export default function WOSNetworkDiagram({
  nodes = defaultNetworkNodes,
  centerLabel = 'WOS.os',
  centerSubLabel = 'Health Journey Platform',
  className = '',
}: WOSNetworkDiagramProps) {
  const radius = 42; // percent of container, from center to each node's center

  const points = nodes.map((node, i) => {
    const angleDeg = -90 + i * (360 / nodes.length); // start at 12 o'clock, go clockwise
    const angleRad = (angleDeg * Math.PI) / 180;
    return {
      ...node,
      x: 50 + radius * Math.cos(angleRad),
      y: 50 + radius * Math.sin(angleRad),
    };
  });

  const summary = nodes.map((n) => n.label).join(', ');

  return (
    <div
      className={`relative w-full ${className}`}
      style={{ aspectRatio: '1 / 1' }}
    >
      {/* Screen-reader summary — the diagram itself is decorative/aria-hidden below */}
      <span className="sr-only">
        {centerLabel} connects: {summary}
      </span>

      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <style>{`
          .wos-network-line {
            stroke-dasharray: 4 3;
            animation: wos-network-dash 18s linear infinite;
          }
          @keyframes wos-network-dash {
            to { stroke-dashoffset: -140; }
          }
          @media (prefers-reduced-motion: reduce) {
            .wos-network-line { animation: none; }
          }
        `}</style>
        {points.map((p) => (
          <line
            key={p.id}
            x1={50}
            y1={50}
            x2={p.x}
            y2={p.y}
            stroke="#1D63A6"
            strokeOpacity={0.35}
            strokeWidth={0.6}
            className="wos-network-line"
          />
        ))}
      </svg>

      {/* Center hub */}
      <div className="absolute left-1/2 top-1/2 z-10 flex h-[30%] w-[30%] -translate-x-1/2 -translate-y-1/2 items-center justify-center">
        <span
          aria-hidden="true"
          className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-gold/20"
          style={{ animationDuration: '3s' }}
        />
        <div className="relative flex h-[78%] w-[78%] flex-col items-center justify-center rounded-full border border-white/20 bg-navy-dark/90 text-center shadow-card backdrop-blur-md">
          <span className="text-lg font-bold text-white">{centerLabel}</span>
          <span className="mt-1 px-2 text-[9px] font-medium uppercase leading-tight tracking-wider text-medicalBlue-light">
            {centerSubLabel}
          </span>
        </div>
      </div>

      {/* Satellite nodes */}
      {points.map((p) => {
        const Icon = NODE_ICONS[p.icon];
        return (
          <div
            key={p.id}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 transition-transform duration-200 hover:scale-105"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-navy-light/90 shadow-card backdrop-blur-md sm:h-12 sm:w-12">
              <Icon className="h-5 w-5 text-gold" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <span className="whitespace-nowrap rounded-full bg-navy-dark/70 px-2 py-0.5 text-[9px] font-medium text-white/85 sm:text-[10px]">
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}