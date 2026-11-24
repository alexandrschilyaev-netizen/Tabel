module.exports = ({ config }) => ({
  ...config,
  name: 'Табель',
  slug: 'tabel',
  version: '0.6.0',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'ru.tabel.worktime',
    supportsTablet: true,
    buildNumber: '6'
  },
  android: {
    package: 'ru.tabel.worktime',
    versionCode: 6,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#254fc5'
    }
  },
  plugins: ['expo-secure-store'],
  platforms: ['ios', 'android']
});
