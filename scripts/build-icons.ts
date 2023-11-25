#!/usr/bin/env tsx
import fs from "fs";
import glob from "fast-glob";

fs.mkdirSync("./dist/icons", { recursive: true });

const iconBase = require("react-icons/lib/cjs/iconBase");
iconBase.GenIcon = (icon: unknown) => () => icon;

const libs = glob.sync("react-icons/*/index.js", { cwd: "./node_modules" });

const index = fs.createWriteStream("./dist/all.js");
const indexDefs = fs.createWriteStream("./dist/all.d.ts");
const iconListList: [string, string[]][] = [];

for (const lib of libs) {
  const name = lib.split("/")[1];
  const iconList: string[] = [];
  // iconList.push(name);
  const icons = fs.createWriteStream(`./dist/icons/${name}.js`);
  const defs = fs.createWriteStream(`./dist/icons/${name}.d.ts`);

  defs.write(`import type { IconTree } from "./index.d";\n\n`);

  for (let [key, value] of Object.entries(require(lib))) {
    if (name === "fa6") {
      key = key.replace(/^Fa/, "Fa6");
    } else if (name === "hi2") {
      key = key.replace(/^Hi/, "Hi2");
    }

    icons.write(`export const ${key} = ${JSON.stringify((value as any)())};\n`);
    defs.write(`export const ${key}: IconTree;\n`);
    iconList.push(key);
  }

  icons.end();
  defs.end();

  index.write(`export * from "./icons/${name}";\n`);
  indexDefs.write(`export * from "./icons/${name}";\n`);
  iconListList.push([name, iconList]);
}

// fs.writeFileSync("website/src/iconList.json", JSON.stringify(iconListList, null, 2));

index.end();
indexDefs.end();
