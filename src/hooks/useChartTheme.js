import { useMemo } from 'react';
import { useTheme } from '@/context/ThemeContext';

/**
 * Recharts needs concrete colour values — it cannot consume Tailwind classes
 * or resolve CSS custom properties for SVG strokes. So the chart furniture is
 * mirrored here and switched off the active theme.
 *
 * Without this, grid lines defined as `rgba(255,255,255,0.06)` are perfectly
 * invisible on a white card, and the muted "expense" grey disappears too.
 */
export function useChartTheme() {
  const { isDark } = useTheme();

  return useMemo(
    () =>
      isDark
        ? {
            grid: 'rgba(255,255,255,0.06)',
            axis: '#6B7280',
            cursor: 'rgba(255,255,255,0.04)',
            income: '#C8FF00',
            expense: '#4B5563',
            net: '#C8FF00',
            netStop: '#C8FF00',
            dotStroke: '#090B0D',
            negative: '#FF5C6C',
            warning: '#FFB547',
          }
        : {
            grid: 'rgba(9,11,13,0.09)',
            axis: '#6B7280',
            cursor: 'rgba(9,11,13,0.04)',
            // A neon fill on white washes out; this olive keeps the hue and
            // still reads as a solid bar.
            income: '#7FA300',
            expense: '#C3C7CC',
            net: '#5E7F00',
            netStop: '#7FA300',
            dotStroke: '#FFFFFF',
            negative: '#E23D4E',
            warning: '#C77A00',
          },
    [isDark],
  );
}

export default useChartTheme;
