#!/usr/bin/env python3
"""Detect chart-switch boundaries in a TradingView screen-recording.

The background is pixel-identical across charts; only the symbol-HEADER text and
the candle area change on a switch. So we DETECT CHANGE in the cropped header
region (dhash + abs-diff + SSIM, 2-of-3 vote), confirmed by a candle-region
change, sampled every 2s. We never OCR — a change detector beats unreadable text.
(Algorithm per Codex advice.)

Usage: detect_switches.py <video.mp4>  ->  prints JSON {duration, boundaries:[sec,...]}
"""
import sys, os, json, tempfile, subprocess, glob
import cv2
import numpy as np
import imagehash
from PIL import Image
from skimage.metrics import structural_similarity as ssim

SAMPLE_SECONDS = 2
# Calibrated on the title-band crop: switches show dhash≈70-98 / abs≈9-15 / ssim≈0.3-0.5,
# same-chart frames dhash≈30 / abs≈2 / ssim≈0.04. Thresholds sit in the gap.
HEADER_DHASH_SPIKE = 55      # /256 (hash_size=16)
HEADER_ABSDIFF_SPIKE = 6     # mean |Δ| on 0-255 grayscale
HEADER_SSIM_SPIKE = 0.22     # 1 - SSIM
CANDLE_PHASH_SPIKE = 20      # /256
CANDLE_EDGE_SPIKE = 0.06
CLUSTER_GAP = 4              # s — group candidate spikes
MIN_BOUNDARY_SPACING = 16    # s — debounce clustered within-chart spikes; vision-dedup
                             #     merges any over-segmentation by actual symbol afterwards.

# The symbol title sits at a different height per layout (528p ≈9% down, 1080p ≈16%).
# Scan several overlapping thin bands (x 0..0.45) and take the band with the biggest
# change — that's the title row, wherever it is. Auto-adapts to any resolution.
TITLE_BANDS = [(0.05, 0.13), (0.09, 0.17), (0.13, 0.21)]
CANDLE = (0.05, 0.22, 0.78, 0.92)


def crop_frac(img, x0, y0, x1, y1):
    h, w = img.shape[:2]
    return img[int(h * y0):int(h * y1), int(w * x0):int(w * x1)]


def header_bands(bgr):
    # x only to 0.22 — the ticker NAME sits at the left; this EXCLUDES the live OHLC
    # values (which tick every candle) and the timeframe/exchange tail, so the band
    # is static within a chart and only changes when the symbol changes.
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    out = []
    for (y0, y1) in TITLE_BANDS:
        c = crop_frac(g, 0.0, y0, 0.22, y1)
        out.append(cv2.resize(c, (260, 60)))
    return out


def prep_candle(bgr):
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return cv2.resize(g, (320, 200))


def edge_diff(a, b):
    ea, eb = cv2.Canny(a, 50, 150), cv2.Canny(b, 50, 150)
    return float(np.mean(cv2.absdiff(ea, eb))) / 255.0


def likely_popup(bgr):
    # Disabled: the contour heuristic mis-flagged a third of normal dark-chart frames.
    # The header-change + candle-change gate already rejects the noise it was meant to.
    return False


def features(path):
    bgr = cv2.imread(path)
    bands = header_bands(bgr)
    cnd = prep_candle(crop_frac(bgr, *CANDLE))
    return {
        "bands": bands,
        "band_dhash": [imagehash.dhash(Image.fromarray(b), hash_size=16) for b in bands],
        "cnd": cnd,
        "cnd_phash": imagehash.phash(Image.fromarray(cnd), hash_size=16),
        "popup": likely_popup(bgr),
    }


def compare(p, c):
    # per-band header metrics → take the band with the largest dhash (the title row)
    best = max(range(len(c["bands"])), key=lambda i: c["band_dhash"][i] - p["band_dhash"][i])
    h_dhash = c["band_dhash"][best] - p["band_dhash"][best]
    h_abs = float(np.mean(cv2.absdiff(p["bands"][best], c["bands"][best])))
    h_ssim = 1.0 - ssim(p["bands"][best], c["bands"][best])
    c_phash = c["cnd_phash"] - p["cnd_phash"]
    c_edge = edge_diff(p["cnd"], c["cnd"])
    # NB: cast to int — summing numpy bools does logical-OR, not an integer count.
    # Require all 3 header signals to agree: a real symbol switch changes the ticker
    # text strongly on every metric; legend/OHLC flicker trips only one or two.
    header_votes = int(h_dhash >= HEADER_DHASH_SPIKE) + int(h_abs >= HEADER_ABSDIFF_SPIKE) + int(h_ssim >= HEADER_SSIM_SPIKE)
    header_change = header_votes >= 3
    candle_change = c_phash >= CANDLE_PHASH_SPIKE or c_edge >= CANDLE_EDGE_SPIKE
    candidate = header_change and candle_change
    strength = (h_dhash / HEADER_DHASH_SPIKE + h_abs / HEADER_ABSDIFF_SPIKE + h_ssim / HEADER_SSIM_SPIKE
                + c_phash / CANDLE_PHASH_SPIKE + c_edge / CANDLE_EDGE_SPIKE)
    return candidate, strength


def main():
    video = sys.argv[1]
    dur = int(float(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", video]).decode().strip()))
    with tempfile.TemporaryDirectory() as td:
        subprocess.run(["ffmpeg", "-y", "-i", video, "-vf", f"fps=1/{SAMPLE_SECONDS}",
                        "-q:v", "3", os.path.join(td, "f_%05d.jpg")],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        frames = sorted(glob.glob(os.path.join(td, "f_*.jpg")))
        feats = [features(f) for f in frames]

    cands = []
    for i in range(1, len(feats)):
        if feats[i - 1]["popup"] or feats[i]["popup"]:
            continue
        cand, strength = compare(feats[i - 1], feats[i])
        if cand:
            cands.append({"t": i * SAMPLE_SECONDS, "strength": strength})

    # cluster nearby spikes, then enforce min spacing
    boundaries = [0]
    cluster = []
    def flush():
        if not cluster:
            return
        best = max(cluster, key=lambda x: x["strength"])
        if best["t"] - boundaries[-1] >= MIN_BOUNDARY_SPACING:
            boundaries.append(best["t"])
    for c in cands:
        if cluster and c["t"] - cluster[-1]["t"] > CLUSTER_GAP:
            flush(); cluster = []
        cluster.append(c)
    flush()

    # High-recall boundaries — never miss a switch. Any residual over-segmentation
    # (within-chart spikes that revert to the same symbol) is merged downstream by the
    # vision extractor, which reads each segment's ACTUAL symbol (reliable, unlike
    # hashing a band polluted by the indicator legend).
    print(json.dumps({"duration": dur, "boundaries": boundaries}))


if __name__ == "__main__":
    main()
