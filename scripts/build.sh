#!/bin/bash
./esbuild.ts
./scripts/build-icons.ts
npx dts-bundle-generator --project tsconfig.json --out-file dist/index.d.ts ./src/index.tsx
jq 'del(.devDependencies, .private) | .type = "module"' package.json > dist/package.json
