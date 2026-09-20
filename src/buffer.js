export class LandmarkBuffer {
  constructor() { this.frames = []; this.timestamps = []; }
  add(result, timestamp) {
    const point = ({ x, y, z }) => ({ x, y, z });
    this.timestamps.push(timestamp);
    this.frames.push({
      hands: { left: result.leftHandLandmarks?.map(point) ?? null, right: result.rightHandLandmarks?.map(point) ?? null },
      face: result.faceLandmarks?.map(point) ?? null,
      pose: result.poseLandmarks?.map(({ x, y, z, visibility }) => ({ x, y, z, visibility })) ?? null,
    });
  }
  toRecording({ recordingId, label, personName }) {
    const base = { recordingId, label, personName, timestamps: this.timestamps };
    return { hands: { ...base, frames: this.frames.map(({ hands }) => hands) }, face: { ...base, frames: this.frames.map(({ face }) => face) }, pose: { ...base, frames: this.frames.map(({ pose }) => pose) } };
  }
}
