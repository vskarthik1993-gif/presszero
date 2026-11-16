// PressZero Expression Model — the reel layer.
//
// Dresses the live face in short-form video grammar, driven by the live transcript:
//   captions — the avatar's words revealed one at a time as they are spoken, each drawn at a
//              size set by how much weight the word carries (wordSize)
//   cuts     — a jump-cut punch-in at each phrase boundary, so a long answer plays like an edited
//              reel instead of one locked-off shot (Reel.boundary)
// Phrase boundaries come from both sides of the call: punctuation in the transcript, and the pause
// before the voice resumes (the performer's phrase start); see Reel.boundaryReason. Everything here is
// DOM and arithmetic; the renderer only receives a zoom.

import { scoreText } from './affect.js';

// Words that carry grammar rather than meaning: drawn small.
const LIGHT = new Set(("a an the to of and or but so in on at for with from by as into than then if it it's its i i'm i'll i've " +
  "you you're your we we're our he she they them their me my us is am are was were be been being do does did have has had " +
  "will would can could should shall may might must just that this these those there here what which who um uh oh hmm").split(' '));
const SIZES = [0.8, 1, 1.24, 1.52];          // light, plain, content, emphasis
const HARD_END = /[.!?…;:]["')\]]*$/;          // a sentence or clause ends with this word
const SOFT_END = /[,—–]["')\]]*$/;             // a breath in the middle of one
const SHOTS = [1, 1.16, 1, 1.24];              // the cut cycle: wide, punch in, wide, tighter
const MAX_LINE = { words: 3, chars: 17 };      // a caption line in the 9:16 frame
const MAX_PHRASE = 8;                          // words before run-on speech looks for a place to cut
const MIN_COMMA_PHRASE = 4;                    // words before a comma counts as a phrase boundary
const MIN_SHOT = 1.3;                          // seconds a shot holds before the next cut

const bare = (word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// How big a word is drawn, as a multiple of the caption size. Function words are small, plain words
// regular, longer content words larger, and the words a speaker leans on largest: numbers, names
// and acronyms, emotionally loaded words (the same lexicon that moves the face), and the word that
// lands an exclamation or a question. A beat in the voice can promote a word after it appears
// (Reel.beat). Long words are capped so they always fit across the 9:16 frame.
export function wordSize(word, { first = false } = {}) {
  const core = bare(word); const lower = core.toLowerCase();
  if (!core) return SIZES[1];
  let level = 1;
  if (LIGHT.has(lower)) level = 0;
  else if (core.length >= 6) level = 2;
  const loaded = Object.values(scoreText(lower).score).some((v) => v > 0);
  const shouted = core.length > 1 && core === core.toUpperCase() && /\p{Lu}/u.test(core);
  const named = !first && level > 0 && /^\p{Lu}/u.test(core);   // a capital mid-phrase, but not "I'm"
  if (/\p{N}/u.test(core) || shouted || /[!?]["')\]]*$/.test(word) || (loaded && level > 0)) level = 3;
  else if (named) level = Math.max(level, 2);
  return Math.min(SIZES[level], 15 / Math.max(5, core.length));
}

// Rough spoken length of a word, for pacing reveals when the transcript runs ahead of the voice.
function spokenSeconds(word) {
  const core = bare(word);
  const syllables = /^[\x00-\x7f]*$/.test(core) ? Math.max(1, (core.match(/[aeiouy]+/gi) || []).length) : Math.max(1, Math.round(core.length / 2));
  return 0.1 + 0.16 * syllables + (HARD_END.test(word) ? 0.24 : SOFT_END.test(word) ? 0.1 : 0);
}

export class Reel {
  // el: the caption container inside the stage.
  constructor(el) {
    this.el = el; this.cuts = []; this.words = []; this.clear();
  }

  clear() {
    this.queue = []; this.partial = ''; this.lastText = 0; this.clock = this.clock || 0; this.nextAt = 0;
    this.line = null; this.lineWords = 0; this.lineChars = 0; this.phraseWords = 0; this.pendingCut = false; this.prev = null;
    this.shotIndex = 0; this.zoom = 1; this.lastCut = -Infinity; this.lastWordAt = -Infinity; this.current = null;
    if (this.el) { this.el.textContent = ''; this.el.classList.remove('on'); }
  }

  // Streaming transcript of what the avatar says. Chunks can split words, so the trailing fragment
  // waits for the next chunk (or a short timeout) before it is shown.
  feed(text) {
    if (!text) return;
    const joined = this.partial + text.replace(/[\[(*]\s*[a-z]+\s*[\])*]/gi, ' ');
    const parts = joined.split(/\s+/);
    this.partial = /\s$/.test(joined) ? '' : parts.pop();
    for (const word of parts) if (word) this.queue.push({ text: word, at: this.clock });
    this.lastText = this.clock;
  }

  // The voice resumed after a pause: a phrase boundary heard in the audio, and a sync point. The next
  // word starts a new phrase now, whatever the punctuation said.
  phrase() { this.pendingCut = true; this.nextAt = Math.min(this.nextAt, this.clock); }

  // A stressed syllable in the voice: the word on screen takes the emphasis size.
  beat(strength = 1) {
    const w = this.current; if (!w || this.clock - w.at > 0.35 || strength < 0.35) return;
    if (w.size < SIZES[3]) { w.size = Math.min(SIZES[3], 15 / Math.max(5, bare(w.text).length)); w.span.style.setProperty('--s', w.size.toFixed(2)); w.span.classList.add('hit'); }
  }

  // The end of the avatar's turn: flush the fragment and close the phrase.
  endTurn() { if (this.partial) { this.queue.push({ text: this.partial, at: this.clock }); this.partial = ''; } }

  // A phrase boundary was crossed: the next word (queue[0]) opens a new caption line, and the shot
  // cuts if the last one has held long enough. Returns whether it cut.
  boundary(reason) {
    this.phraseWords = 0; this.line = null;
    if (this.clock - this.lastCut < MIN_SHOT) return false;
    const ahead = this.queue.slice(0, MAX_PHRASE); const end = ahead.findIndex((w) => HARD_END.test(w.text));
    const phrase = end >= 0 ? ahead.slice(0, end + 1) : ahead;
    const emphatic = phrase.some((w) => /!$/.test(w.text) || wordSize(w.text) >= SIZES[3]);
    this.shotIndex = (this.shotIndex + 1) % SHOTS.length;
    let zoom = SHOTS[this.shotIndex];
    if (emphatic && zoom > 1) zoom = SHOTS.reduce((a, b) => Math.max(a, b));
    if (zoom === this.zoom) zoom = this.zoom > 1 ? 1 : SHOTS[1];
    this.zoom = zoom; this.lastCut = this.clock;
    this.cuts.push({ t: Math.round(this.clock * 1000) / 1000, zoom, reason, word: this.queue[0]?.text || '' }); if (this.cuts.length > 60) this.cuts.shift();
    return true;
  }

  // Where phrases break, strongest first: where the voice paused; after a word that ends a sentence or
  // clause; after a comma or dash once the phrase has some length; and in run-on speech, once the phrase
  // is MAX_PHRASE words long, before the next function word (where a new clause most likely starts),
  // or four words later at the latest. The first word of a turn opens on the wide shot.
  boundaryReason(next) {
    const prev = this.prev?.text; if (!prev) return null;
    if (this.pendingCut) return 'pause';
    if (HARD_END.test(prev)) return 'punctuation';
    if (SOFT_END.test(prev) && this.phraseWords >= MIN_COMMA_PHRASE) return 'comma';
    if (this.phraseWords >= MAX_PHRASE && (LIGHT.has(bare(next).toLowerCase()) || this.phraseWords >= MAX_PHRASE + 4)) return 'run-on';
    return null;
  }

  reveal() {
    const reason = this.boundaryReason(this.queue[0].text);
    if (reason) this.boundary(reason);
    else if (!this.prev || SOFT_END.test(this.prev.text)) { this.line = null; if (!this.prev) this.phraseWords = 0; }
    this.pendingCut = false;
    const item = this.queue.shift(); const word = item.text;
    const size = wordSize(word, { first: this.phraseWords === 0 });
    const chars = bare(word).length;
    if (!this.line || this.lineWords >= MAX_LINE.words || this.lineChars + chars > MAX_LINE.chars) {
      this.line = document.createElement('div'); this.line.className = 'reel-line';
      this.el.replaceChildren(this.line); this.lineWords = 0; this.lineChars = 0;
    }
    const span = document.createElement('span'); span.className = 'w'; span.textContent = word.replace(/[,;:]$/, '');
    span.style.setProperty('--s', size.toFixed(2)); if (size >= SIZES[3]) span.classList.add('em');
    this.line.querySelector('.now')?.classList.remove('now'); span.classList.add('now');
    this.line.append(span); this.el.classList.add('on');
    this.lineWords += 1; this.lineChars += chars; this.phraseWords += 1;
    this.current = { text: word, size, span, at: this.clock }; this.prev = item; this.lastWordAt = this.clock;
    this.words.push({ t: Math.round(this.clock * 1000) / 1000, word, size: Math.round(size * 100) / 100 }); if (this.words.length > 200) this.words.shift();
    return spokenSeconds(word);
  }

  // Called every frame. voiced: the avatar's voice is sounding right now; pending: voice is playing or
  // queued to play. Returns the shot to render.
  update(dt, { voiced = false, pending = voiced } = {}) {
    this.clock += Math.min(0.1, Math.max(0, dt));
    if (this.partial && this.clock - this.lastText > 0.4) this.endTurn();
    // Words advance while the voice sounds; text with no voice to follow is paced on its own.
    const textOnly = this.queue.length && !pending && this.clock - this.queue[0].at > 0.6;
    if (this.queue.length && this.clock >= this.nextAt && (voiced || textOnly)) {
      // Behind the voice, catch up; with no voice to keep up with, keep the natural pace.
      const backlog = voiced ? Math.max(0, this.queue.length - 3) : 0;
      this.nextAt = this.clock + this.reveal() / (1 + 0.15 * backlog);
    }
    // Quiet after the last word: the captions clear and the camera settles back to the wide shot.
    const idle = this.clock - this.lastWordAt;
    if (!this.queue.length && !voiced && idle > 1.6) {
      if (this.el.classList.contains('on')) { this.el.classList.remove('on'); this.line = null; this.prev = null; }
      if (this.zoom !== 1 && idle > 2.2) { this.zoom = 1; this.shotIndex = 0; this.lastCut = this.clock; this.cuts.push({ t: Math.round(this.clock * 1000) / 1000, zoom: 1, reason: 'rest', word: '' }); }
    }
    return { zoom: this.zoom };
  }
}
