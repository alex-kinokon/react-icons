#!/usr/bin/env -S node -r esbin
import fs from "fs";
import glob from "fast-glob";

fs.mkdirSync("./dist", { recursive: true });

const iconBase = require("react-icons/lib/cjs/iconBase");
iconBase.GenIcon = (icon: unknown) => () => icon;

const libs = glob.sync("react-icons/*/index.js", { cwd: "./node_modules" });

const index = fs.createWriteStream("./dist/icons.js");
const indexDefs = fs.createWriteStream("./dist/icons.d.ts");

for (const lib of libs) {
  const name = lib.split("/")[1];
  const icons = fs.createWriteStream(`./dist/${name}.js`);
  const defs = fs.createWriteStream(`./dist/${name}.d.ts`);

  defs.write(`import type { IconTree } from "./index.d";\n\n`);

  for (let [key, value] of Object.entries(require(lib))) {
    if (name === "fa6") {
      key = key.replace(/^Fa/, "Fa6");
    } else if (name === "hi2") {
      key = key.replace(/^Hi/, "Hi2");
    }

    icons.write(`export const ${key} = ${JSON.stringify((value as any)())};\n`);
    defs.write(`export const ${key}: IconTree;\n`);
  }

  icons.end();
  defs.end();

  index.write(`export * from "./${name}";\n`);
  indexDefs.write(`export * from "./${name}";\n`);
}

index.end();
indexDefs.end();
