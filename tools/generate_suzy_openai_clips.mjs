import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const apiKey = process.env.OPENAI_API_KEY;
const outputDir = resolve(process.argv[2] || "./.suzy-openai-clips");

const commonInstructions = [
  "한국어 판타지 오디오 드라마의 젊은 여성 등장인물이다.",
  "실제 인물이나 연예인의 목소리를 모사하지 않는다.",
  "해설자와 동일한 기본 목소리를 사용하지만 수지의 대사는 밝고 즐거운 에너지가 느껴지게 말한다.",
  "웃는 표정이 살짝 느껴지는 자연스러운 서울말로 또렷하게 말한다.",
  "유치한 애교, 속삭임, 콧소리, 과장된 연기와 지나치게 높은 음정을 피한다.",
  "문장 끝을 인위적으로 끌지 않고 기분 좋은 대화처럼 산뜻하게 마친다."
].join(" ");

const clips = [
  {
    text: "촬영 스태프 한 명이 아직 지하에 남아 있어요. 그냥 두고 갈 수는 없어요!",
    instructions: `${commonInstructions} 위험한 상황에서도 낙담하지 않는 밝은 결심과 활기찬 용기가 느껴지게 말한다. 장난스럽거나 웃는 소리를 내지는 말고 약 5초 안에 말한다.`
  },
  {
    text: "태후 씨, 판대일, 식단이에요. 이 주문을 사용해요!",
    instructions: `${commonInstructions} 중요한 단서를 찾아 신이 난 듯 반갑고 즐겁게 알려준다. '판대일, 식단'은 각각 또렷하게 끊고 전체는 약 3초 안에 경쾌하게 말한다.`
  },
  {
    text: "평범한 회사원이라고 했죠? 오늘은 전혀 평범해 보이지 않는데요.",
    instructions: `${commonInstructions} 안도한 뒤 상대를 새롭게 바라보며 기분 좋게 감탄하는 말투로 말한다. 친근한 미소는 느껴지되 웃음을 과장하지 않고 약 5초 안에 말한다.`
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
      voice: "marin",
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
