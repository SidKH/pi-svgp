# pi-svgp

Live SVG preview extension for Pi

https://github.com/user-attachments/assets/2d3b586e-bb2c-413f-adcc-4217ae1f44ae

## How it works

Extension converts a given SVG to PNG with [@resvg/resvg-js](https://github.com/thx/resvg-js) and renders it as a TUI widget below the editor

## Install

```bash
pi install npm:pi-svgp
```

Or try it without installing:

```bash
pi -e npm:pi-svgp
```

## Commands

- `/svgp` opens a live preview widget below the editor.
- `/svgp-copy` copies the SVG source to the clipboard.
- `/svgp-close` closes the preview widget.
