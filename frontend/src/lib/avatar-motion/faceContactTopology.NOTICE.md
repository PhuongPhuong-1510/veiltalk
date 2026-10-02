# Canonical face topology attribution

`faceContactTopology.ts` contains numeric vertex/triangle data derived from the Google MediaPipe canonical face model. Copyright Google LLC, licensed under the Apache License, Version 2.0: <https://www.apache.org/licenses/LICENSE-2.0>.

The complete upstream license is included in `faceContactTopology.LICENSE`.

Original repository: <https://github.com/google-ai-edge/mediapipe>. The generated file records the exact source revision, URL and SHA-256. The data are converted from OBJ to TypeScript arrays without altering the vertex ordering; no iris vertices are added. Regenerate with `node scripts/generate-face-contact-topology.mjs`.

The canonical mesh is used for semantic correspondence within the observed human face. It does not supply shared metric Hand/Pose coordinates and is not copied onto the VRM vertex ordering.
