import { safeStorage } from '../resolver/utils/html_utils.js';

const notes = [
    { freq: 523, start: 0, duration: 0.27, volume: 0.055 },
    { freq: 659, start: 0.15, duration: 0.33, volume: 0.060 },
    { freq: 784, start: 0.30, duration: 0.48, volume: 0.055 },
    { freq: 1046, start: 0.47, duration: 0.40, volume: 0.022 },
];

let context;

function unlockAudio() {
    try {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return;
        context ||= new AudioContext();
        if (context.state === 'suspended') void context.resume().catch(() => {});
    } catch {
        // Audio availability must not affect downloads.
    }
}

// Browsers require a user gesture before allowing notification audio.
globalThis.document?.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
globalThis.document?.addEventListener('keydown', unlockAudio, { capture: true, passive: true });

export function playDownloadSuccessSound() {
    try {
        if (safeStorage.getItem('ModelResolver.downloadSoundEnabled') === 'false' || context?.state !== 'running') return;
        const now = context.currentTime;
        for (const note of notes) {
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            const start = now + note.start;
            const end = start + note.duration;
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(note.freq, start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(note.volume, start + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, end);
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.onended = () => {
                oscillator.disconnect();
                gain.disconnect();
            };
            oscillator.start(start);
            oscillator.stop(end + 0.02);
        }
    } catch {
        // Notification audio is optional when the browser cannot play it.
    }
}
