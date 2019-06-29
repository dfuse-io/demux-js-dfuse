const { defaults } = require("jest-config")

module.exports = {
  transform: {
    "^.+\\.tsx?$": "ts-jest"
  },
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["jest-expect-message"],
  clearMocks: true,

  // coverageThreshold: {
  //   global: {
  //     branches: 42.4,
  //     lines: 62.1,
  //     functions: 33.8,
  //     statements: 62.0
  //   }
  // },
  collectCoverage: true,
  // coverageReporters: ["json", "html"],
  coverageDirectory: "coverage"
}
