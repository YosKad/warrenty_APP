import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Environment-aware app configuration.
 *
 * Three environments are supported (development / staging / production). Each gets its
 * own bundle identifier so all three can be installed side by side on one device, and
 * each reads its own Supabase project + AI gateway from the environment.
 *
 * Nothing privileged belongs here: only values that are safe to ship inside the binary
 * (Supabase URL + anon key, which are protected by Row Level Security). Service-role
 * keys and model provider keys live exclusively in Edge Function secrets.
 */

type AppEnv = 'development' | 'staging' | 'production';

const APP_ENV = (process.env.APP_ENV ?? 'development') as AppEnv;

const NAME_BY_ENV: Record<AppEnv, string> = {
  development: 'MY Warranty (Dev)',
  staging: 'MY Warranty (Stg)',
  production: 'MY Warranty',
};

const BUNDLE_ID_BY_ENV: Record<AppEnv, string> = {
  development: 'com.mywarranty.app.dev',
  staging: 'com.mywarranty.app.stg',
  production: 'com.mywarranty.app',
};

const SCHEME_BY_ENV: Record<AppEnv, string> = {
  development: 'mywarranty-dev',
  staging: 'mywarranty-stg',
  production: 'mywarranty',
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME_BY_ENV[APP_ENV],
  slug: 'mywarranty',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: SCHEME_BY_ENV[APP_ENV],
  icon: './assets/icon.png',
  // The design system owns colour; `automatic` lets the OS drive light/dark.
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#0B1220',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: BUNDLE_ID_BY_ENV[APP_ENV],
    buildNumber: '1',
    usesAppleSignIn: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      // Permission copy is user-facing and reviewed by Apple. It must explain the
      // benefit, not the mechanism.
      NSCameraUsageDescription:
        'MY Warranty uses the camera so you can scan a receipt or photograph a product when you add it.',
      NSPhotoLibraryUsageDescription:
        'MY Warranty needs access to a photo you choose so it can attach a receipt or product image to your warranty.',
      NSPhotoLibraryAddUsageDescription:
        'MY Warranty can save a copy of a warranty document back to your photo library.',
      NSFaceIDUsageDescription:
        'Use Face ID to unlock MY Warranty, since your receipts may contain personal details.',
      // Coarse location only, and only when the app is in use. Used to suggest the
      // right country warranty rules and nearby service centres.
      NSLocationWhenInUseUsageDescription:
        'MY Warranty can use your approximate location to show warranty rules and service centres for your country. You can also set this manually.',
      ITSAppUsesNonExemptEncryption: false,
    },
    entitlements: {
      'com.apple.developer.applesignin': ['Default'],
    },
  },
  android: {
    package: BUNDLE_ID_BY_ENV[APP_ENV],
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#0B1220',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: true,
    permissions: [
      'android.permission.CAMERA',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.USE_BIOMETRIC',
      'com.android.vending.BILLING',
    ],
    blockedPermissions: [
      // The photo picker is used instead of full library access.
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-secure-store',
    'expo-apple-authentication',
    'expo-web-browser',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#FFFFFF',
        dark: { backgroundColor: '#0B1220' },
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission:
          'MY Warranty uses the camera so you can scan a receipt or photograph a product.',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'MY Warranty needs access to the photo you choose so it can attach it to your warranty.',
      },
    ],
    [
      'expo-local-authentication',
      { faceIDPermission: 'Use Face ID to unlock MY Warranty.' },
    ],
    [
      'expo-notifications',
      { icon: './assets/notification-icon.png', color: '#0B1220' },
    ],
    [
      'expo-build-properties',
      {
        ios: { deploymentTarget: '16.0' },
        android: { minSdkVersion: 26, compileSdkVersion: 36, targetSdkVersion: 36 },
      },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: {
    appEnv: APP_ENV,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    privacyPolicyUrl:
      process.env.EXPO_PUBLIC_PRIVACY_URL ?? 'https://mywarranty.app/privacy',
    termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? 'https://mywarranty.app/terms',
    supportUrl: process.env.EXPO_PUBLIC_SUPPORT_URL ?? 'https://mywarranty.app/support',
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
});
