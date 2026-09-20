import { loadReferenceClips, renderReference } from "./reference-clips.js";
import { LandmarkBuffer } from "./buffer.js";
import { startHolistic } from "./holistic.js";

const $ = (id) => document.getElementById(id);
const CAPTURE_SECONDS = 6;
const combinations = ["forward", "neutral", "back"].flatMap((lid) =>
  ["toward", "neutral", "away"].flatMap((hand) =>
    Array.from({ length: hand === "neutral" ? 2 : 1 }, (_, index) => ({ lid, hand, take: index + 1 })),
  ),
);

const reference = $("reference-content");
const signSelect = $("sign-select");
const recordButton = $("record-button");
const review = $("review-dialog");
const reviewVideo = $("review-video");
let personName = "", clips = [], tasks = [], taskIndex = 0, recordings = [];
let cameraStream = null, activeBuffer = null, captureStartedAt = 0, capturing = false, pending = null;

function safeName(value) { return value.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "").replace(/^_+|_+$/g, "") || "recorder"; }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function taskSlug(task) { return `lid_${task.lid}_hand_${task.hand}_take_${task.take}`; }
function taskKey(task) { return `${task.clip.label}\u0000${taskSlug(task)}`; }
function storageSlug(task) { return `tilt_${task.lid}_${task.hand}_${task.take}`; }
function apiFile(relative) { return `/api/sessions/${encodeURIComponent(personName)}/file/${relative.split("/").map(encodeURIComponent).join("/")}`; }
async function putJson(relative, value) {
  const response = await fetch(apiFile(relative), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value, null, 2) });
  if (!response.ok) throw new Error(`Could not save ${relative}`);
}

function buildTasks() {
  tasks = clips.flatMap((clip) => combinations.map((combo) => ({ clip, ...combo })));
}

function updateSignOptions() {
  [...signSelect.options].forEach((option) => {
    const completed = recordings.filter((item) => item.label === option.value).length >= combinations.length;
    option.disabled = completed;
    option.textContent = completed ? `${option.value} (complete)` : option.value;
  });
}

function renderTask() {
  const task = tasks[taskIndex];
  $("total-count").textContent = recordings.length;
  const list = $("sample-list");
  list.replaceChildren();
  if (!recordings.length) list.innerHTML = "<li>No samples recorded yet.</li>";
  else clips.forEach((clip) => {
    const count = recordings.filter((item) => item.label === clip.label).length;
    const li = document.createElement("li"); li.textContent = `${clip.label}: ${count} of ${combinations.length}`; list.append(li);
  });
  updateSignOptions();

  if (!task) {
    signSelect.selectedIndex = -1;
    $("reference-label").textContent = "Complete";
    $("orientation-instruction").textContent = `All ${tasks.length} required orientation captures are complete. Files are saved in sessions/${personName}/.`;
    recordButton.hidden = true;
    return;
  }
  signSelect.value = task.clip.label;
  $("reference-label").textContent = task.clip.label;
  renderReference(reference, task.clip);
  const secondTake = task.hand === "neutral" && task.take === 2 ? " This is the second neutral-hand take." : "";
  $("orientation-instruction").textContent = `Capture ${taskIndex + 1} of ${tasks.length}: set laptop lid ${task.lid}; set hand ${task.hand}.${secondTake}`;
  recordButton.hidden = false;
  recordButton.disabled = !cameraStream || capturing || !!pending;
  recordButton.textContent = `● Record ${CAPTURE_SECONDS} seconds`;
}

function startReviewRecorder(stream) {
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const chunks = [], recorder = new MediaRecorder(stream, { mimeType });
  const finished = new Promise((resolve) => {
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
  });
  recorder.start();
  return { recorder, finished };
}

async function countdown() {
  const overlay = $("capture-countdown"); overlay.hidden = false;
  for (const number of [3, 2, 1]) {
    overlay.textContent = number;
    recordButton.textContent = `Recording wind-up… ${number}s`;
    await wait(1000);
  }
  overlay.hidden = true;
}

async function captureTask() {
  if (!cameraStream || capturing || pending || !tasks[taskIndex]) return;
  capturing = true; recordButton.disabled = true;
  const task = tasks[taskIndex], recordingId = `${Date.now()}`;
  activeBuffer = new LandmarkBuffer(); captureStartedAt = performance.now();
  const reviewRecording = startReviewRecorder(cameraStream);
  await countdown();
  const signingStartedAt = performance.now();
  for (let remaining = CAPTURE_SECONDS - 3; remaining > 0; remaining -= 1) {
    recordButton.textContent = `Sign now… ${remaining}s`;
    await wait(1000);
  }
  reviewRecording.recorder.stop();
  const reviewBlob = await reviewRecording.finished;
  const landmarks = activeBuffer.toRecording({ recordingId, label: task.clip.label, personName });
  const frames = landmarks.hands.timestamps.map((timestamp, index) => ({
    timestamp: Math.max(0, Math.round(timestamp - captureStartedAt)),
    face: landmarks.face.frames[index],
    pose: landmarks.pose.frames[index],
    hands: landmarks.hands.frames[index],
  }));
  const common = {
    sign: task.clip.label,
    orientationIndex: 1,
    lidTilt: task.lid,
    handTilt: task.hand,
    clipNumber: task.take,
    targetFps: 30,
  };
  const untrimmedPayload = {
    ...common,
    captureWindow: "6-second capture including recorded 3-second countdown",
    actualFrameCount: frames.length,
    frames,
  };
  const signingOffset = signingStartedAt - captureStartedAt;
  const trimmedFrames = frames
    .filter((frame) => frame.timestamp >= signingOffset)
    .map((frame) => ({ ...frame, timestamp: Math.max(0, Math.round(frame.timestamp - signingOffset)) }));
  const trimmedPayload = {
    ...common,
    captureWindow: "3-second signing window after countdown",
    actualFrameCount: trimmedFrames.length,
    frames: trimmedFrames,
  };
  pending = { task, trimmedPayload, untrimmedPayload, reviewBlob };
  activeBuffer = null; capturing = false;
  reviewVideo.src = URL.createObjectURL(reviewBlob);
  $("review-summary").textContent = `${task.clip.label} · laptop ${task.lid} · hand ${task.hand} · take ${task.take} · ${CAPTURE_SECONDS} seconds`;
  review.showModal();
  reviewVideo.play().catch(() => {});
}

function closeReview() {
  reviewVideo.pause();
  if (reviewVideo.src) URL.revokeObjectURL(reviewVideo.src);
  reviewVideo.removeAttribute("src"); reviewVideo.load(); review.close();
}

recordButton.addEventListener("click", captureTask);
signSelect.addEventListener("change", () => {
  const saved = new Set(recordings.map((item) => `${item.label}\u0000${item.orientation}`));
  const next = tasks.findIndex((task) => task.clip.label === signSelect.value && !saved.has(taskKey(task)));
  if (next !== -1) taskIndex = next;
  renderTask();
});
review.addEventListener("cancel", (event) => event.preventDefault());
$("keep-recording").addEventListener("click", async () => {
  const keep = $("keep-recording"); keep.disabled = true; keep.textContent = "Saving JSON…";
  try {
    const { task, trimmedPayload, untrimmedPayload } = pending;
    const base = `${task.clip.label}/${storageSlug(task)}`;
    await Promise.all([
      putJson(`${base}/landmarks_trimmed.json`, trimmedPayload),
      putJson(`${base}/landmarks_untrimmed.json`, untrimmedPayload),
    ]);
    recordings.push({ label: task.clip.label, orientation: taskSlug(task) });
    pending = null;
    const saved = new Set(recordings.map((item) => `${item.label}\u0000${item.orientation}`));
    const next = tasks.findIndex((item) => !saved.has(taskKey(item)));
    taskIndex = next === -1 ? tasks.length : next;
    closeReview(); renderTask();
  } catch (error) {
    $("review-summary").textContent = `Save failed: ${error.message}. Keep this window open and try again.`;
  } finally { keep.disabled = false; keep.textContent = "Keep JSON"; }
});
$("redo-recording").addEventListener("click", () => { pending = null; closeReview(); renderTask(); });

$("name-form").addEventListener("submit", async (event) => {
  event.preventDefault(); personName = safeName($("recorder-name").value);
  $("session-person").textContent = `Recorder: ${personName}`;
  $("destination").textContent = `sessions/${personName}/<sign>/tilt_<lid>_<hand>_<take>/{landmarks_trimmed.json,landmarks_untrimmed.json}`;
  $("name-dialog").close();
  try {
    const progressResponse = await fetch(`/api/sessions/${encodeURIComponent(personName)}/progress`, { cache: "no-store" });
    if (!progressResponse.ok) throw new Error("Could not load saved progress");
    const progress = await progressResponse.json();
    const saved = new Set((progress.saved || []).map((item) => `${item.label}\u0000${item.orientation}`));
    recordings = tasks.filter((task) => saved.has(taskKey(task))).map((task) => ({ label: task.clip.label, orientation: taskSlug(task) }));
    const next = tasks.findIndex((task) => !saved.has(taskKey(task)));
    taskIndex = next === -1 ? tasks.length : next;
    const camera = await startHolistic($("camera"), $("overlay"), (results, timestamp) => {
      if (capturing && activeBuffer) activeBuffer.add(results, timestamp);
    });
    cameraStream = camera.stream; $("tracking-status").textContent = "Tracking live"; renderTask();
  } catch (error) { $("tracking-status").textContent = `Camera error: ${error.message}`; }
});

async function initialise() {
  recordButton.disabled = true;
  try {
    clips = await loadReferenceClips(); buildTasks();
    clips.forEach((clip) => signSelect.add(new Option(clip.label, clip.label)));
    $("reference-error").textContent = ""; renderTask();
  } catch (error) { $("reference-error").textContent = `Could not load references: ${error.message}`; }
  $("name-dialog").showModal();
}

initialise();
