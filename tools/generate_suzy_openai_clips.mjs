import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const apiKey = process.env.OPENAI_API_KEY;
const outputDir = resolve(process.argv[2] || "./.suzy-openai-clips");

const commonInstructions = [
  "한국어 판타지 오디오 드라마의 젊은 여성 등장인물이다.",
  "실제 인물이나 연예인의 목소리를 모사하지 않는다.",
  "일상적인 서울말로 자연스럽고 또렷하게 말한다.",
  "애교, 속삭임, 콧소리, 과장된 연기와 지나치게 높은 음정을 피한다.",
  "문장 끝을 인위적으로 끌지 말고 대화하듯 담백하게 마친다."
].join(" ");

const clips = [
  {
    text: "촬영 스태프 한 명이 아직 지하에 남아 있어요. 그냥 두고 갈 수는 없어요!",
    instructions: `${commonInstructions} 위험한 상황이지만 소리치지 말고, 걱정과 결심이 함께 느껴지는 통제된 긴박감으로 약 5초 안에 말한다.`
  },
  {
    text: "태후 씨, 판대일, 식단이에요. 이 주문을 사용해요!",
    instructions: `${commonInstructions} 상대에게 중요한 단서를 알려주듯 밝고 확신 있게 말한다. '판대일, 식단'은 각각 또렷하게 끊고 전체는 약 6초 안에 말한다.`
  },
  {
    text: "평범한 회사원이라고 했죠? 오늘은 전혀 평범해 보이지 않는데요.",
    instructions: `${commonInstructions} 안도한 뒤 상대를 새롭게 바라보는 따뜻하고 살짝 놀란 말투로, 웃음을 과장하지 않고 약 5초 안에 말한다.`
  }
];

async function synthesize(clip, index) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "nova",
      input: clip.text,
      instructions: clip.instructions,
      response_format: "wav"
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`수지 음성 ${index} 생성 실패 (${response.status}): ${detail.slice(0, 400)}`);
  }

  const path = resolve(outputDir, `${index}.wav`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  process.stdout.write(`수지 음성 ${index}/3 생성 완료\n`);
}

if (!apiKey) throw new Error("OPENAI_API_KEY 환경 변수가 필요합니다.");
await mkdir(outputDir, { recursive: true });
for (let index = 0; index < clips.length; index += 1) {
  await synthesize(clips[index], index + 1);
}
process.stdout.write(`저장 위치: ${outputDir}\n`);
