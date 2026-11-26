module.exports = ({ config }) => ({
  ...config,
  name: 'Табель',
  slug: 'tabel',
  version: '0.8.3',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'ru.tabel.worktime',
    supportsTablet: true,
    buildNumber: '11'
  },
  android: {
    package: 'ru.tabel.worktime',
    versionCode: 11,
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.VIBRATE',
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT'
    ],
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#034730'
    }
  },
  plugins: ['expo-secure-store'],
  platforms: ['ios', 'android']
});
