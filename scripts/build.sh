#!/bin/bash
npx esbuild ./src/macro.ts --bundle --target=es2020 --platform=node --packages=external --outfile=dist/macro.js
cp src/macro-d.d.ts ./dist/macro.d.ts
./esbuild.ts
./scripts/build-icons.ts
npx dts-bundle-generator --project tsconfig.json --out-file dist/index.d.ts ./src/index.tsx
jq 'del(.devDependencies, .private) | .type = "module"' package.json > dist/package.json
