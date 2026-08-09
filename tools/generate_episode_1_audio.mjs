import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const toolDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(toolDir, "..");
const outputDir = join(projectDir, "audio", "episode-1");
const firstSceneWav = join(outputDir, "scene-1-voice-drama.wav");
const encoderPath = join(toolDir, "encode_wav_mp3.py");

const roles = {
  narrator: {
    voice: "marin",
    instructions: "한국어 판타지 오디오북의 여성 해설자처럼 차분하고 자연스럽게 낭독한다. 위험한 장면은 절제된 긴장감을 주고, 소방 기술용어와 숫자 및 단위는 천천히 또렷하게 발음한다. 실제 인물의 목소리를 모사하지 않는다."
  },
  suzy: {
    voice: "marin",
    instructions: "성인 한국인 여성 등장인물이다. 해설자와 같은 기본 음색을 사용하되 밝고 즐거운 감정과 따뜻한 호감을 자연스럽게 표현한다. 과장된 애교와 지나치게 높은 음색은 피하고 또렷하게 말한다. 실제 인물의 목소리를 모사하지 않는다."
  },
  taehoo: {
    voice: "onyx",
    instructions: "성인 한국인 남성 회사원 태후의 담백하고 진중한 목소리로 말한다. 놀람과 설렘은 자연스럽게 표현하고 영웅처럼 과장하지 않는다. 주문과 숫자는 조금 느리게 끊어 또렷하게 발음한다. 실제 인물의 목소리를 모사하지 않는다."
  }
};

const dialogueByScene = {
  1: [
    { role: "suzy", target: "태후 씨, 불의 성질을 구분해야 해요. 아무 약제나 쓰면 더 위험해질 수 있어요." },
    { role: "suzy", target: "평범한 회사원이라더니, 오늘은 꽤 믿음직하네요." }
  ],
  2: [
    { role: "suzy", target: "마법사가 됐다고 앞만 보지 말아요. 나는 당신이 다치는 결말은 싫으니까." }
  ],
  3: [
    { role: "suzy", target: "그러니까 앞으로도 둘이 다니면 되겠네요." }
  ],
  4: [
    { role: "suzy", target: "그 힘이 사라져도 오늘 당신이 한 일은 사라지지 않아요." }
  ],
  5: [
    { role: "suzy", target: "비 급인지 씨 급인지, 기본 적응인지 형식승인 조건부 적응인지 눈앞의 불꽃과 함께 골라야 해요." }
  ],
  8: [
    { role: "suzy", target: "수지는 이제 정말 마법사 같다고 말했다.", spoken: "이제 정말 마법사 같아요." },
    { role: "taehoo", target: "태후는 수지가 옆에서 불씨의 문장을 함께 해석하지 않았다면 한 줄도 완성하지 못했을 거라고 답했다.", spoken: "수지가 옆에서 불씨의 문장을 함께 해석하지 않았다면 한 줄도 완성하지 못했을 거예요." }
  ],
  9: [
    { role: "suzy", target: "그럼 다음 관문도 함께 가요. 불은 당신이 잠재우고, 나는 옆에서 길을 찾을게요." },
    { role: "suzy", target: "오늘은 책상 하나지만 언젠가는 도시 전체를 지키게 될지도 모르잖아요." }
  ]
};

function loadEpisode() {
  const source = requireText(join(projectDir, "stories-data.js"));
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "stories-data.js" });
  const episode = context.window.FIRE_STUDY_STORIES?.find((item) => item.id === "nftc101-episode-1");
  if (!episode?.scenes?.length) throw new Error("1화 데이터를 찾지 못했습니다.");
  return episode;
}

function requireText(path) {
  return readFileSync(path, "utf8");
}

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
  const audioFormat = buffer.readUInt16LE(formatChunk.offset);
  const channels = buffer.readUInt16LE(formatChunk.offset + 2);
  const sampleRate = buffer.readUInt32LE(formatChunk.offset + 4);
  const bitsPerSample = buffer.readUInt16LE(formatChunk.offset + 14);
  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) {
    throw new Error(`지원하지 않는 WAV 형식: ${audioFormat}, ${channels}채널, ${bitsPerSample}비트`);
  }
  const pcm = buffer.subarray(dataChunk.offset, dataChunk.offset + dataChunk.size);
  const samples = new Int16Array(Math.floor(pcm.length / 2));
  for (let index = 0; index < samples.length; index += 1) samples[index] = pcm.readInt16LE(index * 2);
  return { sampleRate, samples };
}

function wavBuffer(samples, sampleRate) {
  const output = Buffer.alloc(44 + samples.length * 2);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + samples.length * 2, 4);
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
  output.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) output.writeInt16LE(samples[index], 44 + index * 2);
  return output;
}

function splitLongText(text, limit = 1150) {
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/g) || [text];
  const chunks = [];
  let current = "";
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (current && current.length + sentence.length + 1 > limit) {
      chunks.push(current);
      current = "";
    }
    if (sentence.length > limit) {
      if (current) chunks.push(current);
      for (let index = 0; index < sentence.length; index += limit) chunks.push(sentence.slice(index, index + limit));
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function sceneSegments(scene, sceneIndex) {
  let marked = `제${sceneIndex + 1}장. ${scene.title}.\n\n${scene.text}`;
  const replacements = dialogueByScene[sceneIndex] || [];
  replacements.forEach((item, replacementIndex) => {
    if (!marked.includes(item.target)) throw new Error(`${sceneIndex + 1}장 대사 원문을 찾지 못했습니다: ${item.target}`);
    marked = marked.replace(item.target, `\n@@DIALOGUE_${replacementIndex}@@\n`);
  });
  const segments = [];
  for (const block of marked.split(/\n+/).map((value) => value.trim()).filter(Boolean)) {
    const match = block.match(/^@@DIALOGUE_(\d+)@@$/);
    if (match) {
      const item = replacements[Number(match[1])];
      segments.push({ role: item.role, text: item.spoken || item.target, pauseMs: 520 });
      continue;
    }
    for (const chunk of splitLongText(block)) segments.push({ role: "narrator", text: chunk, pauseMs: 420 });
  }
  return segments;
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
  const scale = Math.min(1.45, Math.max(0.74, 4300 / Math.max(1, rms)), 28500 / peak);
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
    1224 * Math.sin(2 * Math.PI * chord[0] * time) +
    816 * Math.sin(2 * Math.PI * chord[1] * time + 0.7) +
    595 * Math.sin(2 * Math.PI * chord[2] * time + 1.4) +
    357 * Math.sin(2 * Math.PI * chord[2] * 2 * time + 0.35)
  );
  const bellPosition = time % 13.5;
  if (bellPosition < 1.8) {
    const decay = Math.exp(-2.35 * bellPosition);
    const bell = [523.25, 659.25, 783.99][Math.floor(time / 13.5) % 3];
    value += 2295 * decay * Math.sin(2 * Math.PI * bell * bellPosition);
  }
  const fade = Math.min(1, time / 2.2, (duration - time) / 2.2);
  return value * Math.max(0, fade);
}

async function synthesize(segment, sceneNumber, segmentIndex, tempDir) {
  const role = roles[segment.role];
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      voice: role.voice,
      input: segment.text,
      instructions: role.instructions,
      response_format: "wav"
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${sceneNumber}장 ${segmentIndex + 1}번째 음성 생성 실패 (${response.status}): ${detail.slice(0, 500)}`);
  }
  const path = join(tempDir, `scene-${String(sceneNumber).padStart(2, "0")}-${String(segmentIndex + 1).padStart(2, "0")}-${segment.role}.wav`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

function mixScene(clips, sampleRate) {
  const leadIn = Math.round(sampleRate * 1.8);
  const leadOut = Math.round(sampleRate * 2.4);
  const total = leadIn + leadOut + clips.reduce((sum, clip) => sum + clip.samples.length + Math.round(sampleRate * clip.pauseMs / 1000), 0);
  const voice = new Int16Array(total);
  let cursor = leadIn;
  for (const clip of clips) {
    voice.set(clip.samples, cursor);
    cursor += clip.samples.length + Math.round(sampleRate * clip.pauseMs / 1000);
  }
  const mixed = new Int16Array(total);
  const duration = total / sampleRate;
  for (let index = 0; index < total; index += 1) {
    const narration = voice[index];
    const duck = Math.abs(narration) > 600 ? 0.62 : 1;
    const value = narration + backgroundAt(index / sampleRate, duration) * duck;
    mixed[index] = Math.max(-32768, Math.min(32767, Math.round(value)));
  }
  return mixed;
}

function runEncoder(source, target) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("python", [encoderPath, source, target], { stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("exit", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`MP3 인코더 종료 코드: ${code}`)));
  });
}

function concatenateScenes(scenes, sampleRate) {
  const gap = Math.round(sampleRate * 1.2);
  const total = scenes.reduce((sum, samples) => sum + samples.length, 0) + gap * (scenes.length - 1);
  const output = new Int16Array(total);
  let cursor = 0;
  for (const samples of scenes) {
    output.set(samples, cursor);
    cursor += samples.length + gap;
  }
  return output;
}

async function main() {
  if (!apiKey) throw new Error("OPENAI_API_KEY 환경 변수가 필요합니다.");
  const episode = loadEpisode();
  if (episode.scenes.length !== 10) throw new Error(`1화 장면 수가 10개가 아닙니다: ${episode.scenes.length}`);
  await mkdir(outputDir, { recursive: true });
  const tempDir = await mkdtemp(join(tmpdir(), "fire-study-episode-1-"));
  try {
    const firstScene = parseWav(await readFile(firstSceneWav));
    const sampleRate = firstScene.sampleRate;
    const completedScenes = [firstScene.samples];
    const manifest = [{
      scene: 1,
      title: episode.scenes[0].title,
      file: "scene-01.mp3",
      durationSeconds: Number((firstScene.samples.length / sampleRate).toFixed(1))
    }];

    const firstMp3 = join(outputDir, "scene-01.mp3");
    await runEncoder(firstSceneWav, firstMp3);

    for (let sceneIndex = 1; sceneIndex < episode.scenes.length; sceneIndex += 1) {
      const sceneNumber = sceneIndex + 1;
      const segments = sceneSegments(episode.scenes[sceneIndex], sceneIndex);
      process.stdout.write(`\n${sceneNumber}장 생성 시작 · ${segments.length}개 음성 구간 · ${episode.scenes[sceneIndex].title}\n`);
      const generated = await Promise.all(segments.map((segment, segmentIndex) => synthesize(segment, sceneNumber, segmentIndex, tempDir)));
      const clips = [];
      for (let segmentIndex = 0; segmentIndex < generated.length; segmentIndex += 1) {
        const parsed = parseWav(await readFile(generated[segmentIndex]));
        if (parsed.sampleRate !== sampleRate) throw new Error(`${sceneNumber}장 샘플레이트가 다릅니다.`);
        clips.push({ samples: normalizedSamples(parsed.samples), pauseMs: segments[segmentIndex].pauseMs });
      }
      const mixed = mixScene(clips, sampleRate);
      const wavPath = join(tempDir, `scene-${String(sceneNumber).padStart(2, "0")}.wav`);
      const mp3Path = join(outputDir, `scene-${String(sceneNumber).padStart(2, "0")}.mp3`);
      await writeFile(wavPath, wavBuffer(mixed, sampleRate));
      await runEncoder(wavPath, mp3Path);
      completedScenes.push(mixed);
      manifest.push({
        scene: sceneNumber,
        title: episode.scenes[sceneIndex].title,
        file: `scene-${String(sceneNumber).padStart(2, "0")}.mp3`,
        durationSeconds: Number((mixed.length / sampleRate).toFixed(1))
      });
      process.stdout.write(`${sceneNumber}장 완료 · ${(mixed.length / sampleRate / 60).toFixed(1)}분\n`);
    }

    const complete = concatenateScenes(completedScenes, sampleRate);
    const completeWav = join(tempDir, "episode-1-complete.wav");
    const completeMp3 = join(outputDir, "episode-1-complete.mp3");
    await writeFile(completeWav, wavBuffer(complete, sampleRate));
    await runEncoder(completeWav, completeMp3);
    const totalSeconds = complete.length / sampleRate;
    await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify({
      episode: 1,
      title: episode.title,
      model,
      generatedAt: new Date().toISOString(),
      sampleRate,
      totalSeconds: Number(totalSeconds.toFixed(1)),
      completeFile: "episode-1-complete.mp3",
      scenes: manifest
    }, null, 2)}\n`, "utf8");
    process.stdout.write(`\n1화 전체 음성 완료 · ${(totalSeconds / 60).toFixed(1)}분 · ${completeMp3}\n`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export {
  apiKey,
  model,
  projectDir,
  synthesize,
  parseWav,
  wavBuffer,
  normalizedSamples,
  mixScene,
  runEncoder,
  concatenateScenes,
  splitLongText
};

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) await main();
