import test from 'node:test';
import assert from 'node:assert/strict';

test('success sound unlocks on interaction and schedules the supplied chord', async () => {
    const listeners = {};
    const oscillators = [];
    const gains = [];
    globalThis.document = { addEventListener: (name, callback) => { listeners[name] = callback; } };
    globalThis.AudioContext = class {
        state = 'suspended';
        currentTime = 10;
        destination = {};
        async resume() { this.state = 'running'; }
        createOscillator() {
            const oscillator = {
                frequency: { setValueAtTime(value, time) { this.value = value; this.time = time; } }, connect() {}, disconnect() {},
                start(time) { this.started = time; },
                stop(time) { this.stopped = time; },
            };
            oscillators.push(oscillator);
            return oscillator;
        }
        createGain() {
            const events = [];
            gains.push(events);
            return { gain: {
                setValueAtTime(value, time) { events.push(['set', value, time]); },
                exponentialRampToValueAtTime(value, time) { events.push(['exponential', value, time]); },
            }, connect() {}, disconnect() {} };
        }
    };
    try {
        const { playDownloadSuccessSound } = await import('../web/utils/download_sound.js');
        playDownloadSuccessSound();
        assert.equal(oscillators.length, 0);
        listeners.pointerdown();
        playDownloadSuccessSound();
        assert.deepEqual(oscillators.map(item => item.frequency.value), [523, 659, 784, 1046]);
        assert.deepEqual(oscillators.map(item => item.started), [10, 10.15, 10.30, 10.47]);
        oscillators.forEach((item, index) => {
            const duration = [0.27, 0.33, 0.48, 0.40][index];
            assert.ok(Math.abs(item.stopped - item.started - duration - 0.02) < 1e-10);
            assert.deepEqual(gains[index], [
                ['set', 0.0001, item.started],
                ['exponential', [0.055, 0.060, 0.055, 0.022][index], item.started + 0.012],
                ['exponential', 0.0001, item.started + duration],
            ]);
            item.onended();
        });
        const { safeStorage } = await import('../web/resolver/utils/html_utils.js');
        safeStorage.setItem('ModelResolver.downloadSoundEnabled', 'false');
        playDownloadSuccessSound();
        assert.equal(oscillators.length, 4, 'disabled sound must not schedule more notes');
    } finally {
        delete globalThis.document;
        delete globalThis.AudioContext;
    }
});
