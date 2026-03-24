import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const sourceDirectory = resolve(projectRoot, 'node_modules/onnxruntime-web/dist');
const targetDirectory = resolve(projectRoot, 'public/wasm');

if (!existsSync(sourceDirectory)) {
  console.warn('onnxruntime-web dist folder was not found. Skipping WASM sync.');
  process.exit(0);
}

rmSync(targetDirectory, { recursive: true, force: true });
mkdirSync(targetDirectory, { recursive: true });

cpSync(sourceDirectory, targetDirectory, {
  recursive: true,
  filter: (sourcePath) => {
    if (sourcePath === sourceDirectory) {
      return true;
    }

    return /ort(?:[-.].+)?\.(?:mjs|wasm)$/.test(sourcePath);
  }
});

console.log(`Synced ONNX Runtime assets to ${targetDirectory}`);
