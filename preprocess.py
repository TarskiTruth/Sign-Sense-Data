#!/usr/bin/env python3
"""Trim and timestamp-resample raw Sign Sense landmark recordings.

Usage: python preprocess.py path/to/person_folder [--threshold 0.02]
       python preprocess.py path/to/person_folder --plot RECORDING_ID
"""
import argparse
import json
import math
from pathlib import Path


def distance(a, b):
    return math.sqrt((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2 + (a["z"] - b["z"]) ** 2)


def motion_scores(hand_frames):
    scores = [0.0]
    for previous, current in zip(hand_frames, hand_frames[1:]):
        total = 0.0
        for side in ("left", "right"):
            a, b = previous.get(side), current.get(side)
            if a is not None and b is not None:
                total += sum(distance(x, y) for x, y in zip(a, b))
        scores.append(total)
    return scores


def moving_average(values, window=4):
    return [sum(values[max(0, index - window + 1):index + 1]) / min(window, index + 1) for index in range(len(values))]


def lerp_value(a, b, fraction):
    if a is None or b is None:
        return a if fraction < 0.5 else b
    if isinstance(a, dict):
        return {key: lerp_value(a[key], b[key], fraction) for key in a}
    if isinstance(a, list):
        return [lerp_value(x, y, fraction) for x, y in zip(a, b)]
    return a + (b - a) * fraction


def resample(timestamps, frames, count=30):
    if len(frames) == 1:
        return [frames[0]] * count, [timestamps[0]] * count
    start, end = timestamps[0], timestamps[-1]
    targets = [start + (end - start) * i / (count - 1) for i in range(count)]
    output, source = [], 0
    for target in targets:
        while source < len(timestamps) - 2 and timestamps[source + 1] < target:
            source += 1
        before, after = timestamps[source], timestamps[source + 1]
        ratio = 0 if after == before else (target - before) / (after - before)
        output.append(lerp_value(frames[source], frames[source + 1], ratio))
    return output, targets


def process_file(hand_path, face_path, threshold, plot_id):
    hands, face = json.loads(hand_path.read_text()), json.loads(face_path.read_text())
    pose_path = hand_path.parents[1] / "pose" / hand_path.name
    pose = json.loads(pose_path.read_text()) if pose_path.exists() else None
    if pose is not None and (pose["recordingId"] != hands["recordingId"] or pose["timestamps"] != hands["timestamps"] or len(pose["frames"]) != len(hands["frames"])):
        print(f"Skipping {hands['recordingId']}: pose and hands are not index-aligned")
        return
    if hands["timestamps"] != face["timestamps"] or len(hands["frames"]) != len(face["frames"]):
        print(f"Skipping {hands['recordingId']}: hands and face are not index-aligned")
        return
    smoothed = moving_average(motion_scores(hands["frames"]))
    active = [index for index, score in enumerate(smoothed) if score > threshold]
    if not active:
        print(f"Warning: {hands['recordingId']} never exceeded threshold; keeping raw extent.")
        first, last = 0, len(hands["frames"]) - 1
    else:
        first, last = max(0, active[0] - 3), min(len(hands["frames"]) - 1, active[-1] + 3)
    segment = slice(first, last + 1)
    timestamps = hands["timestamps"][segment]
    hand_frames, output_times = resample(timestamps, hands["frames"][segment])
    face_frames, _ = resample(timestamps, face["frames"][segment])
    metadata = {key: hands[key] for key in ("recordingId", "label", "personName")}
    metadata.update({"originalRawFrameCount": len(hands["frames"]), "resampledFrameCount": 30, "timestamps": output_times})
    out_root = hand_path.parents[2] / "trimmed"
    (out_root / "hands").mkdir(parents=True, exist_ok=True); (out_root / "face").mkdir(parents=True, exist_ok=True)
    filename = hand_path.name
    (out_root / "hands" / filename).write_text(json.dumps({**metadata, "frames": hand_frames}, indent=2))
    (out_root / "face" / filename).write_text(json.dumps({**metadata, "frames": face_frames}, indent=2))
    if pose is not None:
        pose_frames, _ = resample(timestamps, pose["frames"][segment])
        (out_root / "pose").mkdir(parents=True, exist_ok=True)
        (out_root / "pose" / filename).write_text(json.dumps({**metadata, "frames": pose_frames}, indent=2))
    if plot_id == hands["recordingId"]:
        import matplotlib.pyplot as plt
        plt.plot(smoothed); plt.axhline(threshold, color="red", linestyle="--"); plt.xlabel("Frame"); plt.ylabel("Smoothed hand motion")
        plt.savefig(hand_path.parents[2] / f"motion_{plot_id}.png", dpi=150, bbox_inches="tight"); plt.close()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument("person_folder", type=Path); parser.add_argument("--threshold", type=float, default=.02); parser.add_argument("--plot", metavar="RECORDING_ID")
    args = parser.parse_args(); hands_dir = args.person_folder / "raw" / "hands"; face_dir = args.person_folder / "raw" / "face"
    for hand_path in hands_dir.glob("*.json"):
        data = json.loads(hand_path.read_text()); record_id = data["recordingId"]
        match = next((path for path in face_dir.glob("*.json") if json.loads(path.read_text())["recordingId"] == record_id), None)
        if match is None: print(f"Skipping {record_id}: no matching face recording"); continue
        process_file(hand_path, match, args.threshold, args.plot)


if __name__ == "__main__": main()
