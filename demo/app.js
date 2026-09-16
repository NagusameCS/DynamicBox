// The demo's behaviour.
//
// tools/demo.mjs concatenates this file directly after src/dynamicbox.mjs inside one
// module script, which is why there is no import statement here: after concatenation
// the library's exports are simply declarations in the same scope. That is also how
// the demo runs from a file:// URL with no server and no build step.

const $ = (id) => document.getElementById(id);

const DEMO = [
  'where do we use greedy?',
  'where do we use levenshtein?',
  'where do we use dynamic programming?',
  'where do we use depth-first search?',
  'how is an inbound email verified?',
  'how does the pack get built?',
  'what changed in the last build?',
];

const ask = $('ask');
let examples = DEMO.slice();
let box = null;
let scale = 1;
let paused = false;

/** Everything the demo shows about a set of examples, recomputed in one place. */
function stats(items) {
  const { order, steps, cost } = plan(items);
  return {
    order,
    packed: encode(steps),
    loop: order.length === 0 ? 0 : order[0].length + cost,
    json: JSON.stringify(items).length,
    steps,
  };
}

function paint(text) {
  for (const row of document.querySelectorAll('ol.order li')) row.classList.toggle('on', row.dataset.text === text);
  $('state').textContent = box && box.stopped ? 'stopped: you touched the field' : '';
}

/** Build a fresh box, because a stopped one stays stopped by design. */
function play() {
  if (box) box.destroy();
  if (examples.length === 0) {
    ask.placeholder = 'add at least one example';
    return;
  }
  box = new TypeBox({
    el: ask,
    examples,
    typeMs: 46 * scale,
    delMs: 26 * scale,
    holdMs: 2000 * scale,
    lastHoldMs: 2400 * scale,
    afterDeleteMs: 260 * scale,
    onChange: paint,
  });
  box.start();
  $('pause').textContent = 'Pause';
  paused = false;
}

function render() {
  const { order, packed, loop, json } = stats(examples);

  $('order').innerHTML = order.map((item, index) => {
    const note = index === 0 ? 'typed first' : 'edit of ' + stepsBetween(order[index - 1], item) + ' characters';
    return '<li data-text="' + escapeAttr(item) + '"><span>' + escapeHtml(item) + '</span><em style="color:var(--faint);font-style:normal;font-size:12.5px;margin-left:auto">' + note + '</em></li>';
  }).join('') || '<li>nothing to show</li>';

  $('packed').textContent = packed || '(empty)';
  $('sizes').innerHTML = [
    ['examples', examples.length],
    ['characters typed and deleted per loop', loop],
    ['as a packed script', packed.length + ' characters'],
    ['written out as JSON', json + ' characters'],
  ].map(([label, value]) => '<tr><td>' + escapeHtml(String(label)) + '</td><td>' + escapeHtml(String(value)) + '</td></tr>').join('');
}

/** How many characters one example has to give up to become the next. */
function stepsBetween(from, to) {
  const keep = commonPrefix(from, to);
  return (from.length - keep) + (to.length - keep);
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

function use(items) {
  examples = items;
  $('source').value = items.join('\n');
  render();
  play();
}

$('again').onclick = () => play();
$('pause').onclick = () => {
  if (!box) return;
  paused = !paused;
  if (paused) box.pause();
  else box.resume();
  $('pause').textContent = paused ? 'Resume' : 'Pause';
};
$('slow').onclick = () => {
  scale = scale === 1 ? 2 : 1;
  $('slow').textContent = scale === 1 ? 'Slower' : 'Normal speed';
  play();
};
$('apply').onclick = () => {
  const items = $('source').value.split('\n').map((line) => line.trim()).filter(Boolean);
  use(items);
};
$('reset').onclick = () => use(DEMO.slice());

use(DEMO.slice());
