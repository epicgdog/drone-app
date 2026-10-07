# Prototype Spec: Live 3D Pose Streaming

Status: APPROVED for implementation
Owner: epicgdog
Implementer: coding agent

> **Change (overrides §R4 Layout, §R6, M5, M6):** The phone app is now **camera + stats only**: a full-screen preview, connection dot, stats overlay and settings. It has no 3D view, and three.js, R3F, drei, expo-gl and gesture-handler have been removed. All 3D rendering (stick figure and Y Bot avatar) happens in the **browser viewer** served by the pose server at `GET /viewer` (`fm_model/server/static/viewer.html`, fed by `WS /viewer/ws`). Do M5/M6 acceptance checks in the viewer. The avatar is served from `mobile/assets/avatar.glb` via `GET /viewer/avatar.glb`.

## How to use this spec

1. Work through the milestones **in order**, M1 to M6. Don't start a milestone until the previous one's acceptance checks pass.
2. Each milestone lists its tasks and acceptance checks, and points to the reference sections (§R1–§R6) that hold the details.
3. When a milestone is done, stop and post a short report: what you built, check results, and any deviations from this spec. Then continue.
4. If something in this spec turns out to be wrong (an API doesn't exist, a library has broken), choose the smallest working alternative, note it in the report, and continue. Don't redesign.
5. Python rules: always use `uv` (`uv add`, `uv run python3 <file>`, `uv run pytest`). Never call `pip` or bare `python`.

## Goal

An iPhone app streams its camera to a Python server on a MacBook Pro (M5). The server runs FMPose3D on each frame and sends back 3D joints. The app shows the live camera feed and a 3D view of the pose, as a stick figure and as a rigged Mixamo Y Bot.

The phone stands in for a drone and the Mac stands in for a ground station.

## Definition of done (whole prototype)

- [ ] The app runs on a physical iPhone in **Expo Go** (no Xcode build, no Apple developer account).
- [ ] With the phone and the Mac on the same Wi-Fi, a person in frame produces a 3D skeleton that visibly follows their movement.
- [ ] A Mixamo Y Bot avatar mirrors the same pose.
- [ ] A stats overlay shows frames sent per second, poses received per second, and round-trip latency in ms.
- [ ] When no person is in frame, the app shows a "no person" state and does not crash.

## Out of scope (do not build)

- Jitter or temporal smoothing, fixed noise seeds, filters
- Pose logging or recording to disk
- On-device 2D pose, ONNX/CoreML export, drone hardware
- Patching the FMPose3D library (for example, to run 2D on MPS)
- VisionCamera, dev builds and frame processors. The app must stay Expo Go-compatible: no packages with custom native code outside the Expo SDK
- Custom `camera_rotation`, multi-person support, Android, auth, non-LAN deployment
- Hand, foot or head orientation and bone twist on the avatar

---

# Milestones

## M1 — Server inference core + benchmark

**Tasks**
1. In `fm_model/`, set `requires-python = ">=3.10,<3.13"` and add the dependencies (§R2 Stack).
2. Create `server/protocol.py` with pydantic models for the pose message (§R3).
3. Create `server/pose.py` with the `PoseEngine` class (§R2 Model wrapper).
4. Create `scripts/bench.py` (§R2 Benchmark) and run it.
5. Create `tests/test_pose.py` with the engine tests from §R2 Tests.

**Acceptance checks**
- [ ] `uv run pytest tests/test_pose.py` passes.
- [ ] `uv run python3 scripts/bench.py` prints p50/p95 for `prepare_2d` and `pose_3d`.
- [ ] Report: the benchmark numbers, the device each stage ran on, and whether MPS worked for the lifter.

## M2 — Server WebSocket + health endpoint

**Tasks**
1. Create `server/app.py`: a FastAPI app with a lifespan that loads `PoseEngine` once, plus `GET /health` and `WS /ws` (§R3).
2. Run inference off the event loop with a single worker (§R2).
3. Add the WebSocket round-trip and error-path tests (§R2 Tests).

**Acceptance checks**
- [ ] `uv run pytest` passes (all tests).
- [ ] `uv run uvicorn server.app:app --host 0.0.0.0 --port 8000` starts, and `curl http://localhost:8000/health` returns `{"ok": true, ...}`.
- [ ] Report: the command to start the server and the Mac's LAN IP lookup command (`ipconfig getifaddr en0`).

## M3 — App shell on device

**Tasks**
1. Create the Expo TypeScript app in `mobile/` (§R4 Stack).
2. Configure `app.json` with the `expo-camera` plugin and camera permission (§R4 iOS config).
3. Build the layout: camera preview on top, an empty R3F canvas on the bottom, and an overlay (§R4 Layout).
4. Add a settings field for the server URL, persisted between launches (§R4 Networking).
5. Add `poseSocket.ts` with connect, reconnect and a connection-state indicator. Don't send frames yet.

**Acceptance checks**
- [ ] `npx expo start`, then scanning the QR code with Expo Go, opens the app on the iPhone.
- [ ] Camera preview shows. The canvas renders (for example, a grid or axes helper).
- [ ] Entering the Mac's URL turns the connection dot green. Stopping the server turns it red, then it reconnects when the server restarts.

## M4 — Frame streaming + stats

**Tasks**
1. Build `FrameStreamer.tsx`, the `takePictureAsync` capture loop gated by a single in-flight frame (§R4 Frame capture).
2. Send frames using the binary protocol, and parse pose responses (§R3).
3. Build `StatsOverlay.tsx`: sent/s, recv/s, RTT, server infer ms, and the last status.

**Acceptance checks**
- [ ] With a person in view, the overlay shows non-zero recv/s and an RTT value, and the status is `ok`.
- [ ] Pointing the camera at a wall shows `no_person`, and streaming continues.
- [ ] Killing the server mid-stream doesn't crash the app, and streaming resumes after the server restarts.
- [ ] Report: the measured sent/s, recv/s, RTT, and the picture size chosen.

## M5 — Live stick figure

**Tasks**
1. Create `pose/skeleton.ts` with joint names, parents and the left/right/centre groups (§R5).
2. Create `pose/coords.ts` with `toThree()`. Determine the up axis empirically (§R6 Coordinates).
3. Create `scene/StickFigure.tsx`, updated in place each pose (§R6 Stick figure).
4. Add orbit controls (drag to rotate, pinch to zoom).

**Acceptance checks**
- [ ] The stick figure stands upright, with the head on top.
- [ ] When you raise your **right** arm, the **red** arm moves. If not, fix the mapping in `skeleton.ts`.
- [ ] The figure follows movement live.
- [ ] Report: the up-axis finding and whether left/right needed a fix.

## M6 — Live Mixamo Y Bot avatar

**Tasks**
1. Confirm the owner-supplied `mobile/assets/avatar.glb` exists and loads (§R6 Avatar asset). Add the licence note to `mobile/assets/README.md`.
2. Create `scene/Avatar.tsx` with the bone mapping table and retargeting (§R6 Retargeting).
3. Add a **Stick / Avatar / Both** toggle to the overlay.

**Acceptance checks**
- [ ] The avatar loads in its rest pose without errors.
- [ ] The avatar's limbs point the same way as the stick figure's in **Both** mode.
- [ ] The avatar faces the same direction as the stick figure (hips orientation is correct).
- [ ] Final report covers every item in §R7.

---

# Reference

## §R1 Architecture and repo layout

```
┌──────────── iPhone (Expo Go) ────────────────────┐        ┌──────── MacBook Pro M5 ────────┐
│ expo-camera ─► takePictureAsync JPEG (~640px)    │  WS    │ FastAPI + uvicorn              │
│             ─► WebSocket client ─────────────────┼──────► │  /ws : decode JPEG (cv2, BGR)  │
│                                                  │ binary │       PoseEngine.infer()       │
│ R3F scene ◄── pose JSON ◄────────────────────────┼─────── │  ──► 17×3 joints JSON          │
│  • stick figure / Y Bot avatar                   │  text  │                                │
│ Stats overlay                                    │        │ GET /health                    │
└──────────────────────────────────────────────────┘        └────────────────────────────────┘
```

**Flow control:** only one frame is in flight at a time. The client sends a frame, waits for its response (or a 2 s timeout), then sends the next. The server never queues frames.

```
drone-app/
├── fm_model/                 # existing uv project → server
│   ├── main.py               # existing demo, leave it alone
│   ├── server/{__init__,app,pose,protocol}.py
│   ├── scripts/bench.py
│   └── tests/test_pose.py
├── mobile/                   # new Expo app (TypeScript)
│   ├── app.json
│   ├── assets/{avatar.glb,README.md}
│   └── src/
│       ├── App.tsx
│       ├── config.ts
│       ├── net/poseSocket.ts
│       ├── camera/FrameStreamer.tsx
│       ├── scene/{PoseScene,StickFigure,Avatar}.tsx
│       ├── pose/{skeleton,coords}.ts
│       └── ui/StatsOverlay.tsx
├── photos/skateboarder.png   # existing test image
└── docs/PROTOTYPE_SPEC.md
```

## §R2 Server details

### Stack
- Python 3.10–3.12 (FMPose3D is tested on 3.10).
- `uv add fastapi "uvicorn[standard]" opencv-python-headless pydantic` and `uv add --dev pytest httpx`.
- Start with `uv run uvicorn server.app:app --host 0.0.0.0 --port 8000` from `fm_model/`.

### Model wrapper (`server/pose.py`)
- `class PoseEngine` builds `FMPose3DInference` **once** and calls `setup_runtime()` in `__init__`, so the weight download and model load happen before any client connects.
- **Device:** use `FMPOSE_DEVICE` if set; otherwise `"cpu"`. Benchmarked on the M5: the lifter takes 33ms on CPU vs 60ms on MPS (per-call transfer overhead), and total time is 344ms vs 407ms. `"mps"` stays available as an opt-in.
  - **Known limitation (verified in library source):** YOLO and HRNet pick `cuda`-or-`cpu` internally (`fmpose3d/lib/hrnet/hrnet.py:199`, `fmpose3d/lib/yolov3/human_detector.py`). On a Mac, the 2D stage **always runs on the CPU**. This is expected. Don't patch it.
- **Inference config** (import from `fmpose3d.common.config`): `InferenceConfig(sample_steps=3, test_augmentation=False, hypothesis_num=1)`. Read overrides from the env vars `FMPOSE_SAMPLE_STEPS` and `FMPOSE_TEST_AUG`.
- `PoseEngine.infer(jpeg_bytes: bytes, frame_id: int) -> PoseMessage`:
  1. Decode with `cv2.imdecode(np.frombuffer(...), cv2.IMREAD_COLOR)`, which gives BGR `(H, W, 3)`. The 2D estimator expects BGR. If decode returns `None`, use `status="error"`.
  2. If the long edge is over 640px, resize it to 640 (`cv2.INTER_AREA`).
  3. Call `r2d = api.prepare_2d(frame)`. If `r2d.status` is `empty` or `invalid`, return `status="no_person"`.
  4. Call `r3d = api.pose_3d(r2d.keypoints, r2d.image_size)`. Return `joints = r3d.poses_3d_world[0]`, `joints_root_rel = r3d.poses_3d[0]` and `scores = r2d.scores[0, 0]`.
  5. If the output contains NaN, use `status="no_person"`.
  6. Catch any other exception and use `status="error"` with the message. Never raise to the caller.
  7. Fill in `timing_ms` for `decode`, `prepare_2d`, `pose_3d` and `total`.
- **Concurrency:** call `infer` with `await asyncio.to_thread(...)`, guarded by an `asyncio.Lock` so only one inference runs at a time.

### Benchmark (`scripts/bench.py`)
- Load `PoseEngine` once and read `../photos/skateboarder.png` encoded as JPEG (quality 60, long edge 640).
- Run 3 warm-up calls, then 30 timed calls. Print p50 and p95 for `prepare_2d`, `pose_3d` and `total`, plus the device in use.

### Tests (`tests/test_pose.py`)
Use one module-scoped `PoseEngine` fixture, since loading the model is slow.
- The skateboarder JPEG gives `status="ok"` and `joints` with shape 17×3, all finite.
- A black 640×480 JPEG gives `status="no_person"`.
- `b"not a jpeg"` gives `status="error"`.
- WebSocket (FastAPI `TestClient`): sending frame_id 7 + the skateboarder JPEG returns JSON with `frame_id == 7` and `status == "ok"`.
- WebSocket: a 2-byte message returns `status="error"`, and the socket stays open (a follow-up valid frame still works).

## §R3 Protocol

**Endpoint:** `ws://<mac-ip>:8000/ws`

**Client → server**, binary, one message per frame:
```
[4 bytes uint32 big-endian frame_id][JPEG bytes]
```

**Server → client**, JSON text, exactly one per received message:
```jsonc
{
  "type": "pose",
  "frame_id": 123,                      // 0 if the header was unreadable
  "status": "ok" | "no_person" | "error",
  "joints": [[x,y,z], ...17] | null,          // poses_3d_world[0]
  "joints_root_rel": [[x,y,z], ...17] | null, // poses_3d[0]
  "scores": [ ...17 ] | null,
  "image_size": [h, w] | null,
  "timing_ms": { "decode": 1.2, "prepare_2d": 150.0, "pose_3d": 20.0, "total": 172.0 },
  "error": null | "message"
}
```
Rules:
- Joint order is H36M-17 exactly as FMPose3D emits it (§R5). Never reorder joints on the server.
- Every received message gets exactly one response, including errors, so the client's in-flight gate always clears.
- An error never closes the socket.

**Health:** `GET /health` returns `{"ok": true, "device": "<lifter device>", "model_loaded": true}`.

## §R4 Mobile app details

### Stack
- Expo SDK (latest stable), TypeScript template. It runs in **Expo Go** (`npx expo start`, then scan the QR code). No dev build, no Xcode.
- Use only Expo Go-compatible packages, and install them with `npx expo install` so versions match the SDK.
- `expo-camera` (`CameraView`, `useCameraPermissions`).
- `three`, `@react-three/fiber` (import from `@react-three/fiber/native`), `expo-gl`, `@react-three/drei` (`useGLTF` only), `expo-asset` and `expo-file-system`.
- `@react-native-async-storage/async-storage` for the server URL.
- `react-native-gesture-handler` for orbit and pinch, if drei's `OrbitControls` doesn't work on native.

### iOS config (`app.json`)
- `expo-camera` plugin with `cameraPermission`.
- `ios.infoPlist` local network and ATS keys are kept for a future dev build. Expo Go ignores them, and it already allows LAN `ws://`. The first connection triggers iOS's "Expo Go wants to find devices on your local network" prompt, which must be allowed.

### Layout (`App.tsx`)
- Portrait. Top half: back-camera preview. Bottom half: `PoseScene` (R3F canvas).
- Overlay: connection dot (green/red), stats, a settings button that opens the URL field, and the Stick / Avatar / Both toggle (from M6).

### Networking (`net/poseSocket.ts`)
- Default URL comes from `config.ts` (placeholder `ws://192.168.1.100:8000/ws`). The user-edited URL is saved in AsyncStorage. Never hard-code the Mac's IP.
- Reconnect with backoff: 1 s, 2 s, 4 s, then 5 s maximum.
- `sendFrame(jpeg: ArrayBuffer): Promise<PoseMessage | null>` adds the frame_id header, sends, and resolves on the matching `frame_id` or `null` after 2 s.
- Stats use rolling 2 s windows: sent/s, recv/s, last RTT, last server `timing_ms.total`.

### Frame capture (`camera/FrameStreamer.tsx`)
- Back camera through `CameraView`. Start capturing only after `onCameraReady` fires.
- Picture size: in `onCameraReady`, call `getAvailablePictureSizesAsync()` and set the `pictureSize` prop to the smallest `WxH` size with a long edge ≥ 640 (for example `"640x480"`). This keeps uploads small. The server still resizes to 640px as a backstop.
- Loop while connected: `takePictureAsync({ quality: 0.6, shutterSound: false })` → read `picture.uri` (already a `file://` URI) into an ArrayBuffer with `expo-file-system`'s `File` → `sendFrame` → await → delete the temp file → repeat.
- Leave `skipProcessing` **off**, so the image is upright (the server ignores EXIF orientation).
- On a capture or send error: `console.warn`, sleep 100ms, retry.
- Expected capture cost is about 150–400ms per picture, which is acceptable because the server caps throughput at about 3 FPS.

## §R5 H36M-17 skeleton

| idx | joint | parent | group |
|----:|-------|-------:|-------|
| 0 | pelvis (root) | — | centre |
| 1 | R hip | 0 | right |
| 2 | R knee | 1 | right |
| 3 | R ankle | 2 | right |
| 4 | L hip | 0 | left |
| 5 | L knee | 4 | left |
| 6 | L ankle | 5 | left |
| 7 | spine | 0 | centre |
| 8 | thorax | 7 | centre |
| 9 | neck/nose | 8 | centre |
| 10 | head top | 9 | centre |
| 11 | L shoulder | 8 | left |
| 12 | L elbow | 11 | left |
| 13 | L wrist | 12 | left |
| 14 | R shoulder | 8 | right |
| 15 | R elbow | 14 | right |
| 16 | R wrist | 15 | right |

```ts
export const PARENTS = [-1, 0, 1, 2, 0, 4, 5, 0, 7, 8, 9, 8, 11, 12, 8, 14, 15];
```
This matches `fm_model/main.py`. The left/right labels must be verified on device (M5).

## §R6 3D rendering details

### Coordinates (`pose/coords.ts`)
- Input: `joints` (`poses_3d_world[0]`), 17×3.
- The up axis is **unknown**. Determine it empirically: render a pose and check whether the head (10) is above the pelvis (0). Then write one `toThree(j: number[]): THREE.Vector3` with the required axis swaps and flips. Leave a comment stating the finding.
- Recentre so the pelvis is at the origin. If the skeleton height (head top to the lower ankle) isn't about 1.5–2.0 units, scale it to 1.7.

### Stick figure (`scene/StickFigure.tsx`)
- 17 spheres (radius 0.03), plus one cylinder per parent→child bone.
- Colours: left `#3b82f6`, right `#ef4444`, centre `#ffffff`. A bone takes its child joint's group colour.
- Create the meshes once. Each pose, mutate positions and orientations through refs. Never remount.
- Keep the last good pose while the status is `no_person`, and dim it (opacity 0.3).

### Avatar asset
- The owner supplies the Mixamo **Y Bot** already converted to GLB at `mobile/assets/avatar.glb`. Don't download or convert it yourself. If the file is missing when you reach M6, stop and ask the owner for it.
- Mixamo assets are free to use under Adobe's terms. Note this in `mobile/assets/README.md`.
- Bone names use the `mixamorig:` prefix. Some converters strip the colon, so match names without regard to that prefix.

### Bone mapping (`scene/Avatar.tsx`)

| H36M bone (parent → child joint) | Mixamo bone |
|---|---|
| 0 → 7 (pelvis → spine) | `mixamorig:Spine` |
| 7 → 8 (spine → thorax) | `mixamorig:Spine2` |
| 8 → 9 (thorax → neck) | `mixamorig:Neck` |
| 9 → 10 (neck → head top) | `mixamorig:Head` |
| 11 → 12 (L shoulder → L elbow) | `mixamorig:LeftArm` |
| 12 → 13 (L elbow → L wrist) | `mixamorig:LeftForeArm` |
| 14 → 15 (R shoulder → R elbow) | `mixamorig:RightArm` |
| 15 → 16 (R elbow → R wrist) | `mixamorig:RightForeArm` |
| 4 → 5 (L hip → L knee) | `mixamorig:LeftUpLeg` |
| 5 → 6 (L knee → L ankle) | `mixamorig:LeftLeg` |
| 1 → 2 (R hip → R knee) | `mixamorig:RightUpLeg` |
| 2 → 3 (R knee → R ankle) | `mixamorig:RightLeg` |
| hips orientation (see below) | `mixamorig:Hips` |

If the stick figure's left/right was fixed in M5, apply the same fix here.

### Retargeting algorithm (run on every pose)

**Work in avatar space, not world space.** The joints are in the orbit group's local space (§R4 Layout), but `getWorldQuaternion()` and `getWorldPosition()` include the user's orbit rotation. Express every rotation and position relative to the GLB `scene` root:
```ts
const rootInv = scene.getWorldQuaternion(new Quaternion()).invert();
const avatarQuat = (o: Object3D) => rootInv.clone().multiply(o.getWorldQuaternion(new Quaternion()));
const avatarPos  = (o: Object3D) => scene.worldToLocal(o.getWorldPosition(new Vector3()));
```
Below, "A-space" means this avatar space. The GLB's root nodes already cancel out the FBX axis flip and apply ×0.01 scaling, so A-space is Y-up, in metres, and lines up with the joints' axes.

1. **At load time:** for each mapped bone, store `restLocalQuat`, `parentRestA = avatarQuat(parent)`, and `restDirA` (the normalised A-space vector from this bone's head to its first child bone's head). For the hips, also store `hipsRestA = avatarQuat(hips)` and the rest positions (A-space) of LeftUpLeg, RightUpLeg, Spine and Hips.
2. **Hips first:** build a frame with `right = normalize(Rhip − Lhip)`, `up = normalize(spine − pelvis)`, `forward = normalize(cross(right, up))`, then re-orthogonalise `up = cross(forward, right)`. Build `targetFrame` from the pose joints and `restFrame` from the stored rest positions.
   - `hipsA = targetFrame * inverse(restFrame) * hipsRestA`
   - `hips.quaternion = inverse(avatarQuat(hips.parent)) * hipsA`
   - Then `hips.updateMatrixWorld(true)`.
3. **Then the other bones, parent-first.** For each bone:
   - `targetDir = normalize(joint[child] − joint[parent])` (scene joints from `toSceneJoints`)
   - `parentA = avatarQuat(bone.parent)`
   - `curDir = restDirA` rotated by `parentA * inverse(parentRestA)`
   - `delta = Quaternion.setFromUnitVectors(curDir, targetDir)`
   - `boneA = delta * parentA * restLocalQuat`
   - `bone.quaternion = inverse(parentA) * boneA`
   - Call `bone.updateMatrixWorld(true)` before processing the children.
4. Unmapped bones (hands, feet, fingers, shoulders) stay in their rest local rotation.
5. No root translation. The avatar stays at the origin. **Don't add any extra scale**: the GLB is already in metres (Hips at about 1.0 above the feet).

## §R7 Final report checklist

- [ ] Benchmark p50/p95 (`prepare_2d`, `pose_3d`, `total`) and the device per stage
- [ ] End-to-end sent/s, recv/s and RTT observed on the phone
- [ ] Picture size chosen and measured capture time per frame
- [ ] Up-axis finding and the left/right verification result
- [ ] Avatar bone names found in the GLB, and whether they matched the §R6 table
- [ ] Every deviation from this spec, with the reason
