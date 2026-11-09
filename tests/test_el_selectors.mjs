import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));

// ComfyUI's $el only splits its first argument on "." and passes the first part to
// document.createElement, so "div#id" or "div[attr]" throws InvalidCharacterError.
// Ids and attributes must go in the props object instead.
const EL_CALL_PATTERN = /\$el\(\s*(["'`])(.*?)\1/g;
const TAG_NAME_PATTERN = /^[a-z][a-z0-9-]*$/i;

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJavaScriptFiles(entryPath));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.js') {
      files.push(entryPath);
    }
  }

  return files;
}

test('$el selectors start with a plain tag name', async () => {
  const invalid = [];
  let calls = 0;

  for (const file of await collectJavaScriptFiles(WEB_ROOT)) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(EL_CALL_PATTERN)) {
      calls += 1;
      const tagName = match[2].split('.')[0];
      if (!TAG_NAME_PATTERN.test(tagName)) {
        const line = source.slice(0, match.index).split('\n').length;
        invalid.push(`${relative(WEB_ROOT, file)}:${line}: ${match[0]}`);
      }
    }
  }

  assert.ok(calls > 0, 'expected to find $el calls under web/');
  assert.deepEqual(invalid, [], 'pass ids and attributes as $el props, not in the selector');
});
