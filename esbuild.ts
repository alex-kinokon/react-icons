#!/usr/bin/env tsx
import esbuild, { type BuildOptions } from "esbuild";
import { name } from "./package.json";

const args = process.argv.slice(2);
const ENV = process.env.NODE_ENV || "development";
const PROD = ENV === "production";

async function main() {
  const shared: BuildOptions = {
    outdir: "dist",
    bundle: true,
    minify: PROD,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [],
    define: {
      "process.env.NODE_ENV": JSON.stringify(ENV),
      "process.env.PACKAGE_NAME": JSON.stringify(name),
    },
  };

  await Promise.all(
    [
      await esbuild.context({
        ...shared,
        entryPoints: ["./src/index.tsx"],
      }),
      await esbuild.context({
        ...shared,
        format: "cjs",
        entryPoints: ["./src/macro.ts"],
      }),
    ].map(async context => {
      await context.rebuild();

      if (args.includes("-w") || args.includes("--watch")) {
        await context.watch();
      } else {
        await context.dispose();
      }
    })
  );
}

void main();
