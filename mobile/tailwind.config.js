/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Primary colors - True Confessions burgundy/red
        primary: {
          DEFAULT: '#971B2F',  // primaryLight
          light: '#D54E6B',    // primaryDark (lighter for dark mode)
          dark: '#73293E',     // primaryContainerDark
          50: '#FFE0E5',
          100: '#FFB1C0',
          200: '#FF8A9E',
          300: '#D54E6B',
          400: '#B8445B',
          500: '#971B2F',      // Main primary
          600: '#7A1527',
          700: '#73293E',
          800: '#3B0716',
          900: '#3B0716',
        },
        // Secondary colors - purple/violet tones
        secondary: {
          DEFAULT: '#625B71',  // secondaryLight
          light: '#CCC2DC',    // secondaryDark
          dark: '#332D41',
          container: {
            light: 'rgba(151, 27, 47, 0.1)',  // primary with 10% alpha
            dark: 'rgba(255, 255, 255, 0.1)',
          },
        },
        // Tertiary - rose/pink
        tertiary: {
          DEFAULT: '#7D5260',
          light: '#EFB8C8',
          dark: '#492532',
        },
        // Error colors
        error: {
          DEFAULT: '#B3261E',
          light: '#F2B8B5',
          dark: '#601410',
        },
        // Background
        background: {
          DEFAULT: '#FFFFFF',
          dark: '#000000',
        },
        // Surface
        surface: {
          DEFAULT: '#FFFFFF',
          dark: '#000000',
          variant: {
            light: '#E7E0EC',
            dark: '#49454F',
          },
        },
        // Text colors
        'on-primary': '#FFFFFF',
        'on-secondary': '#FFFFFF',
        'on-background': {
          DEFAULT: '#121212',
          dark: '#E6E0E9',
        },
        'on-surface': {
          DEFAULT: '#121212',
          dark: '#FFFFFF',
        },
        // Outline
        outline: {
          DEFAULT: '#79747E',
          dark: '#938F99',
        },
      },
    },
  },
  plugins: [],
};
