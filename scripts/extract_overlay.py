import os
import csv
import cv2
import numpy as np
import pytesseract

# Configuration
OVERLAY_PATH = 'overlays/overlay.png'
ICONS_DIR = 'icons'
FEATURES_CSV = 'data/features.csv'
# geographic bounds of overlay: [[minLat, minLon], [maxLat, maxLon]]
# Use world bounds so the overlay spans the entire map
MIN_LAT, MIN_LON = -85, -180
MAX_LAT, MAX_LON = 85, 180

def pixel_to_latlon(x, y, width, height):
    lon = MIN_LON + (x / width) * (MAX_LON - MIN_LON)
    lat = MAX_LAT - (y / height) * (MAX_LAT - MIN_LAT)
    return lat, lon

def extract_text(img):
    data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
    h, w = img.shape[:2]
    results = []
    for i, text in enumerate(data['text']):
        txt = text.strip()
        if not txt:
            continue
        x = data['left'][i] + data['width'][i] / 2
        y = data['top'][i] + data['height'][i] / 2
        lat, lon = pixel_to_latlon(x, y, w, h)
        results.append({'lat': lat, 'lon': lon, 'text': txt})
    return results

def match_icons(img):
    h, w = img.shape[:2]
    results = []
    # Only attempt to match a subset of icons to avoid excessive false positives
    targets = ['fort.png']
    for fname in targets:
        path = os.path.join(ICONS_DIR, fname)
        template = cv2.imread(path, cv2.IMREAD_UNCHANGED)
        if template is None:
            continue
        th, tw = template.shape[:2]
        if th > h or tw > w:
            continue
        if template.shape[2] == 4:
            template = cv2.cvtColor(template, cv2.COLOR_BGRA2BGR)
        res = cv2.matchTemplate(img, template, cv2.TM_CCOEFF_NORMED)
        min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)
        if max_val < 0.5:
            continue
        cx = max_loc[0] + tw / 2
        cy = max_loc[1] + th / 2
        lat, lon = pixel_to_latlon(cx, cy, w, h)
        results.append({'lat': lat, 'lon': lon, 'icon': os.path.splitext(fname)[0]})
    return results

def append_features(markers, texts):
    # Ensure the file ends with a newline before appending
    need_newline = False
    if os.path.exists(FEATURES_CSV):
        with open(FEATURES_CSV, 'rb') as f:
            try:
                f.seek(-1, os.SEEK_END)
                if f.read(1) not in b"\n\r":
                    need_newline = True
            except OSError:
                pass
    with open(FEATURES_CSV, 'a', newline='') as f:
        if need_newline:
            f.write('\n')
        writer = csv.writer(f)
        for m in markers:
            writer.writerow(['marker', m['lat'], m['lon'], m['icon'], m['icon'].title(), '', '', '', '', '', '', '', ''])
        for t in texts:
            writer.writerow(['text', t['lat'], t['lon'], '', '', t['text'], '', 1, 0, 0, 0, '', ''])

def main():
    img = cv2.imread(OVERLAY_PATH)
    if img is None:
        raise SystemExit(f'Could not read overlay at {OVERLAY_PATH}')
    texts = extract_text(img)
    markers = match_icons(img)
    append_features(markers, texts)
    print(f'Appended {len(markers)} markers and {len(texts)} text labels to {FEATURES_CSV}')

if __name__ == '__main__':
    main()
