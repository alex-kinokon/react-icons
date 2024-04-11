// grep `(\w+): IconTree;` from neighboring icons/d.ts files
import fs from "node:fs";
import { resolve } from "node:path";

export const iconMap = new Map<string, string>();

const dir = resolve(
  __dirname,
  process.env.NODE_ENV === "production" ? "icons" : "../dist/icons"
);
const files = fs.readdirSync(dir);

for (const file of files) {
  const content = fs.readFileSync(resolve(dir, file), "utf-8");
  const matches = content.matchAll(/export const (\w+): IconTree;/g);
  for (const match of matches) {
    iconMap.set(match[1], file.replace(/\.d\.ts$/, ""));
  }
}
