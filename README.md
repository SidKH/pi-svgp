# pi-svgp

Live SVG preview extension for pi's TUI.

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
