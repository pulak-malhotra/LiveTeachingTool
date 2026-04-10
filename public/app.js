// ── DOM elements ────────────────────────────────────────────────────────────

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const btnGenerate = document.getElementById('btn-generate');

const topicInput = document.getElementById('topic-input');
const btnAddTopic = document.getElementById('btn-add-topic');
const topicsList = document.getElementById('topics-list');
const topicsPct = document.getElementById('topics-pct');
const topicsProgressBar = document.getElementById('topics-progress-bar');

const standardInput = document.getElementById('standard-input');
const btnAddStandard = document.getElementById('btn-add-standard');
const standardsList = document.getElementById('standards-list');
const standardsPct = document.getElementById('standards-pct');
const standardsProgressBar = document.getElementById('standards-progress-bar');

const activityFeed = document.getElementById('activity-feed');
const suggestionBox = document.getElementById('suggestion-box');
const suggestionText = document.getElementById('suggestion-text');
const agentDot = document.querySelector('.agent-dot');
const agentStateText = document.getElementById('agent-state-text');

const transcriptContent = document.getElementById('transcript-content');
const coverageDashboard = document.getElementById('coverage-dashboard');
const quizPanel = document.getElementById('quiz-panel');
const quizTitle = document.getElementById('quiz-title');
const quizQuestions = document.getElementById('quiz-questions');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

// ── State ───────────────────────────────────────────────────────────────────

let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let firstChunkTimer = null;
let fullTranscript = '';
let isRecording = false;
let stream = null;
let checkingTopics = false;
let chunkCount = 0;

let topics = [];
let standards = [];

// ── Agent state ─────────────────────────────────────────────────────────────

function setAgentState(state, label) {
  agentDot.className = 'agent-dot ' + state;
  agentStateText.textContent = label;
}

// ── Activity feed ───────────────────────────────────────────────────────────

function logActivity(icon, message, type = 'info') {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const entry = document.createElement('div');
  entry.className = `activity-entry type-${type}`;
  entry.innerHTML = `
    <span class="activity-icon">${icon}</span>
    <span class="activity-time">${time}</span>
    <span class="activity-msg">${message}</span>
  `;
  activityFeed.appendChild(entry);
  activityFeed.scrollTop = activityFeed.scrollHeight;
}

function showSuggestion(text) {
  if (!text) return;
  suggestionText.textContent = text;
  suggestionBox.classList.remove('hidden');
  // Re-trigger animation on each new suggestion
  suggestionBox.style.animation = 'none';
  suggestionBox.offsetHeight; // force reflow
  suggestionBox.style.animation = '';
}

// ── Checklist helpers ───────────────────────────────────────────────────────

function addItem(list, text, listEl, pctEl, barEl) {
  if (!text.trim()) return;
  list.push({ text: text.trim(), covered: false });
  renderList(list, listEl, pctEl, barEl);
}

function removeItem(list, index, listEl, pctEl, barEl) {
  list.splice(index, 1);
  renderList(list, listEl, pctEl, barEl);
}

function renderList(list, listEl, pctEl, barEl) {
  listEl.innerHTML = '';
  list.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'checklist-item' + (item.covered ? ' covered' : '');
    div.innerHTML = `
      <div class="item-check"></div>
      <span class="item-text">${item.text}</span>
      <button class="item-remove">&times;</button>
    `;
    div.querySelector('.item-remove').addEventListener('click', () => {
      removeItem(list, i, listEl, pctEl, barEl);
    });
    listEl.appendChild(div);
  });
  updateProgress(list, pctEl, barEl);
}

function updateProgress(list, pctEl, barEl) {
  const total = list.length;
  const covered = list.filter((t) => t.covered).length;
  const pct = total === 0 ? 0 : Math.round((covered / total) * 100);
  pctEl.textContent = `${pct}%`;
  barEl.style.width = `${pct}%`;
}

// ── Coverage check via Claude ───────────────────────────────────────────────

async function checkCoverage() {
  const uncheckedTopics = topics.some((t) => !t.covered);
  const uncheckedStandards = standards.some((s) => !s.covered);
  if ((!uncheckedTopics && !uncheckedStandards) || !fullTranscript.trim() || checkingTopics) return;

  checkingTopics = true;
  setAgentState('thinking', 'Analyzing');
  logActivity('\u{1F50D}', 'Analyzing transcript for topic & objective coverage...', 'thinking');

  try {
    const res = await fetch('/api/check-topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: fullTranscript,
        topics: topics.map((t) => t.text),
        standards: standards.map((s) => s.text),
      }),
    });
    const data = await res.json();

    let changed = false;
    let newlyCovered = [];

    if (data.coveredTopics && Array.isArray(data.coveredTopics)) {
      data.coveredTopics.forEach((idx) => {
        if (topics[idx] && !topics[idx].covered) {
          topics[idx].covered = true;
          changed = true;
          newlyCovered.push(topics[idx].text);
        }
      });
    }
    if (data.coveredStandards && Array.isArray(data.coveredStandards)) {
      data.coveredStandards.forEach((idx) => {
        if (standards[idx] && !standards[idx].covered) {
          standards[idx].covered = true;
          changed = true;
          newlyCovered.push(standards[idx].text);
        }
      });
    }

    if (changed) {
      renderList(topics, topicsList, topicsPct, topicsProgressBar);
      renderList(standards, standardsList, standardsPct, standardsProgressBar);
      newlyCovered.forEach((name) => {
        logActivity('\u2705', `Covered: "${name}"`, 'success');
      });
    } else {
      logActivity('\u{1F4CB}', 'No new coverage detected yet', 'info');
    }

    if (data.suggestion) {
      logActivity('\u{1F4A1}', data.suggestion, 'suggestion');
      showSuggestion(data.suggestion);
    }

    // Check if all done
    const allTopicsDone = topics.length > 0 && topics.every((t) => t.covered);
    const allStandardsDone = standards.length > 0 && standards.every((s) => s.covered);
    if (allTopicsDone && allStandardsDone) {
      logActivity('\u{1F389}', 'All topics and learning objectives covered!', 'success');
    }
  } catch (err) {
    console.error('Coverage check error:', err);
    logActivity('\u26A0\uFE0F', 'Coverage check failed', 'info');
  } finally {
    checkingTopics = false;
    if (isRecording) {
      setAgentState('listening', 'Listening');
    } else {
      setAgentState('idle', 'Idle');
    }
  }
}

// ── Audio recording ─────────────────────────────────────────────────────────

async function startRecording() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    alert('Microphone access denied. Please allow mic access and try again.');
    return;
  }

  isRecording = true;
  fullTranscript = '';
  chunkCount = 0;
  transcriptContent.innerHTML = '';

  btnStart.classList.add('hidden');
  btnStop.classList.remove('hidden');
  btnGenerate.classList.add('hidden');
  quizPanel.classList.add('hidden');
  coverageDashboard.classList.remove('hidden');

  setAgentState('listening', 'Listening');
  logActivity('\u{1F3A4}', 'Microphone activated — listening to your talk', 'success');

  startChunk();

  // Send first chunk after 5s for faster initial feedback, then every 10s
  firstChunkTimer = setTimeout(() => {
    if (isRecording) {
      shipChunkAndRestart();
      recordingInterval = setInterval(() => {
        if (isRecording) shipChunkAndRestart();
      }, 10000);
    }
  }, 5000);
}

function startChunk() {
  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };
  mediaRecorder.start();
}

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'audio/webm';
}

async function shipChunkAndRestart() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  const stopped = new Promise((resolve) => { mediaRecorder.onstop = resolve; });
  mediaRecorder.stop();
  await stopped;

  const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
  transcribeBlob(blob);

  if (isRecording) startChunk();
}

async function stopRecording() {
  isRecording = false;
  clearTimeout(firstChunkTimer);
  clearInterval(recordingInterval);

  btnStop.classList.add('hidden');

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    const stopped = new Promise((resolve) => { mediaRecorder.onstop = resolve; });
    mediaRecorder.stop();
    await stopped;

    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
    await transcribeBlob(blob);
  }

  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  setAgentState('idle', 'Idle');
  logActivity('\u{1F6D1}', `Session ended — ${chunkCount} chunks transcribed, ${fullTranscript.split(/\s+/).length} words captured`, 'info');

  window.location.href = 'https://wayground.com/admin/ai';
}

// ── Transcription ───────────────────────────────────────────────────────────

async function transcribeBlob(blob) {
  if (blob.size < 1000) return;

  setAgentState('thinking', 'Transcribing');
  logActivity('\u{1F4DD}', 'Sending audio to Whisper for transcription...', 'thinking');

  const formData = new FormData();
  formData.append('audio', blob, 'recording.webm');

  try {
    const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.text && data.text.trim()) {
      const text = data.text.trim();
      const wordCount = text.split(/\s+/).length;
      chunkCount++;
      appendTranscript(text);

      if (isRecording) setAgentState('listening', 'Listening');
      logActivity('\u2705', `+${wordCount} words transcribed (chunk ${chunkCount})`, 'success');

      // Fire-and-forget coverage check
      if (topics.some((t) => !t.covered) || standards.some((s) => !s.covered)) {
        checkCoverage();
      }
    } else {
      if (isRecording) setAgentState('listening', 'Listening');
      logActivity('\u{1F507}', 'No speech detected in chunk', 'info');
    }
  } catch (err) {
    console.error('Transcription error:', err);
    if (isRecording) setAgentState('listening', 'Listening');
    logActivity('\u26A0\uFE0F', 'Transcription failed — retrying next chunk', 'info');
  }
}

function appendTranscript(text) {
  const placeholder = transcriptContent.querySelector('.placeholder');
  if (placeholder) placeholder.remove();

  fullTranscript += (fullTranscript ? ' ' : '') + text;

  const span = document.createElement('span');
  span.className = 'chunk new';
  span.textContent = (transcriptContent.children.length > 0 ? ' ' : '') + text;
  transcriptContent.appendChild(span);

  transcriptContent.scrollLeft = transcriptContent.scrollWidth;
  setTimeout(() => span.classList.remove('new'), 500);
}

// ── Quiz generation ─────────────────────────────────────────────────────────

async function generateQuiz() {
  showLoading('Generating quiz from transcript...');
  logActivity('\u{1F9E0}', 'Generating quiz questions from transcript...', 'thinking');

  try {
    const res = await fetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: fullTranscript }),
    });

    const quiz = await res.json();
    if (quiz.error) throw new Error(quiz.error);

    logActivity('\u2705', `Quiz generated: "${quiz.title}" with ${quiz.questions.length} questions`, 'success');

    renderQuiz(quiz);
    coverageDashboard.classList.add('hidden');
    quizPanel.classList.remove('hidden');
    btnGenerate.classList.add('hidden');
  } catch (err) {
    console.error('Quiz generation error:', err);
    logActivity('\u26A0\uFE0F', 'Quiz generation failed', 'info');
    alert('Failed to generate quiz. Please try again.');
  } finally {
    hideLoading();
  }
}

function renderQuiz(quiz) {
  quizTitle.textContent = quiz.title || 'Generated Quiz';
  quizQuestions.innerHTML = '';

  quiz.questions.forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'quiz-question';
    div.style.animationDelay = `${i * 0.08}s`;

    div.innerHTML = `
      <div class="q-number">Question ${i + 1}</div>
      <div class="q-text">${q.question}</div>
      <div class="q-options">
        ${q.options
          .map(
            (opt, idx) =>
              `<div class="q-option ${idx === q.correctIndex ? 'correct' : ''}">${opt}</div>`
          )
          .join('')}
      </div>
    `;

    quizQuestions.appendChild(div);
  });
}

// ── UI helpers ──────────────────────────────────────────────────────────────

function showLoading(text) {
  loadingText.textContent = text;
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

// ── Event listeners ─────────────────────────────────────────────────────────

btnStart.addEventListener('click', startRecording);
btnStop.addEventListener('click', stopRecording);
btnGenerate.addEventListener('click', generateQuiz);

btnAddTopic.addEventListener('click', () => {
  addItem(topics, topicInput.value, topicsList, topicsPct, topicsProgressBar);
  topicInput.value = '';
  topicInput.focus();
});
topicInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addItem(topics, topicInput.value, topicsList, topicsPct, topicsProgressBar);
    topicInput.value = '';
  }
});

btnAddStandard.addEventListener('click', () => {
  addItem(standards, standardInput.value, standardsList, standardsPct, standardsProgressBar);
  standardInput.value = '';
  standardInput.focus();
});
standardInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addItem(standards, standardInput.value, standardsList, standardsPct, standardsProgressBar);
    standardInput.value = '';
  }
});

// ── Demo preset & autostart ─────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);

if (params.get('demo') === 'true') {
  const demoTopics = [
    'Three types of rocks (Igneous, Sedimentary, Metamorphic)',
    'How each rock type forms',
    'The rock cycle as a continuous loop',
    'Real-world uses of rocks',
    'Common misconceptions about rocks',
    'Tectonic plates and rock distribution',
  ];
  const demoObjectives = [
    'Classify rocks by formation process',
    'Explain how rocks transform from one type to another',
    'Identify real-world applications of each rock type',
    'Describe how fossils form in sedimentary layers',
  ];

  demoTopics.forEach((t) => addItem(topics, t, topicsList, topicsPct, topicsProgressBar));
  demoObjectives.forEach((s) => addItem(standards, s, standardsList, standardsPct, standardsProgressBar));

  logActivity('\u{1F4CB}', 'Demo preset loaded — topics & objectives pre-filled', 'info');
}

if (params.get('autostart') === 'true') {
  logActivity('\u{1F916}', 'Auto-start enabled — recording will begin in 2 seconds...', 'info');
  setTimeout(() => {
    startRecording();
  }, 2000);
} else {
  logActivity('\u{1F916}', 'WayAround ready. Add topics & learning objectives, then start listening.', 'info');
}
