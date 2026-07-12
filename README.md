# pi-svgp

Live SVG preview extension for pi's TUI.

https://github.com/user-attachments/assets/2d3b586e-bb2c-413f-adcc-4217ae1f44ae

## Install

```bash
pi install npm:pi-svgp
```

Or try it without installing:

```bash
pi -e npm:pi-svgp
```

## Usage

```text
/svgp path/to/file.svg
/svgp-copy
/svgp-close
```

- `/svgp` opens a live preview widget below the editor.
- `/svgp-copy` copies the SVG source to the clipboard.
- `/svgp-close` closes the preview widget.
