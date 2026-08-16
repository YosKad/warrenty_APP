const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Supabase ships browser-targeted ESM; `unstable_enablePackageExports` keeps Metro
// from resolving the wrong entry point for @supabase/supabase-js and ws.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['react-native', 'require', 'import'];

// `@mw/domain` is TypeScript source outside the app directory, shared with the
// admin console. Metro only watches the project root by default, so the folder
// has to be named explicitly or edits to shared logic never trigger a reload.
const sharedDomain = path.resolve(__dirname, '../../packages/domain');
config.watchFolders = [...(config.watchFolders ?? []), sharedDomain];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@mw/domain': sharedDomain,
};

module.exports = config;
