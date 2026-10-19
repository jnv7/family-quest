# App icons

`icon.svg` is the source. The PNG files are rasterised from it:

| File | Size | Used by |
| --- | --- | --- |
| `icon-192.png`, `icon-512.png` | 192, 512 | the web app manifest (`any`) |
| `icon-maskable-512.png` | 512 | the web app manifest (`maskable`); the star stays inside the central 60% so a mask never cuts it |
| `apple-touch-icon.png` | 180 | iOS home screen |

The icon is neutral on purpose: it has no theme vocabulary. To change it, edit the SVG, render it at 1024 px (for example in a browser), scale it down to each size, and replace the PNG files.
