import Fs from 'fs'
import { Config } from 'jest'

const SwcConfig = JSON.parse(Fs.readFileSync(`${__dirname}/.swcrc`, 'utf-8'))

export default async (): Promise<Config> => ({
  extensionsToTreatAsEsm: ['.ts'],

  transform: {
    "^.+\\.(t)sx?$": ["@swc/jest", SwcConfig]
  },

  testEnvironment: '',

  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname'
  ],

  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  roots: [
    "<rootDir>/src"
  ],

  testRegex: [
    '(/__tests__/.*|(\\.|/)(spec))\\.[jt]sx?$',
  ]
})