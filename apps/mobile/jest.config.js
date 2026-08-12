/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg))',
  ],
  collectCoverageFrom: [
    'src/domain/**/*.ts',
    'src/services/**/*.ts',
    'src/lib/**/*.ts',
    '!**/*.d.ts',
  ],
  coverageThreshold: {
    global: { statements: 60, branches: 50, functions: 55, lines: 60 },
  },
};
