// @ts-check
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import plugin from "babel-plugin-macros";
import { pluginTester } from "./babel-tester";
// import "esbin/register.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

process.env.PACKAGE_NAME = "react-icons";

pluginTester({
  plugin,
  pluginOptions: {
    resolvePath: () => resolve(__dirname, "../src/macro.ts"),
  },
  snapshot: true,
  babelOptions: {
    parserOpts: {
      plugins: ["jsx"],
    },
  },
  tests: [
    /* jsx */ `
      import Icon from "react-icons/macro";
      <Icon icon="FcAcceptDatabase" />;
    `,
    /* jsx */ `
      import Icon from "react-icons/macro";
      <Icon icon={process.env.TEST ? "FcAcceptDatabase" : "FcAddDatabase"} />;
    `,
    /* jsx */ `
      import Icon from "react-icons/macro";
      const Save = Icon.of("BiSave");
    `,
    /* jsx */ `
      import Icon from "react-icons/macro";
      const Save = Icon.of("BiSave", { fontSize: "2em" });
    `,
  ],
});
