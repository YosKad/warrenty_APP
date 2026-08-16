/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@mw/domain$': '<rootDir>/../../packages/domain/src/index.ts',
    // The shared package lives outside this app and has no `node_modules` of its
    // own, so Babel's runtime helpers have to be resolved from here.
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
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
