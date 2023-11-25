// @ts-check
const { extendConfig } = require("@aet/eslint-rules");

module.exports = extendConfig({
  plugins: ["react"],
  rules: {
    "import/no-unresolved": ["error", { ignore: ["^bun:.+"] }],
  },
});
