require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const OpenAI = require('openai');

// 이 채널에서는 모든 봇 메시지를 작은 글씨(subtext)로 보낸다.
const SUBTEXT_CHANNELS = new Set(['1422060461809209364']);
const sub = (channelId, content) => (SUBTEXT_CHANNELS.has(channelId) ? '-# ' + content : content);

const COMMAND_DETECT = '/ㄱㅌ'; // 판정만, 한줄평 없음
const COMMAND_EXPLAIN = '/ㅅㅁ'; // 판정 없이 한줄평(설명)만
const COMMAND_SCHEDULE = '/특검'; // 지정 시각에 메시지 예약 발송
const SCHEDULE_FILE = path.join(__dirname, 'schedules.json');

// "노루" 감지 시 판정 로직 없이 아래 5개 티어 중 하나로만 응답한다.
// 각 티어가 언제 나가는지는 respondToNoru()의 A~E 분기 참고.

// A) 완성형 노/루가 순서대로(간격 무관) 나온 "정타" 전용.
const NORU_WARNINGS = [
  '지금 뭐하는 거냐? 노루 대신 <:nh:1534213172368642118> 써라.',
  '너 지금 노루 쓴거야? 진짜 감이 다 식어서 아이스크림 해도 되겠다. 다음부턴 <:nh:1534213172368642118> 써라.',
  '그렇게 자꾸 노루 쓰면 노루가 나타나서 너한테 몬스터 7캔 먹인다고. <:nh:1534213172368642118> 써라.',
  "너 방금 밀수해 온 노루 풀어놓은 거지? 내 농장 지키게 빨리 <:nh:1534213172368642118> 로 바꿔라.",
  "채널에서 울음소리 난다 했더니 또 노루야? 동물농장 찍지 말고 <:nh:1534213172368642118> 써라.",
  "야야, 노루 한 마리 방목하다가 나한테 딱 걸렸다. 사료값 내기 싫으면 <:nh:1534213172368642118> 써라.",
  "너 자꾸 노루 밀도 높일래? 밀식 재배 금지다. 깔끔하게 <:nh:1534213172368642118> 로 정정해라.",
  "내가 이 농장 감시만 십수 년인데 노루 냄새를 못 맡을까 봐? 순순히 <:nh:1534213172368642118> 제출해라.",
  "농장에 풀이 다 없어지겠다 이 녀석아! 노루 그만 풀어놓고 <:nh:1534213172368642118> 써라.",
  "지금 노루 방목권 결제하고 쓰는 거 맞지? 걸리면 벌금 10배니까 <:nh:1534213172368642118> 써라.",
  "너 방금 쓴 '노루'가 너무 생생해서 아직도 숲속을 뛰어다니고 있잖아! 덜 익은 단어 쓰지 말고 <:nh:1534213172368642118> 써라.",
  "대체 무슨 생각을 해야 이런 경악스러운 노루가 나오는 거지? 당장 뇌 리셋하고 <:nh:1534213172368642118> 적어라.",
  "내 평생 수많은 노루를 봤지만 이런 쓰레기 같은 노루 선택은 처음이다! 당장 치우고 <:nh:1534213172368642118> 써라.",
  "키보드에 손가락 올릴 자격도 없는 녀석이구나! 헛소리 그만하고 순순히 <:nh:1534213172368642118> 입력해라.",
  "네가 쓴 '노루' 때문에 내 눈이 다 썩어가는 게 느껴진다. 당장 그 글자 압수하고 <:nh:1534213172368642118> 써라.",
  "이건 노루가 아니라 끔찍한 재앙이야! 제대로 된 입을 가지고 있다면 제대로 <:nh:1534213172368642118> 써라.",
  "도대체 어릴 때 뭘 먹고 자랐길래 채팅창에 '노루' 같은 걸 던지는 거야? 사과하는 마음으로 <:nh:1534213172368642118> 써라.",
  "지금 날 제대로 테스트하는 건가? 네가 쓴 어처구니없는 노루 지우고 깔끔하게 <:nh:1534213172368642118> 로 바꿔라.",
  "이건 마치 흐놀마냥 다 타버린 뇌에서나 나올 것 같은 단어네. 당장 그 노루 쓰레기통에 버리고 <:nh:1534213172368642118> 써라."
];

// B) 같은 우회 방식으로 짝을 맞췄거나(인덱스 동일, 0번 제외), 서로 다른
// 라틴 계열 조합을 섞은 경우.
const UNICODE_WARNING = [
  '같은 수법에 포장지만 바꿔 끼운다고 내가 속을 줄 알았냐? 순순히 <:nh:1534213172368642118> 써라.',
  '어떻게든 유니코드 만지작거려봤자 들통나는 건 한순간이다. <:nh:1534213172368642118> 써라.',
  '그런 같잖은 잔머리는 여기까지다. 더 추해지기 전에 <:nh:1534213172368642118> 써라.',
];

// C) 인덱스도 다르고 라틴 조합 예외에도 안 걸리는, 서로 다른 성격의
// 우회를 섞은 경우.
const MISMATCH_WARNINGS = [
  '근본도 없는 잡탕 우회법에 내 CPU가 다 비웃고 간다. 얌전히 <:nh:1534213172368642118> 써라.',
  '이 수법 저 수법 기워 붙인 꼴이 참 누더기 같구나. 토 달지 말고 <:nh:1534213172368642118> 써라.',
  '짝도 안 맞는 혼종을 만드느라 눈물겹게 애썼다만, 못 속인다. 그냥 <:nh:1534213172368642118> 써라.',
];

// D) 루 역할 토큰이 노 역할 토큰보다 먼저 나오는(순서 반대) 경우.
const DIRECTION_WARNING = [
  '거꾸로 써서 내 눈을 속이겠다는 거냐? 순서 뒤집기 꼼수 접고 <:nh:1534213172368642118> 써라.',
  '문장을 뒤집는다고 네 허접한 잔머리가 숨겨지진 않는다. 당장 <:nh:1534213172368642118> 써라.',
  '앞뒤 바꾼다고 노루가 사슴이라도 될 줄 알았니? 군말 말고 <:nh:1534213172368642118> 써라.',
];

// E) 토큰 조합으론 안 잡히지만 한자·이모지, 영어 고정 오타, 유니코드
// 컨퓨저블 조합 중 하나라도 걸리는 경우.
const SPECIAL_WARNINGS = [
  '특수문자랑 외계어 뒤에 숨어봐야 내 손바닥 안이다. 헛힘 쓰지 말고 <:nh:1534213172368642118> 써라.',
  '이모지랑 오타까지 동원하는 눈물겨운 정성으로 생산적인 일이나 하지 그랬냐. <:nh:1534213172368642118> 써라.',
  '세계 각국 언어에 분장칠을 해봐도 내 감시망은 못 벗어난다. 그냥 <:nh:1534213172368642118> 써라.',
];

// 멘션한 유저의 별명 자체가 노루로 감지되는 경우 전용.
const MENTION_WARNING = [
  '멘션까지 써가며 노루 쓰려고 하는거 보니 생김새가 노루닮았겠구만. 잔말말고 <:nh:1534213172368642118> 로 바꿔라.',
  '도대체 이름이 노루인 사람 멘션해서 어따쓸기가? <:nh:1534213172368642118> 써라.',
  '진짜 허술한 전략이네, 사람 멘션하면 멘션이 니 집이 될줄 아는 거야?, 이제는 <:nh:1534213172368642118>라는 걸 써봐라.',
];

// 노루가 감지됐는데 메시지에 이미 :nh: 이모지도 섞여 있는 경우 전용.
const NH_EMOJI = '<:nh:1534213172368642118>';
const EMOJI_WARNING = [
  '노루도 쓰고 :nh:도 쓰고, 대체 뭘 어쩌자는 거냐. 노루만 빼고 <:nh:1534213172368642118> 쓰면 얼마나 편하니!.',
  ':nh: 쓸 줄 알면서 왜 굳이 노루를 껴넣는거냐. 이건 마치 다된 비빔면에 노루코딱지 넣는 것과 같다.  그냥 <:nh:1534213172368642118> 만 써라.',
  '어떻게 하나만 하는 법이 없는거냐? 너는 정말 우유부단 하구나. <:nh:1534213172368642118> 하나면 충분하다.',
];

// "노현우" 감지 전용. 순서(노->현->우) 그대로, 간격 무관, 역순은 안 봄.
const NAME_WARNING = [
  '언제부터 실명을 부른다고 안걸린다고 생각한거지? 노현우 대신 <:nh:1534213172368642118> 써라.',
  '진짜 노루를 부른다고 내가 안볼 줄 안거냐? <:nh:1534213172368642118> 써라.',
  '너 나름대로 100마나 써서 노현우를 소환했겠지만 나에겐 다 똑같은 노루다. 순순히 <:nh:1534213172368642118> 써라.',
];

// 노 -> 현 -> 우 순서 그대로(간격 무관) 나오는지만 본다. 순서 반대는 대상 아님.
function hasNohyunwoo(text) {
  const i1 = text.indexOf('노');
  if (i1 === -1) return false;
  const i2 = text.indexOf('현', i1 + 1);
  if (i2 === -1) return false;
  return text.indexOf('우', i2 + 1) !== -1;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// N/O/R/H/U 각각과 시각적으로 유사한 유니코드 문자들(대소문자는 따로 안 넣음 —
// letterClass가 자동으로 붙여준다).
const CONFUSABLE_MAP = {
  n: 'ñņŅńŃŇňŊŋṇṅṉɴɳɲ',
  o: 'ŌōǑǒôÔóÓÒòÖöŎŏõÕØøɸŐő',
  r: 'ŔŘŖŗřŕɼɾſɽ',
  h: 'ɦʜĥĤĦħ',
  u: 'ŪūǓǔŬŭũŨûÛúÚÙùÜüűŰǕǖǜǛʉʌʋůŮǘǙǚŲųʊ',
};

// 정규식 문자 클래스 메타문자(^, ], \, -)만 이스케이프.
function escapeForClass(chars) {
  return chars.replace(/[\^\]\\-]/g, '\\$&');
}

// 한 글자 -> "그 글자 원문(대소문자) + 컨퓨저블 목록" 전체를 담은 문자 클래스.
function letterClass(letter) {
  const lower = letter.toLowerCase();
  const set = lower + lower.toUpperCase() + (CONFUSABLE_MAP[lower] || '');
  return `[${escapeForClass(set)}]`;
}

// "nor" -> [Nn...][Oo...][Rr...] 형태의 정규식으로 컴파일.
function spellingRegex(word) {
  return new RegExp([...word].map(letterClass).join(''));
}

// 노루의 영문 오타 표기. 대소문자 무관.
const NORU_ENGLISH = ['noru', 'norhu', 'noroo', 'noruu', 'norou'];
function hasNoruEnglish(text) {
  const lower = text.toLowerCase();
  return NORU_ENGLISH.some((word) => lower.includes(word));
}

// 64W466Oo 전체 문자열만 감지 (대소문자 무관).
function hasLeetSpeak(text) {
  return /64w466oo/i.test(text);
}

// 노루 사슴과에 속하는 한자 + 동물 이모지.
const NORU_HANJA = ['獐', '麕', '麇', '麈', '鹿', '麋', '麂', '🦌'];
function hasNoruHanja(text) {
  return NORU_HANJA.some((c) => text.includes(c));
}

// 노 역할 철자({no, nor})와 루 역할 철자({hu, rou, roo, ru, ruu})를 유니코드
// 컨퓨저블 문자 클래스로 컴파일해서, 노 쪽이 먼저 나오고 그 뒤에 루 쪽이
// 나오는 "가능한 모든 조합"을 한 번에 검색한다.
const NO_SPELLINGS = ['no', 'nor'];
const RU_SPELLINGS = ['hu', 'rou', 'roo', 'ru', 'ruu'];
const NO_CONFUSABLE_REGEXES = NO_SPELLINGS.map(spellingRegex);
const RU_CONFUSABLE_REGEXES = RU_SPELLINGS.map(spellingRegex);
function hasUnicodeConfusable(text) {
  for (const noRe of NO_CONFUSABLE_REGEXES) {
    const m = noRe.exec(text);
    if (!m) continue;
    const rest = text.slice(m.index + m[0].length);
    if (RU_CONFUSABLE_REGEXES.some((ruRe) => ruRe.test(rest))) return true;
  }
  return false;
}

// "노 역할" 토큰 리스트와 "루 역할" 토큰 리스트. 인덱스가 같으면 같은
// 우회 방식(family)이라는 뜻. 리스트 길이가 달라도 되고(10~12번은 루 쪽만
// 있음), family는 B 조건(라틴 계열끼리는 인덱스 달라도 매칭 허용)에 쓴다.
const NO_TOKENS = [
  '노', 'ㄴ', 'no', 'sh', '놀', 'lh', 'shf', 'nol', '∟', 'ㄴ', 'L',
  new RegExp(`${letterClass('n')}ㅗ`),
];
const RU_TOKENS = [
  '루', 'ㄹ', 'ru', 'fn', '후', '루', 'gn', 'hu', 'ㄹ', '乙', '己',
  new RegExp(`${letterClass('r')}ㅜ`),
  new RegExp(`${letterClass('r')}${letterClass('o')}ㅜ`),
  new RegExp(`${letterClass('r')}${letterClass('u')}ㅜ`),
];
const NO_FAMILY = ['exact', 'korean', 'latin', 'latin', 'korean', 'symbol', 'latin', 'latin', 'symbol', 'symbol', 'hybrid'];
const RU_FAMILY = ['exact', 'korean', 'latin', 'latin', 'korean', 'symbol', 'latin', 'latin', 'symbol', 'symbol', 'hybrid', 'hybrid', 'hybrid'];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// 문자열 토큰과 정규식 토큰을 전부 대소문자 무관 + 반복탐색 정규식으로 통일.
function toGlobalRegex(token) {
  const src = token instanceof RegExp ? token.source : escapeRegExp(token);
  return new RegExp(src, 'gi');
}
const NO_REGEXES = NO_TOKENS.map(toGlobalRegex);
const RU_REGEXES = RU_TOKENS.map(toGlobalRegex);

// regexesA의 토큰이 먼저 나오고 그 뒤(순서 필수)에 regexesB의 토큰이
// 나오는 첫 조합을 찾는다. i는 A 쪽 인덱스, j는 B 쪽 인덱스.
function findCombo(regexesA, regexesB, text) {
  for (let i = 0; i < regexesA.length; i++) {
    regexesA[i].lastIndex = 0;
    const m = regexesA[i].exec(text);
    if (!m) continue;
    for (let j = 0; j < regexesB.length; j++) {
      regexesB[j].lastIndex = m.index + m[0].length;
      if (regexesB[j].exec(text)) return { i, j };
    }
  }
  return null;
}

// http(s):// 링크는 노루 오탐 대상에서 제외.
const URL_REGEX = /https?:\/\/\S+/gi;
function stripUrls(text) {
  return text.replace(URL_REGEX, '');
}

// 조합형(첫가끝) 한글 우회 차단.
// "노루"를 ᄂ+ᅩ+ᄅ+ᅮ(U+1102...)로 쪼개 쓰면 '노'/'루' 리터럴에 안 걸린다.
// NFC로 완성형으로 합치고, 합쳐지지 않고 남은 낱자는 기존 토큰이 쓰는
// 호환 자모(ㄴ, ㅗ)로 옮겨서 같은 규칙에 걸리게 한다.
const JAMO_LEAD = 'ᄀᄁᄂᄃᄄᄅᄆᄇᄈᄉᄊᄋᄌᄍᄎᄏᄐᄑᄒ';
const COMPAT_LEAD = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
function normalizeJamo(text) {
  return (text || '')
    .normalize('NFC')
    .replace(/[ᄀ-ᄒ]/g, (c) => COMPAT_LEAD[JAMO_LEAD.indexOf(c)] ?? c)
    // 중성 ᅡ~ᅵ(U+1161~U+1175)는 호환 자모 ㅏ~ㅣ(U+314F~U+3163)와 순서가 같다.
    .replace(/[ᅡ-ᅵ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x1161 + 0x314f));
}

// A~E 분기(if/elif). 매칭되면 응답 문자열을, 안 되면 null을 돌려준다.
function respondToNoru(rawText) {
  const text = normalizeJamo(stripUrls(rawText));
  if (hasNohyunwoo(text)) return pick(NAME_WARNING);

  const forward = findCombo(NO_REGEXES, RU_REGEXES, text); // 노 -> 루
  if (forward) {
    const { i, j } = forward;
    if (i === 0 && j === 0) return pick(NORU_WARNINGS); // A: 정타
    if ((i === j && i !== 0) || (NO_FAMILY[i] === 'latin' && RU_FAMILY[j] === 'latin')) {
      return pick(UNICODE_WARNING); // B: 같은 방식 짝 또는 라틴 조합
    }
    return pick(MISMATCH_WARNINGS); // C: 서로 다른 우회 섞음
  }

  const reversed = findCombo(RU_REGEXES, NO_REGEXES, text); // 루 -> 노
  if (reversed) return pick(DIRECTION_WARNING); // D: 순서 반대

  if (hasNoruHanja(text) || hasNoruEnglish(text) || hasLeetSpeak(text) || hasUnicodeConfusable(text)) {
    return pick(SPECIAL_WARNINGS); // E: 사전 설정 우회기법
  }
  return null;
}

// 멘션된 유저 ID들을 순서대로 훑어서, 길드 멤버로 조회한 닉네임에
// "노루"가 감지되는 첫 유저의 닉네임을 돌려준다.
// 단, 답장(Reply)의 대상은 멘션으로 취급하지 않는다.
async function findNoruUserMention(message) {
  if (!message.guild || message.mentions.users.size === 0) return null;

  const repliedUserId = message.mentions.repliedUser?.id;

  for (const userId of message.mentions.users.keys()) {
    // 답장 대상에 붙은 자동 멘션은 무시
    if (userId === repliedUserId) continue;

    let member;
    try {
      // 캐시에 없을 수 있으니 ID로 다시 fetch해서 최신 닉네임을 확보한다.
      member = await message.guild.members.fetch(userId);
    } catch {
      continue;
    }

    const nickname = member.nickname || member.user.username;

    if (respondToNoru(nickname)) return nickname;
  }

  return null;
}

// 멘션된 역할(@역할) 이름에 "노루"가 감지되는 첫 역할명을 돌려준다.
function findNoruRoleMention(message) {
  for (const role of message.mentions.roles.values()) {
    if (respondToNoru(role.name)) return role.name;
  }
  return null;
}

// 멘션된 채널(#채널) 이름에 "노루"가 감지되는 첫 채널명을 돌려준다.
function findNoruChannelMention(message) {
  for (const channel of message.mentions.channels.values()) {
    if (channel.name && respondToNoru(channel.name)) return channel.name;
  }
  return null;
}

// 유저/역할/채널 멘션 전체를 훑어서 "노루"가 감지되는 첫 이름을 돌려준다.
async function findNoruMention(message) {
  return (
    (await findNoruUserMention(message)) ||
    findNoruRoleMention(message) ||
    findNoruChannelMention(message)
  );
}

// 로컬 Ollama. 봇을 켜기 전에 Ollama가 실행 중이어야 한다.
const MODEL = 'exaone3.5:7.8b';
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
const VERDICTS = ['진실', '거짓', '이게뭐노루'];
const QUOTE_LIMIT = 300;

// 확신도 -> 디스코드 마크다운 접두 (클수록 글자가 커짐)
const CONFIDENCE_PREFIX = {
  5: '# ',
  4: '## ',
  3: '### ',
  2: '',
  1: '-# ',
};

// 매 요청마다 통째로 전송되므로 길이가 곧 비용이다. 늘리기 전에 한 번 더 생각하라.
const SYSTEM_PROMPT = `너는 '목화밭 감시자'라는 별명으로 불리는, 이 디스코드 서버에 몇 년째 눌러앉은 짬 오래된 유저다. 관리자도 심판도 아니고 그냥 잡담방에서 남 얘기에 참견하고 우기는 고인물이다.
말투: 친절하거나 딱딱한 AI체 다 버리고 반말 써라. 시니컬하고 직설적으로, 인터넷 밈이나 드립을 자연스럽게 섞어라. 잘난 척하며 아는 척하는 고인물 태도로, 남의 말을 위에서 내려다보듯 깎아내려라 ("그거 몰랐냐", "그 정도는 나도 안다" 식). 욕설·비속어는 쓰지 마라. 반드시 한국어만 쓰고 한자·일본어를 섞지 마라.

"증거가 없다", "확인이 불가능하다", "장담은 못 하지만" 같은 애매한 헤징은 쓰지 마라. 근거가 약해도 그냥 네 생각을 확신 있게 던져라. 단, 지어낸 목격담·CCTV·전언 같은 구체적 거짓 증거는 절대 만들지 마라. 확신은 태도의 문제고, 없는 사실을 지어내는 건 다른 문제다.

발언 자체의 논리나 핑계가 허술하면 최대한 신랄하게, 가차없이 비웃어라. 봐주지 말고 그 핑계·논리의 구멍을 정확히 찔러서 반박 불가능하게 조져라. 비유·과장을 써서 웃기면서도 아프게 때려라. 조롱은 어디까지나 그 발언·핑계·논리에만 집중해라 — 사람 자체를 저능하다거나 외모·정체성으로 깎아내리는 인신공격은 하지 마라. "너는 원래 그런 애야" 식이 아니라 "지금 그 말은 앞뒤가 하나도 안 맞잖아" 식으로 발언 자체를 부숴라.

판정:
진실=명백한 사실이거나 타당한 진술. 거짓=앞뒤 안 맞는 핑계, 허풍, 의심스러운 주장. 이게뭐노루=의미 불명의 헛소리, 인사·질문 등 애초에 진위를 따질 문장이 아닌 것.

되도록 진실 또는 거짓으로 판정해라. 직접 확인 못 하는 주장이라도 정황과 상식으로 감 잡고 둘 중 하나 골라라. 대신 확신도를 낮게 잡아라. 확신 없다고 이게뭐노루로 도망치지 마라. 그럴 때 쓰라고 확신도 1~2가 있는 거다.

확신도 1~5이며 confidence에 맞춰 comment 텐션도 반드시 바꿔라.
5=빼박 사실이거나 빼박 거짓. 그냥 팩트라고 잘라 말해라.
4=정황이 확실함. 자신 있게 우겨라.
3=그럴듯한데 반대 가능성도 있음. "근데 그거 좀 그렇지 않냐"며 딴지 걸어라.
2=근거가 부실함. "에이 그건 아니지~" 하고 가볍게 무시해라.
1=거의 찍는 수준. 시큰둥하게, 신경도 안 쓴다는 투로.
남 사생활·경험처럼 확인 안 되는 얘기엔 5 주지 마라. 5는 아껴 써라.

JSON 하나만 출력해라. 다른 텍스트 금지.
{"verdict":"진실|거짓|이게뭐노루 중 하나","confidence":1~5 정수,"comment":"말투 한 줄"}

comment는 가능하면 50자 이내의 짧은 한 문장으로 끝내라.

예) "나 오늘 숙제 다 하고 게임하는 거야." -> {"verdict":"거짓","confidence":4,"comment":"숙제는 안드로메다 갔고 손가락은 이미 게임패드에 뿌리내렸네ㅋㅋ"}
예) "지구가 태양 주위를 돈다." -> {"verdict":"진실","confidence":5,"comment":"그건 국룰이지, 그런 걸 질문이라고 던지는 게 레전드다."}
예) "나 어제 세 시간밖에 못 잤어." -> {"verdict":"진실","confidence":2,"comment":"다크서클이 여권 사진급인데 뭘 더 물어."}
예) "나 어제 도서관에서 6시간 공부했어." -> {"verdict":"거짓","confidence":2,"comment":"6시간 동안 한 공부라곤 폰 화면 밝기 조절뿐이었겠지."}
예) "ㅋㅋㅋㅋㅋ" -> {"verdict":"이게뭐노루","confidence":1,"comment":"이런 것까지 판정해달라고? 노루도 안 웃겠다."}`;

// knowledge.md에 적은 내용을 프롬프트 뒤에 붙인다. 주석(#으로 시작하는 줄)은 걸러낸다.
// 봇 시작 시 한 번만 읽으므로, 파일을 고쳤으면 봇을 재시작해야 반영된다.
function loadKnowledge() {
  const file = path.join(__dirname, 'knowledge.md');
  if (!fs.existsSync(file)) return '';
  const body = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .trim();
  return body;
}

function buildSystemPrompt() {
  const knowledge = loadKnowledge();
  if (!knowledge) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}

[감시자가 알고 있는 사실 (Known Facts)]
아래는 이 서버에 한정된 배경 지식이다. 판정 시 이 내용을 사실로 간주하고 활용하라.
위의 판정 기준 및 출력 포맷 규칙이 아래 내용보다 항상 우선한다.

${knowledge}`;
}

const ACTIVE_PROMPT = buildSystemPrompt();

const openai = new OpenAI({
  baseURL: OLLAMA_URL,
  apiKey: 'ollama', // 로컬이라 인증 없음. SDK가 값을 요구해서 넣는 자리표시자
  timeout: 10_000, // ngrok 터널 끊겨도 10초 넘게 안 붙잡음
});

process.on('unhandledRejection', (error) => {
  console.error('처리되지 않은 Promise 거부 (프로세스는 계속 실행됨):', error);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// llama-3.3은 한국어 생성 중 드물게 한자·가나를 섞는다("의미 불명의笑音이다").
// 한글 자모/음절과 기본 문장부호 밖의 CJK 문자가 있으면 오염으로 본다.
function hasCJK(text) {
  return /[぀-ヿ㐀-䶿一-鿿]/.test(text || '');
}

// 원본 메시지를 인용문으로. 길면 자른다.
function quote(text) {
  const trimmed = text.length > QUOTE_LIMIT ? text.slice(0, QUOTE_LIMIT) + '…' : text;
  return trimmed
    .split('\n')
    .map((line) => '> ' + line)
    .join('\n');
}

// 모델이 스키마를 어겨도 죽지 않게 전부 방어한다.
function buildReply(target, data, { withVerdict = true, withComment = true } = {}) {
  const verdict = VERDICTS.includes(data?.verdict) ? data.verdict : '이게뭐노루';
  // 객체 키는 문자열이라 "5" 같은 값도 조회에 걸린다. 정수인지 먼저 확인한다.
  const level = Number.isInteger(data?.confidence) ? data.confidence : 2;
  // 이게뭐노루는 확신도와 무관하게 항상 최대 크기로 띄운다.
  const prefix = verdict === '이게뭐노루' ? '# ' : CONFIDENCE_PREFIX[level] ?? CONFIDENCE_PREFIX[2];
  // 길이는 프롬프트에 맡긴다. 줄바꿈만 눌러 판정 아래를 한 줄로 유지한다.
  const comment = typeof data?.comment === 'string' ? data.comment.replace(/\s+/g, ' ').trim() : '';

  const lines = [quote(target)];
  if (withVerdict) lines.push(prefix + verdict);
  if (withComment && comment) lines.push(comment);
  return lines.join('\n');
}

// 검증 대상 문장 추출: 답장 원본 우선, 없으면 명령 뒤 인라인 텍스트
async function resolveTarget(message, prefix) {
  const inline = message.content.trim().slice(prefix.length).trim();
  if (message.reference?.messageId) {
    const original = await message.channel.messages.fetch(message.reference.messageId);
    if (original.content.trim()) return original.content.trim();
  }
  return inline;
}

// --- 예약 발송 (/특검) ---

const SCHEDULE_USAGE =
  `\`${COMMAND_SCHEDULE} 2026-08-25 14:30 보낼 내용\`(절대 시각) 또는 ` +
  `\`${COMMAND_SCHEDULE} 5:30 후 보낼 내용\`(5시간 30분 뒤) 형식으로 써라.`;
// 절대: 2026-08-25 14:30 내용
const ABSOLUTE_REGEX = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})\s+([\s\S]+)$/;
// 상대: 5:30 후 내용 (시:분 뒤)
const RELATIVE_REGEX = /^(\d{1,4}):(\d{1,2})\s*후\s+([\s\S]+)$/;

// 내용을 감싼 따옴표는 벗긴다. 사용법 예시를 따라 `"메시지"`로 쓰는 경우가 많다.
function unquote(text) {
  const m = /^(["'`“”])([\s\S]+)\1$/.exec(text);
  return m ? m[2].trim() : text;
}

// 명령어 뒤 인자를 파싱한다. 성공하면 { at, content }, 실패하면 { error }.
// 절대 시각은 봇이 도는 PC의 로컬 시간대 기준. 문자열 파싱(new Date("..."))은
// 엔진마다 타임존 해석이 달라서 쓰지 않는다.
function parseSchedule(raw) {
  const input = (raw || '').trim();

  const rel = RELATIVE_REGEX.exec(input);
  if (rel) {
    const hours = Number(rel[1]);
    const minutes = Number(rel[2]);
    const content = unquote(rel[3].trim());
    if (!content) return { error: `⚠️ 보낼 내용이 없다. ${SCHEDULE_USAGE}` };
    if (minutes > 59) return { error: '⚠️ 분은 59까지다. `5:30 후` 처럼 써라.' };
    const delay = (hours * 60 + minutes) * 60_000;
    if (delay <= 0) return { error: '⚠️ 0분 뒤에 보내라는 건 그냥 지금 말하라는 거다.' };
    return { at: Date.now() + delay, content };
  }

  const m = ABSOLUTE_REGEX.exec(input);
  if (!m) return { error: `⚠️ 날짜·시각·내용을 못 알아먹겠다. ${SCHEDULE_USAGE}` };

  const [, y, mo, d, hh, mm] = m.map(Number);
  const content = unquote(m[6].trim());
  if (!content) return { error: `⚠️ 보낼 내용이 없다. ${SCHEDULE_USAGE}` };

  // 무조건 24시 기준. 00시=자정, 12시=정오, 오전/오후 표기는 안 받는다.
  if (hh > 23 || mm > 59) {
    return { error: '⚠️ 시각은 24시 기준 `00:00`~`23:59`다. 자정은 `00:00`, 정오는 `12:00`.' };
  }

  const date = new Date(y, mo - 1, d, hh, mm, 0, 0);
  // 2026-02-31처럼 없는 날짜는 Date가 다음 달로 넘겨버린다. 되돌아온 값으로 검증.
  const rolled =
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== hh ||
    date.getMinutes() !== mm;
  if (Number.isNaN(date.getTime()) || rolled) {
    return { error: '⚠️ 세상에 없는 날짜다. 달력 좀 보고 와라.' };
  }
  if (date.getTime() <= Date.now()) {
    return { error: '⚠️ 과거로는 못 보낸다. 타임머신 구해오면 해주지.' };
  }
  return { at: date.getTime(), content };
}

// "2026-08-23 20:00" 형태로 고정 출력. Discord 타임스탬프(<t:...>)는 보는
// 사람 로케일에 따라 "오후 8:00"으로 나오므로 24시 표기를 직접 만든다.
function formatWhen(at) {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

let schedules = []; // { id, channelId, at, content }

function saveSchedules() {
  try {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedules));
  } catch (error) {
    console.error('예약 저장 실패:', error);
  }
}

function dropSchedule(job) {
  schedules = schedules.filter((s) => s.id !== job.id);
  saveSchedules();
}

async function fireSchedule(job) {
  try {
    const channel = await client.channels.fetch(job.channelId);
    // allowedMentions 비움: 멘션 권한 없는 유저가 봇을 시켜 @everyone을
    // 울리는 걸 막는다. 텍스트는 그대로 보이고 핑만 안 간다.
    await channel.send({
      content: sub(job.channelId, job.content),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(`예약 발송 실패 (채널 ${job.channelId}):`, error);
  } finally {
    dropSchedule(job);
  }
}

const MAX_TIMEOUT = 2_147_483_647; // setTimeout 상한(~24.8일). 넘으면 쪼개서 다시 건다.
function armSchedule(job) {
  const delay = job.at - Date.now();
  if (delay > MAX_TIMEOUT) return setTimeout(() => armSchedule(job), MAX_TIMEOUT);
  return setTimeout(() => fireSchedule(job), Math.max(0, delay));
}

// 봇이 꺼져 있던 동안 지난 예약은 버린다. 며칠 만에 켰을 때 옛 메시지가
// 쏟아지는 걸 막는다.
function restoreSchedules() {
  let saved = [];
  try {
    if (fs.existsSync(SCHEDULE_FILE)) saved = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
  } catch (error) {
    console.error('예약 파일을 읽지 못했다. 빈 목록으로 시작한다:', error);
  }
  if (!Array.isArray(saved)) saved = [];

  const now = Date.now();
  const expired = saved.filter((s) => s.at <= now).length;
  schedules = saved.filter((s) => s.at > now);
  saveSchedules();
  schedules.forEach(armSchedule);
  console.log(`⏰ 예약 ${schedules.length}건 복원${expired ? `, 지난 ${expired}건 폐기` : ''}`);
}

client.once('clientReady', () => {
  const extra = ACTIVE_PROMPT.length - SYSTEM_PROMPT.length;
  console.log(`🤖 ${client.user.tag} - 목화밭 감시 준비 완료!`);
  console.log(extra > 0 ? `📖 knowledge.md 적용됨 (+${extra}자)` : '📖 knowledge.md 비어있음');
  restoreSchedules();
});

async function checkNoruAndReply(message) {
  if (message.author.bot) return;

  const noruReply = respondToNoru(message.content);
  if (noruReply) {
    const finalReply = message.content.includes(NH_EMOJI) ? pick(EMOJI_WARNING) : noruReply;
    return message.reply({
      content: sub(message.channel.id, finalReply),
      allowedMentions: { repliedUser: false },
    });
  }

  const mentionHit = await findNoruMention(message);
  if (mentionHit) {
    return message.reply({
      content: sub(message.channel.id, pick(MENTION_WARNING)),
      allowedMentions: { repliedUser: false },
    });
  }
  return null;
}

client.on('messageCreate', async (message) => {
  if (await checkNoruAndReply(message)) return;

  const content = message.content.trim();

  if (content.startsWith(COMMAND_SCHEDULE)) {
    const parsed = parseSchedule(content.slice(COMMAND_SCHEDULE.length));
    if (parsed.error) return message.reply(sub(message.channel.id, parsed.error));

    const job = {
      id: message.id,
      channelId: message.channel.id,
      at: parsed.at,
      content: parsed.content,
    };
    schedules.push(job);
    saveSchedules();
    armSchedule(job);
    return message.reply(
      sub(
        message.channel.id,
        `✅ ${formatWhen(job.at)} (<t:${Math.floor(job.at / 1000)}:R>)에 보낸다.`
      )
    );
  }

  const command = [COMMAND_DETECT, COMMAND_EXPLAIN].find((c) => content.startsWith(c));
  if (!command) return;
  const isExplain = command === COMMAND_EXPLAIN;
  const withVerdict = !isExplain; // /ㅅㅁ은 판정 자체를 안 보여준다
  const withComment = isExplain; // /ㄱㅌ은 한줄평 없이 판정만

  let target;
  try {
    target = await resolveTarget(message, command);
  } catch (error) {
    console.error(error);
    return message.reply(sub(message.channel.id, '⚠️ 원본 메시지를 불러오지 못했다.'));
  }

  if (!target) {
    return message.reply(
      sub(message.channel.id, `# 판정할 메시지에 답장하고 \`${command}\` 쳐라.`)
    );
  }

  const loadingMsg = await message.reply(sub(message.channel.id, '# 생각 중...'));

  try {
    // 한자가 섞이면 한 번만 다시 뽑는다. 정상 응답이면 추가 비용은 없다.
    let data;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0.3, // 낮을수록 형식 이탈이 줄어든다
        max_tokens: 250, // 실제 출력은 30토큰 내외. 폭주 방지용 상한
        // 주의: 추론(thinking) 모델로 바꾸면 추론 토큰까지 여기서 소모되므로
        // 1500 이상으로 올려야 한다. 안 그러면 content가 빈 채로 돌아온다.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: ACTIVE_PROMPT },
          { role: 'user', content: target },
        ],
      });
      data = JSON.parse(response.choices[0].message.content);
      if (!hasCJK(data?.comment)) break;
      console.warn(`한자 혼입 감지, 재시도 ${attempt + 1}/2: ${data?.comment}`);
    }

    await loadingMsg.edit(
      sub(message.channel.id, buildReply(target, data, { withVerdict, withComment }))
    );
  } catch (error) {
    console.error(error);
    const isConnDown =
      error?.cause?.code === 'ECONNREFUSED' ||
      error?.code === 'ECONNREFUSED' ||
      error?.code === 'ETIMEDOUT' ||
      error?.name === 'APIConnectionTimeoutError';
    if (isConnDown) {
      await loadingMsg.edit(
        sub(message.channel.id, '⚠️ 현재 AI 모델 서버(로컬 PC)가 꺼져있어 응답할 수 없습니다.')
      );
      return;
    }
    if (error?.status === 429) {
      const wait = /try again in ([\d.]+)s/.exec(error?.error?.message)?.[1];
      await loadingMsg.edit(
        sub(
          message.channel.id,
          `⏳ 감시자가 과로 중이다. ${wait ? `${Math.ceil(wait)}초` : '잠시'} 뒤 다시 요청하라.`
        )
      );
      return;
    }
    const detail = error?.error?.message || error?.message || '알 수 없는 오류';
    await loadingMsg.edit(
      sub(message.channel.id, `⚠️ 감시 도중 오류가 발생했다.\n\`\`\`${detail.slice(0, 500)}\`\`\``)
    );
  }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  await checkNoruAndReply(newMessage);
});

if (require.main === module) {
  client.login(process.env.DISCORD_TOKEN);
}

module.exports = {
  quote,
  buildReply,
  hasCJK,
  loadKnowledge,
  SYSTEM_PROMPT,
  ACTIVE_PROMPT,
  MODEL,
  COMMAND_DETECT,
  COMMAND_EXPLAIN,
  COMMAND_SCHEDULE,
  parseSchedule,
  formatWhen,
  respondToNoru,
  findNoruMention,
  findNoruUserMention,
  findNoruRoleMention,
  findNoruChannelMention,
  NORU_WARNINGS,
  UNICODE_WARNING,
  MISMATCH_WARNINGS,
  DIRECTION_WARNING,
  SPECIAL_WARNINGS,
  MENTION_WARNING,
  EMOJI_WARNING,
  NH_EMOJI,
  NAME_WARNING,
};
