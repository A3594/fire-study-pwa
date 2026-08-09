import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import {
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
} from "./generate_episode_1_audio.mjs";

const outputDir = join(projectDir, "audio", "episode-2");

const dialogueByScene = {
  0: [
    { role: "suzy", target: "“오늘은 내 얼굴 말고 소화전부터 봐요, 대표님.”", spoken: "오늘은 내 얼굴 말고 소화전부터 봐요, 대표님." }
  ],
  1: [
    { role: "suzy", target: "“대표님, 체력도 성능시험 대상이에요.”", spoken: "대표님, 체력도 성능시험 대상이에요." },
    { role: "suzy", target: "“아직 키스할 때 아니에요. 펌프부터 살려요.”", spoken: "아직 키스할 때 아니에요. 펌프부터 살려요." }
  ],
  2: [
    { role: "suzy", target: "“이건 축하 포옹이에요.”", spoken: "이건 축하 포옹이에요." },
    { role: "suzy", target: "“키스는 아직 성능 미달.”", spoken: "키스는 아직 성능 미달." }
  ],
  3: [
    { role: "suzy", target: "“회사가 커져도 계산은 두 번 확인하기. 나를 보는 건 그다음.”", spoken: "회사가 커져도 계산은 두 번 확인하기. 나를 보는 건 그다음." }
  ],
  6: [
    { role: "suzy", target: "“이 손은 전원이 돌아와도 놓지 마요.”", spoken: "이 손은 전원이 돌아와도 놓지 마요." }
  ],
  7: [
    { role: "suzy", target: "“우리 연구소, 이제 책상 하나짜리는 아니겠네요.”", spoken: "우리 연구소, 이제 책상 하나짜리는 아니겠네요." }
  ],
  9: [
    { role: "taehoo", target: "“수지 씨가 없었으면 계약도 수룡도 없었어요.”", spoken: "수지 씨가 없었으면 계약도 수룡도 없었어요." },
    { role: "suzy", target: "“그럼 앞으로도 없으면 안 되는 사람이 되게 해줘요.”", spoken: "그럼 앞으로도 없으면 안 되는 사람이 되게 해줘요." }
  ]
};

function loadEpisode() {
  const context = { window: {} };
  vm.createContext(context);
  for (const filename of ["stories-data.js", "episode-2-data.js"]) {
    vm.runInContext(readFileSync(join(projectDir, filename), "utf8"), context, { filename });
  }
  const episode = context.window.FIRE_STUDY_STORIES?.find((item) => item.id === "nftc102-episode-2");
  if (!episode?.scenes?.length) throw new Error("2화 데이터를 찾지 못했습니다.");
  return episode;
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
      segments.push({ role: item.role, text: item.spoken, pauseMs: 520 });
      continue;
    }
    for (const chunk of splitLongText(block)) segments.push({ role: "narrator", text: chunk, pauseMs: 420 });
  }
  return segments;
}

async function main() {
  if (!apiKey) throw new Error("OPENAI_API_KEY 환경 변수가 필요합니다.");
  const episode = loadEpisode();
  if (episode.scenes.length !== 10) throw new Error(`2화 장면 수가 10개가 아닙니다: ${episode.scenes.length}`);
  const preparedSegments = episode.scenes.map((scene, sceneIndex) => sceneSegments(scene, sceneIndex));
  if (process.argv.includes("--preflight")) {
    process.stdout.write(`${JSON.stringify(preparedSegments.map((segments, index) => ({ scene: index + 1, segments: segments.length })))}\n`);
    return;
  }
  await mkdir(outputDir, { recursive: true });
  const tempDir = await mkdtemp(join(tmpdir(), "fire-study-episode-2-"));
  try {
    let sampleRate = null;
    const completedScenes = [];
    const manifest = [];
    for (let sceneIndex = 0; sceneIndex < episode.scenes.length; sceneIndex += 1) {
      const sceneNumber = sceneIndex + 1;
      const segments = preparedSegments[sceneIndex];
      process.stdout.write(`\n${sceneNumber}장 생성 시작 · ${segments.length}개 음성 구간 · ${episode.scenes[sceneIndex].title}\n`);
      const generated = await Promise.all(segments.map((segment, segmentIndex) => synthesize(segment, sceneNumber, segmentIndex, tempDir)));
      const clips = [];
      for (let segmentIndex = 0; segmentIndex < generated.length; segmentIndex += 1) {
        const parsed = parseWav(await readFile(generated[segmentIndex]));
        if (sampleRate && parsed.sampleRate !== sampleRate) throw new Error(`${sceneNumber}장 샘플레이트가 다릅니다.`);
        sampleRate ||= parsed.sampleRate;
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
    const completeWav = join(tempDir, "episode-2-complete.wav");
    const completeMp3 = join(outputDir, "episode-2-complete.mp3");
    await writeFile(completeWav, wavBuffer(complete, sampleRate));
    await runEncoder(completeWav, completeMp3);
    const totalSeconds = complete.length / sampleRate;
    await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify({
      episode: 2,
      title: episode.title,
      model,
      generatedAt: new Date().toISOString(),
      sampleRate,
      totalSeconds: Number(totalSeconds.toFixed(1)),
      completeFile: "episode-2-complete.mp3",
      scenes: manifest
    }, null, 2)}\n`, "utf8");
    process.stdout.write(`\n2화 전체 음성 완료 · ${(totalSeconds / 60).toFixed(1)}분 · ${completeMp3}\n`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

await main();
