import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY 환경 변수가 필요합니다.");

const toolDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(toolDir, "..");
const outputDir = join(projectDir, "audio", "episode-1");
const outputPath = join(outputDir, "scene-1-voice-drama.wav");

const roles = {
  narrator: {
    voice: "marin",
    instructions: "한국어 판타지 오디오북의 여성 해설자처럼 차분하고 자연스럽게 연기한다. 문장 사이에는 여유를 두고, 위험한 장면은 낮고 긴장감 있게, 학습 용어와 숫자는 또렷하게 발음한다. 특정 실제 인물의 목소리를 모사하지 않는다."
  },
  suzy: {
    voice: "coral",
    instructions: "한국어 판타지 드라마 속 밝고 용감한 젊은 여성 등장인물처럼 자연스럽게 연기한다. 다급한 장면에서도 대사는 또렷하게 말한다. 따뜻함과 결단력이 함께 느껴지게 한다. 특정 실제 인물의 목소리를 모사하지 않는다."
  },
  taehoo: {
    voice: "cedar",
    instructions: "평범한 한국인 회사원 남성이 갑작스럽게 마법을 깨우는 장면처럼 자연스럽게 연기한다. 처음에는 당황하지만 주문을 외울수록 확신이 생긴다. 니모닉과 기술 용어는 느리고 정확하게 발음한다. 특정 실제 인물의 목소리를 모사하지 않는다."
  }
};

const script = [
  {
    role: "narrator",
    pauseMs: 650,
    text: "제1장. 야근하던 밤, 불의 도서관. 태후는 서울의 평범한 회사원이었다. 특별한 재능도, 거창한 꿈도 없이 매일 보고서와 야근 사이를 오갔다. 그날도 퇴근이 늦었다. 회사 옆 오래된 문화회관에서는 여자 연예인 수지의 촬영이 한창이었다. 태후가 건물 앞을 지나던 순간, 지하에서 검은 불꽃이 솟구쳤다. 불꽃은 뜨겁지 않았지만 사람들의 기억을 하나씩 태우고 있었다."
  },
  {
    role: "narrator",
    pauseMs: 350,
    text: "대피하는 사람들 사이에서 태후는 홀로 건물 안쪽으로 뛰어드는 수지를 보았다. 태후가 그녀를 붙잡으려 하자, 수지는 연기 너머를 가리키며 외쳤다."
  },
  {
    role: "suzy",
    pauseMs: 600,
    text: "촬영 스태프 한 명이 아직 지하에 남아 있어요. 그냥 두고 갈 수는 없어요!"
  },
  {
    role: "narrator",
    pauseMs: 500,
    text: "그 순간 태후의 손목에 붉은 문장이 나타났다. 낮고 신비로운 목소리가 머릿속을 울렸다. 소화마법의 계승자를 확인했습니다. 첫 번째 관문이 묻습니다. 소화기구를 설치해야 하는 대상은 무엇입니까?"
  },
  {
    role: "taehoo",
    pauseMs: 550,
    text: "연삼, 가발전국, 터지구. 연면적 삼십삼 제곱미터 이상. 가스시설. 발전시설 중 전기저장시설. 국가유산. 터널. 지하구!"
  },
  {
    role: "narrator",
    pauseMs: 500,
    text: "태후가 주문을 말하자 검은 불꽃이 양쪽으로 갈라지며 안전한 통로가 열렸다. 하지만 통로 끝의 두 번째 문에는 새로운 문제가 붉게 타오르고 있었다. 소화기구의 종류를 말하시오."
  },
  {
    role: "taehoo",
    pauseMs: 550,
    text: "소간자, 에척소. 소화기. 간이소화용구. 자동확산소화기. 간이소화용구에는 에어로졸식, 투척용, 소공간용, 그리고 소화약제 외의 것을 이용한 용구가 있다."
  },
  {
    role: "narrator",
    pauseMs: 400,
    text: "두 번째 문도 천천히 열렸다. 지하 주방에 도착하자 불길 속에서 마지막 질문이 떠올랐다. 상업용 주방자동소화장치를 설치해야 하는 장소는 어디입니까? 수지는 벽에 나타난 글자를 바라보다가 짧은 기억 주문을 발견했다."
  },
  {
    role: "suzy",
    pauseMs: 450,
    text: "태후 씨, 판대일, 식단이에요. 이 주문을 사용해요!"
  },
  {
    role: "taehoo",
    pauseMs: 650,
    text: "판대일, 식단. 판매시설의 대규모점포에 입점한 일반음식점. 그리고 집단급식소!"
  },
  {
    role: "narrator",
    pauseMs: 450,
    text: "태후의 주문과 수지의 목소리가 맞물리자 주방을 뒤덮었던 불길이 푸른 빛으로 바뀌었다. 첫 번째 봉인이 풀리고, 실종된 스태프가 안전한 통로 너머에서 모습을 드러냈다."
  },
  {
    role: "suzy",
    pauseMs: 350,
    text: "평범한 회사원이라고 했죠? 오늘은 전혀 평범해 보이지 않는데요."
  },
  {
    role: "taehoo",
    pauseMs: 850,
    text: "저도 아직 믿기지 않아요. 하지만 다음 문제가 나타나면, 다시 한번 해볼게요."
  },
  {
    role: "narrator",
    pauseMs: 1400,
    text: "태후의 손목에서 붉은 문장이 다시 빛났다. 불의 도서관은 이제 막 첫 번째 문을 열었을 뿐이었다. 기억 주문. 연삼 가발전국 터지구. 소간자 에척소. 판대일 식단."
  }
];

function findChunk(buffer, id) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (chunkId === id) return { offset: offset + 8, size };
    offset += 8 + size + (size % 2);
  }
  throw new Error(`WAV ${id} 청크를 찾지 못했습니다.`);
}

function parseWav(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("올바른 WAV 파일이 아닙니다.");
  }
  const formatChunk = findChunk(buffer, "fmt ");
  const dataChunk = findChunk(buffer, "data");
  const format = {
    audioFormat: buffer.readUInt16LE(formatChunk.offset),
    channels: buffer.readUInt16LE(formatChunk.offset + 2),
    sampleRate: buffer.readUInt32LE(formatChunk.offset + 4),
    bitsPerSample: buffer.readUInt16LE(formatChunk.offset + 14)
  };
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new Error(`지원하지 않는 WAV 형식: ${JSON.stringify(format)}`);
  }
  const pcm = buffer.subarray(dataChunk.offset, dataChunk.offset + dataChunk.size);
  return { ...format, samples: new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2)) };
}

function wavBuffer(samples, sampleRate) {
  const dataSize = samples.length * 2;
  const output = Buffer.alloc(44 + dataSize);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataSize, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) output.writeInt16LE(samples[index], 44 + index * 2);
  return output;
}

function normalizedSamples(samples) {
  let sum = 0;
  let count = 0;
  let peak = 1;
  for (const sample of samples) {
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    if (absolute > 250) {
      sum += sample * sample;
      count += 1;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  const scale = Math.min(1.5, Math.max(0.72, 4300 / Math.max(1, rms)), 28500 / peak);
  return Int16Array.from(samples, (sample) => Math.max(-32768, Math.min(32767, Math.round(sample * scale))));
}

function backgroundAt(time, duration) {
  const chords = [
    [130.81, 155.56, 196.0],
    [103.83, 130.81, 155.56],
    [155.56, 196.0, 233.08],
    [98.0, 123.47, 146.83]
  ];
  const chord = chords[Math.floor(time / 9) % chords.length];
  const breathe = 0.58 + 0.42 * Math.sin(2 * Math.PI * 0.045 * time) ** 2;
  let value = breathe * (
    300 * Math.sin(2 * Math.PI * chord[0] * time) +
    205 * Math.sin(2 * Math.PI * chord[1] * time + 0.7) +
    150 * Math.sin(2 * Math.PI * chord[2] * time + 1.4)
  );
  const bellPosition = time % 13.5;
  if (bellPosition < 1.8) {
    const decay = Math.exp(-2.35 * bellPosition);
    const bell = [523.25, 659.25, 783.99][Math.floor(time / 13.5) % 3];
    value += 520 * decay * Math.sin(2 * Math.PI * bell * bellPosition);
  }
  const fade = Math.min(1, time / 2.2, (duration - time) / 2.2);
  return value * Math.max(0, fade);
}

async function synthesize(segment, index, tempDir) {
  const role = roles[segment.role];
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: role.voice,
      input: segment.text,
      instructions: role.instructions,
      response_format: "wav"
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`음성 ${index + 1} 생성 실패 (${response.status}): ${detail.slice(0, 500)}`);
  }
  const path = join(tempDir, `${String(index + 1).padStart(2, "0")}-${segment.role}.wav`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const tempDir = await mkdtemp(join(tmpdir(), "fire-study-voice-"));
  try {
    const generated = [];
    for (let index = 0; index < script.length; index += 1) {
      process.stdout.write(`음성 생성 ${index + 1}/${script.length} · ${script[index].role}\n`);
      generated.push(await synthesize(script[index], index, tempDir));
    }

    const clips = [];
    let sampleRate = null;
    for (let index = 0; index < generated.length; index += 1) {
      const parsed = parseWav(await readFile(generated[index]));
      if (sampleRate && parsed.sampleRate !== sampleRate) throw new Error("생성 음성의 샘플레이트가 서로 다릅니다.");
      sampleRate = parsed.sampleRate;
      clips.push({ samples: normalizedSamples(parsed.samples), pauseMs: script[index].pauseMs });
    }

    const leadIn = Math.round(sampleRate * 1.6);
    const leadOut = Math.round(sampleRate * 2.2);
    const totalSamples = leadIn + leadOut + clips.reduce(
      (total, clip) => total + clip.samples.length + Math.round(sampleRate * clip.pauseMs / 1000),
      0
    );
    const voice = new Int16Array(totalSamples);
    let cursor = leadIn;
    for (const clip of clips) {
      voice.set(clip.samples, cursor);
      cursor += clip.samples.length + Math.round(sampleRate * clip.pauseMs / 1000);
    }

    const mixed = new Int16Array(totalSamples);
    const duration = totalSamples / sampleRate;
    for (let index = 0; index < totalSamples; index += 1) {
      const narration = voice[index];
      const duck = Math.abs(narration) > 600 ? 0.52 : 1;
      const background = backgroundAt(index / sampleRate, duration) * duck;
      mixed[index] = Math.max(-32768, Math.min(32767, Math.round(narration + background)));
    }

    await writeFile(outputPath, wavBuffer(mixed, sampleRate));
    process.stdout.write(`완료: ${outputPath}\n`);
    process.stdout.write(`길이: ${duration.toFixed(1)}초 · ${script.length}개 음성 구간 · ${sampleRate}Hz\n`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

await main();
