import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const defaultPagesDir = path.join(os.homedir(), "Documents", "Logseq", "home", "pages");
const pagesDir = path.resolve(process.env.LOGSEQ_PAGES_DIR || defaultPagesDir);
const outputPath = path.join(appDir, "cards-data.js");

const SOURCE_RULES = [
  {
    prefix: "PARA___Resource___화재안전기술기준___",
    kind: "화재안전기술기준",
  },
  {
    prefix: "PARA___Resource___점검실무행정___점검표___",
    kind: "점검표",
  },
];

function indentWidth(value = "") {
  let width = 0;
  for (const char of value) width += char === "\t" ? 4 : 1;
  return width;
}

function blockInfo(line) {
  const match = line.match(/^(\s*)-\s+(.*)$/);
  if (!match) return null;
  return { indent: indentWidth(match[1]), rawIndent: match[1], content: match[2] };
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function cleanInline(value) {
  return decodeEntities(value || "")
    .replace(/!\[[^\]]*\]\([^)]*\)(?:\{[^}]*\})?/g, " ")
    .replace(/\{\{c\d+\s+([^}]+)\}\}/g, "$1")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[[^\]]+\]\([^)]*\)/g, " ")
    .replace(/#[^\s#]+/g, " ")
    .replace(/==|\*\*|__|~~|`/g, "")
    .replace(/^\s*(?:✔\s*)?(?:중요한 내용|니모닉|암기법|암기)\s*[:：]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findOwnerBlock(lines, propertyIndex) {
  const propertyIndent = indentWidth((lines[propertyIndex].match(/^(\s*)/) || [])[1]);
  for (let index = propertyIndex - 1; index >= 0; index -= 1) {
    const block = blockInfo(lines[index]);
    if (block && block.indent < propertyIndent) return { index, ...block };
  }
  return null;
}

function findBlockEnd(lines, owner) {
  for (let index = owner.index + 1; index < lines.length; index += 1) {
    const block = blockInfo(lines[index]);
    if (block && block.indent <= owner.indent) return index;
  }
  return lines.length;
}

function extractQuestion(lines, owner, propertyIndex) {
  const parts = [owner.content];
  for (let index = owner.index + 1; index < propertyIndex; index += 1) {
    const line = lines[index];
    if (/^\s*(?:id|deck|source|collapsed)::/i.test(line)) continue;
    if (/!\[[^\]]*\]\(/.test(line)) continue;
    const block = blockInfo(line);
    if (block && block.indent > owner.indent) break;
    const continuation = cleanInline(line);
    if (continuation) parts.push(continuation);
  }

  for (let index = propertyIndex + 1; index < lines.length; index += 1) {
    const block = blockInfo(lines[index]);
    if (block) break;
    if (/^\s*(?:id|deck|source|collapsed)::/i.test(lines[index])) continue;
    if (/!\[[^\]]*\]\(/.test(lines[index])) continue;
    const continuation = cleanInline(lines[index]);
    if (continuation) parts.push(continuation);
  }
  return cleanInline(parts.join(" "));
}

function extractMnemonic(lines, propertyIndex, endIndex) {
  const separatorIndex = lines.findIndex(
    (line, index) => index > propertyIndex && index < endIndex && /^\s*-?\s*---\s*$/.test(line),
  );
  const stopIndex = separatorIndex >= 0 ? separatorIndex : Math.min(endIndex, propertyIndex + 14);
  const candidates = [];
  let explicitLabelValue = "";
  let started = false;

  for (let index = propertyIndex + 1; index < stopIndex; index += 1) {
    const line = lines[index];
    const isBlank = !line.trim();
    if (isBlank) continue;
    if (/!\[[^\]]*\]\(/.test(line)) {
      if (started) break;
      continue;
    }
    if (/추가\s*설명|관련\s*정보|오답\s*핵심/i.test(line)) {
      if (started) break;
      continue;
    }

    const equals = [...line.matchAll(/==(.+?)==/g)].map((match) => cleanInline(match[1])).filter(Boolean);
    if (equals.length) {
      candidates.push(...equals);
      started = true;
      continue;
    }

    if (/(?:중요한 내용|니모닉|암기법)/.test(line)) {
      const afterLabel = cleanInline(line);
      if (afterLabel) explicitLabelValue = afterLabel;
      started = Boolean(afterLabel);
      continue;
    }

    if (started) break;

    const block = blockInfo(line);
    if (!block) continue;
    const compact = cleanInline(block.content);
    const looksLikeFullyBoldMnemonic = /^\s*\*\*.+\*\*\s*$/.test(block.content);
    const looksLikeBoldMnemonic = looksLikeFullyBoldMnemonic && compact.length > 1 && compact.length <= 180;
    const looksLikeAnswer = /(?:MPa|L\/min|㎜|㎡|이상|이하)\s*[:：]?\s*\d/i.test(compact);
    const looksLikeChecklistAnswer = /[●○]|적정\s*여부|설치할\s*것/.test(compact);
    if (!candidates.length && looksLikeBoldMnemonic && !looksLikeAnswer && !looksLikeChecklistAnswer) {
      candidates.push(compact);
      started = true;
    }
  }

  const values = [explicitLabelValue, ...candidates]
    .map(cleanInline)
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 5);

  return values.join(" / ");
}

function stableId(sourceFile, ownerIndex, uuid) {
  if (uuid) return uuid;
  return crypto.createHash("sha1").update(`${sourceFile}:${ownerIndex}`).digest("hex").slice(0, 20);
}

function parsePage(filePath, source) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);
  const cards = [];
  const seenOwners = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const property = lines[index].match(/^\s*id::\s*([0-9a-f-]{16,})\s*$/i);
    if (!property) continue;
    const owner = findOwnerBlock(lines, index);
    if (!owner || seenOwners.has(owner.index)) continue;
    const endIndex = findBlockEnd(lines, owner);
    const question = extractQuestion(lines, owner, index);
    const mnemonic = extractMnemonic(lines, index, endIndex);
    const subtree = lines.slice(owner.index, endIndex).join("\n");
    const hasCardTag = /(?:#card|\*\*card\*\*)/i.test(subtree);
    const looksLikeQuestion = /(?:하시오|쓰시오|답하시오|기술하시오|점검항목|기준|경우|대상|방법|기능|종류|무엇|\?)\s*[.]?$/i.test(
      question,
    );
    if (!question || (!hasCardTag && !mnemonic && !looksLikeQuestion)) continue;

    seenOwners.add(owner.index);
    cards.push({
      id: stableId(path.basename(filePath), owner.index, property[1]),
      question,
      mnemonic: mnemonic || "니모닉 미등록",
      hasMnemonic: Boolean(mnemonic),
      kind: source.kind,
      subject: source.title,
      sourceFile: path.basename(filePath),
      line: owner.index + 1,
    });
  }

  return cards;
}

if (!fs.existsSync(pagesDir)) {
  throw new Error(`Logseq pages directory not found: ${pagesDir}`);
}

const sourceFiles = fs
  .readdirSync(pagesDir)
  .filter((name) => name.endsWith(".md"))
  .map((name) => {
    const rule = SOURCE_RULES.find((candidate) => name.startsWith(candidate.prefix));
    if (!rule) return null;
    const title = name.slice(rule.prefix.length, -3).replace(/___/g, " / ").trim();
    return { name, title, kind: rule.kind };
  })
  .filter(Boolean)
  .sort((a, b) => {
    const kindOrder = SOURCE_RULES.findIndex((rule) => rule.kind === a.kind) - SOURCE_RULES.findIndex((rule) => rule.kind === b.kind);
    return kindOrder || a.name.localeCompare(b.name, "ko");
  });

const cards = sourceFiles.flatMap((source) => parsePage(path.join(pagesDir, source.name), source));
const deduped = [...new Map(cards.map((card) => [card.id, card])).values()].map((card, index) => ({
  ...card,
  order: index + 1,
}));

const metadata = {
  generatedAt: new Date().toISOString(),
  sourceFiles: sourceFiles.length,
  totalCards: deduped.length,
  mnemonicCards: deduped.filter((card) => card.hasMnemonic).length,
  kinds: Object.fromEntries(
    SOURCE_RULES.map((rule) => [rule.kind, deduped.filter((card) => card.kind === rule.kind).length]),
  ),
};

const payload = `window.FIRE_STUDY_DATA = ${JSON.stringify({ metadata, cards: deduped }, null, 2)};\n`;
fs.writeFileSync(outputPath, payload, "utf8");

console.log(JSON.stringify(metadata, null, 2));
console.log(`Wrote ${outputPath}`);
