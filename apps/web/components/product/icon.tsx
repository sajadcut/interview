import type { SVGProps } from "react";

export type IconName =
  | "home" | "jobs" | "candidates" | "talent" | "interviews" | "inbox" | "analytics"
  | "automation" | "integrations" | "settings" | "search" | "bell" | "plus" | "sparkles"
  | "chevron" | "filter" | "columns" | "calendar" | "more" | "share" | "briefcase" | "clock"
  | "location" | "check" | "arrow" | "play" | "message" | "shield" | "brain" | "target";

const paths: Record<IconName, string[]> = {
  home: ["M3 11.5 12 4l9 7.5", "M5 10.5V20h5v-6h4v6h5v-9.5"],
  jobs: ["M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7", "M4 7h16v13H4z", "M4 12h16"],
  candidates: ["M16 20v-1.5A4.5 4.5 0 0 0 11.5 14h-3A4.5 4.5 0 0 0 4 18.5V20", "M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M17 8a3 3 0 0 1 0 6", "M19 20v-1a4 4 0 0 0-3-3.87"],
  talent: ["M12 3.5 14.2 8l4.8.7-3.5 3.4.8 4.9-4.3-2.3L7.7 17l.8-4.9L5 8.7 9.8 8Z"],
  interviews: ["M4 5h12a2 2 0 0 1 2 2v10H6a2 2 0 0 1-2-2Z", "m18 9 3-2v8l-3-2"],
  inbox: ["M4 5h16v14H4z", "m4 8 8 6 8-6"],
  analytics: ["M5 19V9", "M10 19V5", "M15 19v-7", "M20 19V3"],
  automation: ["M12 3v3", "M12 18v3", "M3 12h3", "M18 12h3", "M5.6 5.6l2.1 2.1", "M16.3 16.3l2.1 2.1", "M18.4 5.6l-2.1 2.1", "M7.7 16.3l-2.1 2.1", "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"],
  integrations: ["M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "M17 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "M17 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "M9.5 6.5h5", "M8.5 9.5l6.8 9", "M15.5 9.5l-6.8 9"],
  settings: ["M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.12 3.67-.08-.02a1.7 1.7 0 0 0-1.8.48l-.7.4a1.7 1.7 0 0 0-.88 1.57V23H9.78v-.03a1.7 1.7 0 0 0-.88-1.57l-.7-.4a1.7 1.7 0 0 0-1.8-.48l-.08.02-2.12-3.67.06-.06A1.7 1.7 0 0 0 4.6 15l-.4-.7a1.7 1.7 0 0 0-1.46-.85H2.7V9.21h.04a1.7 1.7 0 0 0 1.46-.85l.4-.7a1.7 1.7 0 0 0-.34-1.87l-.06-.06 2.12-3.67.08.02a1.7 1.7 0 0 0 1.8-.48l.7-.4A1.7 1.7 0 0 0 9.78-.37V-.4h4.44v.03a1.7 1.7 0 0 0 .88 1.57l.7.4a1.7 1.7 0 0 0 1.8.48l.08-.02 2.12 3.67-.06.06a1.7 1.7 0 0 0-.34 1.87l.4.7a1.7 1.7 0 0 0 1.46.85h.04v4.24h-.04a1.7 1.7 0 0 0-1.46.85Z"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z", "m16 16 5 5"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  plus: ["M12 5v14", "M5 12h14"],
  sparkles: ["M12 3l1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2Z", "M18.5 13l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z", "M5.5 14l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z"],
  chevron: ["m9 18 6-6-6-6"],
  filter: ["M4 6h16", "M7 12h10", "M10 18h4"],
  columns: ["M4 5h16v14H4z", "M12 5v14"],
  calendar: ["M5 5h14v15H5z", "M8 3v4", "M16 3v4", "M5 9h14"],
  more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  share: ["M12 16V4", "m8 8 4-4 4 4", "M5 13v7h14v-7"],
  briefcase: ["M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M4 7h16v13H4z", "M4 12h16"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
  location: ["M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z", "M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"],
  check: ["m5 12 4 4L19 6"],
  arrow: ["M5 12h14", "m14 0-5-5", "m5 5-5 5"],
  play: ["m9 7 8 5-8 5Z"],
  message: ["M4 5h16v12H8l-4 4Z"],
  shield: ["M12 3 4 6v5c0 5 3.5 8 8 9 4.5-1 8-4 8-9V9Z"],
  brain: ["M9.5 4A3.5 3.5 0 0 0 6 7.5v1A3.5 3.5 0 0 0 4 12a3.5 3.5 0 0 0 2 3.5v1A3.5 3.5 0 0 0 9.5 20H12V4Z", "M14.5 4A3.5 3.5 0 0 1 18 7.5v1A3.5 3.5 0 0 1 20 12a3.5 3.5 0 0 1-2 3.5v1a3.5 3.5 0 0 1-3.5 3.5H12V4Z", "M8 10h4", "M12 14h4"],
  target: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z", "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"],
};

export function Icon({ name, size = 18, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name].map((d, index) => <path key={`${name}-${index}`} d={d} />)}
    </svg>
  );
}
