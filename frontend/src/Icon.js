// Line icons from the design export, plus a few the live app needs
// (minus, upload, locate, logout).

const PATHS = {
  home: (
    <>
      <path d="M3 11 12 4l9 7v9H3Z" />
      <path d="M9 20v-6h6v6" />
    </>
  ),
  recipes: (
    <>
      <path d="M3 11h18a9 9 0 0 1-18 0Z" />
      <path d="M9 7c0-1.5 1-1.5 1-3M14 7c0-1.5 1-1.5 1-3" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5h16v11H9l-5 4Z" />
      <path d="M8 10h8" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8h4l2-3h6l2 3h4v11H3Z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  send: <path d="M4 12 20 4l-6 16-3-7Z" />,
  back: <path d="m15 18-6-6 6-6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  map: <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15" />,
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 4C12 4 5 8 5 15c0 2 1 4 3 5 7-1 11-6 12-16Z" />
      <path d="M4 21c3-5 7-8 12-11" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h7M15 6h5M4 12h3M11 12h9M4 18h10M18 18h2" />
      <circle cx="13" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </>
  ),
  heart: (
    <path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z" />
  ),
  sparkle: (
    <path d="m12 3 1.3 4.1L17 9l-3.7 1.9L12 15l-1.3-4.1L7 9l3.7-1.9ZM5 15l.7 2.3L8 18l-2.3.7L5 21l-.7-2.3L2 18l2.3-.7Z" />
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  pin: (
    <>
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  walk: (
    <>
      <circle cx="13" cy="4" r="2" />
      <path d="m10 22 2-7-3-3 2-5 4 3h4M6 22l3-6M14 15l4 7" />
    </>
  ),
  bike: (
    <>
      <circle cx="6" cy="17" r="4" />
      <circle cx="18" cy="17" r="4" />
      <path d="m6 17 5-8 4 8M9 12h7M14 6h3" />
    </>
  ),
  car: (
    <>
      <path d="m4 15 2-6h12l2 6v5H4zM7 20v1M17 20v1" />
      <circle cx="8" cy="16" r="1" />
      <circle cx="16" cy="16" r="1" />
    </>
  ),
  bus: (
    <>
      <rect x="5" y="3" width="14" height="17" rx="3" />
      <path d="M5 14h14M8 20v2M16 20v2M8 7h8" />
    </>
  ),
  store: (
    <path d="M4 10v11h16V10M3 10l2-6h14l2 6c-1 2-4 2-5 0-1 2-4 2-5 0-1 2-4 2-5 0-1 2-3 1-3 0ZM9 21v-6h6v6" />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  logout: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

export default function Icon({ name, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
