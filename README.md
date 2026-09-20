# Sign Sense Data Collection

Run the local server from this folder:

```powershell
node server.js
```

Then open [http://localhost:8001](http://localhost:8001).

Place reference videos directly in `reference/` as MP4 files. The filename without
`.mp4` is the sign label and is used in exported data. For example, `bye.mp4`
uses `bye`, while `thank_you.mp4` uses `thank_you`. No manifest is required.
The bundled server supports MP4 byte-range requests, so the reference controls
can play, replay, and seek correctly in Safari and Chromium-based browsers.

For each reference sign, the app prompts for all 12 orientation captures from
the original protocol. Every capture is six seconds total: recording begins
before the visible three-second wind-up, followed by three seconds of signing.
A temporary review video allows Keep or Redo, but no video is saved.

There is no ZIP export. Choosing Keep writes directly to:

`sessions/<user>/<sign>/tilt_<lid>_<hand>_<take>/`

Each orientation folder contains `landmarks_trimmed.json` and
`landmarks_untrimmed.json`. The untrimmed file contains the full six seconds,
including the recorded countdown. The trimmed file contains only the three
seconds after the countdown, with its timestamps rebased to zero.
Entering the same user name again scans these files and resumes at the first
unfinished sign/orientation. The current-sign dropdown can jump to the first
unfinished orientation of any sign; fully completed signs remain listed but
are disabled to prevent accidental overwrites.

Each participant's saved landmarks and progress are kept only on the computer running the server, in `sessions/<participant name>/`. That folder is ignored by Git, so recordings are not uploaded when the project is pushed to GitHub.
