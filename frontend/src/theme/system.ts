import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';

/**
 * Evendule design system. Every component uses colorPalette="brand" (or a
 * semantic status palette), so the UI stays visually consistent and colours
 * are changed in one place.
 */
const config = defineConfig({
  globalCss: {
    'html, body': { bg: 'bg.subtle', color: 'fg' },
  },
  theme: {
    tokens: {
      fonts: {
        heading: { value: `'Inter', system-ui, sans-serif` },
        body: { value: `'Inter', system-ui, sans-serif` },
      },
      colors: {
        brand: {
          50: { value: '#eff4ff' },
          100: { value: '#dbe6ff' },
          200: { value: '#bccfff' },
          300: { value: '#93b2fd' },
          400: { value: '#6a8ef8' },
          500: { value: '#4263eb' },
          600: { value: '#3552d6' },
          700: { value: '#2c44b3' },
          800: { value: '#283a8e' },
          900: { value: '#232c66' },
          950: { value: '#151a40' },
        },
      },
      radii: {
        card: { value: '1rem' },
      },
    },
    semanticTokens: {
      colors: {
        brand: {
          solid: { value: { _light: '{colors.brand.600}', _dark: '{colors.brand.500}' } },
          contrast: { value: 'white' },
          fg: { value: { _light: '{colors.brand.700}', _dark: '{colors.brand.300}' } },
          muted: { value: { _light: '{colors.brand.100}', _dark: '{colors.brand.900}' } },
          subtle: { value: { _light: '{colors.brand.50}', _dark: '{colors.brand.950}' } },
          emphasized: { value: { _light: '{colors.brand.200}', _dark: '{colors.brand.800}' } },
          focusRing: { value: '{colors.brand.500}' },
        },
        // Data-viz palette: validated for CVD separation and contrast in both modes
        // (dataviz validator, surfaces #ffffff / #111111). Series 1 = bookings, 2 = cancellations.
        chart: {
          series1: { value: { _light: '#2a78d6', _dark: '#3987e5' } },
          series2: { value: { _light: '#eb6834', _dark: '#d95926' } },
          grid: { value: { _light: '#e1e0d9', _dark: '#2c2c2a' } },
          axis: { value: { _light: '#c3c2b7', _dark: '#383835' } },
          muted: { value: '#898781' },
        },
      },
    },
    layerStyles: {
      card: {
        value: {
          bg: 'bg.panel',
          borderWidth: '1px',
          borderColor: 'border.muted',
          borderRadius: 'card',
          boxShadow: 'xs',
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
