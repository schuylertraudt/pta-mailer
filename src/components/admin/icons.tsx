/** Small stroke icons (24px grid, drawn at 16px) for the composer. */
const PATHS = {
  image: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21",
  bullet: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  ordered: "M10 6h11M10 12h11M10 18h11M4 4h1v5M4 9h2M6 20H4c0-1 2-2 2-3s-1-1.5-2-1",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  unlink: "M9 17H7A5 5 0 0 1 7 7M15 7h2a5 5 0 0 1 4 8M8 12h4M3 3l18 18",
  alignLeft: "M21 6H3M15 12H3M17 18H3",
  alignCenter: "M21 6H3M17 12H7M19 18H5",
  alignRight: "M21 6H3M21 12H9M21 18H7",
  undo: "M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13",
  redo: "M21 7v6h-6M3 17a9 9 0 0 1 15-6.7l3 2.7",
  button: "M5 7h14a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3zM8 12h8",
  imageText: "M3 5h8v8H3zM15 6h6M15 10h6M3 17h18M3 21h12",
  divider: "M3 12h18M8 6h8M8 18h8",
  spacer: "M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4",
  chevronDown: "M6 9l6 6 6-6",
  upload: "M12 13v8M8 17l4-4 4 4M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3",
  close: "M18 6L6 18M6 6l12 12",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
