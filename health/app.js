import { connectVoiceSession, prepareVoiceSession } from './voice-live.js?v=voice-direct-v2';

const state = {
  config: null,
  dashboard: null,
  call: null,
  timer: null,
  seconds: 0,
  voicePreviews: new Map(),
  activeVoicePreview: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const API_BASE = window.__NAMMA_API_BASE__ || '';
const APP_BASE = window.__NAMMA_APP_BASE__ || '';
let historyToken = sessionStorage.getItem('namma_history_token') || '';
const apiUrl = (path) => `${API_BASE}${path}`;
const assetUrl = (path) => `${APP_BASE}${path}`;

class VoiceCall {
  constructor() {
    this.session = null;
    this.audioContext = null;
    this.stream = null;
    this.worklet = null;
    this.inputChunks = [];
    this.inputLength = 0;
    this.playbackTime = 0;
    this.playingSources = new Set();
    this.recordingOrigin = 0;
    this.patientRecordingChunks = [];
    this.assistantRecordingChunks = [];
    this.recordingSaved = false;
    this.ready = false;
    this.muted = false;
  }

  async start() {
    this.audioContext = new AudioContext({ latencyHint: 'interactive' });
    this.recordingOrigin = this.audioContext.currentTime;
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const workletPromise = this.audioContext.audioWorklet.addModule(assetUrl('/pcm-worklet.js'));
    const sessionPromise = connectVoiceSession({
      onMessage: (message) => this.handleMessage(message),
      onClose: () => {
        if (state.call === this) {
          state.call = null;
          void this.persistRecording()
            .catch(() => showToast('The call ended, but its recording could not be saved.', true))
            .finally(() => this.stopLocalMedia())
            .finally(() => loadDashboard());
          endCallUi();
        }
      },
    });
    try {
      const [stream, session] = await Promise.all([streamPromise, sessionPromise, workletPromise]);
      this.stream = stream;
      this.session = session;
      await this.audioContext.resume();
    } catch (error) {
      void sessionPromise.then((session) => session.end()).catch(() => undefined);
      throw error;
    }

    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(this.audioContext, 'microphone-processor');
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    source.connect(this.worklet).connect(silentGain).connect(this.audioContext.destination);
    this.worklet.port.onmessage = ({ data }) => this.capture(data);
  }

  capture(floatSamples) {
    if (!this.ready || this.muted || !this.session?.isOpen()) return;
    this.inputChunks.push(floatSamples);
    this.inputLength += floatSamples.length;
    if (this.inputLength < 2048) return;

    const joined = new Float32Array(this.inputLength);
    let offset = 0;
    for (const chunk of this.inputChunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    this.inputChunks = [];
    this.inputLength = 0;
    const pcm = downsampleToPcm16(joined, this.audioContext.sampleRate, 16000);
    const chunkDuration = pcm.length / 16000;
    this.patientRecordingChunks.push({
      offset: Math.max(0, Math.round((this.audioContext.currentTime - this.recordingOrigin - chunkDuration) * 16000)),
      samples: pcm,
    });
    this.session.sendAudio(arrayBufferToBase64(pcm.buffer));
  }

  handleMessage(message) {
    if (message.type === 'ready') {
      this.ready = true;
      setCallStatus('Connected · Asha is listening');
      $('.phone-card').classList.add('live');
      setCallControls({ active: true });
      startTimer();
    } else if (message.type === 'audio') {
      this.playPcm(message.data, message.sampleRate || 24000);
    } else if (message.type === 'transcript') {
      appendTranscript(message.speaker, message.text);
    } else if (message.type === 'interrupted') {
      this.clearPlayback();
    } else if (message.type === 'refresh_dashboard') {
      void loadDashboard();
    } else if (message.type === 'language_changed') {
      activateLanguage(message.language);
    } else if (message.type === 'error') {
      showToast(message.message, true);
      setCallStatus('Connection error');
    }
  }

  playPcm(base64, sampleRate) {
    if (!this.audioContext) return;
    const bytes = base64ToUint8(base64);
    const sampleCount = Math.floor(bytes.byteLength / 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
    const buffer = this.audioContext.createBuffer(1, sampleCount, sampleRate);
    const output = buffer.getChannelData(0);
    for (let index = 0; index < sampleCount; index += 1) output[index] = view.getInt16(index * 2, true) / 32768;
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    const startAt = Math.max(this.audioContext.currentTime + 0.025, this.playbackTime);
    this.assistantRecordingChunks.push({
      offset: Math.max(0, Math.round((startAt - this.recordingOrigin) * 16000)),
      samples: resamplePcm16(bytes, sampleRate, 16000),
    });
    source.start(startAt);
    this.playbackTime = startAt + buffer.duration;
    this.playingSources.add(source);
    source.onended = () => this.playingSources.delete(source);
  }

  clearPlayback() {
    for (const source of this.playingSources) {
      try { source.stop(); } catch {}
    }
    this.playingSources.clear();
    if (this.audioContext) this.playbackTime = this.audioContext.currentTime;
  }

  switchLanguage(language) {
    this.session?.sendText(`Please switch the conversation to ${language} now.`);
  }

  setMuted(muted) {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    return this.muted;
  }

  async end() {
    let recording = null;
    try {
      recording = this.buildRecording();
    } catch (error) {
      console.error('Could not assemble call recording', error);
      showToast('Call ended, but the recording could not be assembled.', true);
    }
    await this.session?.end();
    if (recording) {
      try {
        await this.session?.saveRecording(recording.wav, recording.durationMs);
        this.recordingSaved = true;
      } catch {
        showToast('Call saved, but the recording upload failed. Please retry with a new call.', true);
      }
    }
    await this.stopLocalMedia();
    this.ready = false;
  }

  async persistRecording() {
    if (this.recordingSaved || !this.session) return;
    const recording = this.buildRecording();
    if (!recording) return;
    await this.session.saveRecording(recording.wav, recording.durationMs);
    this.recordingSaved = true;
  }

  buildRecording() {
    if (!this.audioContext || (!this.patientRecordingChunks.length && !this.assistantRecordingChunks.length)) return null;
    const elapsedSamples = Math.max(1, Math.round((this.audioContext.currentTime - this.recordingOrigin) * 16000));
    const lastSample = [...this.patientRecordingChunks, ...this.assistantRecordingChunks]
      .reduce((maximum, chunk) => Math.max(maximum, chunk.offset + chunk.samples.length), elapsedSamples);
    return {
      wav: encodeStereoWav(this.assistantRecordingChunks, this.patientRecordingChunks, lastSample, 16000),
      durationMs: Math.round((lastSample / 16000) * 1000),
    };
  }

  async stopLocalMedia() {
    this.clearPlayback();
    this.worklet?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.audioContext?.close().catch(() => {});
    this.worklet = null;
    this.stream = null;
    this.audioContext = null;
  }
}

async function startCall() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('This browser does not support microphone capture.', true);
    return;
  }
  if (state.call) return;
  stopVoicePreview();
  setCallControls({ connecting: true });
  try {
    setCallStatus('Connecting to Asha…');
    $('#call-hint').textContent = 'Speak naturally — you can interrupt at any time';
    $('#transcript').hidden = false;
    state.call = new VoiceCall();
    await state.call.start();
  } catch (error) {
    await state.call?.stopLocalMedia();
    state.call = null;
    void prepareVoiceSession().catch(() => undefined);
    endCallUi();
    showToast(
      error?.name === 'NotAllowedError'
        ? 'Microphone permission was not granted.'
        : error?.message || 'Could not start the demo call.',
      true,
    );
  }
}

async function endCurrentCall() {
  const call = state.call;
  if (!call) return;
  $('#end-call-button').disabled = true;
  state.call = null;
  await call.end();
  endCallUi();
  await loadDashboard();
}

function toggleMute() {
  if (!state.call?.ready) return;
  const muted = state.call.setMuted(!state.call.muted);
  const button = $('#mute-button');
  button.setAttribute('aria-pressed', String(muted));
  $('#mute-button-label').textContent = muted ? 'Unmute' : 'Mute';
  setCallStatus(muted ? 'Muted · Asha cannot hear you' : 'Connected · Asha is listening');
}

function endCallUi() {
  clearInterval(state.timer);
  state.timer = null;
  state.seconds = 0;
  $('#call-timer').textContent = '00:00';
  $('#call-hint').textContent = 'Your browser will ask for microphone access';
  $('.phone-card').classList.remove('live');
  setCallControls({ active: false });
  activateLanguage('kn');
  setCallStatus('Ready for a demo call');
}

function setCallControls({ active = false, connecting = false } = {}) {
  $('#start-call-button').disabled = active || connecting;
  $('#mute-button').disabled = !active;
  $('#end-call-button').disabled = !active && !connecting;
  if (!active) {
    $('#mute-button').setAttribute('aria-pressed', 'false');
    $('#mute-button-label').textContent = 'Mute';
  }
}

function setCallStatus(value) { $('#call-state').textContent = value; }
function startTimer() {
  clearInterval(state.timer);
  state.seconds = 0;
  state.timer = setInterval(() => {
    state.seconds += 1;
    const minutes = String(Math.floor(state.seconds / 60)).padStart(2, '0');
    const seconds = String(state.seconds % 60).padStart(2, '0');
    $('#call-timer').textContent = `${minutes}:${seconds}`;
  }, 1000);
}

function appendTranscript(speaker, text) {
  const body = $('#transcript-body');
  let last = body.lastElementChild;
  if (!last || last.dataset.speaker !== speaker) {
    last = document.createElement('p');
    last.className = 'utterance';
    last.dataset.speaker = speaker;
    const label = document.createElement('b');
    label.textContent = speaker === 'patient' ? 'You · ' : 'Asha · ';
    const content = document.createElement('span');
    last.append(label, content);
    body.append(last);
  }
  last.querySelector('span').textContent += text;
  body.scrollTop = body.scrollHeight;
}

async function loadConfig() {
  try {
    state.config = await api('/api/config');
    $('#clinic-name').textContent = state.config.clinicName;
    $('#whatsapp-status').textContent = `${titleCase(state.config.integrations.whatsapp)} adapter active`;
    $('#telephony-status').textContent = `${titleCase(state.config.integrations.telephony)} webhook active`;
    const pill = $('#system-pill');
    pill.querySelector('span').textContent = state.config.voiceConfigured ? 'System ready' : 'Voice setup needed';
    pill.classList.toggle('error', !state.config.voiceConfigured);
    $('#voice-engine-ready').textContent = state.config.voiceConfigured ? 'Ready' : 'Setup';
    renderVoiceOptions(state.config.receptionist);
  } catch {
    $('#system-pill').classList.add('error');
    $('#system-pill span').textContent = 'Server unavailable';
  }
}

async function loadDashboard() {
  try {
    state.dashboard = await api('/api/dashboard');
    $('#patient-count').textContent = state.dashboard.stats.patients;
    $('#appointment-count').textContent = state.dashboard.stats.upcomingAppointments;
    $('#slot-count').textContent = state.dashboard.stats.availableSlots;
    $('#call-count').textContent = state.dashboard.callHistoryLocked ? '—' : state.dashboard.calls.filter((call) => call.recordingStatus === 'ready').length;
    renderAppointments(state.dashboard.appointments);
    renderSlots(state.dashboard.slots.filter((slot) => slot.status === 'available').slice(0, 8));
    renderPatients(state.dashboard.patients);
    renderCallHistoryAccess();
    if (!state.dashboard.callHistoryLocked) renderCalls(state.dashboard.calls);
  } catch (error) {
    showToast(error.message || 'Could not load clinic data.', true);
  }
}

function renderCallHistoryAccess() {
  const locked = Boolean(state.dashboard?.callHistoryLocked);
  $('#call-history-lock').hidden = !locked;
  $('#call-history-content').hidden = locked;
  $('#call-history-logout').hidden = locked;
  $('#call-search').disabled = locked;
  $('#call-status-filter').disabled = locked;
}

function renderCalls(calls) {
  const target = $('#call-table-body');
  const query = ($('#call-search')?.value || '').trim().toLowerCase();
  const status = $('#call-status-filter')?.value || 'all';
  const filtered = calls.filter((call) => {
    const matchesStatus = status === 'all' || call.status === status;
    const haystack = `${call.id} ${call.providerCallId || ''} ${call.patientName || ''} ${call.patientPhone || call.callerPhone || ''}`.toLowerCase();
    return matchesStatus && (!query || haystack.includes(query));
  });
  if (!filtered.length) {
    const row = document.createElement('tr');
    const cell = el('td', 'empty-state', calls.length ? 'No calls match these filters.' : 'Complete a demo call to create the first recording.');
    cell.colSpan = 9;
    row.append(cell);
    target.replaceChildren(row);
    return;
  }
  target.replaceChildren(...filtered.map((call) => {
    const row = document.createElement('tr');
    const date = new Date(call.startedAt);
    row.append(el('td', '', date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })));
    const identity = el('td', 'call-identity');
    identity.append(el('strong', '', call.patientName || call.patientPhone || call.callerPhone || 'Unidentified caller'), el('code', '', call.id));
    row.append(identity);
    const patient = el('td', 'call-patient-details');
    patient.append(el('strong', '', call.patientAge == null ? genderName(call.patientGender) : `${call.patientAge} · ${genderName(call.patientGender)}`));
    patient.append(el('small', '', call.patientPhone || call.callerPhone || 'Phone not collected'));
    patient.append(el('small', '', call.patientProblem || 'Reason not collected'));
    row.append(patient);
    const appointment = el('td', 'call-appointment');
    if (call.appointmentStartsAt) {
      appointment.append(el('strong', '', formatSlotDateTime(call.appointmentStartsAt)));
      appointment.append(el('small', '', [call.appointmentDoctorName, call.appointmentDepartment].filter(Boolean).join(' · ')));
    } else appointment.append(el('span', '', 'Not booked'));
    row.append(appointment, el('td', '', formatDuration(call.recordingDurationMs ?? callDurationMs(call))));
    const statusCell = el('td'); statusCell.append(el('span', `status-badge ${call.status}`, call.status)); row.append(statusCell);
    const recordingCell = el('td'); recordingCell.append(el('span', `recording-badge ${call.recordingStatus}`, call.recordingStatus)); row.append(recordingCell);
    row.append(el('td', '', languageName(call.language)));
    const action = el('td'); const button = el('button', 'view-call', 'Review'); button.type = 'button'; button.addEventListener('click', () => openCallDetail(call)); action.append(button); row.append(action);
    return row;
  }));
}

async function openCallDetail(call) {
  $('#call-detail-title').textContent = call.patientName || call.patientPhone || call.callerPhone || 'Unidentified caller';
  $('#call-detail-id').textContent = call.id;
  const summary = $('#call-detail-summary');
  const fields = [
    ['Started', new Date(call.startedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })],
    ['Duration', formatDuration(call.recordingDurationMs ?? callDurationMs(call))],
    ['Status', titleCase(call.status)],
    ['Language', languageName(call.language)],
    ['Patient', call.patientName || 'Not collected'],
    ['Phone', call.patientPhone || call.callerPhone || 'Not collected'],
    ['Age & gender', call.patientAge == null ? 'Not collected' : `${call.patientAge} · ${genderName(call.patientGender)}`],
    ['Reason', call.patientProblem || 'Not collected'],
    ['Appointment', call.appointmentStartsAt ? formatSlotDateTime(call.appointmentStartsAt) : 'Not booked'],
    ['Doctor', call.appointmentDoctorName || 'Not assigned'],
  ];
  summary.replaceChildren(...fields.map(([label, value]) => { const item = document.createElement('div'); item.append(el('span', '', label), el('strong', '', value)); return item; }));

  const player = $('#call-recording-player');
  const download = $('#call-recording-download');
  const message = $('#call-recording-message');
  player.pause(); player.removeAttribute('src'); player.load();
  if (call.recordingUrl) {
    player.hidden = true; download.hidden = true; message.textContent = 'Loading protected recording…';
    try {
      const response = await fetch(apiUrl(call.recordingUrl), { headers: historyToken ? { authorization: `Bearer ${historyToken}` } : {} });
      if (!response.ok) throw new Error('Recording could not be opened.');
      const source = URL.createObjectURL(await response.blob());
      player.src = source; player.hidden = false; download.href = source; download.download = `call-${call.id}.wav`; download.hidden = false;
      message.textContent = `${formatBytes(call.recordingBytes)} · lossless stereo WAV`;
    } catch (error) {
      message.textContent = error.message || 'Recording could not be opened.';
    }
  } else {
    player.hidden = true; download.hidden = true;
    message.textContent = call.recordingStatus === 'failed' ? 'The recording could not be stored.' : call.recordingStatus === 'pending' ? 'Recording is still being saved.' : 'No recording is available for this call.';
  }

  const transcript = Array.isArray(call.transcript) ? call.transcript : [];
  $('#call-transcript-count').textContent = `${transcript.length} turn${transcript.length === 1 ? '' : 's'}`;
  const transcriptTarget = $('#call-detail-transcript');
  transcriptTarget.replaceChildren(...(transcript.length ? transcript.map((turn) => {
    const item = el('div', `history-turn ${turn.speaker}`);
    item.append(el('strong', '', turn.speaker === 'assistant' ? 'Asha' : turn.speaker === 'patient' ? 'Patient' : 'System'), document.createTextNode(turn.text));
    return item;
  }) : [el('div', 'empty-state', 'No transcript was captured for this call.')]));
  $('#call-detail-dialog').showModal();
}

function callDurationMs(call) {
  return call.endedAt ? Math.max(0, new Date(call.endedAt) - new Date(call.startedAt)) : 0;
}
function formatDuration(milliseconds) { const seconds = Math.round((milliseconds || 0) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function formatBytes(bytes) { if (!bytes) return '0 KB'; return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`; }

function renderAppointments(appointments) {
  const target = $('#appointment-list');
  if (!appointments.length) {
    target.innerHTML = '<div class="empty-state">No bookings yet.<br />Complete a demo call to create the first appointment.</div>';
    return;
  }
  target.replaceChildren(...appointments.filter((item) => item.status === 'booked').slice(0, 6).map((item) => {
    const date = new Date(item.startsAt);
    const wrapper = el('div', 'appointment-item');
    const dateBox = el('div', 'date-box');
    dateBox.append(el('small', '', date.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' })), el('strong', '', date.toLocaleDateString('en-IN', { day: '2-digit', timeZone: 'Asia/Kolkata' })));
    const copy = el('div', 'appointment-copy');
    copy.append(el('strong', '', item.patientName), el('small', '', `${item.doctorName} · ${item.reason}`));
    const time = el('span', 'time-badge', date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }));
    wrapper.append(dateBox, copy, time);
    return wrapper;
  }));
}

function renderSlots(slots) {
  const target = $('#slot-list');
  target.replaceChildren(...slots.map((slot) => {
    const date = new Date(slot.startsAt);
    const wrapper = el('div', 'slot-item');
    const copy = el('div');
    copy.append(el('strong', '', date.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })), el('small', '', `${slot.doctorName} · ${slot.department}`));
    wrapper.append(copy, el('time', '', date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })));
    return wrapper;
  }));
}

function renderPatients(patients) {
  const target = $('#patient-table-body');
  if (!patients.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.className = 'empty-state';
    cell.textContent = 'No patients saved yet.';
    row.append(cell);
    target.replaceChildren(row);
    return;
  }
  target.replaceChildren(...patients.map((patient) => {
    const row = document.createElement('tr');
    [patient.fullName, patient.age, genderName(patient.gender), patient.latestProblem || '—', patient.phone, languageName(patient.preferredLanguage)].forEach((value, index) => {
      const cell = el('td', index === 3 ? 'problem-cell' : '', String(value));
      if (index === 3 && patient.latestAppointmentAt) {
        cell.title = `Latest appointment: ${formatSlotDateTime(patient.latestAppointmentAt)}`;
      }
      row.append(cell);
    });
    const action = el('td');
    const button = el('button', 'edit-patient', 'Edit');
    button.type = 'button';
    button.addEventListener('click', () => openPatientDialog(patient));
    action.append(button);
    row.append(action);
    return row;
  }));
}

function openPatientDialog(patient = null) {
  const isEditing = Boolean(patient);
  $('#patient-dialog-title').textContent = isEditing ? 'Edit patient' : 'Add patient & appointment';
  $('#patient-id').value = patient?.id || '';
  $('#patient-name').value = patient?.fullName || '';
  $('#patient-age').value = patient?.age ?? '';
  $('#patient-gender').value = patient?.gender || 'unspecified';
  $('#patient-phone').value = patient?.phone || '';
  $('#patient-language').value = patient?.preferredLanguage || 'kn';
  $('#patient-problem').value = '';
  $('#patient-notes').value = patient?.notes || '';
  const appointmentFields = $('#patient-appointment-fields');
  appointmentFields.hidden = isEditing;
  $('#patient-problem').required = !isEditing;
  $('#patient-slot').required = !isEditing;
  $('#save-patient-button').textContent = isEditing ? 'Save patient' : 'Book appointment';
  if (isEditing) $('#save-patient-button').disabled = false;
  else renderPatientSlotOptions();
  $('#patient-form-error').textContent = '';
  $('#patient-dialog').showModal();
}

function renderPatientSlotOptions() {
  const select = $('#patient-slot');
  const slots = (state.dashboard?.slots || []).filter((slot) => slot.status === 'available');
  if (!slots.length) {
    const option = new Option('No appointment slots available', '');
    option.disabled = true;
    option.selected = true;
    select.replaceChildren(option);
    $('#save-patient-button').disabled = true;
    return;
  }
  select.replaceChildren(...slots.map((slot) => {
    const option = new Option(
      `${formatSlotDateTime(slot.startsAt)} · ${slot.doctorName}`,
      slot.id,
    );
    return option;
  }));
  $('#save-patient-button').disabled = false;
}

async function savePatient(event) {
  event.preventDefault();
  const id = $('#patient-id').value;
  const patient = { fullName: $('#patient-name').value, age: Number($('#patient-age').value), gender: $('#patient-gender').value, phone: $('#patient-phone').value, preferredLanguage: $('#patient-language').value, notes: $('#patient-notes').value };
  try {
    if (id) {
      await api(`/api/patients/${id}`, { method: 'PATCH', body: patient });
    } else {
      await api('/api/appointments/book', {
        method: 'POST',
        body: {
          ...patient,
          reason: $('#patient-problem').value,
          slotId: $('#patient-slot').value,
        },
      });
    }
    $('#patient-dialog').close();
    showToast(id ? 'Patient details updated.' : 'Patient and appointment added.');
    await loadDashboard();
  } catch (error) { $('#patient-form-error').textContent = error.message; }
}

async function importCsv(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV must include a header and at least one patient.');
  const headers = parseCsvLine(lines[0]).map((value) => value.trim().toLowerCase().replace(/\s+/g, ''));
  const find = (...names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0);
  const nameIndex = find('fullname', 'name');
  const ageIndex = find('age');
  const genderIndex = find('gender', 'sex');
  const phoneIndex = find('phone', 'phonenumber', 'mobile');
  const languageIndex = find('preferredlanguage', 'language');
  const notesIndex = find('notes', 'note');
  if ([nameIndex, ageIndex, phoneIndex].some((index) => index === undefined)) throw new Error('CSV needs name, age, and phone columns.');
  const patients = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return { fullName: cells[nameIndex], age: Number(cells[ageIndex]), gender: genderIndex === undefined ? 'unspecified' : normalizeGender(cells[genderIndex]), phone: cells[phoneIndex], preferredLanguage: normalizeLanguage(cells[languageIndex] || 'kn'), notes: notesIndex === undefined ? '' : cells[notesIndex] || '' };
  });
  const result = await api('/api/patients/import', { method: 'POST', body: { patients } });
  showToast(`${result.imported} patient record${result.imported === 1 ? '' : 's'} imported.`);
  await loadDashboard();
}

async function saveSlot(event) {
  event.preventDefault();
  try {
    const start = localInputToIst($('#slot-start').value);
    const end = localInputToIst($('#slot-end').value);
    if (new Date(end) <= new Date(start)) throw new Error('End time must be after start time.');
    await api('/api/slots', { method: 'POST', body: { startsAt: start, endsAt: end, doctorName: $('#slot-doctor').value, department: $('#slot-department').value } });
    $('#slot-dialog').close();
    showToast('Availability slot added.');
    await loadDashboard();
  } catch (error) { $('#slot-form-error').textContent = error.message; }
}

function renderVoiceOptions(receptionist) {
  const target = $('#voice-options');
  if (!receptionist?.voices) return;
  target.replaceChildren(...receptionist.voices.map((voice) => {
    const option = el('div', 'voice-option');
    option.dataset.voice = voice.id;
    option.dataset.selected = String(voice.id === receptionist.voice);

    const selectButton = el('button', 'voice-select');
    selectButton.type = 'button';
    selectButton.setAttribute('aria-pressed', String(voice.id === receptionist.voice));
    selectButton.append(el('strong', '', voice.label), el('small', '', voice.style));
    selectButton.addEventListener('click', () => selectVoice(voice.id));

    const previewButton = el('button', 'voice-preview');
    previewButton.type = 'button';
    previewButton.setAttribute('aria-label', `Preview ${voice.label} voice`);
    previewButton.append(el('span', 'voice-preview-icon', '▶'), el('span', 'voice-preview-label', 'Preview'));
    previewButton.addEventListener('click', () => toggleVoicePreview(voice, previewButton));

    option.append(selectButton, previewButton);
    getVoicePreview(voice);
    return option;
  }));
}

function getVoicePreview(voice) {
  if (!state.voicePreviews.has(voice.id)) {
    const audio = new Audio(assetUrl(voice.previewUrl));
    audio.preload = 'auto';
    audio.load();
    state.voicePreviews.set(voice.id, audio);
  }
  return state.voicePreviews.get(voice.id);
}

async function toggleVoicePreview(voice, button) {
  const audio = getVoicePreview(voice);
  if (state.activeVoicePreview?.audio === audio && !audio.paused) {
    stopVoicePreview();
    return;
  }

  stopVoicePreview();
  state.activeVoicePreview = { audio, button };
  button.classList.add('playing');
  button.setAttribute('aria-label', `Stop ${voice.label} voice preview`);
  button.querySelector('.voice-preview-icon').textContent = '■';
  button.querySelector('.voice-preview-label').textContent = 'Stop';
  audio.currentTime = 0;
  audio.onended = stopVoicePreview;
  audio.onerror = () => {
    stopVoicePreview();
    showToast('Could not load the cached voice preview.', true);
  };
  try {
    await audio.play();
  } catch {
    stopVoicePreview();
    showToast('Your browser blocked preview playback. Please try again.', true);
  }
}

function stopVoicePreview() {
  const active = state.activeVoicePreview;
  if (!active) return;
  active.audio.pause();
  active.audio.currentTime = 0;
  active.button.classList.remove('playing');
  const voice = active.button.closest('.voice-option')?.dataset.voice || '';
  active.button.setAttribute('aria-label', `Preview ${voice} voice`);
  active.button.querySelector('.voice-preview-icon').textContent = '▶';
  active.button.querySelector('.voice-preview-label').textContent = 'Preview';
  state.activeVoicePreview = null;
}

async function selectVoice(voice) {
  stopVoicePreview();
  const buttons = $$('.voice-select, .voice-preview');
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const receptionist = await api('/api/settings/receptionist', { method: 'PATCH', body: { voice } });
    state.config.receptionist = receptionist;
    renderVoiceOptions(receptionist);
    showToast(`${voice} will be used for the next call.`);
  } catch (error) {
    showToast(error.message || 'Could not update the receptionist voice.', true);
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function api(url, options = {}) {
  const response = await fetch(apiUrl(url), { ...options, headers: { 'content-type': 'application/json', ...(historyToken ? { authorization: `Bearer ${historyToken}` } : {}), ...(options.headers || {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  return payload;
}

function downsampleToPcm16(samples, inputRate, outputRate) {
  const ratio = inputRate / outputRate;
  const length = Math.floor(samples.length / ratio);
  const pcm = new Int16Array(length);
  for (let outputIndex = 0; outputIndex < length; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(Math.floor((outputIndex + 1) * ratio), samples.length);
    let total = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) total += samples[inputIndex];
    const value = Math.max(-1, Math.min(1, total / Math.max(1, end - start)));
    pcm[outputIndex] = value < 0 ? value * 32768 : value * 32767;
  }
  return pcm;
}

function resamplePcm16(bytes, inputRate, outputRate) {
  const input = new Int16Array(Math.floor(bytes.byteLength / 2));
  const view = new DataView(bytes.buffer, bytes.byteOffset, input.length * 2);
  for (let index = 0; index < input.length; index += 1) input[index] = view.getInt16(index * 2, true);
  if (inputRate === outputRate) return input;
  const output = new Int16Array(Math.max(1, Math.floor(input.length * outputRate / inputRate)));
  const ratio = inputRate / outputRate;
  for (let index = 0; index < output.length; index += 1) {
    const source = index * ratio;
    const before = Math.floor(source);
    const after = Math.min(input.length - 1, before + 1);
    const mix = source - before;
    output[index] = Math.round(input[before] * (1 - mix) + input[after] * mix);
  }
  return output;
}

function encodeStereoWav(leftChunks, rightChunks, totalSamples, sampleRate) {
  const left = new Int16Array(totalSamples);
  const right = new Int16Array(totalSamples);
  for (const chunk of leftChunks) left.set(chunk.samples.subarray(0, totalSamples - chunk.offset), chunk.offset);
  for (const chunk of rightChunks) right.set(chunk.samples.subarray(0, totalSamples - chunk.offset), chunk.offset);
  const buffer = new ArrayBuffer(44 + totalSamples * 4);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF'); view.setUint32(4, 36 + totalSamples * 4, true);
  writeAscii(view, 8, 'WAVE'); writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data'); view.setUint32(40, totalSamples * 4, true);
  for (let index = 0; index < totalSamples; index += 1) {
    view.setInt16(44 + index * 4, left[index], true);
    view.setInt16(46 + index * 4, right[index], true);
  }
  return buffer;
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
function base64ToUint8(value) { const binary = atob(value); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i); return bytes; }
function el(tag, className = '', text = '') { const node = document.createElement(tag); if (className) node.className = className; if (text !== '') node.textContent = text; return node; }
function titleCase(value) { return value ? value[0].toUpperCase() + value.slice(1) : ''; }
function languageName(code) { return { kn: 'Kannada', en: 'English', hinglish: 'Hinglish', te: 'Telugu' }[code] || code; }
function genderName(code) { return { female: 'Female', male: 'Male', non_binary: 'Non-binary', prefer_not_to_say: 'Prefer not to say', unspecified: 'Not recorded' }[code] || 'Not recorded'; }
function normalizeLanguage(value) { const text = String(value).trim().toLowerCase(); return { kannada: 'kn', kn: 'kn', english: 'en', en: 'en', hinglish: 'hinglish', hindi: 'hinglish', telugu: 'te', te: 'te' }[text] || 'kn'; }
function normalizeGender(value) { const text = String(value || '').trim().toLowerCase().replace(/[ -]+/g, '_'); return { female: 'female', woman: 'female', f: 'female', male: 'male', man: 'male', m: 'male', non_binary: 'non_binary', nonbinary: 'non_binary', prefer_not_to_say: 'prefer_not_to_say', undisclosed: 'prefer_not_to_say' }[text] || 'unspecified'; }
function activateLanguage(code) { $$('.language-chip').forEach((button) => { const selected = button.dataset.languageCode === code; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); }); }
function localInputToIst(value) { return `${value}:00+05:30`; }
function formatSlotDateTime(value) { const date = new Date(value); return `${date.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })}, ${date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`; }
function parseCsvLine(line) { const values = []; let value = ''; let quoted = false; for (let i = 0; i < line.length; i += 1) { const char = line[i]; if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; } else if (char === '"') quoted = !quoted; else if (char === ',' && !quoted) { values.push(value.trim()); value = ''; } else value += char; } values.push(value.trim()); return values; }
let toastTimer;
function showToast(message, error = false) { const toast = $('#toast'); toast.textContent = message; toast.classList.toggle('error', error); toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3500); }

$('#start-call-button').addEventListener('click', startCall);
$('#mute-button').addEventListener('click', toggleMute);
$('#end-call-button').addEventListener('click', endCurrentCall);
$('#clear-transcript').addEventListener('click', () => { $('#transcript-body').replaceChildren(); });
$$('.language-chip').forEach((button) => button.addEventListener('click', () => { activateLanguage(button.dataset.languageCode); state.call?.switchLanguage(button.dataset.languageName); }));
$('#refresh-dashboard').addEventListener('click', loadDashboard);
$('#call-search').addEventListener('input', () => renderCalls(state.dashboard?.calls || []));
$('#call-status-filter').addEventListener('change', () => renderCalls(state.dashboard?.calls || []));
$('#call-history-login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('#call-history-login-error');
  error.textContent = '';
  try {
    const session = await api('/api/call-history/login', { method: 'POST', body: { passcode: $('#call-history-passcode').value } });
    historyToken = session.token || '';
    if (historyToken) sessionStorage.setItem('namma_history_token', historyToken);
    $('#call-history-passcode').value = '';
    await loadDashboard();
  } catch (loginError) {
    error.textContent = loginError.message || 'Could not unlock call history.';
  }
});
$('#call-history-logout').addEventListener('click', async () => {
  await api('/api/call-history/logout', { method: 'POST', body: {} });
  historyToken = '';
  sessionStorage.removeItem('namma_history_token');
  await loadDashboard();
});
$('#close-call-detail').addEventListener('click', () => $('#call-detail-dialog').close());
$('#add-patient-button').addEventListener('click', () => openPatientDialog());
$('#patient-form').addEventListener('submit', savePatient);
$('#cancel-patient').addEventListener('click', () => $('#patient-dialog').close());
$('#csv-upload').addEventListener('change', async (event) => { try { if (event.target.files[0]) await importCsv(event.target.files[0]); } catch (error) { showToast(error.message, true); } finally { event.target.value = ''; } });
$('#add-slot-button').addEventListener('click', () => { const soon = new Date(Date.now() + 86400000); const date = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`; $('#slot-start').value = `${date}T09:30`; $('#slot-end').value = `${date}T10:00`; $('#slot-form-error').textContent = ''; $('#slot-dialog').showModal(); });
$('#slot-form').addEventListener('submit', saveSlot);
$('#cancel-slot').addEventListener('click', () => $('#slot-dialog').close());

const voiceWarmup = prepareVoiceSession().catch(() => undefined);
await Promise.all([loadConfig(), loadDashboard(), voiceWarmup]);
