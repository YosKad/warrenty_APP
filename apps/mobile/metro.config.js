const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Supabase ships browser-targeted ESM; `unstable_enablePackageExports` keeps Metro
// from resolving the wrong entry point for @supabase/supabase-js and ws.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['react-native', 'require', 'import'];

module.exports = config;
