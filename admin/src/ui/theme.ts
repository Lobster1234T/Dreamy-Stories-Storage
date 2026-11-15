import { createTheme } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'violet',
  defaultRadius: 'md',
  fontFamily: 'Inter, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
  headings: { fontWeight: '650' },
  cursorType: 'pointer',
  components: {
    Tooltip: { defaultProps: { withArrow: true, openDelay: 300 } },
    Button: { defaultProps: { radius: 'md' } },
  },
});

const LOCALE_COLORS = ['blue', 'teal', 'grape', 'orange', 'cyan', 'pink', 'lime', 'indigo', 'red', 'yellow'] as const;

/** Stable color per geo code. */
export function localeColor(code: string): string {
  const hash = Array.from(code).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return LOCALE_COLORS[hash % LOCALE_COLORS.length];
}
