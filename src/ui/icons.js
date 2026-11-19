// Small inline SVG icons (no image files needed).
const svg = body => `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const ICONS = {
  shooter: svg('<path d="M24 6 L34 30 L24 25 L14 30 Z"/><path d="M18 36 L24 31 L30 36"/><circle cx="10" cy="12" r="2"/><circle cx="40" cy="16" r="2"/>'),
  reaction: svg('<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="9"/><circle cx="24" cy="24" r="2.5" fill="currentColor"/>'),
  memory: svg('<rect x="7" y="10" width="15" height="21" rx="3"/><rect x="26" y="17" width="15" height="21" rx="3"/><path d="M33.5 24 v7 M30 27.5 h7"/>'),
  typing: svg('<rect x="5" y="13" width="38" height="22" rx="4"/><path d="M11 20h2 M17 20h2 M23 20h2 M29 20h2 M35 20h2 M14 28h20"/>'),
  brain: svg('<path d="M24 6c-7 0-12 5-12 11.5 0 4.2 2.2 7.2 5 9.5V32h14v-5c2.8-2.3 5-5.3 5-9.5C36 11 31 6 24 6z"/><path d="M19 37h10 M20.5 42h7"/><path d="M24 14v6 M21 17h6"/>'),
  sound: svg('<path d="M8 19h7l9-7v24l-9-7H8z"/><path d="M31 18c3 3 3 9 0 12 M36 14c5 5 5 15 0 20"/>'),
  muted: svg('<path d="M8 19h7l9-7v24l-9-7H8z"/><path d="M31 19l10 10 M41 19 L31 29"/>'),
  full: svg('<path d="M8 18V8h10 M30 8h10v10 M40 30v10H30 M18 40H8V30"/>'),
};
