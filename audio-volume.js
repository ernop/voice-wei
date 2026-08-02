// @ts-check
//-----------------------------------------------------------------------
// AUDIO VOLUME
// The one owner of every default output level, so all tabs play at the
// same loudness out of the box. No page sets its own volume literal;
// every audio path reads its default from here.
//
// The reference level is the practice piano that most tabs are built on:
// Salamander samples (C4 peaks at -8 dBFS, note onsets around -17 LUFS)
// through the -3 dB master, so a practice note lands near -20 LUFS.
// Everything else is calibrated onto that reference:
//
// - Sine guide beeps: a steady pure tone reads much louder than a decaying
//   piano sample at equal gain, so the synth default sits at -10 dB, which
//   lands its sustained level at the same perceived loudness.
// - Streamed media (YouTube, Books TTS audio): mastered near -14 LUFS and
//   previously played at full volume - the "one tab suddenly much louder"
//   offender. -6 dB (gain 0.5 / player volume 50) lands it on the reference.
// - Spoken prompts (speechSynthesis): short, must cut through road noise,
//   and identical on every tab, so they stay at full volume.
//-----------------------------------------------------------------------

const AudioVolume = Object.freeze({
    // Piano master gain, dB. The reference all other levels are matched to.
    PIANO_DB: -3,
    // Sine synth (guide beeps), dB: pure-tone equivalent of the reference.
    SINE_DB: -10,
    // Ears drone, dB: deliberately below the reference so the mic still
    // hears the sung voice over the sustained tone.
    DRONE_DB: -12,
    // HTMLMediaElement volume (0..1) for streamed content: -6 dB.
    MEDIA_GAIN: 0.5,
    // The same -6 dB expressed for YT.Player.setVolume (0..100).
    MEDIA_PERCENT: 50,
    // speechSynthesis utterance volume (0..1) for spoken prompts.
    SPEECH_GAIN: 1.0
});

window.AudioVolume = AudioVolume;
