"""Replace only Suzy's three lines in the episode-one WAV sample.

The replacement clips must be 24 kHz, mono, signed 16-bit WAV files named
1.wav, 2.wav, and 3.wav. Narrator and Taehoo audio stays untouched.
"""

from __future__ import annotations

import argparse
import array
import math
import wave
from pathlib import Path


SAMPLE_RATE = 24_000
REPLACEMENTS = (
    # Original active-speech bounds, with a small erasure margin.
    (52.40, 58.50, 52.56, "1.wav"),
    (138.70, 146.95, 138.86, "2.wav"),
    (167.95, 174.05, 168.10, "3.wav"),
)


def read_wav(path: Path) -> array.array:
    with wave.open(str(path), "rb") as source:
        if (
            source.getnchannels() != 1
            or source.getsampwidth() != 2
            or source.getframerate() != SAMPLE_RATE
        ):
            raise ValueError(f"지원하지 않는 WAV 형식: {path}")
        samples = array.array("h")
        samples.frombytes(source.readframes(source.getnframes()))
        return samples


def write_wav(path: Path, samples: array.array) -> None:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(samples.tobytes())


def background_at(time: float, duration: float, gain: float = 2.4) -> float:
    chords = (
        (130.81, 155.56, 196.0),
        (103.83, 130.81, 155.56),
        (155.56, 196.0, 233.08),
        (98.0, 123.47, 146.83),
    )
    chord = chords[int(time / 9) % len(chords)]
    breathe = 0.58 + 0.42 * math.sin(2 * math.pi * 0.045 * time) ** 2
    value = breathe * (
        720 * math.sin(2 * math.pi * chord[0] * time)
        + 480 * math.sin(2 * math.pi * chord[1] * time + 0.7)
        + 350 * math.sin(2 * math.pi * chord[2] * time + 1.4)
        + 210 * math.sin(2 * math.pi * chord[2] * 2 * time + 0.35)
    )
    bell_position = time % 13.5
    if bell_position < 1.8:
        decay = math.exp(-2.35 * bell_position)
        bell = (523.25, 659.25, 783.99)[int(time / 13.5) % 3]
        value += 1350 * decay * math.sin(2 * math.pi * bell * bell_position)
    fade = min(1.0, time / 2.2, (duration - time) / 2.2)
    return value * max(0.0, fade) * gain


def normalize(samples: array.array) -> array.array:
    active = [sample for sample in samples if abs(sample) > 180]
    rms = math.sqrt(sum(sample * sample for sample in active) / max(1, len(active)))
    peak = max((abs(sample) for sample in samples), default=1)
    scale = min(1.8, max(0.65, 4300 / max(1, rms)), 28000 / max(1, peak))
    fade_samples = int(SAMPLE_RATE * 0.035)
    normalized = array.array("h")
    for index, sample in enumerate(samples):
        fade = min(1.0, index / fade_samples, (len(samples) - 1 - index) / fade_samples)
        normalized.append(round(sample * scale * max(0.0, fade)))
    return normalized


def trim_silence(samples: array.array) -> array.array:
    """Remove API-added edge silence while keeping a short natural pad."""
    frame_length = round(SAMPLE_RATE * 0.02)
    active_frames: list[int] = []
    for frame_index, start in enumerate(range(0, len(samples), frame_length)):
        frame = samples[start : start + frame_length]
        rms = math.sqrt(sum(sample * sample for sample in frame) / max(1, len(frame)))
        if rms > 120:
            active_frames.append(frame_index)
    if not active_frames:
        return samples
    padding = round(SAMPLE_RATE * 0.04)
    start = max(0, active_frames[0] * frame_length - padding)
    end = min(len(samples), (active_frames[-1] + 1) * frame_length + padding)
    return samples[start:end]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("clips", type=Path)
    parser.add_argument(
        "--compact-openai",
        action="store_true",
        help="OpenAI의 자연스러운 짧은 두 번째 대사 뒤에 남는 과도한 공백을 줄입니다.",
    )
    args = parser.parse_args()

    original = read_wav(args.audio)
    result = array.array("h", original)
    duration = len(result) / SAMPLE_RATE
    second_speech_end = None

    for erase_start, erase_end, speech_start, filename in REPLACEMENTS:
        clip = normalize(trim_silence(read_wav(args.clips / filename)))
        erase_from = round(erase_start * SAMPLE_RATE)
        erase_to = round(erase_end * SAMPLE_RATE)
        insert_at = round(speech_start * SAMPLE_RATE)
        if insert_at + len(clip) > erase_to:
            raise ValueError(f"{filename}이 교체 구간보다 깁니다.")

        # Remove the previous character voice while preserving continuous music.
        for index in range(erase_from, erase_to):
            result[index] = round(background_at(index / SAMPLE_RATE, duration))

        # Duck the music only while the new character is speaking.
        for offset, voice_sample in enumerate(clip):
            index = insert_at + offset
            duck = 0.65 if abs(voice_sample) > 180 else 1.0
            mixed = voice_sample + background_at(index / SAMPLE_RATE, duration) * duck
            result[index] = max(-32768, min(32767, round(mixed)))
        if filename == "2.wav":
            second_speech_end = (insert_at + len(clip)) / SAMPLE_RATE

    if args.compact_openai:
        # The original slow character clip occupied this interval. Keep a natural
        # conversational pause, then crossfade the continuous music into Taehoo.
        if second_speech_end is None:
            raise ValueError("두 번째 수지 대사 구간을 찾지 못했습니다.")
        cut_from_seconds = max(142.70, second_speech_end + 0.55)
        cut_from = round(cut_from_seconds * SAMPLE_RATE)
        cut_to = round(146.95 * SAMPLE_RATE)
        fade_length = round(0.08 * SAMPLE_RATE)
        if cut_from + fade_length >= cut_to:
            raise ValueError("두 번째 대사가 너무 길어 공백을 자연스럽게 줄일 수 없습니다.")
        crossfade = array.array("h")
        for offset in range(fade_length):
            ratio = offset / max(1, fade_length - 1)
            left = result[cut_from - fade_length + offset]
            right = result[cut_to + offset]
            crossfade.append(round(left * (1 - ratio) + right * ratio))
        result = (
            result[: cut_from - fade_length]
            + crossfade
            + result[cut_to + fade_length :]
        )

    write_wav(args.audio, result)
    print(f"수지 음성 3개 구간 교체 완료: {args.audio}")


if __name__ == "__main__":
    main()
