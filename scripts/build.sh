#!/bin/bash
set -e

rm -rf dist
mkdir dist
cp src/macro-d.d.ts ./dist/macro.d.ts
echo "📀 Running esbuild..."
./esbuild.ts
echo "📀 Running build-icons.ts"
./scripts/build-icons.ts
echo "📀 Copying package.json..."
jq 'del(.devDependencies, .private)' package.json > dist/package.json
echo "📀 Running dts-bundle-generator..."
npx dts-bundle-generator --project tsconfig.json --out-file dist/index.d.ts ./src/index.tsx
