import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const resolverSource = await readFile(
  new URL('../web/resolver.js', import.meta.url),
  'utf8'
);

test('frontend entrypoint registers the ComfyUI extension contract', () => {
  assert.match(
    resolverSource,
    /import\s+\{\s*app\s*\}\s+from\s+["']\.\.\/\.\.\/\.\.\/scripts\/app\.js["']/
  );
  assert.match(resolverSource, /registerGlobalHelpers\(\);/);
  assert.match(resolverSource, /const modelResolver = new ModelResolverClass\(\);/);
  assert.match(resolverSource, /app\.registerExtension\(\{/);
  assert.match(resolverSource, /name:\s*["']Model Resolver["']/);
  assert.match(resolverSource, /id:\s*MODEL_RESOLVER_OPEN_COMMAND_ID/);
  assert.match(resolverSource, /function:\s*\(\)\s*=>\s*modelResolver\.activateResolverButton\(\)/);
  assert.match(resolverSource, /keybindings:\s*\[\s*MODEL_RESOLVER_OPEN_DEFAULT_KEYBINDING/);

  const hookPatterns = {
    setup: /\bsetup\s*:/,
    beforeRegisterNodeDef: /\bbeforeRegisterNodeDef\s*\(/,
    nodeCreated: /\bnodeCreated\s*\(/,
    loadedGraphNode: /\bloadedGraphNode\s*\(/,
    afterConfigureGraph: /\bafterConfigureGraph\s*\(/,
  };
  for (const [hook, pattern] of Object.entries(hookPatterns)) {
    assert.match(
      resolverSource,
      pattern,
      `expected ComfyUI lifecycle hook: ${hook}`
    );
  }

  assert.equal(
    (resolverSource.match(/modelResolver\.configureNodeContextMenu\(node\?\.constructor\);/g) || []).length,
    2,
    'dynamically created and loaded node types must receive the widget-change hook'
  );
});
