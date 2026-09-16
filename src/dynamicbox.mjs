// DynamicBox -- examples that type themselves into a field.
//
// The problem is small and specific. A text field that invites a question is more
// inviting when it shows one, but a placeholder holds one string and a slideshow
// of unrelated strings reads as noise. What reads as thought is *editing*: keeping
// the part of the previous example that still applies and changing only the part
// that does not. Ask "where do we use greedy?", and a moment later the same line
// becomes "where do we use levenshtein?" -- six characters deleted, twelve typed,
// and the shared stem never flickers.
//
// So this module does three things:
//
//   1. orders the examples so consecutive ones share as much as possible,
//   2. turns that order into a minimal edit script -- delete n characters off the
//      end, then append this -- which is also the smallest way to store them,
//   3. plays the script into a field a character at a time, with a beat where the
//      deletion happened, because the pause is the part that looks deliberate.
//
// No dependencies, no build step. And deliberately no backticks and no template
// interpolation anywhere in this file: the whole module can be pasted inside a
// template literal, which is how a host that assembles its page as String.raw can
// inline it without a bundler. (That host's build refuses to write a page
// containing a backtick, so this is a real constraint and not a style choice.)

/** Timing functions, swappable so that playback can be tested without waiting. */
function defaultTimers() {
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
}

/**
 * How many characters two strings share at the start.
 *
 * Compared by code unit rather than by grapheme, which is the right unit here:
 * the animation deletes code units one at a time, so the prefix it can keep is
 * exactly the prefix that would survive that deletion.
 */
export function commonPrefix(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

/** Same list with repeats dropped, first sighting wins, order kept. */
function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const text = String(item == null ? '' : item);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/**
 * The order to play examples in, and the edit between each.
 *
 * Two passes. First a greedy walk: from each possible starting example, always step
 * to whichever example left shares the longest prefix with the one on screen. Then a
 * reversal pass, which is cheap because the measure is symmetric -- reversing a run
 * of examples leaves every prefix inside the run unchanged, so only the two edits at
 * the run's ends are affected and a whole run can be accepted or rejected by one
 * comparison.
 *
 * The measure is the cost of a full cycle, including the step that returns to the
 * first example. Costing the loop rather than the line is what stops the ordering
 * being rewarded for starting on a short string: whichever example goes first, it has
 * to be typed and deleted once per time round. Trying every start is not a search
 * either -- there are a dozen examples and the walk is linear, so trying them all
 * costs nothing and removes the one thing a hand-picked starting point would
 * otherwise decide for the caller, which is whether the effect looks good.
 *
 * Ties break on position and improvements must be strict, so the same examples always
 * produce the same chain: a page built twice types the same way twice.
 */
export function plan(examples, options = {}) {
  const items = dedupe(examples || []);
  if (items.length === 0) return { order: [], steps: [], wrap: null, cost: 0 };

  const starts = options.start && items.indexOf(options.start) !== -1 ? [options.start] : items;
  let best = null;
  for (const start of starts) {
    const order = improve(walk(items, start));
    const cost = cycleCost(order);
    if (best === null || cost < best.cost) best = { order, cost };
  }
  best.steps = stepsFor(best.order);
  best.wrap = items.length > 1 ? editBetween(best.order[items.length - 1], best.order[0]) : null;
  return best;
}

/** What one time round the examples costs, in characters typed and deleted. */
export function cycleCost(order) {
  if (order.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < order.length; i += 1) sum += editCost(order[i], order[(i + 1) % order.length]);
  return sum;
}

/** Swap runs of examples around while it saves characters. */
function improve(order) {
  let best = order;
  let bestCost = cycleCost(best);
  let improved = true;
  // Three examples have only one shape of loop to be found, once rotations and
  // reversals are discounted, so there is nothing left to try below four.
  while (improved && best.length > 3) {
    improved = false;
    for (let i = 0; i < best.length - 1; i += 1) {
      for (let j = i + 1; j < best.length; j += 1) {
        const candidate = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        const cost = cycleCost(candidate);
        if (cost < bestCost) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return best;
}

/** Greedy path through the examples: always step to the closest one left. */
function walk(items, start) {
  const left = items.filter((item) => item !== start);
  const order = [start];
  let at = start;
  while (left.length > 0) {
    let pick = 0;
    let bestShared = -1;
    for (let i = 0; i < left.length; i += 1) {
      const shared = commonPrefix(at, left[i]);
      if (shared > bestShared) {
        bestShared = shared;
        pick = i;
      }
    }
    at = left[pick];
    order.push(at);
    left.splice(pick, 1);
  }
  return order;
}

/** The edit that turns one string into another: what to delete off the end, what to add. */
function editBetween(from, to) {
  const keep = commonPrefix(from, to);
  return { del: from.length - keep, ins: to.slice(keep) };
}

/** What one edit costs, in characters. */
function editCost(from, to) {
  const keep = commonPrefix(from, to);
  return (from.length - keep) + (to.length - keep);
}

/** A chain of examples as steps, the first of which starts from an empty field. */
function stepsFor(order) {
  const steps = [{ del: 0, ins: order[0] }];
  for (let i = 1; i < order.length; i += 1) steps.push(editBetween(order[i - 1], order[i]));
  return steps;
}

/** The step that closes the loop, from the last example back to the first. */
export function wrapStep(order) {
  if (order.length < 2) return null;
  return editBetween(order[order.length - 1], order[0]);
}

/**
 * The script as a single string.
 *
 * Each record is "<delete>.<length>:<text>", and the reason for a length prefix
 * rather than a separator is that a question may contain any character at all --
 * including whatever separator looked unlikely. Reading it is unambiguous: digits,
 * a dot, digits, a colon, then exactly that many characters. Any record set
 * encodes, and any encoded string decodes back to the same records.
 *
 * The saving is not the point; the point is that the shared part of two adjacent
 * examples is stored once. Twelve questions that all begin "where do we use "
 * carry that phrase once instead of twelve times.
 */
export function encode(steps) {
  let out = '';
  for (const step of steps) out += step.del + '.' + step.ins.length + ':' + step.ins;
  return out;
}

/** The inverse of encode. Throws rather than guessing at a malformed script. */
export function decode(text) {
  const source = String(text == null ? '' : text);
  const steps = [];
  let i = 0;
  while (i < source.length) {
    const dot = source.indexOf('.', i);
    const colon = dot === -1 ? -1 : source.indexOf(':', dot + 1);
    if (dot === -1 || colon === -1) throw new Error('dynamicbox: malformed script at ' + i);
    const del = Number(source.slice(i, dot));
    const length = Number(source.slice(dot + 1, colon));
    if (!Number.isInteger(del) || !Number.isInteger(length) || del < 0 || length < 0) {
      throw new Error('dynamicbox: malformed script at ' + i);
    }
    const start = colon + 1;
    const end = start + length;
    if (end > source.length) throw new Error('dynamicbox: script ends early at ' + i);
    steps.push({ del, ins: source.slice(start, end) });
    i = end;
  }
  return steps;
}

/** The examples a script produces, so a script alone is enough to play it. */
export function replay(steps) {
  const out = [];
  let at = '';
  for (const step of steps) {
    at = at.slice(0, at.length - step.del) + step.ins;
    out.push(at);
  }
  return out;
}

/** Plan and encode in one call: the smallest thing a host has to store or ship. */
export function script(examples, options) {
  return encode(plan(examples, options).steps);
}

/**
 * Plays a script into a field.
 *
 * The field keeps its own placeholder until start() is called, and gets a complete
 * example back the moment a reader touches it, because a field that keeps typing
 * while someone is thinking is hostile. What it types is decoration: the element's
 * value stays empty unless mode is "value", and the caller is told not to use that
 * mode for a form field for exactly that reason.
 */
export class TypeBox {
  #el;
  #mode;
  #steps;
  #order;
  #chain = [];
  #i = 0;
  #at = 0;
  #shown = '';
  #timer = null;
  #paused = false;
  #stopped = false;
  #started = false;
  #listeners = [];
  #options;

  constructor(options = {}) {
    if (!options.el) throw new Error('dynamicbox: TypeBox needs an element to type into');
    this.#el = options.el;
    this.#mode = options.mode || 'placeholder';
    this.#options = {
      typeMs: options.typeMs == null ? 46 : options.typeMs,
      delMs: options.delMs == null ? 26 : options.delMs,
      holdMs: options.holdMs == null ? 2000 : options.holdMs,
      lastHoldMs: options.lastHoldMs == null ? 2400 : options.lastHoldMs,
      holdPerCharMs: options.holdPerCharMs == null ? 18 : options.holdPerCharMs,
      holdCapMs: options.holdCapMs == null ? 3400 : options.holdCapMs,
      afterDeleteMs: options.afterDeleteMs == null ? 260 : options.afterDeleteMs,
      afterDeletePerCharMs: options.afterDeletePerCharMs == null ? 24 : options.afterDeletePerCharMs,
      afterDeleteCapMs: options.afterDeleteCapMs == null ? 900 : options.afterDeleteCapMs,
      jitter: options.jitter == null ? 0.35 : options.jitter,
      random: options.random || Math.random,
      timers: options.timers || defaultTimers(),
      onChange: options.onChange || null,
      stopOnInput: options.stopOnInput !== false,
      respectReducedMotion: options.respectReducedMotion !== false,
    };
    const steps = options.script != null ? decode(options.script) : plan(options.examples || [], { start: options.start }).steps;
    this.#steps = steps;
    this.#order = replay(steps);
    // Everything laid out as one sequence that can be walked from the start and
    // then repeated from position 1. The first pass types every example; the step
    // that closes the loop brings back the first one; from there it cycles.
    this.#chain = steps.map((step, index) => ({ del: step.del, ins: step.ins, land: index }));
    const wrap = wrapStep(this.#order);
    if (wrap) this.#chain.push({ del: wrap.del, ins: wrap.ins, land: 0 });
  }

  /** The examples in the order they will be played. */
  get order() {
    return this.#order.slice();
  }

  /** What is on the field right now. */
  get text() {
    return this.#shown;
  }

  /** True once the reader has touched the field, or stop() was called. */
  get stopped() {
    return this.#stopped;
  }

  start() {
    if (this.#stopped) return this;
    this.#started = true;
    if (this.#order.length === 0) return this;
    // Reduced motion means no motion. The information is the useful half of this
    // feature, so the first example is still shown -- as a still.
    if (this.#reduced()) {
      this.#shown = this.#order[0];
      this.#write();
      return this;
    }
    if (this.#options.stopOnInput) this.#watch();
    this.#run();
    return this;
  }

  /** Stop for good and leave a complete example behind. */
  stop() {
    if (this.#stopped) return this;
    this.#stopped = true;
    this.#paused = false;
    this.#clear();
    this.#unwatch();
    if (this.#order.length > 0) {
      this.#shown = this.#order[0];
      this.#write();
    }
    return this;
  }

  /** Stop without giving up the field: used when the tab goes to the background. */
  pause() {
    if (this.#stopped || this.#paused || !this.#started) return this;
    this.#paused = true;
    this.#clear();
    return this;
  }

  resume() {
    if (this.#stopped || !this.#paused) return this;
    this.#paused = false;
    // The reader looked away mid-word, so the field is put back on the last
    // complete example rather than resuming into half a word.
    if (this.#order.length > 0) {
      this.#shown = this.#order[this.#at];
      this.#write();
    }
    const next = this.#chain[this.#i];
    if (next !== undefined) this.#timer = this.#timers().setTimeout(() => this.#run(), this.#options.afterDeleteMs);
    return this;
  }

  /** Detach everything. Safe to call twice. */
  destroy() {
    this.#clear();
    this.#unwatch();
    this.#stopped = true;
    return this;
  }

  #timers() {
    return this.#options.timers;
  }

  #reduced() {
    if (!this.#options.respectReducedMotion) return false;
    try {
      return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (error) {
      return false;
    }
  }

  #watch() {
    const stop = () => this.stop();
    for (const type of ['focus', 'pointerdown', 'keydown', 'input']) {
      this.#el.addEventListener(type, stop, { passive: true });
      this.#listeners.push([type, stop]);
    }
  }

  #unwatch() {
    for (const [type, fn] of this.#listeners) this.#el.removeEventListener(type, fn);
    this.#listeners = [];
  }

  #clear() {
    if (this.#timer !== null) this.#timers().clearTimeout(this.#timer);
    this.#timer = null;
  }

  #write() {
    if (this.#mode === 'value') this.#el.value = this.#shown;
    else if (this.#mode === 'text') this.#el.textContent = this.#shown;
    else this.#el.placeholder = this.#shown;
    if (this.#options.onChange) this.#options.onChange(this.#shown);
  }

  /** Move the cursor on, wrapping back to the second example when it runs out. */
  #advance() {
    const last = this.#chain.length - 1;
    this.#i = this.#i < last ? this.#i + 1 : (last > 0 ? 1 : this.#chain.length);
  }

  #run() {
    if (this.#stopped || this.#paused) return;
    const item = this.#chain[this.#i];
    // A single example that has already been typed: there is nothing to edit, so
    // it holds there rather than being retyped at itself.
    if (item === undefined) return;
    this.#advance();
    this.#remove(item.del, item.del, () => {
      this.#insert(item.ins, item.ins.length, () => {
        this.#at = item.land;
        this.#timer = this.#timers().setTimeout(() => this.#run(), this.#hold(item.land));
      });
    });
  }

  /** How long to sit on a finished example: longer for a longer one. */
  #hold(land) {
    const base = land === this.#order.length - 1 ? this.#options.lastHoldMs : this.#options.holdMs;
    return Math.min(this.#options.holdCapMs, base + this.#options.holdPerCharMs * this.#shown.length);
  }

  /**
   * Delete characters off the end, quickening slightly as it goes.
   *
   * The pace matters more than it looks: a constant rate reads as a machine
   * emptying a buffer, while a rate that starts slow and speeds up reads as someone
   * changing their mind about a word. The beat afterwards is placed here rather than
   * before the typing, so the half-finished line is what gets the pause.
   */
  #remove(left, total, done) {
    if (this.#stopped || this.#paused) return;
    if (left <= 0) return done();
    this.#shown = this.#shown.slice(0, -1);
    this.#write();
    // A host is allowed to stop from inside its own change callback, so the stop is
    // checked before anything else is scheduled. Without this the field would be left
    // with one timer still pending after it had been stopped.
    if (this.#stopped || this.#paused) return;
    const remaining = left - 1;
    if (remaining <= 0) {
      const beat = Math.min(
        this.#options.afterDeleteCapMs,
        this.#options.afterDeleteMs + this.#options.afterDeletePerCharMs * total,
      );
      this.#timer = this.#timers().setTimeout(done, this.#jitter(beat));
      return;
    }
    const progress = 1 - remaining / total;
    const ms = Math.max(12, this.#options.delMs * (1 - 0.45 * progress));
    this.#timer = this.#timers().setTimeout(() => this.#remove(remaining, total, done), this.#jitter(ms));
  }

  /** Type characters on, one at a time. */
  #insert(text, left, done) {
    if (this.#stopped || this.#paused) return;
    if (left <= 0) return done();
    this.#shown += text[text.length - left];
    this.#write();
    if (this.#stopped || this.#paused) return;
    const remaining = left - 1;
    this.#timer = this.#timers().setTimeout(() => this.#insert(text, remaining, done), this.#jitter(this.#options.typeMs));
  }

  /** A little unevenness, so no two characters land on the same beat. */
  #jitter(ms) {
    const spread = this.#options.jitter;
    if (!spread) return ms;
    return Math.max(1, Math.round(ms * (1 + (this.#options.random() * 2 - 1) * spread)));
  }
}
