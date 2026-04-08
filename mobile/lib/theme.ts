export const colors = {
  light: {
    primary: '#971B2F',
    primaryContainer: '#FFFFFF',
    secondary: '#625B71',
    secondaryContainer: 'rgba(151, 27, 47, 0.1)',
    tertiary: '#7D5260',
    background: '#FFFFFF',
    surface: '#FFFFFF',
    error: '#B3261E',
    onPrimary: '#FFFFFF',
    onSecondary: '#FFFFFF',
    onBackground: '#121212',
    onSurface: '#121212',
    outline: '#79747E',
  },
  dark: {
    primary: '#D54E6B',
    primaryContainer: '#73293E',
    secondary: '#CCC2DC',
    secondaryContainer: 'rgba(255, 255, 255, 0.1)',
    tertiary: '#EFB8C8',
    background: '#000000',
    surface: '#000000',
    error: '#F2B8B5',
    onPrimary: '#FFFFFF',
    onSecondary: '#332D41',
    onBackground: '#E6E0E9',
    onSurface: '#FFFFFF',
    outline: '#938F99',
  },
};

export type ThemeColors = typeof colors.light;
