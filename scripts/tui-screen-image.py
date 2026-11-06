"""Rasterize saved real Pi frame cells; fixture data, not a live-model screenshot.

Optional visual-review tool: Python + Pillow + DejaVu/Noto CJK fonts on Linux.
Usage: python3 scripts/tui-screen-image.py fixtures/tui/0.8.11/screens.json
"""
import json
from pathlib import Path
import re
import sys
import unicodedata
from PIL import Image, ImageDraw, ImageFont


def indexed(n):
    if n < 16:
        return ["#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
                "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff"][n]
    if n >= 232:
        return (8 + (n-232)*10,)*3
    n -= 16
    level = [0, 95, 135, 175, 215, 255]
    return (level[n//36], level[n//6 % 6], level[n % 6])


source = Path(sys.argv[1])
fonts = {False: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 15),
         True: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 15)}
cjk = {False: ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 18, index=1),
       True: ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 18, index=1)}
frames = json.loads(source.read_text())['captures']
for frame in frames:
    image = Image.new('RGB', (frame['columns']*10, frame['rows']*24), '#010201')
    draw = ImageDraw.Draw(image)
    for y, line in enumerate(frame['ansi']):
        foreground, background, bold, inverse = '#bbc6c3', '#010201', False, False
        x = 0
        for part in re.split(r'(\x1b\[[0-9;]*m|\x1b\][^\x07]*(?:\x07|\x1b\\))', line):
            if part.startswith('\x1b['):
                codes = list(map(int, part[2:-1].split(';'))) if part[2:-1] else [0]
                i = 0
                while i < len(codes):
                    code = codes[i]
                    if code == 0: foreground, background, bold, inverse = '#bbc6c3', '#010201', False, False
                    elif code in (1, 22): bold = code == 1
                    elif code in (7, 27): inverse = code == 7
                    elif code == 39: foreground = '#bbc6c3'
                    elif code == 49: background = '#010201'
                    elif 30 <= code <= 37: foreground = indexed(code-30)
                    elif 90 <= code <= 97: foreground = indexed(code-90+8)
                    elif 40 <= code <= 47: background = indexed(code-40)
                    elif 100 <= code <= 107: background = indexed(code-100+8)
                    elif code in (38, 48):
                        if codes[i+1] == 2:
                            value = tuple(codes[i+2:i+5]); i += 4
                        elif codes[i+1] == 5:
                            value = indexed(codes[i+2]); i += 2
                        else: raise ValueError('Unsupported SGR color')
                        if code == 38: foreground = value
                        else: background = value
                    i += 1
            elif not part.startswith('\x1b]'):
                for char in part:
                    if unicodedata.combining(char): continue
                    cells = 2 if unicodedata.east_asian_width(char) in ('W', 'F') else 1
                    fg, bg = (background, foreground) if inverse else (foreground, background)
                    draw.rectangle((x*10, y*24, (x+cells)*10-1, (y+1)*24-1), fill=bg)
                    draw.text((x*10, y*24+19), char, font=cjk[bold] if cells == 2 else fonts[bold], fill=fg, anchor='ls')
                    x += cells
    image.save(source.parent/(frame['name']+'.png'))
print(json.dumps({'frames': len(frames), 'source': str(source), 'kind': 'actual-renderer-colors/synthetic-presentation-data'}))
