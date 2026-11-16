import { buildRig, addKeyframe, warmDetector } from './engine/rig.js';
import { AvatarRenderer } from './engine/renderer.js';
import { LipSync } from './engine/lipsync.js';
import { Performer, expressionPose } from './engine/performer.js';
import { Affect } from './engine/affect.js';
import { generateExpression } from './engine/generate.js';

const $ = (selector) => document.querySelector(selector);
const SAMPLE_FACE = './samples/mira.jpg';
const SAMPLE_VOICE = '../health/audio/voice-previews/v1/kore.wav';
const TILES = [['joy', 'Happy'], ['surprise', 'Surprise'], ['sad', 'Empathy'], ['concern', 'Concern'], ['think', 'Thinking'], ['aa', 'Aah'], ['ee', 'Eee'], ['oo', 'Ooo']];
const STORE = { portrait: 'pz-avatar-portrait-v1', key: 'pz-avatar-gen-key', model: 'pz-avatar-gen-model' };

const lip = new LipSync();
const performer = new Performer(lip);
const affect = new Affect(performer);
const renderer = new AvatarRenderer($('#avatar'));
const state = { rig: null, frame: 'head', call: null, preview: null, micDrive: null, sampleTimer: null, caption: '', captionAt: 0, pendingReply: false, userTalking: false, userQuietAt: 0 };

// ---------------------------------------------------------------- audio stage
// Plays streamed voice and hands every chunk to the lip-sync timeline the
// moment it arrives, stamped with the time it will be heard.
class VoiceStage {
  constructor() { this.ctx = null; this.playhead = 0; this.sources = new Set(); this.delay = 0; this.leadMs = 0; }
  async ensure() {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
  }
  // The moment currently reaching the listener's ears, on the audio clock.
  now() { return this.ctx ? this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0) - this.delay : performance.now() / 1000; }
  play(samples, sampleRate) {
    const { ctx } = this; if (!ctx) return;
    const buffer = ctx.createBuffer(1, samples.length, sampleRate); buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.03, this.playhead);
    lip.push(samples, sampleRate, startAt);
    this.leadMs = Math.round((startAt - ctx.currentTime) * 1000);
    source.start(startAt); this.playhead = startAt + buffer.duration;
    this.sources.add(source); source.onended = () => this.sources.delete(source);
  }
  get speakingUntil() { return this.playhead; }
  clear() {
    for (const source of this.sources) { try { source.stop(); } catch { /* already stopped */ } }
    this.sources.clear(); this.playhead = 0;
    if (this.ctx) lip.truncate(this.ctx.currentTime);
  }
}
const stage = new VoiceStage();

function pcm16ToFloat(bytes) {
  const n = Math.floor(bytes.byteLength / 2); const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2); const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
function base64ToBytes(value) { const bin = atob(value); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i); return bytes; }
function bytesToBase64(buffer) { const bytes = new Uint8Array(buffer); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); }
function downsampleToPcm16(samples, inputRate, outputRate) {
  const ratio = inputRate / outputRate; const length = Math.floor(samples.length / ratio); const pcm = new Int16Array(length);
  for (let o = 0; o < length; o += 1) {
    const start = Math.floor(o * ratio); const end = Math.min(Math.floor((o + 1) * ratio), samples.length); let total = 0;
    for (let i = start; i < end; i += 1) total += samples[i];
    const v = Math.max(-1, Math.min(1, total / Math.max(1, end - start))); pcm[o] = v < 0 ? v * 32768 : v * 32767;
  }
  return pcm;
}
function rms(samples) { let s = 0; for (let i = 0; i < samples.length; i += 1) s += samples[i] * samples[i]; return Math.sqrt(s / Math.max(1, samples.length)); }

// ---------------------------------------------------------------- character
async function loadImage(src) { const image = new Image(); image.crossOrigin = 'anonymous'; image.src = src; await image.decode(); return image; }

async function setPortrait(source, { remember = true } = {}) {
  const status = $('#build-status');
  status.textContent = 'Reading the face…';
  $('#rig-info').textContent = 'Building expression model…';
  try {
    const started = performance.now();
    const rig = await buildRig(source);
    state.rig = rig; performer.keyframes = rig.keyframes; performer.rig = rig;
    $('#stage').dataset.state = 'ready';
    renderer.setRig(rig, { frame: state.frame });
    const ms = Math.round(performance.now() - started);
    $('#rig-info').textContent = `Expression model fitted in ${ms} ms · ${rig.nV} control points · ${Object.keys(rig.shapes).length} shape units${rig.photoMouthOpen ? ' · portrait shows teeth, so its own teeth are kept' : ''}`;
    status.textContent = '';
    for (const id of ['#call', '#sample-voice', '#mic-drive', '#generate']) $(id).disabled = false;
    renderBoard();
    if (remember) { try { localStorage.setItem(STORE.portrait, rig.canvas.toDataURL('image/jpeg', 0.86)); } catch { /* storage full or blocked */ } }
  } catch (error) {
    status.textContent = error.message || 'Could not read that image.';
    $('#rig-info').textContent = state.rig ? 'Kept the previous portrait. ' + (error.message || '') : 'No portrait yet.';
    console.error(error);
  }
}

async function fileToImage(file) { const url = URL.createObjectURL(file); try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 4000); } }

$('#portrait-file').addEventListener('change', async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) await setPortrait(await fileToImage(file)); });
$('#use-sample').addEventListener('click', async () => setPortrait(await loadImage(SAMPLE_FACE), { remember: false }));
const stageEl = $('#stage');
for (const type of ['dragenter', 'dragover']) stageEl.addEventListener(type, (event) => { event.preventDefault(); stageEl.classList.add('drag'); });
for (const type of ['dragleave', 'drop']) stageEl.addEventListener(type, (event) => { event.preventDefault(); stageEl.classList.remove('drag'); });
stageEl.addEventListener('drop', async (event) => { const file = [...(event.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/')); if (file) await setPortrait(await fileToImage(file)); });
document.querySelectorAll('[data-frame]').forEach((button) => button.addEventListener('click', () => {
  state.frame = button.dataset.frame; document.querySelectorAll('[data-frame]').forEach((b) => b.classList.toggle('on', b === button));
  if (state.rig) { renderer.setFrame(state.frame); renderBoard(); }
}));

// ---------------------------------------------------------------- storyboard
let tileTarget = null;
function tilePose(name) { return state.rig.keyframes[name] ? { keyframes: { [name]: 1 } } : expressionPose(name); }
function renderBoard() {
  const board = $('#board'); board.textContent = '';
  let learned = 0;
  for (const [name, label] of TILES) {
    const isLearned = Boolean(state.rig.keyframes[name]); if (isLearned) learned += 1;
    const tile = document.createElement('div'); tile.className = `tile${isLearned ? ' learned' : ''}`; tile.dataset.name = name;
    const play = document.createElement('button'); play.type = 'button'; play.style.cssText = 'all:unset;display:block;cursor:pointer;width:100%'; play.setAttribute('aria-label', `Play ${label}`);
    play.append(renderer.snapshot(tilePose(name), 200));
    const caption = document.createElement('div'); caption.className = 'name';
    const a = document.createElement('span'); a.textContent = label; const b = document.createElement('span'); b.className = 'tag'; b.textContent = isLearned ? 'learned' : 'fitted';
    caption.append(a, b); play.append(caption);
    play.addEventListener('click', () => playTile(name));
    const swap = document.createElement('button'); swap.type = 'button'; swap.className = 'swap'; swap.textContent = '↑'; swap.title = `Teach ${label} from an image`; swap.setAttribute('aria-label', swap.title);
    swap.addEventListener('click', () => { tileTarget = name; $('#tile-file').click(); });
    tile.append(play, swap); board.append(tile);
  }
  $('#board-note').textContent = learned ? `${learned} learned · ${TILES.length - learned} fitted` : 'all fitted from one image';
}
function playTile(name) {
  if (['aa', 'ee', 'oo'].includes(name)) state.preview = { name, start: performance.now(), dur: 900 };
  else performer.feel(name, 1, { hold: 1.8 });
}
async function learnTile(name, source) {
  const tile = document.querySelector(`.tile[data-name="${name}"]`); tile?.classList.add('busy');
  try { await addKeyframe(state.rig, name, source, { region: ['aa', 'ee', 'oo'].includes(name) ? 'mouth' : 'face' }); renderBoard(); return true; }
  catch (error) { $('#gen-status').textContent = `${name}: ${error.message}`; tile?.classList.remove('busy'); return false; }
}
$('#tile-file').addEventListener('change', async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file && tileTarget && state.rig) await learnTile(tileTarget, await fileToImage(file)); });

$('#gen-key').value = localStorage.getItem(STORE.key) || '';
if (localStorage.getItem(STORE.model)) $('#gen-model').value = localStorage.getItem(STORE.model);
$('#gen-key').addEventListener('change', (event) => localStorage.setItem(STORE.key, event.target.value.trim()));
$('#gen-model').addEventListener('change', (event) => localStorage.setItem(STORE.model, event.target.value.trim()));
$('#generate').addEventListener('click', async () => {
  const apiKey = $('#gen-key').value.trim(); const status = $('#gen-status');
  if (!apiKey) { status.textContent = 'Add a Gemini API key under “AI storyboard settings” first.'; document.querySelector('details.card').open = true; return; }
  $('#generate').disabled = true; let done = 0;
  for (const [name, label] of TILES) {
    status.textContent = `Generating ${label} (${done + 1}/${TILES.length})…`;
    try { const image = await generateExpression(state.rig.canvas, name, { apiKey, model: $('#gen-model').value.trim() }); if (await learnTile(name, image)) done += 1; }
    catch (error) { status.textContent = `${label}: ${error.message}`; if (/key|permission|quota|not found|401|403|404/i.test(error.message)) break; }
  }
  if (done) status.textContent = `Learned ${done} of ${TILES.length} expressions.`;
  $('#generate').disabled = false;
});

// ---------------------------------------------------------------- direction
$('#cues').addEventListener('click', (event) => { const cue = event.target.closest('[data-cue]')?.dataset.cue; if (cue) affect.feed(`[${cue}]`); });
$('#intensity').addEventListener('input', (event) => { performer.intensity = Number(event.target.value); });

function setCaption(text, append) {
  state.caption = append ? `${state.caption}${text}` : text; state.captionAt = performance.now();
  const words = state.caption.trim().split(/\s+/); $('#caption').textContent = words.slice(-18).join(' ');
}

// ---------------------------------------------------------------- sample voice (streamed like the live model)
async function toggleSampleVoice() {
  const button = $('#sample-voice');
  if (state.sampleTimer) { stopSampleVoice(); return; }
  await stage.ensure(); stage.delay = 0;
  const wav = new Uint8Array(await (await fetch(SAMPLE_VOICE)).arrayBuffer());
  let at = 12; let dataStart = 44; let sampleRate = 24000;
  while (at + 8 <= wav.length) { const id = String.fromCharCode(...wav.subarray(at, at + 4)); const size = new DataView(wav.buffer).getUint32(at + 4, true); if (id === 'fmt ') sampleRate = new DataView(wav.buffer).getUint32(at + 12, true); if (id === 'data') { dataStart = at + 8; break; } at += 8 + size + (size % 2); }
  const samples = pcm16ToFloat(wav.subarray(dataStart)); const chunk = Math.round(sampleRate * 0.04); let offset = 0;
  button.textContent = 'Stop sample'; button.classList.add('on');
  affect.feed('[smile]');
  // Feed 40 ms chunks, staying ~200 ms ahead of the playhead, as a streaming voice model does.
  state.sampleTimer = setInterval(() => {
    while (offset < samples.length && stage.playhead - stage.ctx.currentTime < 0.2) { stage.play(samples.subarray(offset, Math.min(samples.length, offset + chunk)), sampleRate); offset += chunk; }
    if (offset >= samples.length && stage.ctx.currentTime > stage.playhead + 0.3) stopSampleVoice();
  }, 20);
}
function stopSampleVoice() { clearInterval(state.sampleTimer); state.sampleTimer = null; stage.clear(); const b = $('#sample-voice'); b.textContent = 'Play sample voice'; b.classList.remove('on'); }
$('#sample-voice').addEventListener('click', () => toggleSampleVoice().catch((error) => { $('#call-status').textContent = error.message; }));

// ---------------------------------------------------------------- microphone
async function openMic(onSamples) {
  const ctx = await stage.ensure();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  await ctx.audioWorklet.addModule('../health/pcm-worklet.js');
  const source = ctx.createMediaStreamSource(stream); const node = new AudioWorkletNode(ctx, 'microphone-processor'); const silent = ctx.createGain(); silent.gain.value = 0;
  source.connect(node).connect(silent).connect(ctx.destination);
  node.port.onmessage = ({ data }) => onSamples(data, ctx.sampleRate);
  return { close() { node.port.onmessage = null; try { source.disconnect(); node.disconnect(); } catch { /* noop */ } stream.getTracks().forEach((track) => track.stop()); } };
}

// Puppet mode: your own voice drives the face directly. No model, no credits.
async function toggleMicDrive() {
  const button = $('#mic-drive');
  if (state.micDrive) { state.micDrive.close(); state.micDrive = null; stage.delay = 0; lip.clear(); button.textContent = 'Drive with my voice'; button.classList.remove('on'); return; }
  let clock = 0;
  const mic = await openMic((samples, rate) => {
    const now = stage.ctx.currentTime; if (Math.abs(clock - now) > 0.12) clock = now;
    lip.push(samples, rate, clock); clock += samples.length / rate;
  });
  stage.delay = 0.1; state.micDrive = mic; button.textContent = 'Stop my voice'; button.classList.add('on');
}
$('#mic-drive').addEventListener('click', () => toggleMicDrive().catch((error) => { $('#call-status').textContent = error.name === 'NotAllowedError' ? 'Microphone permission is needed.' : error.message; }));

// ---------------------------------------------------------------- live call (existing PressZero voice session)
class Call {
  constructor() { this.muted = false; this.chunks = []; this.length = 0; this.ready = false; this.ended = false; }
  async start() {
    stage.delay = 0;
    const { connectVoiceSession } = await import('../health/voice-live.js?v=voice-direct-v3');
    const micPromise = openMic((samples, rate) => this.capture(samples, rate));
    const sessionPromise = connectVoiceSession({ onMessage: (message) => this.onMessage(message), onClose: () => this.closed() });
    try { [this.mic, this.session] = await Promise.all([micPromise, sessionPromise]); }
    catch (error) { micPromise.then((mic) => mic.close()).catch(() => undefined); sessionPromise.then((session) => session.end()).catch(() => undefined); throw error; }
  }
  capture(samples, rate) {
    // Local voice activity → listener behaviour, independent of the network.
    const level = rms(samples); const talking = level > 0.02 && !this.muted;
    const speaking = stage.ctx.currentTime < stage.speakingUntil + 0.15;
    if (talking && !speaking) { performer.hear(Math.min(1, level * 6)); if (!state.userTalking) { state.userTalking = true; state.pendingReply = false; } state.userQuietAt = performance.now(); }
    else if (state.userTalking && performance.now() - state.userQuietAt > 650) { state.userTalking = false; state.pendingReply = true; }
    if (!this.ready || this.muted || !this.session?.isOpen()) return;
    this.chunks.push(samples); this.length += samples.length;
    if (this.length < 2048) return;
    const joined = new Float32Array(this.length); let offset = 0; for (const chunk of this.chunks) { joined.set(chunk, offset); offset += chunk.length; }
    this.chunks = []; this.length = 0;
    this.session.sendAudio(bytesToBase64(downsampleToPcm16(joined, rate, 16000).buffer));
  }
  onMessage(message) {
    if (message.type === 'ready') { this.ready = true; setCallUi('live'); $('#call-status').textContent = 'Connected. Just talk.'; }
    else if (message.type === 'audio') { state.pendingReply = false; stage.play(pcm16ToFloat(base64ToBytes(message.data)), message.sampleRate || 24000); }
    else if (message.type === 'transcript') {
      if (message.speaker === 'assistant') { affect.feed(message.text, 'assistant'); setCaption(message.text, this.lastSpeaker === 'assistant'); }
      else affect.feed(message.text, 'user');
      this.lastSpeaker = message.speaker;
    } else if (message.type === 'interrupted') { stage.clear(); performer.queueBlink(0.05); }
    else if (message.type === 'turn_complete') { affect.turn('assistant'); affect.turn('user'); this.lastSpeaker = null; }
    else if (message.type === 'error') $('#call-status').textContent = message.message;
  }
  async end() { if (this.ended) return; this.ended = true; try { await this.session?.end(); } catch { /* noop */ } this.closed(); }
  closed() { this.mic?.close(); stage.clear(); if (state.call === this) { state.call = null; state.userTalking = false; state.pendingReply = false; setCallUi('idle'); if (!this.ended) $('#call-status').textContent = 'Call ended.'; } }
}
function setCallUi(mode) {
  const button = $('#call'); button.disabled = mode === 'connecting';
  button.textContent = mode === 'live' ? 'End call' : mode === 'connecting' ? 'Connecting…' : 'Start call'; button.classList.toggle('live', mode === 'live');
  $('#mute').hidden = mode !== 'live'; for (const id of ['#sample-voice', '#mic-drive']) $(id).disabled = mode !== 'idle' || !state.rig;
}
$('#call').addEventListener('click', async () => {
  if (state.call) { $('#call-status').textContent = ''; await state.call.end(); return; }
  if (state.sampleTimer) stopSampleVoice(); if (state.micDrive) await toggleMicDrive();
  const call = new Call(); state.call = call; setCallUi('connecting'); $('#call-status').textContent = 'Connecting to the voice model…'; setCaption('');
  try { await call.start(); } catch (error) {
    state.call = null; setCallUi('idle');
    $('#call-status').textContent = error.name === 'NotAllowedError' ? 'Microphone permission is needed for a call.'
      : /fetch|network|load/i.test(error.message || '') ? 'The voice service only accepts calls from presszero.in. Open this page there, or use “Play sample voice” / “Drive with my voice” here.' : (error.message || 'Could not start the call.');
  }
});
$('#mute').addEventListener('click', () => { if (!state.call) return; state.call.muted = !state.call.muted; $('#mute').textContent = state.call.muted ? 'Unmute' : 'Mute'; $('#mute').classList.toggle('on', state.call.muted); });

// ---------------------------------------------------------------- frame loop
let last = performance.now(); let frames = 0; let statAt = last; const MODE_LABEL = { idle: 'Idle', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' };
function tick(nowMs) {
  requestAnimationFrame(tick);
  const dt = (nowMs - last) / 1000; last = nowMs;
  if (!state.rig) return;
  const audioNow = stage.now();
  const speaking = lip.active(audioNow);
  const mode = speaking ? 'speaking' : state.call ? (state.pendingReply && !state.userTalking ? 'thinking' : 'listening') : 'idle';
  performer.setMode(mode);
  let pose = performer.update(dt, audioNow);
  if (state.preview) {
    const p = (nowMs - state.preview.start) / state.preview.dur;
    if (p >= 1) state.preview = null; else { const k = Math.sin(Math.min(1, p * 2.2) * Math.PI / 2) * Math.min(1, (1 - p) * 4); const target = state.rig.keyframes[state.preview.name] ? { keyframes: { [state.preview.name]: k }, shapes: {} } : expressionPose(state.preview.name, k); pose = { shapes: { ...pose.shapes, ...target.shapes }, keyframes: { ...pose.keyframes, ...(target.keyframes || {}) }, head: pose.head }; }
  }
  renderer.render(pose);
  if (stageEl.dataset.mode !== mode) { stageEl.dataset.mode = mode; $('#mode-text').textContent = MODE_LABEL[mode]; }
  if (state.caption && nowMs - state.captionAt > 5000 && !speaking) setCaption('');
  frames += 1;
  if (nowMs - statAt > 1000) { $('#stat-fps').textContent = `${Math.round((frames * 1000) / (nowMs - statAt))} fps`; $('#stat-lat').textContent = speaking ? `face ready ${stage.leadMs} ms early` : 'face ready — ms early'; frames = 0; statAt = nowMs; }
}
requestAnimationFrame(tick);
window.addEventListener('resize', () => { if (state.rig) renderer.setFrame(state.frame); });

// ---------------------------------------------------------------- boot
warmDetector().catch(() => { $('#build-status').textContent = 'Could not load the face model. Check the connection and reload.'; });
const saved = (() => { try { return localStorage.getItem(STORE.portrait); } catch { return null; } })();
if (saved) loadImage(saved).then((image) => setPortrait(image, { remember: false })).catch(() => undefined);

// Small surface for embedding and for tests.
window.pzAvatar = { state, lip, performer, affect, renderer, stage, setPortrait, loadImage, learnTile };
