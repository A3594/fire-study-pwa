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

const outputDir = join(projectDir, "audio", "episode-3");

const dialogueByScene = {
  0: [
    { role: "suzy", target: "“대표님 눈이 또 점검항목을 벗어났어요.”", spoken: "대표님 눈이 또 점검항목을 벗어났어요." }
  ],
  1: [
    { role: "suzy", target: "“떨어지면 안 돼요. 아직 같이 벌 돈이 많으니까.”", spoken: "떨어지면 안 돼요. 아직 같이 벌 돈이 많으니까." }
  ],
  2: [
    { role: "suzy", target: "“그 말은 합격.”", spoken: "그 말은 합격." }
  ],
  3: [
    { role: "suzy", target: "“그리드 방식은 두 방향 급수라더니 포옹도 양쪽이네요.”", spoken: "그리드 방식은 두 방향 급수라더니 포옹도 양쪽이네요." }
  ],
  4: [
    { role: "suzy", target: "“방금은 경보 때문에 안긴 거예요.”", spoken: "방금은 경보 때문에 안긴 거예요." },
    { role: "taehoo", target: "“그럼 경보가 멈추면요?”", spoken: "그럼 경보가 멈추면요?" }
  ],
  5: [
    { role: "suzy", target: "“최신 기준에서는 여기 예외예요.”", spoken: "최신 기준에서는 여기 예외예요." }
  ],
  7: [
    { role: "suzy", target: "“나는 보호받는 역할만 하려고 이 회사에 온 게 아니에요. 대신 위험할 때는 꼭 같이 있어 줘요.”", spoken: "나는 보호받는 역할만 하려고 이 회사에 온 게 아니에요. 대신 위험할 때는 꼭 같이 있어 줘요." }
  ],
  8: [
    { role: "suzy", target: "“대표가 쓰러지면 회사도 멈춰요.”", spoken: "대표가 쓰러지면 회사도 멈춰요." }
  ],
  9: [
    { role: "taehoo", target: "“오늘은 성능 미달 아니죠?”", spoken: "오늘은 성능 미달 아니죠?" }
  ]
};

function loadEpisode() {
  const context = { window: {} };
  vm.createContext(context);
  for (const filename of ["stories-data.js", "episode-2-data.js", "episode-3-data.js"]) {
    vm.runInContext(readFileSync(join(projectDir, filename), "utf8"), context, { filename });
  }
  const episode = context.window.FIRE_STUDY_STORIES?.find((item) => item.id === "nftc103-episode-3");
  if (!episode?.scenes?.length) throw new Error("3화 데이터를 찾지 못했습니다.");
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
  if (episode.scenes.length !== 10) throw new Error(`3화 장면 수가 10개가 아닙니다: ${episode.scenes.length}`);
  const preparedSegments = episode.scenes.map((scene, sceneIndex) => sceneSegments(scene, sceneIndex));
  if (process.argv.includes("--preflight")) {
    process.stdout.write(`${JSON.stringify(preparedSegments.map((segments, index) => ({ scene: index + 1, segments: segments.length })))}\n`);
    return;
  }
  await mkdir(outputDir, { recursive: true });
  const tempDir = await mkdtemp(join(tmpdir(), "fire-study-episode-3-"));
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
    const completeWav = join(tempDir, "episode-3-complete.wav");
    const completeMp3 = join(outputDir, "episode-3-complete.mp3");
    await writeFile(completeWav, wavBuffer(complete, sampleRate));
    await runEncoder(completeWav, completeMp3);
    const totalSeconds = complete.length / sampleRate;
    await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify({
      episode: 3,
      title: episode.title,
      model,
      generatedAt: new Date().toISOString(),
      sampleRate,
      totalSeconds: Number(totalSeconds.toFixed(1)),
      completeFile: "episode-3-complete.mp3",
      scenes: manifest
    }, null, 2)}\n`, "utf8");
    process.stdout.write(`\n3화 전체 음성 완료 · ${(totalSeconds / 60).toFixed(1)}분 · ${completeMp3}\n`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

await main();
