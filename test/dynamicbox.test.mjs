// Tests for DynamicBox.
//
// Playback is tested against a virtual clock rather than by waiting, for two
// reasons: a suite that sleeps for fifteen seconds is a suite nobody runs, and an
// animation test that depends on real time flakes on a loaded machine. The clock is
// also the only way to assert the thing that matters most here -- the exact sequence
// of strings the field passes through -- because the interesting states last a few
// hundred milliseconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commonPrefix, plan, cycleCost, encode, decode, replay, script, wrapStep, TypeBox } from '../src/dynamicbox.mjs';

/* ---------- harness ---------- */

/** A clock that only moves when told to, and runs work in time order. */
function clock() {
  let now = 0;
  let nextId = 0;
  let queue = [];
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const handle = { id: (nextId += 1), at: now + Math.max(0, Math.round(ms || 0)), fn };
      queue.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      queue = queue.filter((item) => item !== handle);
    },
    /** Run scheduled work in time order, at most `limit` tasks and none after `until`. */
    run(until = Infinity, limit = 100000) {
      let ran = 0;
      while (ran < limit) {
        queue.sort((a, b) => a.at - b.at || a.id - b.id);
        const item = queue[0];
        if (!item || item.at > until) break;
        now = Math.max(now, item.at);
        queue = queue.slice(1);
        item.fn();
        ran += 1;
      }
      return ran;
    },
  };
}

/** The smallest element TypeBox will accept. */
function field() {
  const listeners = new Map();
  return {
    placeholder: '',
    value: '',
    textContent: '',
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    },
    fire(type) {
      for (const fn of [...(listeners.get(type) || [])]) fn();
    },
    count(type) {
      return (listeners.get(type) || new Set()).size;
    },
  };
}

/** No jitter, so the sequence of states is the same on every machine. */
const steady = { random: () => 0.5 };

const ASKS = [
  'where do we use greedy?',
  'where do we use levenshtein?',
  'how is an inbound email verified?',
];

/* ---------- prefix arithmetic ---------- */

test('commonPrefix counts what the two strings share at the start', () => {
  assert.equal(commonPrefix('where do we use greedy?', 'where do we use levenshtein?'), 16);
  assert.equal(commonPrefix('abc', 'abc'), 3);
  assert.equal(commonPrefix('abc', ''), 0);
  assert.equal(commonPrefix('', ''), 0);
  assert.equal(commonPrefix('abc', 'abd'), 2);
  assert.equal(commonPrefix('abc', 'xyz'), 0);
});

/* ---------- ordering ---------- */

test('examples sharing a stem end up side by side', () => {
  const items = [
    'how is an inbound email verified?',
    'where do we use greedy?',
    'where is the pack built?',
    'where do we use levenshtein?',
  ];
  const { order } = plan(items);
  const a = order.indexOf('where do we use greedy?');
  const b = order.indexOf('where do we use levenshtein?');
  const apart = Math.abs(a - b);
  // Either next to each other, or across the join where the loop wraps round --
  // which is the same adjacency one step later in the animation.
  assert.ok(apart === 1 || apart === items.length - 1, 'expected adjacency, got ' + apart);
});

test('ordering never costs more than leaving the examples as they came', () => {
  const { order, cost } = plan(ASKS);
  assert.ok(cost <= cycleCost(ASKS));
  assert.equal(order.length, ASKS.length);
  assert.deepEqual([...order].sort(), [...ASKS].sort());
});

test('ordering is the cheapest loop available, not merely a cheap one', () => {
  // Six permutations of four examples once rotations are discounted, so the optimum
  // can simply be enumerated and compared.
  const items = [...ASKS, 'where do we use dynamic programming?'];
  const permutations = (list) => (list.length <= 1
    ? [list]
    : list.flatMap((item, i) => permutations(list.slice(0, i).concat(list.slice(i + 1))).map((rest) => [item, ...rest])));
  const exhaustive = permutations(items.slice(1)).map((rest) => cycleCost([items[0], ...rest]));
  assert.equal(plan(items).cost, Math.min(...exhaustive));
});

test('the same examples always produce the same chain', () => {
  const first = plan(ASKS);
  const second = plan([...ASKS]);
  assert.deepEqual(first.order, second.order);
  assert.equal(encode(first.steps), encode(second.steps));
});

test('repeats are dropped rather than retyped at themselves', () => {
  const { order } = plan(['a question?', 'a question?', 'another?']);
  assert.deepEqual(order, ['a question?', 'another?']);
  assert.equal(plan([]).order.length, 0);
  assert.equal(plan(['only one?']).wrap, null);
});

test('a single example has no loop to find', () => {
  assert.equal(cycleCost(['alone?']), 0);
  assert.equal(wrapStep(['alone?']), null);
});

test('a chain rebuilds from its steps, including the closing step', () => {
  const { order, steps, wrap } = plan(ASKS);
  assert.deepEqual(replay(steps), order);
  // The closing step is the one that comes back to the first example, which is what
  // makes the animation a loop rather than a list that stops at the end.
  assert.deepEqual(replay([...steps, wrap])[steps.length], order[0]);
});

/* ---------- storage ---------- */

test('a packed script round-trips, awkward characters and all', () => {
  const steps = [
    { del: 0, ins: 'where do we use greedy?' },
    { del: 6, ins: 'levenshtein?' },
    { del: 12, ins: '' },
    { del: 0, ins: 'pipes | and dots . and colons : and 0.0:0' },
    { del: 30, ins: 'unicode: \u00e9\u4e2d\u6587\ud83d\ude00' },
    { del: 1, ins: 'a' },
  ];
  assert.deepEqual(decode(encode(steps)), steps);
  assert.deepEqual(replay(decode(encode(steps))), replay(steps));
});

test('an empty script decodes to nothing', () => {
  assert.deepEqual(decode(''), []);
  assert.deepEqual(decode(encode([])), []);
});

test('a malformed script is refused rather than guessed at', () => {
  assert.throws(() => decode('nonsense'), /malformed/);
  assert.throws(() => decode('0.99:short'), /ends early/);
});

test('the packed form is smaller than the examples written out', () => {
  const names = ['greedy', 'levenshtein', 'dynamic programming', 'backtracking', 'depth-first search', 'memoisation'];
  const items = names.map((name) => 'where do we use ' + name + '?');
  const packed = script(items);
  assert.ok(packed.length < JSON.stringify(items).length, 'packed ' + packed.length + ' vs json ' + JSON.stringify(items).length);
  assert.deepEqual(replay(decode(packed)), plan(items).order);
});

/* ---------- playback ---------- */

test('the field passes through the shared stem rather than flickering', () => {
  const el = field();
  const clocked = clock();
  const states = [];
  const box = new TypeBox({
    el,
    examples: ['where do we use greedy?', 'where do we use levenshtein?'],
    timers: clocked,
    onChange: (text) => states.push(text),
    ...steady,
  });
  box.start();

  // One task at a time until the second example has arrived. Nothing is written
  // synchronously by start(): the first character is scheduled, not painted, so the
  // clock has to be stepped rather than simply read.
  let guard = 0;
  while (!states.includes('where do we use levenshtein?') && guard++ < 10000) clocked.run(Infinity, 1);
  assert.ok(states.includes('where do we use greedy?'));
  assert.ok(states.includes('where do we use '), 'the shared stem was never on screen');
  assert.ok(guard < 10000, 'the animation never reached the second example');
});

test('one time round costs exactly what the planner promised', () => {
  const el = field();
  const clocked = clock();
  const states = [];
  const box = new TypeBox({ el, examples: ASKS, timers: clocked, onChange: (text) => states.push(text), ...steady });
  const { order, cost } = plan(ASKS);
  box.start();

  // Run until the first example has arrived a second time: exactly one cycle. Only a
  // task that actually changed the field counts, because the hold after a finished
  // example runs without writing anything and would otherwise be counted twice.
  let seenFirst = 0;
  let guard = 0;
  while (seenFirst < 2 && guard++ < 20000) {
    const before = states.length;
    if (clocked.run(Infinity, 1) === 0) break;
    if (states.length > before && states[states.length - 1] === order[0]) seenFirst += 1;
  }
  assert.equal(seenFirst, 2);
  // Every character the field was made to change, counted off the states it passed
  // through, against the planner's own measure of the loop.
  const spent = states.reduce((sum, state, i) => (i === 0 ? state.length : sum + editSpend(states[i - 1], state)), 0);
  assert.equal(spent, order[0].length + cost);
});

/** Characters touched in moving from one state to the next. */
function editSpend(from, to) {
  const keep = commonPrefix(from, to);
  return (from.length - keep) + (to.length - keep);
}

test('the field is left alone the moment a reader touches it', () => {
  const el = field();
  const clocked = clock();
  const box = new TypeBox({ el, examples: ASKS, timers: clocked, ...steady });
  box.start();
  clocked.run(200, 12);
  el.fire('focus');
  assert.equal(box.stopped, true);
  assert.equal(el.placeholder, plan(ASKS).order[0]);
  const frozen = el.placeholder;
  clocked.run(60000);
  assert.equal(el.placeholder, frozen);
  assert.equal(el.count('focus'), 0); // listeners detached, not merely ignored
});

test('reduced motion shows the first example as a still', () => {
  globalThis.matchMedia = () => ({ matches: true });
  try {
    const el = field();
    const clocked = clock();
    new TypeBox({ el, examples: ASKS, timers: clocked, ...steady }).start();
    assert.equal(el.placeholder, ASKS[0]);
    assert.equal(clocked.run(60000), 0); // nothing scheduled at all
  } finally {
    delete globalThis.matchMedia;
  }
});

test('a single example is typed once and then holds', () => {
  const el = field();
  const clocked = clock();
  let writes = 0;
  new TypeBox({ el, examples: ['only one?'], timers: clocked, onChange: () => (writes += 1), ...steady }).start();
  clocked.run(120000);
  assert.equal(el.placeholder, 'only one?');
  assert.equal(writes, 'only one?'.length);
});

test('a field with nothing to type into is refused', () => {
  assert.throws(() => new TypeBox({ examples: ASKS }), /needs an element/);
});

test('stopping during a write does not leave a timer running', () => {
  const el = field();
  const clocked = clock();
  const box = new TypeBox({
    el,
    examples: ASKS,
    timers: clocked,
    ...steady,
    onChange: (text) => { if (text.length > 3) box.stop(); },
  });
  box.start();
  clocked.run(60000);
  assert.equal(box.stopped, true);
});

/* ---------- the module's own contract ---------- */

test('the module can be pasted inside a template literal', () => {
  const source = readFileSync(new URL('../src/dynamicbox.mjs', import.meta.url), 'utf8');
  // A host that assembles its page with String.raw cannot inline a file containing
  // either of these, and the failure would be silent: it would close the template.
  assert.equal(source.includes('`'), false, 'source contains a backtick');
  assert.equal(source.includes('${'), false, 'source contains an interpolation');
  assert.equal(/^\s*import\s/m.test(source), false, 'source imports something');
  assert.equal(/^\s*export\s+\{[^}]*\}\s+from\s/m.test(source), false, 'source re-exports something');
});
