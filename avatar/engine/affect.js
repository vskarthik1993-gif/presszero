// PressZero Expression Model — what should the face feel?
//
// Reads the words going both ways in the conversation and turns them into a
// small emotional state: what the avatar is saying colours how it says it, and
// what it hears colours how it listens. Also understands inline direction cues
// such as [smile], [gasp] or (laughs) so a script or an LLM can direct the face.

const LEX = {
  joy: ['great', 'wonderful', 'happy', 'glad', 'love', 'lovely', 'perfect', 'awesome', 'amazing', 'excellent', 'fantastic', 'congratulations', 'congrats', 'welcome', 'thank', 'thanks', 'pleasure', 'delighted', 'good news', 'yay', 'nice', 'beautiful', 'brilliant', 'excited', 'fun', 'haha', 'best', 'enjoy', 'cheers', 'bahut accha', 'badhiya', 'shukriya', 'dhanyavaad', 'dhanyavad', 'khushi', 'mubarak', 'zabardast', 'shandaar', 'swagat', 'namaste', 'namaskara', 'धन्यवाद', 'बहुत अच्छा', 'बढ़िया', 'ಧನ್ಯವಾದ', 'ನಮಸ್ಕಾರ'],
  sad: ['sorry', 'sad', 'unfortunately', 'regret', 'apologize', 'apologise', 'apologies', 'loss', 'lost', 'passed away', 'miss you', 'difficult', 'tough', 'hard time', 'afraid', 'pain', 'painful', 'hurt', 'hurts', 'sick', 'unwell', 'ill', 'fever', 'cancel', 'cancelled', 'unable', 'cannot', "can't", 'not possible', 'failed', 'bad news', 'maaf', 'afsos', 'dukh', 'dard', 'takleef', 'bimar', 'mushkil', 'pareshan', 'माफ़', 'दर्द', 'दुख', 'ಕ್ಷಮಿಸಿ', 'ನೋವು'],
  surprise: ['wow', 'really', 'oh my', 'whoa', 'incredible', 'unbelievable', 'no way', 'seriously', 'what?!', 'guess what', 'imagine', 'surprise', 'surprised', 'suddenly', 'arre', 'sach mein', 'kya baat', 'अरे', 'ಅಯ್ಯೋ'],
  concern: ['worried', 'worry', 'careful', 'urgent', 'emergency', 'serious', 'risk', 'problem', 'issue', 'trouble', 'warning', 'danger', 'important', 'please note', 'make sure', 'concern', 'stress', 'anxious', 'scared', 'chest pain', 'bleeding', 'dhyan', 'zaroori', 'chinta', 'samasya', 'dikkat', 'ज़रूरी', 'चिंता', 'ತೊಂದರೆ'],
  think: ['let me check', 'let me see', 'let me think', 'one moment', 'just a moment', 'hmm', 'well,', 'perhaps', 'maybe', 'i think', 'i believe', 'consider', 'depends', 'actually', 'ek minute', 'dekhti hoon', 'dekhta hoon', 'shayad', 'sochne', 'एक मिनट', 'शायद', 'ಒಂದು ನಿಮಿಷ'],
};
const NEGATE = /\b(no|not|never|don't|dont|isn't|wasn't|nahi|nahin)\s+$/i;

const CUES = {
  smile: { emotion: 'joy', amount: 0.9 }, happy: { emotion: 'joy', amount: 0.9 }, grin: { emotion: 'joy', amount: 1 }, warm: { emotion: 'joy', amount: 0.6 },
  laugh: { emotion: 'joy', amount: 1, gesture: 'laugh' }, laughs: { emotion: 'joy', amount: 1, gesture: 'laugh' }, chuckle: { emotion: 'joy', amount: 0.8, gesture: 'laugh' }, chuckles: { emotion: 'joy', amount: 0.8, gesture: 'laugh' },
  sad: { emotion: 'sad', amount: 0.9 }, empathy: { emotion: 'sad', amount: 0.7 }, sorry: { emotion: 'sad', amount: 0.8 }, sigh: { emotion: 'sad', amount: 0.6, gesture: 'sigh' }, sighs: { emotion: 'sad', amount: 0.6, gesture: 'sigh' },
  gasp: { emotion: 'surprise', amount: 1, gesture: 'gasp' }, gasps: { emotion: 'surprise', amount: 1, gesture: 'gasp' }, surprised: { emotion: 'surprise', amount: 1 }, wow: { emotion: 'surprise', amount: 0.9 },
  serious: { emotion: 'concern', amount: 0.8 }, concerned: { emotion: 'concern', amount: 0.9 }, worried: { emotion: 'concern', amount: 0.9 },
  think: { emotion: 'think', amount: 1 }, thinking: { emotion: 'think', amount: 1 }, hmm: { emotion: 'think', amount: 0.8 }, pause: { gesture: 'pause' },
  nod: { gesture: 'nod' }, nods: { gesture: 'nod' }, shake: { gesture: 'shake' }, wink: { gesture: 'wink' }, blink: { gesture: 'blink' }, calm: { emotion: 'neutral', amount: 1 }, neutral: { emotion: 'neutral', amount: 1 },
};
const CUE_RE = /[\[(*]\s*([a-z]+)\s*[\])*]/gi;

export const EMOTIONS = ['joy', 'sad', 'surprise', 'concern', 'think'];

// Remove direction cues from text that is going to a TTS engine; returns the
// clean text and the cues with their character offsets in the clean text.
export function parseCues(text) {
  const cues = []; let clean = ''; let last = 0; let m;
  CUE_RE.lastIndex = 0;
  while ((m = CUE_RE.exec(text))) {
    const cue = CUES[m[1].toLowerCase()]; if (!cue) continue;
    clean += text.slice(last, m.index); last = m.index + m[0].length;
    cues.push({ at: clean.length, name: m[1].toLowerCase(), ...cue });
  }
  clean += text.slice(last);
  return { text: clean.replace(/\s{2,}/g, ' ').trim(), cues };
}

export function scoreText(text) {
  const lower = ` ${String(text).toLowerCase()} `;
  const score = { joy: 0, sad: 0, surprise: 0, concern: 0, think: 0 };
  for (const emotion of EMOTIONS) for (const term of LEX[emotion]) {
    let from = 0; let at;
    while ((at = lower.indexOf(term, from)) !== -1) {
      from = at + term.length;
      const ascii = /^[\x00-\x7f]+$/.test(term);
      if (ascii && (/[a-z]/.test(lower[at - 1] || ' ') || /[a-z]/.test(lower[from] || ' '))) continue;
      if (NEGATE.test(lower.slice(Math.max(0, at - 12), at))) { if (emotion === 'joy') score.sad += 0.4; continue; }
      score[emotion] += term.includes(' ') ? 1.2 : 1;
    }
  }
  const bangs = (lower.match(/!/g) || []).length;
  if (bangs) { score.joy += 0.35 * Math.min(2, bangs) * (score.sad + score.concern > 0 ? 0 : 1); score.surprise += 0.2 * Math.min(2, bangs); }
  return { score, question: /\?\s*$/.test(text.trim()) || /\?/.test(text), emphatic: bangs > 0 };
}

// Rolling emotional state for the conversation.
export class Affect {
  constructor(performer) { this.performer = performer; this.buffer = { assistant: '', user: '' }; }

  // Streaming transcript text. speaker: 'assistant' (what the avatar is saying) or 'user' (what it hears).
  feed(text, speaker = 'assistant') {
    if (!text) return;
    const { cues } = parseCues(text);
    for (const cue of cues) this.cue(cue);
    // Words can be split across chunks; score a short rolling window and only credit new matches.
    const prev = this.buffer[speaker]; const next = (prev + text).slice(-160);
    const before = scoreText(prev).score; const after = scoreText(next);
    this.buffer[speaker] = next;
    const gain = speaker === 'assistant' ? 0.62 : 0.5;
    for (const emotion of EMOTIONS) {
      const delta = after.score[emotion] - before[emotion];
      if (delta > 0.05) {
        // Hearing bad news reads as concern on the listener's face, not sadness of its own.
        const shown = speaker === 'user' && emotion === 'sad' ? 'concern' : speaker === 'user' && emotion === 'think' ? null : emotion;
        if (shown) this.performer.feel(shown, Math.min(1, gain * delta + 0.2));
      }
    }
    if (speaker === 'assistant' && /\?/.test(text)) this.performer.gesture('ask');
    if (speaker === 'assistant' && /!/.test(text)) this.performer.gesture('emphasis');
  }

  cue(cue) {
    if (cue.emotion === 'neutral') this.performer.calm();
    else if (cue.emotion) this.performer.feel(cue.emotion, cue.amount ?? 0.9, { hold: 2.4 });
    if (cue.gesture) this.performer.gesture(cue.gesture);
  }

  turn(speaker) { this.buffer[speaker] = ''; }
}
