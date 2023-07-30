#!/usr/bin/env -S node -r esbin
import esbuild from "esbuild";

const args = process.argv.slice(2);
const ENV = process.env.NODE_ENV || "development";
const PROD = ENV === "production";

async function main() {
  const context = await esbuild.context({
    entryPoints: ["./src/index.tsx"],
    outdir: "dist",
    bundle: true,
    minify: PROD,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [],
    define: {
      "process.env.NODE_ENV": JSON.stringify(ENV),
    },
  });

  await context.rebuild();

  if (args.includes("-w") || args.includes("--watch")) {
    await context.watch();
  } else {
    await context.dispose();
  }
}

main();
