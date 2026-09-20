export async function loadReferenceClips() {
  const response = await fetch("/api/references", { cache: "no-store" });
  if (!response.ok) throw new Error(`reference list returned ${response.status}`);
  const clips = await response.json();
  if (!Array.isArray(clips) || !clips.length) throw new Error("No MP4 reference videos found in reference/.");
  return clips;
}

export function renderReference(container, clip) {
  container.replaceChildren();
  const video = document.createElement("video");
  video.src = clip.url;
  video.controls = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("aria-label", `${clip.label} reference sign`);
  container.append(video);
  video.play().catch(() => {});
}
