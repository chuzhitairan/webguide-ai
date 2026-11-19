import { mkdir, readFile, writeFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import standalone from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const output = new URL('packages/contracts/src/generated/', root);
await mkdir(output, { recursive: true });

// Ajv runs here at build time. The extension only gets ordinary functions,
// including the small Unicode helpers that Ajv uses for string lengths.
for (const [version, file] of [[1, 'tutorial.schema.json'], [2, 'tutorial-v2.schema.json']]) {
  const schema = JSON.parse(await readFile(new URL('docs/design/contracts/' + file, root), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strictRequired: false, code: { source: true } });
  const source = standalone(ajv, ajv.compile(schema));
  const bundled = await build({
    stdin: { contents: source, resolveDir: process.cwd(), loader: 'js' },
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false,
  });
  await writeFile(new URL('tutorial-v' + version + '-validator.js', output), bundled.outputFiles[0].text);
}