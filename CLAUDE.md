# ComfyUI PromptPalette

## Project Overview

ComfyUI-PromptPalette is a custom node for ComfyUI that enables fast prompt editing with mouse operations.
It provides interactive prompt editing features such as enabling/disabling phrases via checkboxes and weight adjustment buttons.

## Fork & Maintenance Scope

- This repository is a fork of the original ComfyUI-PromptPalette.
- Active development targets the **Nodes 1.0 Canvas UI only** (`web/canvas_ui.js`).
- The Nodes 2.0 DOM UI (`web/dom_ui.js`) remains in the repository but is not actively maintained. Do not add new features to it unless explicitly requested.

## Languages

- Python
- JavaScript

## Coding Conventions

- Code comments in English
- Log output in English

## Commit Conventions

- Commit messages in English

## Installation

- Follow the standard ComfyUI custom node installation procedure: place this folder in the `custom_nodes` directory.
- No additional setup or dependencies required.

## Build

- Not required

## Project Structure

Follows the standard ComfyUI custom node layout.

- `__init__.py`: Entry point that imports/exports the node mappings and web directory
- `nodes.py`: Backend that processes the text input (Python)
- `web/`
  - `index.js`: Frontend entry point (JavaScript)
  - `canvas_ui.js`: Frontend for Nodes 1.0 (Canvas rendering) — **primary UI**
  - `dom_ui.js`: Frontend for Nodes 2.0 (DOM rendering) — not actively maintained
  - `ui_utils.js`: Shared UI logic
  - `line.js`: Shared per-line text processing logic
  - `text_lines.js`: Line-array operations over the text widget value
- `pyproject.toml`: Metadata for Comfy Registry publishing

## Features

### Node Input Slots

- `prefix` slot (Optional)
  - type: Multiline STRING

### Node Widgets

- `text` widget: main text area
  - type: Multiline STRING
  - default: ""
- `delimiter` widget: delimiter setting
  - type: COMBO
  - options:
    - "comma"
    - "space"
    - "none"
  - default: "comma"
- `line_break` widget: line break setting
  - type: BOOLEAN
  - default: true

### Node Output

Outputs the main text area content formatted as follows:

- Remove empty lines
- Remove comments
  - Remove comment lines starting with `//`
  - Remove text after `//` within a line (trailing comment)
- Append a string to the end of each line according to the `delimiter` setting
  - "comma": append ", "
  - "space": append " "
  - "none": append nothing
- Adjust line breaks in the output according to the `line_break` setting
  - true: keep line breaks
  - false: remove line breaks
- If the `prefix` slot has input, prepend the prefix to the output string
  - Join with or without a line break according to the `line_break` setting
    - true: join with a line break
    - false: join without a line break
  - If the output string is empty, use the prefix alone as the output

### Edit Mode and Display Mode

- There are two modes: Edit mode and Display mode
- The `Edit` / `Save` button at the bottom of the node toggles between them
- Default is Display mode

### Edit Mode UI

- Arrange the following elements from top to bottom:
  - `text` widget
  - `delimiter` widget
  - `line_break` widget
  - `Save` button
- Layout
  - Align `delimiter`, `line_break`, and `Save` to the bottom of the node
  - The `text` widget fills the remaining upper area

### Display Mode UI

- For Nodes 1.0, the UI is rendered on the Canvas
  - Clicks are resolved via coordinate-based `clickableAreas`
- For Nodes 2.0, the UI is rendered with DOM elements
- The following widgets are hidden in Display mode:
  - `text` widget (main text area)
  - `delimiter` widget
  - `line_break` widget
- When the main text area contains text:
  - Render a "display row" (described below) for each line of the main text area
  - Show the `Edit` button aligned to the bottom of the node
  - Show the bulk action buttons (`All` / `None` / `Sort`) in a horizontal row above the `Edit` button
- When the main text area is empty:
  - Show "No Text" in the center of the node
  - Show the `Edit` button aligned to the bottom of the node
- When the node is collapsed:
  - Render nothing

#### Terminology

- `display text`: the text of a line with the leading comment prefix, weight value, weight parentheses, and weight colon removed. Trailing comments are included in the display text.
- `phrase text`: the text of a line with the leading comment prefix, trailing comment, weight value, weight parentheses, and weight colon removed.

#### Display Rows

- For each line, render a checkbox, the display text, the weight value, a `-` button, and a `+` button
  - Checkbox and display text are left-aligned
  - Weight value, `-` button, and `+` button are right-aligned
- If the phrase text is empty or whitespace-only, render the line as an empty row
  - e.g. lines containing only a leading comment prefix, or only a leading comment prefix and a trailing comment

#### Toggling Leading Comments via Checkbox

- When the checkbox is unchecked, add a leading comment `//` to the line
- When the checkbox is checked, remove the leading comment from the line

#### Bulk Action Buttons

- Show three buttons — `All` / `None` / `Sort` — in a horizontal row above the `Edit` button
- Hidden when the main text area is empty
- `All`: remove the leading comment from every line that has phrase text (check all)
- `None`: add a leading comment to every line that has phrase text (uncheck all)
- `All` / `None` do not reformat lines whose state does not change
- `Sort`: sort lines alphabetically by phrase text (case-insensitive)
  - Checked lines are grouped above unchecked lines
  - Lines without phrase text (empty lines, comment-only lines) move to the end, keeping their original relative order

#### Display Text

- If the display text would overlap the weight value or ± buttons, truncate the overlapping part
  - Nodes 1.0 (Canvas): clip the display text using Canvas `clip()`
  - Nodes 2.0 (DOM): truncate with an ellipsis via `text-overflow: ellipsis`
- If the weight is not 1.0, render the display text in bold

#### Weight Value

- Parse weight notation such as `(phrase:1.5)` and show the weight value
- Hide the weight value when the weight is 1.0
- Always show at least one decimal place
  - Show a second decimal place if present
  - Round off the third decimal place and beyond

#### Weight Adjustment `-` and `+` Buttons

- The ± buttons adjust the weight in 0.1 steps
- The weight range is 0.1–2.0
- If a value outside the range (e.g. 2.5) was entered by hand:
  - Display: show the value as-is
  - After pressing a ± button: clamp into the range
- When the weight returns to 1.0, remove the weight parentheses and value
- Weights can be adjusted on commented-out lines and lines with trailing comments
  - Leading comments and trailing comments are preserved after a weight change

### ComfyUI Theme Integration

- Match text, button, and checkbox colors to the ComfyUI theme
  - Supports both light and dark themes
- Read colors from ComfyUI CSS variables
  - Cache color values for performance
  - Expand 3-digit hex colors to 6-digit hex before use

#### Colors for Nodes 1.0 (Canvas)

Checkbox checked:
- Checkbox border: --input-text
- Checkbox fill: --input-text
- Checkbox check mark: --comfy-input-bg
- Display text: --input-text

Checkbox unchecked:
- Checkbox border: --input-text (opacity: 0.5)
- Checkbox fill: none
- Display text: --input-text (opacity: 0.4)

Other:
- Weight button fill: --comfy-input-bg
- Weight button + and -: --input-text (opacity: 0.6)
- "No Text" label: --input-text (opacity: 0.6)

#### Colors for Nodes 2.0 (DOM)

Checkbox checked:
- Checkbox border: --text-primary
- Checkbox fill: --text-primary
- Checkbox check mark: --component-node-widget-background
- Display text: --text-primary

Checkbox unchecked:
- Checkbox border: --text-primary (opacity: 0.5)
- Checkbox fill: none
- Display text: --text-primary (opacity: 0.4)

Other:
- Weight button fill: --component-node-widget-background
- Weight button fill (hover): --component-node-widget-background-hovered
- Weight button + and -: --text-primary (opacity: 0.6)
- Toggle button text: --text-primary (opacity: 0.6)
- Toggle button fill: --component-node-widget-background
- Toggle button fill (hover): --component-node-widget-background-hovered
- "No Text" label: --text-primary (opacity: 0.6)

### Extension Registration

- Register as a ComfyUI extension and hook into PromptPalette node creation/rendering
- Override PromptPalette node behavior in `beforeRegisterNodeDef`

## Other Implementation Guidelines

- Define UI constants in a `CONFIG` object

## Running ComfyUI

The ComfyUI-PromptPalette folder is placed inside the custom_nodes folder of a ComfyUI portable install.
With the ComfyUI-PromptPalette folder as the working directory, start ComfyUI with:

```
..\..\..\python_embeded\python.exe -u -s ..\..\..\ComfyUI\main.py --windows-standalone-build --disable-auto-launch
```

## Testing Procedure

1. Restart ComfyUI
2. Open ComfyUI with MCP Playwright
3. Create a new Workflow with the + button at the top of the screen
4. Double-click near the center of the screen to search for a node
5. Type "PromptPalette" and press Enter
6. Confirm the PromptPalette node was added at the center of the screen
7. Press the Edit button on the PromptPalette node
8. Add the following lines to the PromptPalette node's text area
```
aaa
(bbb:0.9) // BBB
// (abc:1.2)
//
```
9. Press the Save button on the PromptPalette node
10. Press the + button to the right of "aaa" twice
11. Confirm the number to the right of "aaa" is now 1.2

## Coding Agent Policy

- Do not make changes beyond the request; keep changes minimal and limited to the specified areas
- If the request is unclear or ambiguous, ask for clarification instead of guessing
- Explain the intent when editing code
- Explain the intent when running commands
- New UI features target the Nodes 1.0 Canvas UI (`canvas_ui.js`) only; leave the DOM UI (`dom_ui.js`) untouched unless explicitly requested

## Reference Pages

- [Comfy Objects - ComfyUI](https://docs.comfy.org/custom-nodes/js/javascript_objects_and_hijacking)
- [Comfy Hooks - ComfyUI](https://docs.comfy.org/custom-nodes/js/javascript_hooks)
