// 판정 출력 형식 자체 검증. 실행: node selftest.js
const assert = require('assert');
const {
  quote,
  buildReply,
  hasCJK,
  loadKnowledge,
  SYSTEM_PROMPT,
  ACTIVE_PROMPT,
} = require('./index');

const T = '숙제 다 했어';


// 한자·가나 감지: 실제로 나왔던 오염 사례를 잡아야 한다
assert.ok(hasCJK('의미 불명의笑音이다.'), '한자 못 잡음');
assert.ok(hasCJK('서버 내的事實을 알고 있다'), '한자 못 잡음');
assert.ok(hasCJK('それは嘘だ'), '일본어 못 잡음');
// 정상 한국어는 오탐이 없어야 한다 (자모, 문장부호, 숫자, 이모지 포함)
for (const ok of ['핑계 대지 마라.', 'ㅋㅋㅋ 웃기지 마라!', '3시간? 증거를 대라~', '🟢 진실이다']) {
  assert.ok(!hasCJK(ok), `오탐: ${ok}`);
}

// 주석만 있는 knowledge.md는 프롬프트에 아무것도 붙이지 않는다
if (!loadKnowledge()) {
  assert.strictEqual(ACTIVE_PROMPT, SYSTEM_PROMPT, '빈 knowledge.md인데 프롬프트가 늘어났다');
} else {
  assert.ok(ACTIVE_PROMPT.length > SYSTEM_PROMPT.length, 'knowledge.md 내용이 프롬프트에 안 붙었다');
  assert.ok(ACTIVE_PROMPT.includes(loadKnowledge()), 'knowledge.md 본문이 프롬프트에 없다');
}


// 확신도 5단계가 각각 올바른 마크다운 접두를 만든다
const expected = { 5: '# 거짓', 4: '## 거짓', 3: '### 거짓', 2: '거짓', 1: '-# 거짓' };
for (const [confidence, line] of Object.entries(expected)) {
  const out = buildReply(T, { verdict: '거짓', confidence: Number(confidence), comment: '핑계 마라.' });
  assert.strictEqual(out, `> ${T}\n${line}\n핑계 마라.`, `확신도 ${confidence} 접두 불일치: ${out}`);
}

// 이게뭐노루는 확신도와 무관하게 항상 "# "
for (const c of [1, 2, 3, 4, 5]) {
  const out = buildReply(T, { verdict: '이게뭐노루', confidence: c, comment: '헛소리다.' });
  assert.strictEqual(out, `> ${T}\n# 이게뭐노루\n헛소리다.`, `이게뭐노루 확신도 ${c} 접두 불일치: ${out}`);
}
// 확신도가 깨져도 마찬가지
assert.ok(buildReply(T, { verdict: '이게뭐노루', confidence: 'x' }).includes('# 이게뭐노루'));
// 알 수 없는 판정도 이게뭐노루로 떨어지므로 "# "가 붙는다
assert.ok(buildReply(T, { verdict: '아마도', confidence: 1 }).includes('# 이게뭐노루'));

// 여러 줄 원본은 모든 줄에 "> "가 붙는다
assert.strictEqual(quote('첫 줄\n둘째 줄'), '> 첫 줄\n> 둘째 줄');

// 길이 제한 초과 시 잘리고 말줄임표가 붙는다
const long = 'ㄱ'.repeat(500);
const quoted = quote(long);
assert.ok(quoted.endsWith('…'), '말줄임표 없음');
assert.strictEqual(quoted.length, 2 + 300 + 1, `자르기 실패: ${quoted.length}`);

// --- 모델이 스키마를 어긴 경우 (봇이 죽으면 안 된다) ---

// 알 수 없는 판정 -> 이게뭐노루로 대체
assert.ok(buildReply(T, { verdict: '아마도', confidence: 5 }).includes('# 이게뭐노루'));

// 범위 밖 / 잘못된 타입 확신도 -> 접두 없음(2단계)으로 대체
for (const bad of [0, 6, 99, -1, 3.5, '5', null, undefined]) {
  const out = buildReply(T, { verdict: '진실', confidence: bad });
  assert.strictEqual(out, `> ${T}\n진실`, `잘못된 확신도 ${bad} 처리 실패: ${out}`);
}

// comment가 없거나 비면 그 줄을 생략한다
assert.strictEqual(buildReply(T, { verdict: '진실', confidence: 2, comment: '   ' }), `> ${T}\n진실`);

// withComment: false -> comment 있어도 출력 안 됨 (/ㄱㅌ용)
assert.strictEqual(
  buildReply(T, { verdict: '진실', confidence: 2, comment: '한줄평이다' }, { withComment: false }),
  `> ${T}\n진실`
);

// withVerdict: false -> 판정 줄 없이 인용+한줄평만 (/ㅅㅁ용)
assert.strictEqual(
  buildReply(T, { verdict: '진실', confidence: 5, comment: '설명이다' }, { withVerdict: false }),
  `> ${T}\n설명이다`
);

// comment 안의 줄바꿈은 한 줄로 눌린다 (판정 아래는 항상 한 줄)
assert.strictEqual(
  buildReply(T, { verdict: '진실', confidence: 2, comment: '앞\n뒤' }),
  `> ${T}\n진실\n앞 뒤`
);

// 응답 자체가 비정상이어도 문자열을 돌려준다
assert.ok(buildReply(T, null).includes('이게뭐노루'));
assert.ok(buildReply(T, {}).includes('이게뭐노루'));

console.log('셀프테스트 통과');
