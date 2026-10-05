import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

test('mapping picker filters models, selects a result and excludes other mapped models', () => {
    const window = new Window();
    const document = window.document;
    const container = document.createElement('div');
    document.body.append(container);
    const source = fs.readFileSync(new URL('../web/resolver/views/options_methods.js', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('        const getBaseModelMappingChoices ='), source.indexOf('        const renderTemplatePreview ='));
    const dialog = {
        baseModels: { base_models: [{ name: 'SDXL' }, { name: 'Pony' }, { name: 'Flux.1' }] },
        escapeHtml: value => value,
        showDropdownList: list => { list.style.display = 'block'; },
        hideDropdownList: list => { list.style.display = 'none'; },
        enableWheelScrollChaining() {}, bindDropdownOutsideDismiss() {}, bindTooltips() {},
    };
    const methods = new Function('document', 'tokens', 'baseModelMappingsContainer', 'setStatus', 'syncAllTemplateControls',
        `${block}; return { addBaseModelMappingRow, collectBaseModelPathMappings };`
    ).call(dialog, document, { base_model_path_mappings: {} }, container, () => {}, () => {});
    methods.addBaseModelMappingRow('SDXL', 'SDXL');
    methods.addBaseModelMappingRow('', 'Pony-folder');
    const input = container.querySelectorAll('.mr-options-mapping-base')[1];
    const list = input.nextElementSibling;
    input.dispatchEvent(new window.Event('focus'));
    assert.equal(list.textContent.includes('SDXL'), false);
    input.value = 'pon';
    input.dispatchEvent(new window.Event('input'));
    assert.equal(list.textContent, 'Pony');
    list.firstElementChild.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    assert.equal(input.value, 'Pony');
    assert.equal(list.style.display, 'none');
    assert.deepEqual(methods.collectBaseModelPathMappings(), { SDXL: 'SDXL', Pony: 'Pony-folder' });
    input.value = 'flux';
    input.dispatchEvent(new window.Event('input'));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    assert.equal(input.value, 'Flux.1');
    input.dispatchEvent(new window.Event('focus'));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(list.style.display, 'none');
    window.happyDOM.abort();
});
