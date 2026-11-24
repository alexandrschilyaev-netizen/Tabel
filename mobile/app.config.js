module.exports = ({ config }) => ({
  ...config,
  name: 'Табель',
  slug: 'tabel',
  version: '0.8.0',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'ru.tabel.worktime',
    supportsTablet: true,
    buildNumber: '8'
  },
  android: {
    package: 'ru.tabel.worktime',
    versionCode: 8,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#034730'
    }
  },
  plugins: ['expo-secure-store'],
  platforms: ['ios', 'android']
});
