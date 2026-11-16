"""Minimal CPU LivePortrait: re-render one portrait under controlled expression edits.

Usage: lp.py <lp_dir> <image> <landmarks.json> <outdir> [name=key:value,key:value ...]
Weights are loaded with weights_only=True (tensors only, no pickled code).
"""
import sys, os
import numpy as np, torch, cv2, yaml

LP = os.path.abspath(sys.argv[1])
sys.path.insert(0, os.path.join(LP, 'code'))
from src.modules.appearance_feature_extractor import AppearanceFeatureExtractor
from src.modules.motion_extractor import MotionExtractor
from src.modules.warping_network import WarpingNetwork
from src.modules.spade_generator import SPADEDecoder
from src.modules.stitching_retargeting_network import StitchingRetargetingNetwork
from src.utils.camera import headpose_pred_to_degree, get_rotation_matrix

torch.set_grad_enabled(False)
cfg = yaml.safe_load(open(os.path.join(LP, 'code/src/config/models.yaml')))['model_params']


def weights(name):
    return torch.load(os.path.join(LP, 'w', name), map_location='cpu', weights_only=True)


def load(cls, key, name):
    model = cls(**cfg[key])
    model.load_state_dict(weights(name))
    return model.eval()


F_ = load(AppearanceFeatureExtractor, 'appearance_feature_extractor_params', 'appearance_feature_extractor.pth')
M_ = load(MotionExtractor, 'motion_extractor_params', 'motion_extractor.pth')
W_ = load(WarpingNetwork, 'warping_module_params', 'warping_module.pth')
G_ = load(SPADEDecoder, 'spade_generator_params', 'spade_generator.pth')
S_ = StitchingRetargetingNetwork(**cfg['stitching_retargeting_module_params']['stitching'])
S_.load_state_dict({k.replace('module.', ''): v for k, v in weights('stitching_retargeting_module.pth')['retarget_shoulder'].items()})
S_.eval()


def landmarks(path):
    import json
    return np.array(json.load(open(path)))


def crop_matrix(pts, scale=2.3, vy=-0.125, dsize=512):
    # LivePortrait's crop convention: square of side scale * landmark extent, centre nudged up.
    centre = (pts.min(0) + pts.max(0)) / 2
    size = float(max(pts.max(0) - pts.min(0))) * scale
    centre = centre + np.array([0.0, vy * size])
    s = dsize / size
    return np.array([[s, 0, dsize / 2 - s * centre[0]], [0, s, dsize / 2 - s * centre[1]]], dtype=np.float32)


def edits(e, p):
    """Expression sliders on the implicit keypoints (after the AdvancedLivePortrait expression editor)."""
    g = lambda k: float(p.get(k, 0))
    smile, mouth, eee, woo, wink = g('smile'), g('aaa'), g('eee'), g('woo'), g('wink')
    px, py, eyes, brow = g('pupil_x'), g('pupil_y'), g('blink'), g('eyebrow')
    e[0, 20, 1] += smile * -0.01; e[0, 14, 1] += smile * -0.02; e[0, 17, 1] += smile * 0.0065; e[0, 17, 2] += smile * 0.003
    e[0, 13, 1] += smile * -0.00275; e[0, 16, 1] += smile * -0.00275; e[0, 3, 1] += smile * -0.0035; e[0, 7, 1] += smile * -0.0035
    e[0, 19, 1] += mouth * 0.001; e[0, 19, 2] += mouth * 0.0001; e[0, 17, 1] += mouth * -0.0001
    e[0, 20, 2] += eee * -0.001; e[0, 20, 1] += eee * -0.001; e[0, 14, 1] += eee * -0.001
    e[0, 14, 1] += woo * 0.001; e[0, 3, 1] += woo * -0.0005; e[0, 7, 1] += woo * -0.0005; e[0, 17, 2] += woo * -0.0005
    e[0, 11, 1] += wink * 0.001; e[0, 13, 1] += wink * -0.0003; e[0, 17, 0] += wink * 0.0003; e[0, 17, 1] += wink * 0.0003; e[0, 3, 1] += wink * -0.0003
    if px > 0:
        e[0, 11, 0] += px * 0.0007; e[0, 15, 0] += px * 0.001
    else:
        e[0, 11, 0] += px * 0.001; e[0, 15, 0] += px * 0.0007
    e[0, 11, 1] += py * -0.001; e[0, 15, 1] += py * -0.001
    eyes -= py / 2.
    e[0, 11, 1] += eyes * -0.001; e[0, 13, 1] += eyes * 0.0003; e[0, 15, 1] += eyes * -0.001; e[0, 16, 1] += eyes * 0.0003
    e[0, 1, 1] += eyes * -0.00025; e[0, 2, 1] += eyes * 0.00025
    if brow > 0:
        e[0, 1, 1] += brow * 0.001; e[0, 2, 1] += brow * -0.001
    else:
        e[0, 1, 0] += brow * -0.001; e[0, 2, 0] += brow * 0.001; e[0, 1, 1] += brow * 0.0003; e[0, 2, 1] += brow * -0.0003
    return g('pitch'), g('yaw'), g('roll')


def main():
    img_path, lmk_path, outdir = sys.argv[2], sys.argv[3], sys.argv[4]
    os.makedirs(outdir, exist_ok=True)
    specs = {}
    for arg in sys.argv[5:]:
        name, _, spec = arg.partition('=')
        specs[name] = {kv.split(':')[0]: float(kv.split(':')[1]) for kv in spec.split(',') if kv}
    rgb = cv2.cvtColor(cv2.imread(img_path), cv2.COLOR_BGR2RGB)
    H, Wd = rgb.shape[:2]
    M = crop_matrix(landmarks(lmk_path))
    Minv = cv2.invertAffineTransform(M)
    crop = cv2.warpAffine(rgb, M, (512, 512), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REFLECT)
    x = torch.from_numpy(cv2.resize(crop, (256, 256), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.).permute(2, 0, 1)[None]
    kp = M_(x)
    pitch = headpose_pred_to_degree(kp['pitch'])[:, None]
    yaw = headpose_pred_to_degree(kp['yaw'])[:, None]
    roll = headpose_pred_to_degree(kp['roll'])[:, None]
    xc = kp['kp'].reshape(1, -1, 3); exp = kp['exp'].reshape(1, -1, 3); t = kp['t']; scale = kp['scale']
    print('pose', round(pitch.item(), 2), round(yaw.item(), 2), round(roll.item(), 2), 'scale', round(scale.item(), 3), flush=True)

    def transform(p, y, r, e):
        k = (xc @ get_rotation_matrix(p, y, r) + e) * scale[..., None]
        k[:, :, 0:2] += t[:, None, 0:2]
        return k

    xs = transform(pitch, yaw, roll, exp)
    fs = F_(x)
    mask = cv2.imread(os.path.join(LP, 'code/src/utils/resources/mask_template.png'), cv2.IMREAD_COLOR)
    mask = cv2.warpAffine(mask, Minv, (Wd, H), flags=cv2.INTER_LINEAR).astype(np.float32) / 255.
    for name, p in specs.items():
        e = exp.clone()
        rp, ry, rr = edits(e, p)
        xd = transform(pitch + rp, yaw + ry, roll + rr, e)
        delta = S_(torch.cat([xs.view(1, -1), xd.view(1, -1)], dim=1))
        xd = xd + delta[:, :63].view(1, 21, 3)
        xd[:, :, :2] += delta[:, 63:65].view(1, 1, 2)
        out = G_(feature=W_(fs, kp_source=xs, kp_driving=xd)['out'])
        o = out[0].permute(1, 2, 0).clamp(0, 1).numpy() * 255.
        full = cv2.warpAffine(o.astype(np.float32), Minv, (Wd, H), flags=cv2.INTER_CUBIC)
        res = np.clip(mask * full + (1 - mask) * rgb, 0, 255).astype(np.uint8)
        cv2.imwrite(os.path.join(outdir, name + '.png'), cv2.cvtColor(res, cv2.COLOR_RGB2BGR))
        print('wrote', name, flush=True)


main()
