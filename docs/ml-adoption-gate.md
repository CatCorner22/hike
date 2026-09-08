# Optional on-device ML adoption gate

Status: **evaluated, deliberately not shipped in the safety-critical bundle** (2026-08-22).

Klandagi's first useful ML feature would be opt-in speech-to-text for a field-note draft. It must remain an input convenience: the hiker reviews and explicitly saves the text. ML must never calculate a position, interpret an emergency command, infer distress, identify an edible plant, decide that a crossing is safe, or block the map.

## Candidate reviewed

- Runtime: [Hugging Face Transformers.js](https://huggingface.co/docs/transformers.js), using browser-side ONNX Runtime.
- Model: [onnx-community/whisper-tiny.en](https://huggingface.co/onnx-community/whisper-tiny.en), an ONNX conversion of the Apache-2.0 `openai/whisper-tiny.en` model.
- The repository contains many precision variants and totals about 1.41 GB. A plausible WASM pair is still roughly 41 MB before tokenizers, runtime code, browser cache overhead, and audio buffers (`encoder_model_int8.onnx` about 10.1 MB plus `decoder_model_merged_int8.onnx` about 30.7 MB).
- The base model card explicitly documents hallucinated text and uneven performance across accents, dialects, and languages, and recommends robust context-specific evaluation before deployment.

## Why it is deferred

Text notes and privacy-scrubbed photos provide the core offline field-capture job without a model download, a new eviction risk, or a long CPU/memory spike. Shipping Whisper now would add a second offline asset system before route-launch assets and physical-device IndexedDB behavior have completed field validation. That trade is wrong for a safety-first release.

No Hub dataset found during this review was a maintained, authoritative, U.S.-wide source of current trail access, closures, permits, weather alerts, or campsite availability. Those facts continue to come from OSM, NPS, NWS, RIDB, and state sources with explicit provenance. A language or vision model is not a replacement for them.

## Required design before implementation

1. A separate **Download voice notes** action states the exact download size, source, license, revision, storage location, and removal control. It is never included in **Prepare offline** or navigation readiness.
2. The model revision and every required file hash are pinned in a signed/checked manifest. Partial packs fail closed and are removable without touching route packs.
3. Audio stays on-device, is capped at 15 seconds per draft, and is deleted after transcription unless the hiker explicitly retains it.
4. The transcript is visibly labeled **draft from on-device speech recognition**. The hiker must review and confirm before it becomes a waypoint note.
5. Empty audio, wind-only audio, low-confidence output, repeated hallucinated phrases, model-load failure, quota failure, and unsupported browsers all return to ordinary text entry.
6. The pipeline is loaded once, progress is shown, cancellation works, and model/WASM resources are disposed when the feature closes.
7. No transcript is used by SOS, rescue coordinates, Guardian state, off-route thresholds, access/permit evidence, or official-alert logic.

## Release evidence required

- Cold and warm model-load tests with the network removed after an acknowledged pack download.
- Storage-eviction tests proving that an ML eviction cannot remove or relabel a route pack.
- Ten-second field recordings across wind, water, traffic, multiple U.S. accents, silence, and clipped microphones on representative iOS Safari and Android Chrome devices.
- Measured download bytes, peak memory, inference latency, cancellation latency, and battery impact. Do not infer mobile performance from a desktop benchmark.
- Accessibility review and an equivalent non-voice workflow.

Until those gates pass, the correct implementation is the smaller, deterministic field-capture path and this documented adoption boundary—not a hidden model download.
