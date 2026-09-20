export async function startHolistic(video, canvas, onResults) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  video.srcObject = stream; await video.play();
  const context = canvas.getContext("2d");
  const { Holistic, Camera, drawConnectors, drawLandmarks, FACEMESH_TESSELATION, HAND_CONNECTIONS, POSE_CONNECTIONS } = window;
  const holistic = new Holistic({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}` });
  holistic.setOptions({ modelComplexity: 1, smoothLandmarks: true, refineFaceLandmarks: true, minDetectionConfidence: .5, minTrackingConfidence: .5 });
  holistic.onResults((results) => {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    context.save(); context.clearRect(0, 0, canvas.width, canvas.height); context.translate(canvas.width, 0); context.scale(-1, 1);
    if (results.poseLandmarks) {
      const visibleConnections = POSE_CONNECTIONS.filter(([a, b]) => results.poseLandmarks[a].visibility >= .5 && results.poseLandmarks[b].visibility >= .5);
      drawConnectors(context, results.poseLandmarks, visibleConnections, { color: "#77cfff", lineWidth: 3 });
      drawLandmarks(context, results.poseLandmarks.filter((point) => point.visibility >= .5), { color: "#77cfff", radius: 3 });
    }
    if (results.faceLandmarks) { drawConnectors(context, results.faceLandmarks, FACEMESH_TESSELATION, { color: "#93b6ff55", lineWidth: .45 }); }
    [results.leftHandLandmarks, results.rightHandLandmarks].forEach((hand) => { if (hand) { drawConnectors(context, hand, HAND_CONNECTIONS, { color: "#74e8ae", lineWidth: 2 }); drawLandmarks(context, hand, { color: "#ffcf72", radius: 2 }); } });
    context.restore(); onResults(results, performance.now());
  });
  const camera = new Camera(video, { onFrame: async () => holistic.send({ image: video }), width: 1280, height: 720 }); camera.start();
  return { stream, stop: () => { camera.stop(); stream.getTracks().forEach((track) => track.stop()); } };
}
