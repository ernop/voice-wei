"""
Generate demo audio files simulating voice-controlled scale practice sessions.

Creates MP3s demonstrating:
- Setting options via voice
- Making mistakes and corrections
- Successful commands
- Practice sessions
- Relaxed exploration
"""

import numpy as np
from scipy.io import wavfile
import os
import subprocess
import tempfile

# Piano frequencies for notes (A4 = 440Hz standard tuning)
NOTE_FREQS = {
    'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81,
    'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00,
    'A#3': 233.08, 'B3': 246.94,
    'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63,
    'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00,
    'A#4': 466.16, 'B4': 493.88,
    'C5': 523.25, 'C#5': 554.37, 'D5': 587.33, 'D#5': 622.25, 'E5': 659.25,
    'F5': 698.46, 'F#5': 739.99, 'G5': 783.99, 'G#5': 830.61, 'A5': 880.00,
    'A#5': 932.33, 'B5': 987.77, 'C6': 1046.50,
}

SCALES = {
    'major': [0, 2, 4, 5, 7, 9, 11, 12],
    'minor': [0, 2, 3, 5, 7, 8, 10, 12],
    'chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    'pentatonic': [0, 2, 4, 7, 9, 12],
    'harmonic_minor': [0, 2, 3, 5, 7, 8, 11, 12],
}

SAMPLE_RATE = 44100


def generate_piano_tone(freq, duration, sample_rate=SAMPLE_RATE):
    """Generate a piano-like tone with attack, decay, sustain, release."""
    t = np.linspace(0, duration, int(sample_rate * duration), False)
    
    # Fundamental + harmonics for richer sound
    tone = np.sin(2 * np.pi * freq * t)
    tone += 0.5 * np.sin(2 * np.pi * freq * 2 * t)  # 2nd harmonic
    tone += 0.25 * np.sin(2 * np.pi * freq * 3 * t)  # 3rd harmonic
    tone += 0.125 * np.sin(2 * np.pi * freq * 4 * t)  # 4th harmonic
    
    # ADSR envelope
    attack = int(0.02 * sample_rate)
    decay = int(0.1 * sample_rate)
    release = int(0.3 * sample_rate)
    
    envelope = np.ones(len(t))
    # Attack
    envelope[:attack] = np.linspace(0, 1, attack)
    # Decay to sustain level (0.7)
    envelope[attack:attack+decay] = np.linspace(1, 0.7, decay)
    # Release
    if release < len(envelope):
        envelope[-release:] = np.linspace(0.7, 0, release)
    
    tone = tone * envelope
    tone = tone / np.max(np.abs(tone)) * 0.8
    return tone


def generate_scale(root, scale_type, note_duration=0.4, gap=0.05, direction='up'):
    """Generate a scale as audio."""
    notes_list = list(NOTE_FREQS.keys())
    root_idx = notes_list.index(root)
    intervals = SCALES.get(scale_type, SCALES['major'])
    
    if direction == 'down':
        intervals = intervals[::-1]
    elif direction == 'up+down':
        intervals = intervals + intervals[-2::-1]
    elif direction == 'down+up':
        intervals = intervals[::-1] + intervals[1:]
    
    audio = np.array([])
    gap_samples = int(gap * SAMPLE_RATE)
    
    for interval in intervals:
        note_idx = root_idx + interval
        if note_idx < len(notes_list):
            freq = NOTE_FREQS[notes_list[note_idx]]
            tone = generate_piano_tone(freq, note_duration)
            audio = np.concatenate([audio, tone, np.zeros(gap_samples)])
    
    return audio


def generate_silence(duration):
    """Generate silence."""
    return np.zeros(int(SAMPLE_RATE * duration))


def tts_to_audio(text, voice='user'):
    """
    Generate speech audio using Windows SAPI via PowerShell.
    Returns numpy array of audio samples.
    """
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        temp_wav = f.name
    
    # Use PowerShell to generate speech
    # Different rate for user vs system voice
    rate = 0 if voice == 'user' else 1
    
    ps_script = f'''
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = {rate}
$synth.SetOutputToWaveFile("{temp_wav}")
$synth.Speak("{text}")
$synth.Dispose()
'''
    
    try:
        subprocess.run(['powershell', '-Command', ps_script], 
                      capture_output=True, check=True)
        rate, data = wavfile.read(temp_wav)
        # Convert to mono float
        if len(data.shape) > 1:
            data = data.mean(axis=1)
        data = data.astype(np.float64) / 32768.0
        # Resample if needed
        if rate != SAMPLE_RATE:
            data = np.interp(
                np.linspace(0, len(data), int(len(data) * SAMPLE_RATE / rate)),
                np.arange(len(data)),
                data
            )
        return data
    finally:
        if os.path.exists(temp_wav):
            os.remove(temp_wav)


def save_as_mp3(audio, filename):
    """Save audio array as MP3."""
    # First save as WAV
    temp_wav = filename.replace('.mp3', '.wav')
    audio_int = (audio * 32767).astype(np.int16)
    wavfile.write(temp_wav, SAMPLE_RATE, audio_int)
    
    # Convert to MP3 using ffmpeg
    try:
        subprocess.run([
            'ffmpeg', '-y', '-i', temp_wav, '-b:a', '192k', filename
        ], capture_output=True, check=True)
        os.remove(temp_wav)
        print(f"Created: {filename}")
    except FileNotFoundError:
        print(f"ffmpeg not found - saved as WAV instead: {temp_wav}")
    except subprocess.CalledProcessError as e:
        print(f"ffmpeg error, keeping WAV: {temp_wav}")


def demo_setting_options():
    """Demo: User exploring voice command options."""
    print("Generating: setting-options...")
    
    segments = []
    
    # User says command, system echoes, scale plays
    commands = [
        ("D minor", "D4", "minor"),
        ("slowly", "D4", "minor"),  # same scale, slower
        ("chromatic", "D4", "chromatic"),
        ("up and down", "C4", "major"),
        ("octave 3", "C3", "major"),
    ]
    
    for cmd, root, scale in commands:
        segments.append(tts_to_audio(cmd, 'user'))
        segments.append(generate_silence(0.3))
        segments.append(tts_to_audio(cmd, 'system'))  # echo
        segments.append(generate_silence(0.2))
        dur = 0.8 if 'slowly' in cmd else 0.4
        direction = 'up+down' if 'up and down' in cmd else 'up'
        segments.append(generate_scale(root, scale, note_duration=dur, direction=direction))
        segments.append(generate_silence(0.8))
    
    return np.concatenate(segments)


def demo_making_mistakes():
    """Demo: User making mistakes, corrections."""
    print("Generating: making-mistakes...")
    
    segments = []
    
    # Unclear speech, wrong interpretation, correction
    segments.append(tts_to_audio("see major", 'user'))
    segments.append(generate_silence(0.3))
    segments.append(tts_to_audio("C major", 'system'))
    segments.append(generate_silence(0.2))
    segments.append(generate_scale("C4", "major"))
    segments.append(generate_silence(0.5))
    
    # Mumbled command
    segments.append(tts_to_audio("um... harmonic", 'user'))
    segments.append(generate_silence(0.5))
    segments.append(tts_to_audio("harmonic minor", 'system'))
    segments.append(generate_silence(0.2))
    segments.append(generate_scale("C4", "harmonic_minor"))
    segments.append(generate_silence(0.5))
    
    # Wrong scale, stop and correct
    segments.append(tts_to_audio("G minor", 'user'))
    segments.append(generate_silence(0.3))
    segments.append(tts_to_audio("G minor", 'system'))
    segments.append(generate_silence(0.2))
    # Start playing then interrupt
    partial_scale = generate_scale("G4", "minor")[:int(SAMPLE_RATE * 1.5)]
    segments.append(partial_scale)
    segments.append(tts_to_audio("stop", 'user'))
    segments.append(generate_silence(0.3))
    segments.append(tts_to_audio("no wait, G major", 'user'))
    segments.append(generate_silence(0.3))
    segments.append(tts_to_audio("G major", 'system'))
    segments.append(generate_silence(0.2))
    segments.append(generate_scale("G4", "major"))
    segments.append(generate_silence(0.5))
    
    return np.concatenate(segments)


def demo_doing_it_right():
    """Demo: Clean successful commands."""
    print("Generating: doing-it-right...")
    
    segments = []
    
    commands = [
        ("A minor scale", "A4", "minor", "up"),
        ("F major up and down", "F4", "major", "up+down"),
        ("B flat pentatonic", "A#4", "pentatonic", "up"),
        ("slowly E harmonic minor", "E4", "harmonic_minor", "up"),
    ]
    
    for cmd, root, scale, direction in commands:
        segments.append(tts_to_audio(cmd, 'user'))
        segments.append(generate_silence(0.2))
        # Echo just the parsed version
        echo = cmd.replace("slowly ", "").replace(" scale", "")
        segments.append(tts_to_audio(echo, 'system'))
        segments.append(generate_silence(0.2))
        dur = 0.7 if 'slowly' in cmd else 0.4
        segments.append(generate_scale(root, scale, note_duration=dur, direction=direction))
        segments.append(generate_silence(1.0))
    
    return np.concatenate(segments)


def demo_practicing():
    """Demo: Focused practice session - repeating a scale."""
    print("Generating: practicing...")
    
    segments = []
    
    # Set up repeat
    segments.append(tts_to_audio("D minor repeat forever", 'user'))
    segments.append(generate_silence(0.3))
    segments.append(tts_to_audio("D minor repeat forever", 'system'))
    segments.append(generate_silence(0.2))
    
    # Play scale 3 times with short gaps
    for i in range(3):
        segments.append(generate_scale("D4", "minor", note_duration=0.5))
        segments.append(generate_silence(0.3))
    
    # Stop and try variation
    segments.append(tts_to_audio("stop", 'user'))
    segments.append(generate_silence(0.5))
    
    segments.append(tts_to_audio("same thing but up and down", 'user'))
    segments.append(generate_silence(0.3))
    segments.append(tts_to_audio("D minor up and down repeat", 'system'))
    segments.append(generate_silence(0.2))
    
    # Play up+down twice
    for i in range(2):
        segments.append(generate_scale("D4", "minor", note_duration=0.45, direction='up+down'))
        segments.append(generate_silence(0.3))
    
    segments.append(tts_to_audio("stop", 'user'))
    segments.append(generate_silence(0.3))
    
    return np.concatenate(segments)


def demo_enjoying():
    """Demo: Relaxed exploration, having fun."""
    print("Generating: enjoying-it...")
    
    segments = []
    
    # Leisurely exploring different scales
    segments.append(tts_to_audio("C major slowly", 'user'))
    segments.append(generate_silence(0.2))
    segments.append(generate_scale("C4", "major", note_duration=0.8))
    segments.append(generate_silence(1.5))
    
    # Hmm, try something else
    segments.append(tts_to_audio("now pentatonic", 'user'))
    segments.append(generate_silence(0.2))
    segments.append(generate_scale("C4", "pentatonic", note_duration=0.7))
    segments.append(generate_silence(1.2))
    
    # Ooh nice
    segments.append(tts_to_audio("that's nice... A minor", 'user'))
    segments.append(generate_silence(0.3))
    segments.append(generate_scale("A4", "minor", note_duration=0.6))
    segments.append(generate_silence(1.0))
    
    # Down direction
    segments.append(tts_to_audio("down", 'user'))
    segments.append(generate_silence(0.2))
    segments.append(generate_scale("A4", "minor", note_duration=0.6, direction='down'))
    segments.append(generate_silence(1.5))
    
    # Final flourish
    segments.append(tts_to_audio("chromatic up and down fast", 'user'))
    segments.append(generate_silence(0.2))
    segments.append(generate_scale("C4", "chromatic", note_duration=0.15, gap=0.02, direction='up+down'))
    segments.append(generate_silence(0.5))
    
    return np.concatenate(segments)


def main():
    output_dir = os.path.dirname(os.path.abspath(__file__))
    demos_dir = os.path.join(output_dir, 'demos')
    os.makedirs(demos_dir, exist_ok=True)
    
    demos = [
        ('setting-options.mp3', demo_setting_options),
        ('making-mistakes.mp3', demo_making_mistakes),
        ('doing-it-right.mp3', demo_doing_it_right),
        ('practicing.mp3', demo_practicing),
        ('enjoying-it.mp3', demo_enjoying),
    ]
    
    for filename, generator in demos:
        audio = generator()
        save_as_mp3(audio, os.path.join(demos_dir, filename))
    
    print(f"\nAll demos saved to: {demos_dir}")


if __name__ == '__main__':
    main()
