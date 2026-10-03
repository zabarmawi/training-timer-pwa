// @ts-check

const SOUND_URLS = Object.freeze({
  "five-minutes": new URL("../../../assets/audio/alert-5m.wav", import.meta.url).href,
  "one-minute": new URL("../../../assets/audio/alert-1m.wav", import.meta.url).href,
  completed: new URL("../../../assets/audio/alert-finish.wav", import.meta.url).href,
});

/** @param {{AudioClass?: typeof Audio | null}} [options] */
export function createAlertPresenter(options = {}) {
  const AudioClass = options.AudioClass === undefined ? globalThis.Audio : options.AudioClass;

  function present(event, { soundEnabled = true, notify = () => {} } = {}) {
    notify(event.message);
    if (!soundEnabled || !AudioClass || !SOUND_URLS[event.sound]) return { visual: true, audio: false };
    try {
      const audio = new AudioClass(SOUND_URLS[event.sound]);
      audio.volume = event.sound === "completed" ? 1 : 0.82;
      const playback = audio.play();
      playback?.catch?.(() => {});
      return { visual: true, audio: true };
    } catch {
      return { visual: true, audio: false };
    }
  }

  return Object.freeze({ present });
}
