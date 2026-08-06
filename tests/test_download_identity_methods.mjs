import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSha256Field } from '../web/resolver/utils/hash_utils.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const downloadTargetMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/search/download_target_methods.js'),
  'utf8'
);
const searchPanelMethodsSource = fs.readFileSync(
  path.join(projectRoot, 'web/resolver/search/search_panel.js'),
  'utf8'
);

function extractMethod(source, methodName, paramsPattern = '[^)]*') {
  const signatureRegex = new RegExp(`\\n\\s+(async\\s+)?${methodName}\\s*\\(${paramsPattern}\\)\\s*\\{`);
  const match = signatureRegex.exec(source);
  assert.ok(match, `Could not find ${methodName}`);
  const isAsync = Boolean(match[1]);
  const parenStart = source.indexOf('(', match.index);
  const parenEnd = source.indexOf(')', parenStart);
  const params = source.slice(parenStart + 1, parenEnd);
  const braceStart = source.indexOf('{', parenEnd);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return `${isAsync ? 'async ' : ''}function ${methodName}(${params}) ${source.slice(braceStart, index + 1)}`;
    }
  }
  throw new Error(`Could not parse ${methodName}`);
}

const getDownloadMetadata = eval(`(${extractMethod(downloadTargetMethodsSource, 'getDownloadMetadata')})`);
const renderLocalMatchStatus = eval(`(${extractMethod(searchPanelMethodsSource, 'renderLocalMatchStatus')})`);

const selectedHash = 'A'.repeat(64);
const sourceHash = 'B'.repeat(64);

test('download metadata uses the selected file hash before the source hash', () => {
  const sourceData = {
    source: 'civitai',
    filename: 'foo.safetensors',
    hashes: { SHA256: sourceHash },
    selected_file: {
      name: 'foo.safetensors',
      hashes: { SHA256: selectedHash },
    },
  };
  const dialog = {
    getDownloadSourceContext: () => ({
      sourceData,
      merged: sourceData,
      inheritedDownloadSource: {},
      isProvidedUrl: false,
      useSourceProvenanceBoundary: false,
    }),
    getDownloadPathMetadata: () => ({
      filename: 'foo.safetensors',
      model_name: 'foo',
      base_model: '',
      tags: [],
      author: '',
    }),
    getFilenameFromPath: () => 'foo.safetensors',
  };

  const metadata = getDownloadMetadata.call(dialog, {}, sourceData, { filename: 'foo.safetensors' });

  assert.equal(metadata.sha256, selectedHash.toLowerCase());
});

test('local match status uses the same hash precedence and normalized label key', () => {
  const hashLabelMap = new Map([[selectedHash.toLowerCase(), 'Hash 1']]);
  const html = renderLocalMatchStatus(
    {
      hash_match: true,
      hash: `  ${selectedHash}  `,
      model: { sha256: sourceHash },
    },
    hashLabelMap
  );

  assert.match(html, /mr-match-status-hash/);
  assert.match(html, />Hash 1<\/span>/);
});

void getSha256Field;
