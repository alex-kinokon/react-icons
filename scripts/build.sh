#!/bin/bash
set -e

rm -rf dist
npx esbuild ./src/macro.ts --bundle --target=esnext --platform=node --packages=external --outfile=dist/macro.js
cp src/macro-d.d.ts ./dist/macro.d.ts
./esbuild.ts
./scripts/build-icons.ts
npx dts-bundle-generator --project tsconfig.json --out-file dist/index.d.ts ./src/index.tsx
jq 'del(.devDependencies, .private)' package.json > dist/package.json
