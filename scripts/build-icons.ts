#!/usr/bin/env tsx
import fs from "fs";
import glob from "fast-glob";
import JSON5 from "json5";

fs.mkdirSync("./dist/icons", { recursive: true });

const define = Object.defineProperty;
Object.defineProperty = (obj, prop, value) =>
  define(obj, prop, { ...value, configurable: true });
const iconBase = require("react-icons/lib");
Object.defineProperty = define;
Object.defineProperty(iconBase, "GenIcon", { value: (icon: unknown) => () => icon });

const libs = glob.sync("react-icons/*/index.js", { cwd: "./node_modules" });

const index = fs.createWriteStream("./dist/all.js");
const indexDefs = fs.createWriteStream("./dist/all.d.ts");
const iconListList: [string, string[]][] = [];

for (const lib of libs) {
  if (lib === "react-icons/lib/index.js") continue;

  const name = lib.split("/")[1];
  const iconList: string[] = [];
  // iconList.push(name);
  const icons = fs.createWriteStream(`./dist/icons/${name}.js`);
  const defs = fs.createWriteStream(`./dist/icons/${name}.d.ts`);

  defs.write(`import type { IconTree } from "../index.d";\n\n`);

  for (let [key, value] of Object.entries(require(lib.replace("/index.js", "")))) {
    if (name === "fa6") {
      key = key.replace(/^Fa/, "Fa6");
    } else if (name === "hi2") {
      key = key.replace(/^Hi/, "Hi2");
    }

    icons.write(`export const ${key} = ${JSON5.stringify((value as any)())};\n`);
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
