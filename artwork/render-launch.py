"""Render the startup artwork using Inkscape, Pillow and DejaVu fonts."""
import base64
from bisect import bisect_right
import math
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw, ImageFont


ARTWORK = Path(__file__).resolve().parent
ROOT = ARTWORK.parent
SCALE = 2
WIDTH, HEIGHT = 300, 148
COLUMNS, ROWS = 6, 4
FRAME_MS = 45
CONTROL = [(89, 101), (89, 108), (92, 115), (99, 118), (129, 118),
           (135, 116), (137, 110), (137, 104)]
POWER = [(183, 108), (183, 117), (185.25, 123.75), (192, 126),
         (210, 126), (219, 123), (222, 114), (222, 58),
         (223.75, 52.75), (229, 51), (236, 51)]


def gradient(value, low, high):
    return max(0.0, min(1.0, (value - low) / (high - low)))


class Cable:
    def __init__(self, points):
        self.points = points
        self.marks = [0]
        for start, end in zip(points, points[1:]):
            self.marks.append(self.marks[-1] + math.dist(start, end))
        self.length = self.marks[-1]

    def point(self, length):
        length = max(0, min(length, self.length))
        index = min(bisect_right(self.marks, length) - 1, len(self.marks) - 2)
        start, end = self.points[index:index + 2]
        ratio = gradient(length, self.marks[index], self.marks[index + 1])
        return tuple(a + ratio * (b - a) for a, b in zip(start, end))

    def wave(self, distance, time, strength):
        x, y = self.point(distance)
        x1, y1 = self.point(distance - 2)
        x2, y2 = self.point(distance + 2)
        dx, dy = x2 - x1, y2 - y1
        amplitude = 4.5 * strength * min(1, distance / 7, (self.length - distance) / 7)
        displacement = amplitude * math.sin(math.tau * (distance - .14 * time) / 23) / math.hypot(dx, dy)
        return x - dy * displacement, y + dx * displacement


def pixels(x, y):
    return round(x * SCALE), round(y * SCALE)


def trace(draw, points, color, width):
    if len(points) > 1:
        draw.line([pixels(*point) for point in points], fill=color, width=round(width * SCALE), joint="curve")


def render_motion():
    control, power = Cable(CONTROL), Cable(POWER)
    sprite = Image.new("RGBA", (WIDTH * SCALE * COLUMNS, HEIGHT * SCALE * ROWS))
    font = ImageFont.truetype("DejaVuSansMono-Bold.ttf", 10 * SCALE)
    small = ImageFont.truetype("DejaVuSans.ttf", 5 * SCALE)
    for frame in range(COLUMNS * ROWS):
        ms = frame * FRAME_MS
        image = Image.new("RGBA", (WIDTH * SCALE, HEIGHT * SCALE))
        draw = ImageDraw.Draw(image)

        if ms >= 90:
            for x in (16, 25, 34):
                color = "#acffc3" if x != 25 or ms >= 225 else "#487a68"
                draw.rounded_rectangle((pixels(x, 50), pixels(x + 5, 53)), radius=SCALE, fill=color)

        if 135 <= ms <= 450:
            tip = control.length * gradient(ms, 135, 440)
            start = max(0, tip - 14)
            trace(draw, [control.point(n) for n in range(int(start), int(tip) + 1)], "#79eeb5", 3.5)
            x, y = control.point(tip)
            draw.ellipse((pixels(x - 2, y - 2), pixels(x + 2, y + 2)), fill="#deffeb")

        frequency = min(50, round(50 * gradient(ms, 405, 945) / 5) * 5)
        draw.text(pixels(163, 34), f"{frequency},0", font=font, anchor="mm",
                  fill="#b9ffc4" if ms >= 405 else "#628979")
        draw.text(pixels(181, 38), "Гц", font=small, anchor="rs", fill="#9dceab")

        if ms >= 405:
            leading_edge = power.length * gradient(ms, 395, 860)
            strength = .68 + .32 * frequency / 50
            distances = [float(n) for n in range(0, math.ceil(leading_edge))] + [leading_edge]
            signal = [power.wave(d, ms, strength) for d in distances]
            trace(draw, signal, (100, 245, 170, 75), 4.2)
            trace(draw, signal, "#acffc7", 1.45)
            if ms >= 855:
                angle = math.tau * (ms - 855) / 190
                for direction in (0, math.pi):
                    theta = angle + direction
                    trace(draw, [(284 + 3.3 * math.cos(theta), 72 + 6 * math.sin(theta)),
                                 (284 + 6 * math.cos(theta), 72 + 11 * math.sin(theta))], "#acffc7", 1.25)
                draw.rectangle((pixels(237, 50), pixels(240, 52)), fill="#acffc3")

        sprite.paste(image, ((frame % COLUMNS) * WIDTH * SCALE, (frame // COLUMNS) * HEIGHT * SCALE))

    return sprite.quantize(colors=96, method=Image.Quantize.FASTOCTREE)


def main():
    with TemporaryDirectory() as temp:
        source = Path(temp) / "hardware.png"
        subprocess.run(["inkscape", str(ARTWORK / "launch-hardware.svg"),
                        f"--export-filename={source}", "--export-width=750"],
                       check=True, stdout=subprocess.DEVNULL)
        with Image.open(source) as rendered:
            hardware = rendered.convert("RGBA")
    output = ROOT / "public" / "icons"
    payloads = {}
    for suffix, artwork in (("hardware", hardware), ("motion", render_motion())):
        filename = output / f"launch-{suffix}.png"
        artwork.save(filename, optimize=True)
        payloads[suffix] = base64.b64encode(filename.read_bytes()).decode("ascii")
    module = ROOT / "mobile" / "launch-artwork.js"
    module.write_text(
        "// Generated by artwork/render-launch.py.\n" +
        "".join(f"export const {name} = {{ uri: 'data:image/png;base64,{payload}' }};\n"
                for name, payload in payloads.items()),
        encoding="utf-8"
    )


if __name__ == "__main__":
    main()
