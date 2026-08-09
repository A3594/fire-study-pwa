from __future__ import annotations

import sys
import wave
from pathlib import Path

import lameenc


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("사용법: python encode_wav_mp3.py 입력.wav 출력.mp3")

    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    with wave.open(str(source), "rb") as wav:
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        sample_width = wav.getsampwidth()
        if channels != 1 or sample_width != 2:
            raise SystemExit(f"16비트 모노 WAV만 지원합니다: {channels}채널, {sample_width * 8}비트")
        pcm = wav.readframes(wav.getnframes())

    encoder = lameenc.Encoder()
    encoder.set_bit_rate(96)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(1)
    encoder.set_quality(2)
    encoded = encoder.encode(pcm) + encoder.flush()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(encoded)
    print(f"MP3 완료: {target} ({len(encoded) / 1024 / 1024:.1f}MB)")


if __name__ == "__main__":
    main()
