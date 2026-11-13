"""Geometry-only preprocessing for the ruled Copetin form; no OCR guesses."""
import cv2
import numpy as np


def _intersection(a, b):
    point = np.cross(a, b)
    if abs(point[2]) < 1e-6:
        raise ValueError("Parallel form boundaries")
    return point[:2] / point[2]


def prepare_form(image):
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                                   cv2.THRESH_BINARY_INV, 31, 12)
    lines = cv2.HoughLinesP(binary, 1, np.pi / 1800, 90,
                            minLineLength=int(width * .45), maxLineGap=25)
    horizontals, verticals = [], []
    for x1, y1, x2, y2 in [] if lines is None else lines.reshape(-1, 4):
        dx, dy = float(x2-x1), float(y2-y1)
        if abs(dx) > width * .45 and abs(dy / dx) < .25 and min(y1, y2) > height * .18:
            slope = dy / dx
            y_mid = y1 + slope * (width / 2 - x1)
            horizontals.append((y_mid, slope))
        if abs(dy) > height * .36 and abs(dx / dy) < .15:
            slope = dx / dy
            x_mid = x1 + slope * (height / 2 - y1)
            if width * .32 < x_mid < width * .74:
                verticals.append((x_mid, slope))
    groups = []
    for x_mid, slope in sorted(verticals):
        if not groups or abs(x_mid - np.median([v[0] for v in groups[-1]])) > width * .02:
            groups.append([])
        groups[-1].append((x_mid, slope))
    if len(horizontals) < 10 or len(groups) < 3:
        return image.copy(), {"rectified": False, "reason": "Grid not detected reliably"}
    # Use internal table rules: page/book edges are often curved or obscured.
    first, last = np.median(groups[0], axis=0), np.median(groups[-1], axis=0)
    if last[0] - first[0] < width * .15:
        return image.copy(), {"rectified": False, "reason": "Insufficient grid width"}
    ys = np.array([v[0] for v in horizontals])
    slopes = np.array([v[1] for v in horizontals])
    coefficient = np.polyfit(ys, slopes, 1)
    residual = np.abs(slopes - np.polyval(coefficient, ys))
    good = residual < max(.008, float(np.median(residual) * 3))
    if good.sum() >= 10:
        coefficient = np.polyfit(ys[good], slopes[good], 1)
    top, bottom = np.percentile(ys[good], [5, 95]) if good.sum() >= 10 else np.percentile(ys, [5, 95])
    def horizontal(y):
        slope = np.polyval(coefficient, y)
        return np.array([-slope, 1, slope * width/2 - y])
    def vertical(values):
        x_mid, slope = values
        return np.array([1, -slope, slope * height/2 - x_mid])
    left_line, right_line = vertical(first), vertical(last)
    source = np.float32([_intersection(left_line, horizontal(top)),
                         _intersection(right_line, horizontal(top)),
                         _intersection(right_line, horizontal(bottom)),
                         _intersection(left_line, horizontal(bottom))])
    target = np.float32([[first[0], top], [last[0], top], [last[0], bottom], [first[0], bottom]])
    transform = cv2.getPerspectiveTransform(source, target)
    warped = cv2.warpPerspective(image, transform, (width, height),
                                 borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
    return warped, {"rectified": True, "horizontalRules": len(horizontals),
                    "verticalRuleGroups": len(groups), "transform": transform.tolist()}


def remove_grid(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    background = cv2.GaussianBlur(gray, (61, 61), 0)
    normalized = cv2.divide(gray, background, scale=240)
    binary = cv2.adaptiveThreshold(normalized, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                                   cv2.THRESH_BINARY_INV, 25, 15)
    h, w = gray.shape
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                                  cv2.getStructuringElement(cv2.MORPH_RECT, (max(50, w//8), 1)))
    vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN,
                                cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(50, h//8))))
    mask = cv2.dilate(horizontal | vertical, np.ones((2, 2), np.uint8))
    cleaned = cv2.inpaint(normalized, mask, 2, cv2.INPAINT_TELEA)
    return cv2.cvtColor(cleaned, cv2.COLOR_GRAY2BGR)
