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

interface IconTree {
  tag: string;
  attr: { [key: string]: string };
  child?: IconTree[];
}

function modify(icon: IconTree): any[] {
  const result: any[] = [icon.tag, icon.attr];
  if (icon.child?.length) {
    result.push(...icon.child.map(modify));
  }
  return result;
}

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

    const [, attr, ...children] = modify((value as () => any)());
    icons.write(`export const ${key} = ${JSON5.stringify([attr, children])};\n`);
    defs.write(`export const ${key}: IconTree;\n`);
    iconList.push(key);
  }

  icons.end();
  defs.end();

  index.write(`export * from "./icons/${name}";\n`);
  indexDefs.write(`export * from "./icons/${name}";\n`);
}

index.end();
indexDefs.end();
