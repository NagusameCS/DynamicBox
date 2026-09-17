# DynamicBox

Examples that type themselves into a field, editing only what changed.

A text field that invites a question is more inviting when it shows one. But a
placeholder holds one string, and a slideshow of unrelated questions reads as noise.
What reads as *thought* is editing: keep the part of the previous example that still
applies, change the rest.

From `where do we use greedy?` the field becomes `where do we use levenshtein?` by
deleting six characters and typing twelve. The shared stem never flickers, because it
was never removed:

```
where do we use greedy?
where do we use
where do we use levenshtein?
```

Open `demo/index.html` to watch it. No server, no build step, no dependencies.

## Use it

```js
import { TypeBox } from 'dynamicbox';

new TypeBox({
  el: document.querySelector('#ask'),
  examples: [
    'where do we use greedy?',
    'where do we use levenshtein?',
    'how is an inbound email verified?',
  ],
}).start();
```

That is the whole API for the common case. The field's **placeholder** is animated, not
its value, so nothing a reader types can be confused with a suggestion. Touching the
field stops the animation for good and leaves a complete example behind — a field that
keeps typing while someone is thinking is hostile.

## What it does

**1. Orders the examples.** Greedy nearest neighbour by shared prefix, tried from every
possible starting example, then reversal moves while they save characters. The measure
is the cost of a whole loop, including the step that returns to the first example:
costing the loop rather than the line is what stops a short example being promoted to
first place for no reason. Ties break on position and improvements must be strict, so
the same examples always produce the same chain — a page built twice types the same way
twice.

**2. Stores the order as a script.** One record per step: `delete this many characters
off the end, then append this`. The shared part of two adjacent examples is stored once.
Seven examples that cluster into two groups pack into 199 characters against 236 for the
same list as JSON, and the format is what the animator reads, so there is nothing to
expand at runtime.

**3. Plays it.** A character at a time, with a little unevenness so no two characters
land on the same beat. Deletion starts slow and quickens, which reads as someone
changing their mind about a word rather than a buffer being cleared, and the beat
afterwards is placed *before* the new text — so the half-finished line is what gets the
pause. That beat is the whole effect: without it the shared stem is a flicker.

## API

| Export | What it is |
| --- | --- |
| `TypeBox` | Plays a set of examples into an element. |
| `plan(examples, options)` | `{ order, steps, wrap, cost }` — the ordering and the edits between. |
| `cycleCost(order)` | What one time round an ordering costs, in characters. |
| `commonPrefix(a, b)` | Characters two strings share at the start. |
| `encode(steps)` / `decode(text)` | The script as one string, and back. |
| `replay(steps)` | The examples a script produces. |
| `script(examples, options)` | `plan` and `encode` in one call. |
| `wrapStep(order)` | The step that closes the loop. |

### `TypeBox` options

| Option | Default | Notes |
| --- | --- | --- |
| `el` | — | Required. Anything with a `placeholder`, `value` or `textContent`. |
| `examples` | `[]` | What to play. Repeats are dropped, order does not matter. |
| `script` | — | A packed script instead of examples. Roughly a third of the cost. |
| `mode` | `'placeholder'` | Also `'value'` and `'text'`. Do not use `'value'` on a form field. |
| `typeMs`, `delMs` | `52`, `85` | Per character. Deleting is deliberately unhurried. |
| `delBudgetMs`, `delPerCharBudgetMs` | `320`, `45` | What one deletion run may take in total, so a long one does not drag. |
| `holdMs`, `lastHoldMs` | `2000`, `2400` | Sitting on a finished example, plus 18 ms per character. |
| `afterDeleteMs` | `260` | The beat, plus 24 ms per character deleted, capped at 700. |
| `jitter` | `0.35` | Unevenness. Set `0` with a fixed `random` to make tests exact. |
| `random`, `timers` | `Math.random`, real timers | Injectable, so playback can be tested against a virtual clock. |
| `stopOnInput` | `true` | Stop for good on focus, pointer, key or input. |
| `respectReducedMotion` | `true` | No motion at all; the first example is shown as a still. |

Methods: `start()`, `stop()`, `pause()`, `resume()`, `destroy()`. Getters: `order`,
`text`, `stopped`. `onChange(text)` is called on every character, which is how the demo
highlights the example currently on screen.

## The packed format

```
<delete>.<insert length>:<insert>   repeated

0.23:where do we use greedy?7.12:levenshtein?
```

A length prefix rather than a separator, because an example may contain any character at
all — including whichever separator looked unlikely at the time. Reading it is
unambiguous: digits, a dot, digits, a colon, then exactly that many characters. Anything
encodes, and anything encoded decodes back to the same records; a malformed script throws
rather than being guessed at.

## Inlinable on purpose

`src/dynamicbox.mjs` contains no backticks, no `${` interpolation and no import
statements, and a test enforces all three. A host that assembles its page with
`String.raw` can paste the module into a template literal and get a working page with no
bundler, which is how the demo is built — `tools/demo.mjs` concatenates the library and
the demo's script into one file that opens from a `file://` URL.

## Tests

```sh
npm test     # 20 tests, no network, no waiting
```

Playback is tested against an injectable virtual clock rather than by sleeping, because
an animation test that depends on real time flakes on a loaded machine and a suite that
sleeps for fifteen seconds is a suite nobody runs. That is also the only way to assert
the thing that matters most: the exact sequence of strings the field passes through,
including the shared stem, which is on screen for a few hundred milliseconds.

One test counts every character changed across a full loop off the states the field
passed through and compares it with the planner's own estimate of the loop. If the
animation ever spends more than the ordering promised, the two disagree.

## Demo

`demo/index.html` is generated — run `npm run demo` after editing `src/` or
`demo/app.js`. It is committed so the repository is openable as-is.

## License

MIT.
