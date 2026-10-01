#!/usr/bin/env python3
# /// script
# dependencies = ["numpy", "pillow", "opencv-python-headless"]
# ///
"""Regenerate the phone's app icons from the desktop app icon.

The desktop icon (apps/desktop/resources/AppIcon.png in the Ghostex checkout)
is a macOS squircle tile: a flat flower drawn over a blue gradient, with
transparent corners and a drop shadow. The phone needs a full-bleed square for
iOS and Expo, and separate background, foreground and monochrome layers for
the Android adaptive icon, so this splits the flower from its gradient,
rebuilds the gradient under the flower and past the tile edge, and writes:

  assets/icon.png                     1024 full-bleed square (iOS, Expo)
  assets/splash-icon.png              same artwork
  assets/favicon.png                  48 squircle tile (web)
  assets/android-icon-background.png  432 gradient layer
  assets/android-icon-foreground.png  432 flower layer
  assets/android-icon-monochrome.png  432 white flower for themed icons

The flower keeps the share of the visible icon it has on the desktop tile.

Usage: uv run scripts/generate-app-icons.py [path/to/AppIcon.png]
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

APP = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = APP.parents[2] / "apps/desktop/resources/AppIcon.png"
ASSETS = APP / "assets"

# The opaque squircle inside the 1024 desktop canvas.
TILE_ORIGIN = 100
TILE_SIZE = 824
# Android adaptive layers are 108dp; launchers show the middle 72dp.
ANDROID_LAYER = 432
ANDROID_VISIBLE = ANDROID_LAYER * 72 // 108
# Pixels of the tile edge that carry the macOS rim highlight.
RIM = 10


def load_tile(source: Path) -> np.ndarray:
    rgba = np.array(Image.open(source).convert("RGBA"))
    end = TILE_ORIGIN + TILE_SIZE
    return rgba[TILE_ORIGIN:end, TILE_ORIGIN:end].copy()


def erode(mask: np.ndarray, radius: int) -> np.ndarray:
    """Erode treating everything past the image edge as empty."""
    kernel = np.ones((2 * radius + 1, 2 * radius + 1), np.uint8)
    return cv2.erode(mask, kernel, borderType=cv2.BORDER_CONSTANT, borderValue=0)


def flower_masks(tile: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return (petals, flower): petals is the light fill only, flower adds the outlines."""
    rgb = tile[:, :, :3].astype(np.int32)
    hls = cv2.cvtColor(tile[:, :, :3], cv2.COLOR_RGB2HLS)
    # Petals are flat light blues (and a white centre dot); the gradient never gets this light.
    petals = ((hls[:, :, 1] > 150) & (rgb[:, :, 2] > 200)).astype(np.uint8) * 255
    petals[erode(tile[:, :, 3], 4 * RIM) < 255] = 0
    petals = cv2.morphologyEx(petals, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    # Grow over the navy outlines, then fill anything enclosed.
    flower = cv2.dilate(petals, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
    contours, _ = cv2.findContours(flower, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(flower)
    cv2.drawContours(filled, contours, -1, 255, cv2.FILLED)
    return petals, filled


def full_bleed_background(tile: np.ndarray, flower: np.ndarray, size: int) -> np.ndarray:
    """Rebuild the gradient without the flower on a `size` canvas centred on the tile."""
    pad = (size - TILE_SIZE) // 2
    canvas = np.zeros((size, size, 3), np.uint8)
    known = np.zeros((size, size), np.uint8)
    canvas[pad : pad + TILE_SIZE, pad : pad + TILE_SIZE] = tile[:, :, :3]
    inner = (tile[:, :, 3] == 255).astype(np.uint8) * 255
    inner = erode(inner, RIM)
    inner[flower > 0] = 0
    inner = erode(inner, 2)
    known[pad : pad + TILE_SIZE, pad : pad + TILE_SIZE] = inner
    # The gradient is smooth (light from the top, a soft glow in the middle), so a
    # low-order polynomial fitted to the visible background rebuilds it under the
    # flower and past the tile edge without blotches.
    ys, xs = np.nonzero(known)
    step = max(1, len(xs) // 40000)
    ys, xs = ys[::step], xs[::step]
    basis = lambda x, y: np.stack([x**i * y**j for i in range(5) for j in range(5 - i)], axis=-1)
    # Past the tile, hold the edge colour instead of extrapolating the polynomial.
    norm = lambda v: np.clip((v.astype(np.float64) - size / 2) / (TILE_SIZE / 2), -1, 1)
    coeffs, *_ = np.linalg.lstsq(basis(norm(xs), norm(ys)), canvas[ys, xs].astype(np.float64), rcond=None)
    grid_y, grid_x = np.mgrid[0:size, 0:size]
    out = basis(norm(grid_x), norm(grid_y)) @ coeffs
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def flower_layer(tile: np.ndarray, flower: np.ndarray, size: int) -> np.ndarray:
    """The flower's own pixels on a transparent `size` canvas, antialiased at the edge."""
    pad = (size - TILE_SIZE) // 2
    alpha = cv2.GaussianBlur(cv2.erode(flower, np.ones((3, 3), np.uint8)), (0, 0), 1.0)
    layer = np.zeros((size, size, 4), np.uint8)
    layer[pad : pad + TILE_SIZE, pad : pad + TILE_SIZE, :3] = tile[:, :, :3]
    layer[pad : pad + TILE_SIZE, pad : pad + TILE_SIZE, 3] = alpha
    return layer


def composite(background: np.ndarray, layer: np.ndarray) -> np.ndarray:
    a = layer[:, :, 3:4].astype(np.float32) / 255.0
    out = background.astype(np.float32) * (1 - a) + layer[:, :, :3].astype(np.float32) * a
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def save(array: np.ndarray, name: str, size: int, mode: str) -> None:
    image = Image.fromarray(array, mode)
    if image.width != size:
        image = image.resize((size, size), Image.LANCZOS)
    image.save(ASSETS / name, optimize=True)
    print(f"wrote assets/{name} ({size}x{size})")


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    tile = load_tile(source)
    petals, flower = flower_masks(tile)

    # Android: the tile maps onto the visible 72dp, so the layers extend past it.
    android_canvas = TILE_SIZE * ANDROID_LAYER // ANDROID_VISIBLE
    android_canvas += android_canvas % 2
    background = full_bleed_background(tile, flower, android_canvas)
    foreground = flower_layer(tile, flower, android_canvas)
    save(background, "android-icon-background.png", ANDROID_LAYER, "RGB")
    save(foreground, "android-icon-foreground.png", ANDROID_LAYER, "RGBA")

    pad = (android_canvas - TILE_SIZE) // 2
    mono = np.zeros((android_canvas, android_canvas, 4), np.uint8)
    mono[:, :, :3] = 255
    petal_alpha = cv2.GaussianBlur(petals, (0, 0), 1.0)
    mono[pad : pad + TILE_SIZE, pad : pad + TILE_SIZE, 3] = petal_alpha
    save(mono, "android-icon-monochrome.png", ANDROID_LAYER, "RGBA")

    # iOS and Expo: the tile itself, full bleed (iOS applies its own mask).
    square = composite(background, foreground)[pad : pad + TILE_SIZE, pad : pad + TILE_SIZE]
    save(square, "icon.png", 1024, "RGB")
    save(square, "splash-icon.png", 1024, "RGB")

    # Web favicon: the desktop tile with its rounded corners.
    save(tile, "favicon.png", 48, "RGBA")


if __name__ == "__main__":
    main()
