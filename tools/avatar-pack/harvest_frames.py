"""Harvest an expression pack from a talking-head video of the character, rendering only what it lacks.

Usage:
  harvest_frames.py analyze <video> <work_dir> <face_landmarker.task> <hand_landmarker.task>
  harvest_frames.py select <video> <work_dir> <frames_dir> [--size 720x1280] [--scale 0.8] [--pose 6]
  harvest_frames.py fill <work_dir> <frames_dir> <liveportrait_dir> <face_landmarker.task> [--pose 6]

analyze  runs MediaPipe Face Landmarker (478 landmarks, 52 blendshapes, head pose) and Hand Landmarker on
         every frame and stores the measurements in <work_dir>/analysis.npz.
select   picks the neutral portrait (mouth closed, eyes open on the lens, brows at rest, near frontal, sharp,
         no hands) and scores every usable frame against each pack slot. Usable means sharp, nearly still,
         no hand near the face, and within --pose degrees of the portrait's yaw and pitch, so slots blend
         cleanly. Each slot takes the best frame whose measurements fall inside the slot's tolerances; it
         is aligned to the portrait on the stable landmarks the engine registers with and written to
         <frames_dir>/<slot>.png (the names build-pack.mjs reads). Slots no frame satisfies are left empty.
fill     renders each empty slot from the portrait with render_frames.py over a short ladder of LivePortrait
         settings, measures every render with the same detector and tolerances, and keeps the closest. The
         renderer's own drift (an unedited render measured against the portrait) is taken out first. Where
         LivePortrait cannot make the expression either, the closest render is kept and its error (> 1)
         recorded, so a short fall is visible rather than hidden.
Both steps keep <frames_dir>/slots.json: for every slot whether it is a real video frame (frame number,
time, measurements, error) or a LivePortrait fill (spec, measurements, error, and the best video frame that
was rejected). <frames_dir>/portrait_landmarks.json holds the portrait's landmarks for render_frames.py.
"""
import sys, os, json, math, shutil, subprocess, tempfile
import numpy as np, cv2

# Same landmark groups as avatar/engine/rig.js.
UI = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308]
LI = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]
EYE = {'R': dict(upper=[246, 161, 160, 159, 158, 157, 173], lower=[7, 163, 144, 145, 153, 154, 155], outer=33, inner=133, iris=468),
       'L': dict(upper=[466, 388, 387, 386, 385, 384, 398], lower=[249, 390, 373, 374, 380, 381, 382], outer=263, inner=362, iris=473)}
BROW = {'R': [70, 63, 105, 66, 107], 'L': [300, 293, 334, 296, 336]}
STABLE = [33, 133, 362, 263, 168, 6, 197, 195, 5, 4, 127, 356, 234, 454]
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]

OPEN = [0, 0.28, 0.6, 1]  # build-pack.mjs mouth.open stops
MOUTH = [f'm{s}{o}{v}' for s in (0, 1) for o in range(4) for v in 'emo']
UPPER = ['blink', 'browUp', 'frown', 'gl', 'gr', 'gu', 'gd', 'wide']

# LivePortrait settings tried for a slot the video lacks (render_frames.py sliders). gl/gr/gu/gd name the
# direction the irises move in the image.
LADDER = {'blink': ['blink:-14', 'blink:-18'], 'browUp': ['eyebrow:8', 'eyebrow:12'], 'frown': ['eyebrow:-13', 'eyebrow:-17', 'eyebrow:-21'],
          'wide': ['blink:3,eyebrow:2', 'blink:5,eyebrow:3'], 'gl': ['pupil_x:-8', 'pupil_x:-11', 'pupil_x:-14'], 'gr': ['pupil_x:8', 'pupil_x:11', 'pupil_x:14'],
          # Vertical gaze also moves the lids: pupil_y alone lifts them into a stare, so gu holds them
          # back (blink < 0) and gd lets them follow the iris down.
          'gu': ['pupil_y:20,blink:-4', 'pupil_y:24,blink:-6', 'pupil_y:28,blink:-8'], 'gd': ['pupil_y:-16,blink:-4', 'pupil_y:-20,blink:-4', 'pupil_y:-20']}
LP_SMILE = [[0], [0.6, 1.0]]
LP_OPEN = [[-8, 0], [4, 16], [30, 42], [75, 95]]
LP_SHAPE = {'e': ['eee:3', 'eee:6'], 'm': [''], 'o': ['woo:10', 'woo:20']}


def ladder(slot):
    if slot in LADDER: return LADDER[slot]
    s, o, v = int(slot[1]), int(slot[2]), slot[3]
    return [','.join(p for p in (f'smile:{a}' if a else '', f'aaa:{b}' if b else '', c) if p) or 'smile:0'
            for a in LP_SMILE[s] for b in LP_OPEN[o] for c in LP_SHAPE[v]]


def face_landmarker(task):
    from mediapipe.tasks.python import vision, BaseOptions
    return vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=task), num_faces=1, min_face_detection_confidence=0.4,
        min_face_presence_confidence=0.4, output_face_blendshapes=True, output_facial_transformation_matrixes=True))


def detect(landmarker, bgr):
    import mediapipe as mp
    H, W = bgr.shape[:2]
    r = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
    if not r.face_landmarks: return None
    return (np.array([[q.x * W, q.y * H, q.z * W] for q in r.face_landmarks[0]], np.float32), [c.category_name for c in r.face_blendshapes[0]],
            np.array([c.score for c in r.face_blendshapes[0]], np.float32), np.array(r.facial_transformation_matrixes[0], np.float32))


# ---------------------------------------------------------------- analyze

def analyze(video, work, face_task, hand_task):
    from mediapipe.tasks.python import vision, BaseOptions
    import mediapipe as mp
    face = face_landmarker(face_task)
    hands = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=hand_task), num_hands=2, min_hand_detection_confidence=0.35, min_hand_presence_confidence=0.35))
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS); n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    pts = np.full((n, 478, 3), np.nan, np.float32); bs = np.full((n, 52), np.nan, np.float32); mat = np.full((n, 4, 4), np.nan, np.float32)
    hb = np.full((n, 2, 4), np.nan, np.float32); sharp = np.full(n, np.nan, np.float32); names = None
    i = 0
    while i < n:
        ok, bgr = cap.read()
        if not ok: break
        H, W = bgr.shape[:2]
        found = detect(face, bgr)
        if found:
            p, names, bs[i], mat[i] = found; pts[i] = p
            # Sharpness of the face at a fixed scale (inter-iris distance 64 px).
            k = 64 / max(1, np.linalg.norm(p[473, :2] - p[468, :2]))
            x0, y0 = np.maximum(p[:, :2].min(0).astype(int), 0); x1, y1 = p[:, :2].max(0).astype(int)
            g = cv2.cvtColor(bgr[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
            if g.size: sharp[i] = cv2.Laplacian(cv2.resize(g, None, fx=k, fy=k, interpolation=cv2.INTER_AREA), cv2.CV_32F).var()
        h = hands.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
        for j, lm in enumerate(h.hand_landmarks[:2]):
            xy = np.array([[q.x * W, q.y * H] for q in lm]); hb[i, j] = [*xy.min(0), *xy.max(0)]
        i += 1
        if i % 200 == 0: print('analyzed', i, '/', n, flush=True)
    os.makedirs(work, exist_ok=True)
    np.savez_compressed(os.path.join(work, 'analysis.npz'), pts=pts[:i], bs=bs[:i], mat=mat[:i], hands=hb[:i], sharp=sharp[:i],
                        names=np.array(names or []), fps=fps, size=np.array([W, H]))
    print('frames', i, 'faces', int(np.isfinite(sharp[:i]).sum()), flush=True)


# ---------------------------------------------------------------- measurements

def euler(m):
    R = m[:3, :3]; sy = math.hypot(R[0, 0], R[1, 0])
    return np.degrees([math.atan2(-R[2, 0], sy), math.atan2(R[2, 1], R[2, 2]), math.atan2(R[1, 0], R[0, 0])])  # yaw, pitch, roll


def features(p, b, names):
    """Expression measurements of one face, in inter-iris distances (iod) or eye widths, so scale-free."""
    B = dict(zip(names, b)); bm = lambda *k: float(np.mean([B[x] for x in k]))
    P = p[:, :2]; iod = float(np.linalg.norm(P[473] - P[468]))
    r = (P[473] - P[468]) / iod; d = np.array([-r[1], r[0]])
    if d @ (P[152] - P[10]) < 0: d = -d
    gap = float(np.mean([np.linalg.norm(P[u] - P[l]) for u, l in zip(UI[2:9], LI[2:9])])) / iod
    ear, gx, gy, brow = [], [], [], []
    for s, e in EYE.items():
        w = np.linalg.norm(P[e['outer']] - P[e['inner']])
        ear.append(np.mean([np.linalg.norm(P[u] - P[l]) for u, l in zip(e['upper'][1:6], e['lower'][1:6])]) / w)
        c = (P[e['outer']] + P[e['inner']]) / 2
        gx.append((P[e['iris']] - c) @ r / w); gy.append((P[e['iris']] - c) @ d / w)  # +x image right, +y down
        brow.append(np.mean([(c - P[k]) @ d for k in BROW[s]]) / iod)
    return dict(iod=iod, gap=gap, width=float(np.linalg.norm(P[61] - P[291])) / iod,
                ear=float(np.mean(ear)), ear_max=float(np.max(ear)), gx=float(np.mean(gx)), gy=float(np.mean(gy)), brow=float(np.mean(brow)),
                smile=bm('mouthSmileLeft', 'mouthSmileRight'), funnel=B['mouthFunnel'], pucker=B['mouthPucker'],
                blink=bm('eyeBlinkLeft', 'eyeBlinkRight'), browDown=bm('browDownLeft', 'browDownRight'))


def similarity(src, dst):
    """Least-squares similarity src -> dst as a 2x3 matrix (same fit as rig.js fitSimilarity)."""
    sm, dm = src.mean(0), dst.mean(0); s, t = src - sm, dst - dm
    a = (s * t).sum() / (s ** 2).sum(); b = (s[:, 0] * t[:, 1] - s[:, 1] * t[:, 0]).sum() / (s ** 2).sum()
    M = np.array([[a, -b, 0], [b, a, 0]], np.float64); M[:, 2] = dm - M[:, :2] @ sm
    return M


class Cohort:
    """The video's usable frames, its portrait, and this face's own ranges, which slot scores are relative to."""

    def __init__(self, work, pose_tol=6.0):
        A = np.load(os.path.join(work, 'analysis.npz'))
        self.A = A; pts, bs, mat, hands, sharp = A['pts'], A['bs'], A['mat'], A['hands'], A['sharp']
        self.names = [str(x) for x in A['names']]; self.fps = float(A['fps']); n = self.n = len(pts)
        found = np.isfinite(sharp)
        self.F = [features(pts[i], bs[i], self.names) if found[i] else None for i in range(n)]
        self.ang = ang = np.array([euler(mat[i]) if found[i] else [np.nan] * 3 for i in range(n)])
        V = self.columns(self.F)
        # Image motion around each frame (blur), in iod per frame.
        motion = np.full(n, np.inf)
        for i in range(1, n - 1):
            if found[i - 1] and found[i] and found[i + 1]:
                motion[i] = np.mean(np.linalg.norm(pts[i + 1, :, :2] - pts[i - 1, :, :2], axis=1)) / 2 / V['iod'][i]
        # A hand anywhere near the face disqualifies the frame.
        occluded = np.zeros(n, bool)
        for i in np.where(found)[0]:
            x0, y0 = pts[i, :, :2].min(0); x1, y1 = pts[i, :, :2].max(0); m = 0.12 * (x1 - x0)
            for h in hands[i]:
                if np.isfinite(h).all() and h[0] < x1 + m and h[2] > x0 - m and h[1] < y1 + m and h[3] > y0 - m: occluded[i] = True
        good = found & ~occluded & (sharp >= np.nanpercentile(sharp, 20)) & (motion < 0.016)
        print(f'frames {n}, faces {found.sum()}, no hand near face {(found & ~occluded).sum()}, sharp and still {good.sum()}')

        # ---- the portrait: mouth closed, eyes open on the lens, brows at rest, frontal, many frames near its pose ----
        med = {k: np.nanmedian(V[k][good]) for k in ('ear', 'gx', 'gy', 'brow')}
        yaw0, pitch0 = np.nanmedian(ang[good, 0]), np.nanmedian(ang[good, 1])
        support = np.array([np.sum(good & (np.abs(ang[:, 0] - ang[i, 0]) < pose_tol) & (np.abs(ang[:, 1] - ang[i, 1]) < pose_tol)) if good[i] else 0 for i in range(n)])
        cost = np.full(n, np.inf); s90 = np.nanpercentile(sharp, 90)
        for i in np.where(good & (V['gap'] < 0.03))[0]:
            f = self.F[i]
            cost[i] = (8 * f['gap'] + 1.5 * f['smile'] + 2 * f['blink'] + 1.2 * f['browDown'] + 1.5 * (f['funnel'] + f['pucker'])
                       + 6 * abs(f['ear'] - med['ear']) + 10 * math.hypot(f['gx'] - med['gx'], f['gy'] - med['gy']) + 4 * abs(f['brow'] - med['brow'])
                       + 0.02 * (abs(ang[i, 0] - yaw0) + abs(ang[i, 1] - pitch0)) + 0.012 * (abs(ang[i, 0]) + abs(ang[i, 1]))
                       + 0.6 * (1 - support[i] / support.max()) + 10 * motion[i] + 0.3 * (1 - min(1, sharp[i] / s90)))
        self.n0 = n0 = int(np.argmin(cost)); self.f0 = f0 = self.F[n0]; self.a0 = a0 = ang[n0]
        self.near = good & (np.abs(ang[:, 0] - a0[0]) < pose_tol) & (np.abs(ang[:, 1] - a0[1]) < pose_tol)
        self.good, self.pose_tol = good, pose_tol
        print(f'portrait frame {n0} t={n0 / self.fps:.2f}s yaw {a0[0]:.1f} pitch {a0[1]:.1f} roll {a0[2]:.1f}; {self.near.sum()} usable frames within {pose_tol} deg of its pose')

        # ---- this face's ranges ----
        cand = np.where(self.near)[0]
        # Openness: lip gap over the widest this face opens, so the grid spans its own range.
        self.gmax = max(0.12, float(np.nanpercentile(V['gap'][cand], 98)))
        # Lip shape: width against the width this face shows at the same openness and smile (the jaw draws the
        # corners in, a smile pulls them out), in standard deviations.
        wr = V['width'] / f0['width'] - 1
        rest = cand[(V['funnel'][cand] < 0.15) & (V['pucker'][cand] < 0.25)]
        self.coef = np.linalg.lstsq(np.c_[np.ones(len(rest)), V['gap'][rest], V['smile'][rest]], wr[rest], rcond=None)[0]
        self.sd = float(np.nanstd(wr[rest] - np.c_[np.ones(len(rest)), V['gap'][rest], V['smile'][rest]] @ self.coef))
        self.smile_hi = max(0.5, float(np.nanpercentile(V['smile'][cand], 97)))
        print(f'open range {self.gmax:.3f} iod, smile {f0["smile"]:.2f}-{self.smile_hi:.2f}, width sd {self.sd:.3f}')
        s90 = np.nanpercentile(sharp, 90)
        self.quality = (0.15 * motion / 0.016 + 0.1 * (1 - np.clip(sharp / s90, 0, 1))
                        + 0.004 * (np.abs(ang[:, 0] - a0[0]) + np.abs(ang[:, 1] - a0[1])))
        self.V = V

    @staticmethod
    def columns(F):
        keys = next(f for f in F if f).keys()
        return {k: np.array([f[k] if f else np.nan for f in F]) for k in keys}

    def errors(self, V, slot):
        """Error of each face for a slot, in units of the slot's tolerance on each axis (the worst axis counts).
        <= 1 means the face shows the slot."""
        f0 = self.f0
        over = lambda v, lo, tol: np.maximum(0, lo - v) / tol       # want v >= lo
        under = lambda v, hi, tol: np.maximum(0, v - hi) / tol      # want v <= hi
        within = lambda v, c, tol: np.abs(v - c) / tol
        de, db, dx, dy = V['ear'] / f0['ear'] - 1, V['brow'] - f0['brow'], V['gx'] - f0['gx'], V['gy'] - f0['gy']
        gaze = np.hypot(dx, dy)
        if slot.startswith('m'):
            s, o, v = int(slot[1]), int(slot[2]), slot[3]
            oc = V['gap'] / self.gmax; sc = (V['smile'] - f0['smile']) / (self.smile_hi - f0['smile'])
            wr = V['width'] / f0['width'] - 1; rnd = V['pucker'] + V['funnel']
            xc = (wr - (self.coef[0] + self.coef[1] * V['gap'] + self.coef[2] * V['smile'])) / self.sd
            centre, tol = [(0, 0), (0.28, 0.13), (0.6, 0.17), (0.84, 0.16)][o]
            terms = [under(V['gap'], 0.02, 0.015) if o == 0 else over(oc, centre, tol) if o == 3 else within(oc, centre, tol)]
            terms.append(over(sc, 0.65, 0.3) if s else under(sc, 0.35, 0.3))
            if v == 'e': terms += [over(xc, 1.4, 0.7), under(rnd, 0.3, 0.3)]
            # Rounded: pursed, or clearly narrower than this face is at the same openness and smile.
            elif v == 'o': terms.append(np.minimum(over(rnd, 0.5, 0.2), over(-xc, 2, 0.8)))
            else: terms += [within(xc, 0, 0.7), under(rnd, 0.3, 0.3)]
            if slot == 'm10m':  # also the eyesSmile frame: eyes open and on the lens
                terms += [over(de, -0.35, 0.2), within(gaze, 0, 0.05)]
            return np.maximum.reduce(terms)
        calm_brow = within(db, 0, 0.05)
        terms = {
            'blink': [under(V['ear_max'] / f0['ear'], 0.3, 0.1), over(V['blink'], 0.6, 0.3), calm_brow],  # both eyes shut
            'browUp': [over(db, 0.055, 0.015), over(de, -0.15, 0.2), within(gaze, 0, 0.04)],
            'frown': [under(db, -0.045, 0.015), over(V['browDown'], 0.35, 0.1), over(de, -0.45, 0.2), within(gaze, 0, 0.04)],
            'wide': [over(de, 0.15, 0.06), under(db, 0.05, 0.03), within(gaze, 0, 0.04)],
            # A glance has to read as one: the iris at least 7% of the eye's width off its resting place (landmark
            # noise is 1-2%), lids open. Looking down lowers the lids, but a closing blink is not a glance.
            'gl': [over(-dx, 0.09, 0.02), within(dy, 0, 0.03), over(de, -0.12, 0.1), calm_brow],
            'gr': [over(dx, 0.09, 0.02), within(dy, 0, 0.03), over(de, -0.12, 0.1), calm_brow],
            'gu': [over(-dy, 0.06, 0.02), within(dx, 0, 0.03), over(de, -0.1, 0.1), under(de, 0.15, 0.1), calm_brow],  # a glance, not a stare
            'gd': [over(dy, 0.07, 0.02), within(dx, 0, 0.03), over(de, -0.3, 0.15), calm_brow],
        }[slot]
        return np.maximum.reduce(terms)


MEASURED = ('gap', 'width', 'smile', 'funnel', 'pucker', 'ear', 'blink', 'brow', 'browDown', 'gx', 'gy')


# ---------------------------------------------------------------- select

def select(video, work, out, size=(720, 1280), scale=0.8, pose_tol=6.0):
    C = Cohort(work, pose_tol); A, n0, fps = C.A, C.n0, C.fps; pts = A['pts']
    picks = {}; used = {n0}
    for slot in MOUTH + UPPER:
        if slot == 'm00m': picks[slot] = (n0, 0.0); continue
        err = C.errors(C.V, slot)
        total = np.where(C.near, err + C.quality, np.inf)
        # A frame (or its immediate neighbours) fills one slot only.
        order = [int(i) for i in np.argsort(total) if np.isfinite(total[i])]
        best = next((i for i in order if all(abs(i - u) > 2 for u in used)), order[0])
        picks[slot] = (best, float(err[best]))
        if err[best] <= 1: used.add(best)

    os.makedirs(out, exist_ok=True)
    cap = cv2.VideoCapture(video)
    def grab(i): cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, f = cap.read(); assert ok, i; return f
    W, H = size; P0 = pts[n0, :, :2]; FW, FH = (int(v) for v in A['size'])
    # The portrait is a window around the face, scaled by `scale`, face centre 36% down.
    cw, ch = min(FW, W / scale), min(FH, H / scale)
    cx, cy = P0[OVAL].mean(0)
    x0 = min(max(cx - cw / 2, 0), FW - cw); y0 = min(max(cy - ch * 0.36, 0), FH - ch)
    to_out = np.array([[W / cw, 0, -x0 * W / cw], [0, H / ch, -y0 * H / ch], [0, 0, 1]])
    record = {'fps': round(fps, 3), 'frames': C.n, 'portrait_frame': n0, 'portrait_time': round(n0 / fps, 3),
              'window': [round(x0), round(y0), round(cw), round(ch)], 'size': [W, H], 'pose_tolerance_deg': pose_tol,
              'usable_frames': int(C.good.sum()), 'within_pose': int(C.near.sum()), 'open_range_iod': round(C.gmax, 4), 'slots': {}}
    for slot in MOUTH + UPPER:
        i, err = picks[slot]; real = err <= 1; path = os.path.join(out, slot + '.png')
        seen = {'frame': i, 'time': round(i / fps, 3), 'error': round(err, 3), 'yaw_off': round(float(C.ang[i, 0] - C.a0[0]), 2),
                'pitch_off': round(float(C.ang[i, 1] - C.a0[1]), 2), 'measured': {k: round(float(C.F[i][k]), 3) for k in MEASURED}}
        if real:
            M = np.vstack([similarity(pts[i][STABLE, :2], P0[STABLE]), [0, 0, 1]])
            cv2.imwrite(path, cv2.warpAffine(grab(i), (to_out @ M)[:2], (W, H), flags=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE))
            record['slots'][slot] = {'source': 'video', **seen}
        else:
            if os.path.exists(path): os.remove(path)
            record['slots'][slot] = {'source': 'missing', 'closest_video_frame': seen}
        print(f"{slot:7s} {'video' if real else 'MISSING'} frame {i:5d} t={i / fps:6.2f}s error {err:5.2f}")
    with open(os.path.join(out, 'portrait_landmarks.json'), 'w') as fh: json.dump(((to_out[:2, :2] @ P0.T).T + to_out[:2, 2]).round(2).tolist(), fh)
    with open(os.path.join(out, 'slots.json'), 'w') as fh: json.dump(record, fh, indent=1)
    missing = [s for s, e in record['slots'].items() if e['source'] != 'video']
    print(f'{len(record["slots"]) - len(missing)} slots from video, {len(missing)} to fill: {" ".join(missing)}')


# ---------------------------------------------------------------- fill

def fill(work, out, lp_dir, face_task, pose_tol=6.0):
    C = Cohort(work, pose_tol)
    with open(os.path.join(out, 'slots.json')) as fh: record = json.load(fh)
    todo = [s for s, e in record['slots'].items() if e['source'] != 'video']
    if not todo: print('nothing to fill'); return
    tmp = tempfile.mkdtemp(prefix='lpfill-')
    jobs = [('base', 0, 'smile:0')] + [(slot, k, spec) for slot in todo for k, spec in enumerate(ladder(slot))]
    here = os.path.dirname(os.path.abspath(__file__))
    subprocess.run([sys.executable, '-I', os.path.join(here, 'render_frames.py'), lp_dir, os.path.join(out, 'm00m.png'),
                    os.path.join(out, 'portrait_landmarks.json'), tmp, *[f'{slot}__{k}={spec}' for slot, k, spec in jobs]], check=True)
    landmarker = face_landmarker(face_task)
    measure = lambda name: (lambda found: found and features(found[0], found[2], found[1]))(detect(landmarker, cv2.imread(os.path.join(tmp, name + '.png'))))
    base = measure('base__0'); bias = {k: base[k] - C.f0[k] for k in base if k != 'iod'}
    record['liveportrait_drift'] = {k: round(float(v), 4) for k, v in bias.items()}
    print('LivePortrait drift on an unedited render:', ', '.join(f'{k} {v:+.3f}' for k, v in bias.items()))
    for slot in todo:
        tried = []
        for s2, k, spec in jobs:
            if s2 != slot: continue
            f = measure(f'{slot}__{k}')
            if not f: tried.append({'spec': spec, 'error': None}); continue
            f = {key: v - bias.get(key, 0) for key, v in f.items()}
            tried.append({'spec': spec, 'error': round(float(C.errors(Cohort.columns([f]), slot)[0]), 3), 'k': k, 'measured': {m: round(float(f[m]), 3) for m in MEASURED}})
        best = min((t for t in tried if t['error'] is not None), key=lambda t: t['error'])
        shutil.copy(os.path.join(tmp, f"{slot}__{best['k']}.png"), os.path.join(out, slot + '.png'))
        entry = record['slots'][slot]
        record['slots'][slot] = {'source': 'liveportrait', 'spec': best['spec'], 'error': best['error'], 'measured': best['measured'],
                                 'tried': [{'spec': t['spec'], 'error': t['error']} for t in tried],
                                 'closest_video_frame': entry.get('closest_video_frame')}
        print(f"{slot:7s} LivePortrait {best['spec']:28s} error {best['error']:.2f}  (tried {', '.join(str(t['error']) for t in tried)})")
    shutil.rmtree(tmp, ignore_errors=True)
    with open(os.path.join(out, 'slots.json'), 'w') as fh: json.dump(record, fh, indent=1)


if __name__ == '__main__':
    cmd, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ('', [])
    pos = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or not args[i - 1].startswith('--'))]
    opts = {a: args[i + 1] for i, a in enumerate(args) if a.startswith('--')}
    if cmd == 'analyze': analyze(*pos[:4])
    elif cmd == 'select':
        select(*pos[:3], size=tuple(int(v) for v in opts.get('--size', '720x1280').split('x')), scale=float(opts.get('--scale', 0.8)), pose_tol=float(opts.get('--pose', 6)))
    elif cmd == 'fill': fill(*pos[:4], pose_tol=float(opts.get('--pose', 6)))
    else: sys.exit(__doc__)
