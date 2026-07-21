import { Line } from "./line.js";
import {
  findDelimiterWidget,
  findLineBreakWidget,
  findTextWidget,
  hideWidget,
  hideWidgetAndKeepSpace,
  showWidget,
  validateDelimiterValue,
  validateLineBreakValue,
} from "./ui_utils.js";
import { TextLines } from "./text_lines.js";

const CONFIG = {
  minNodeHeight: 100,
  topNodePadding: 40,
  sideNodePadding: 14,
  lineHeight: 24,
  fontSize: 13,
  checkboxSize: 16,
  checkboxMarginRight: 6,
  weightLabelWidth: 34,
  weightLabelMarginRight: 2,
  weightButtonSize: 16,
  weightButtonGap: 4,
  // Action buttons (Check All / Uncheck All / Sort)
  actionButtonHeight: 18,
  actionButtonGap: 6,
  actionButtonFontSize: 11,
  // Scrolling
  bottomPadding: 6,
  fallbackBottomPadding: 46,
  scrollbarWidth: 6,
  scrollbarMargin: 2,
  scrollbarMinThumb: 24,
};

let colorCache = null;

export function setupCanvasUI(nodeType, app) {
  // Hook once per node type to avoid double-wrapping prototype methods.
  if (nodeType.prototype.__nodeTypeInitialized) {
    return;
  }
  nodeType.prototype.__nodeTypeInitialized = true;

  // Run the original handler to preserve other extensions.
  const origOnNodeCreated = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function () {
    if (origOnNodeCreated) {
      origOnNodeCreated.apply(this, arguments);
    }
    // Initialize Canvas UI for new nodes
    if (this.__nodeInitialized) {
      return;
    }
    this.__nodeInitialized = true;

    const textWidget = findTextWidget(this);
    if (textWidget) {
      this.__promptPaletteCanvasUI = new PromptPaletteCanvasUI(
        this,
        textWidget,
        app,
      );
    }
  };

  const origOnConfigure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function (data) {
    if (origOnConfigure) {
      origOnConfigure.call(this, data);
    }
    validateDelimiterValue(findDelimiterWidget(this));
    validateLineBreakValue(findLineBreakWidget(this));
  };

  const origOnDrawForeground = nodeType.prototype.onDrawForeground;
  nodeType.prototype.onDrawForeground = function (ctx) {
    if (origOnDrawForeground) {
      origOnDrawForeground.call(this, ctx);
    }
    this.__promptPaletteCanvasUI?.draw(ctx);
  };
}

class PromptPaletteCanvasUI {
  static MODE = Object.freeze({
    EDIT: "edit",
    DISPLAY: "display",
  });
  static ACTION = Object.freeze({
    TOGGLE_COMMENT: "toggle_comment",
    WEIGHT_PLUS: "weight_plus",
    WEIGHT_MINUS: "weight_minus",
    CHECK_ALL: "check_all",
    UNCHECK_ALL: "uncheck_all",
    SORT: "sort",
  });

  #node;
  #textWidget;
  #delimiterWidget;
  #lineBreakWidget;
  #app;
  #mode;
  #clickableAreas;
  #toggleButton;
  #scrollY;
  #maxScrollY;
  #scrollbarThumb;
  #wheelHandler;

  constructor(node, textWidget, app) {
    this.#node = node;
    this.#textWidget = textWidget;
    this.#delimiterWidget = findDelimiterWidget(node);
    this.#lineBreakWidget = findLineBreakWidget(node);
    this.#app = app;
    this.#mode = PromptPaletteCanvasUI.MODE.DISPLAY;
    this.#clickableAreas = [];
    this.#toggleButton = null;
    this.#scrollY = 0;
    this.#maxScrollY = 0;
    this.#scrollbarThumb = null;
    this.#wheelHandler = null;

    hideWidgetAndKeepSpace(this.#textWidget);
    hideWidget(this.#delimiterWidget);
    hideWidget(this.#lineBreakWidget);
    this.#addToggleButton();
    this.#attachClickHandler();
    this.#attachWheelHandler();
  }

  draw(ctx) {
    if (this.#mode !== PromptPaletteCanvasUI.MODE.DISPLAY) {
      return;
    }
    this.#drawCheckboxList(ctx);
  }

  // ========================================
  // Mode Management
  // ========================================
  #changeMode(mode) {
    this.#mode = mode;
    this.#updateWidgetVisibility();
    this.#updateToggleButtonLabel();
    this.#app.graph.setDirtyCanvas(true);
  }

  #updateWidgetVisibility() {
    if (this.#mode === PromptPaletteCanvasUI.MODE.EDIT) {
      if (this.#textWidget) showWidget(this.#textWidget);
      if (this.#delimiterWidget) showWidget(this.#delimiterWidget);
      if (this.#lineBreakWidget) showWidget(this.#lineBreakWidget);
    } else {
      if (this.#textWidget) hideWidgetAndKeepSpace(this.#textWidget);
      if (this.#delimiterWidget) hideWidget(this.#delimiterWidget);
      if (this.#lineBreakWidget) hideWidget(this.#lineBreakWidget);
    }
  }

  #updateToggleButtonLabel() {
    if (!this.#toggleButton) return;
    this.#toggleButton.name =
      this.#mode === PromptPaletteCanvasUI.MODE.EDIT ? "Save" : "Edit";
  }

  // ========================================
  // Widget Management
  // ========================================
  #addToggleButton() {
    this.#toggleButton = this.#node.addWidget(
      "button",
      "Edit",
      "edit_text",
      () => {
        this.#changeMode(
          this.#mode === PromptPaletteCanvasUI.MODE.EDIT
            ? PromptPaletteCanvasUI.MODE.DISPLAY
            : PromptPaletteCanvasUI.MODE.EDIT,
        );
      },
    );
    this.#toggleButton.serialize = false;

    const spacer = this.#node.addWidget("text", "", "");
    spacer.computeSize = () => [0, 6];
    spacer.draw = () => {};
    spacer.serialize = false;
  }

  // ========================================
  // Click Handling
  // ========================================
  #attachClickHandler() {
    const self = this;
    this.#node.onMouseDown = function (e, pos) {
      return self.#handleMouseDown(pos);
    };
  }

  #handleMouseDown(pos) {
    if (this.#mode === PromptPaletteCanvasUI.MODE.EDIT) {
      return;
    }
    // Return true so LiteGraph doesn't start dragging the node while
    // the scrollbar is being manipulated.
    if (this.#startScrollbarDragIfHit(pos)) {
      return true;
    }
    const clickedArea = this.#findClickedArea(pos);
    if (clickedArea) {
      this.#handleClickableAreaAction(clickedArea);
    }
  }

  // ========================================
  // Scroll Handling
  // ========================================
  #attachWheelHandler() {
    const canvasEl = this.#app.canvas?.canvas;
    if (!canvasEl) return;

    this.#wheelHandler = (e) => this.#handleWheel(e);
    // Capture phase so we can pre-empt the canvas zoom handler when the
    // cursor is over a scrollable node.
    canvasEl.addEventListener("wheel", this.#wheelHandler, {
      passive: false,
      capture: true,
    });

    // Remove the listener when the node is deleted to avoid leaks.
    const self = this;
    const origOnRemoved = this.#node.onRemoved;
    this.#node.onRemoved = function () {
      canvasEl.removeEventListener("wheel", self.#wheelHandler, {
        capture: true,
      });
      if (origOnRemoved) {
        return origOnRemoved.apply(this, arguments);
      }
    };
  }

  #handleWheel(e) {
    if (this.#mode !== PromptPaletteCanvasUI.MODE.DISPLAY) return;
    if (this.#node.flags && this.#node.flags.collapsed) return;
    if (this.#maxScrollY <= 0) return;
    if (!this.#isMouseOverNode()) return;

    this.#scrollY = clamp(this.#scrollY + e.deltaY, 0, this.#maxScrollY);
    this.#app.graph.setDirtyCanvas(true);
    // Scroll the list instead of zooming the canvas.
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  #isMouseOverNode() {
    const canvas = this.#app.canvas;
    if (!canvas) return false;
    const mouse = canvas.graph_mouse || canvas.canvas_mouse;
    if (!mouse) return false;
    if (typeof this.#node.isPointInside === "function") {
      return this.#node.isPointInside(mouse[0], mouse[1]);
    }
    // Fallback: manual bounds check in graph coordinates.
    const [nx, ny] = this.#node.pos;
    const [nw, nh] = this.#node.size;
    return (
      mouse[0] >= nx &&
      mouse[0] <= nx + nw &&
      mouse[1] >= ny &&
      mouse[1] <= ny + nh
    );
  }

  #startScrollbarDragIfHit(pos) {
    const thumb = this.#scrollbarThumb;
    if (!thumb || this.#maxScrollY <= 0) return false;

    const [x, y] = pos;
    const withinX = x >= thumb.x - 2 && x <= thumb.x + thumb.w + 2;
    const withinTrack = y >= thumb.trackY && y <= thumb.trackY + thumb.trackH;
    if (!withinX || !withinTrack) return false;

    const onThumb = y >= thumb.y && y <= thumb.y + thumb.h;
    if (!onThumb) {
      // Clicking the track jumps the thumb to the cursor before dragging.
      this.#setScrollFromThumbTop(y - thumb.h / 2, thumb);
    }
    this.#beginScrollbarDrag(thumb);
    return true;
  }

  #beginScrollbarDrag(thumb) {
    const scale = this.#app.canvas?.ds?.scale || 1;
    const startThumbTop = this.#thumbTopFromScroll(thumb);
    let startClientY = null;

    const onMove = (e) => {
      if (startClientY === null) startClientY = e.clientY;
      const deltaGraph = (e.clientY - startClientY) / scale;
      this.#setScrollFromThumbTop(startThumbTop + deltaGraph, thumb);
      this.#app.graph.setDirtyCanvas(true);
      e.preventDefault();
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  }

  #thumbTopFromScroll(thumb) {
    if (this.#maxScrollY <= 0) return thumb.trackY;
    return (
      thumb.trackY +
      (this.#scrollY / this.#maxScrollY) * (thumb.trackH - thumb.h)
    );
  }

  #setScrollFromThumbTop(thumbTop, thumb) {
    const range = thumb.trackH - thumb.h;
    const ratio = range > 0 ? (thumbTop - thumb.trackY) / range : 0;
    this.#scrollY = clamp(ratio * this.#maxScrollY, 0, this.#maxScrollY);
  }

  #findClickedArea(pos) {
    const [x, y] = pos;
    for (const area of this.#clickableAreas) {
      if (
        x >= area.x &&
        x <= area.x + area.w &&
        y >= area.y &&
        y <= area.y + area.h
      ) {
        return area;
      }
    }
    return null;
  }

  #handleClickableAreaAction(area) {
    switch (area.action) {
      case PromptPaletteCanvasUI.ACTION.TOGGLE_COMMENT:
        this.#toggleLineComment(area.lineIndex);
        break;
      case PromptPaletteCanvasUI.ACTION.WEIGHT_PLUS:
        this.#adjustLineWeight(area.lineIndex, 0.1);
        break;
      case PromptPaletteCanvasUI.ACTION.WEIGHT_MINUS:
        this.#adjustLineWeight(area.lineIndex, -0.1);
        break;
      case PromptPaletteCanvasUI.ACTION.CHECK_ALL:
        this.#setAllChecked(true);
        break;
      case PromptPaletteCanvasUI.ACTION.UNCHECK_ALL:
        this.#setAllChecked(false);
        break;
      case PromptPaletteCanvasUI.ACTION.SORT:
        this.#sortLines();
        break;
    }
  }

  // ========================================
  // Data Operations
  // ========================================
  #toggleLineComment(lineIndex) {
    const textLines = new TextLines(this.#textWidget.value);
    textLines.toggleCommentAt(lineIndex);
    this.#textWidget.value = textLines.toString();
    this.#app.graph.setDirtyCanvas(true);
  }

  #adjustLineWeight(lineIndex, delta) {
    const textLines = new TextLines(this.#textWidget.value);
    textLines.adjustWeightAt(lineIndex, delta);
    this.#textWidget.value = textLines.toString();
    this.#app.graph.setDirtyCanvas(true);
  }

  #setAllChecked(checked) {
    const textLines = new TextLines(this.#textWidget.value);
    textLines.setAllCommented(!checked);
    this.#textWidget.value = textLines.toString();
    this.#app.graph.setDirtyCanvas(true);
  }

  #sortLines() {
    const textLines = new TextLines(this.#textWidget.value);
    textLines.sortByPhrase();
    this.#textWidget.value = textLines.toString();
    this.#app.graph.setDirtyCanvas(true);
  }

  // ========================================
  // Drawing
  // ========================================
  #drawCheckboxList(ctx) {
    if (this.#node.flags && this.#node.flags.collapsed) {
      return;
    }

    // Keep the node at least at the minimum height, but never auto-grow to
    // fit the content: the list scrolls within the node's fixed height.
    if (this.#node.size[1] < CONFIG.minNodeHeight) {
      this.#node.size[1] = CONFIG.minNodeHeight;
      this.#app.graph.setDirtyCanvas(true);
    }

    const text = this.#textWidget.value || "";
    if (text.trim() !== "") {
      this.#drawCheckboxItems(ctx, text.split("\n"));
    } else {
      this.#maxScrollY = 0;
      this.#scrollbarThumb = null;
      this.#clickableAreas = [];
      this.#drawEmptyMessage(ctx);
    }
  }

  #drawEmptyMessage(ctx) {
    ctx.fillStyle = getColors().inactiveTextColor;
    ctx.font = `${CONFIG.fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("No Text", this.#node.size[0] / 2, this.#node.size[1] / 2);
  }

  #drawCheckboxItems(ctx, lines) {
    this.#clickableAreas = [];
    // Register action buttons first: rows partially scrolled out of the
    // viewport keep clickable areas that can overlap the action row, and
    // click detection picks the first matching area.
    this.#drawActionButtons(ctx);

    const viewportTop = CONFIG.topNodePadding;
    const viewportBottom = this.#getViewportBottom();
    const viewportHeight = Math.max(0, viewportBottom - viewportTop);
    const contentHeight = lines.length * CONFIG.lineHeight;

    this.#maxScrollY = Math.max(0, contentHeight - viewportHeight);
    this.#scrollY = clamp(this.#scrollY, 0, this.#maxScrollY);

    // Clip rows to the viewport so scrolled content doesn't overlap the
    // header or the Edit button.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, viewportTop, this.#node.size[0], viewportHeight);
    ctx.clip();

    lines.forEach((lineText, index) => {
      const line = new Line(lineText);
      if (!line.hasPhraseText()) return;

      const y = viewportTop + index * CONFIG.lineHeight - this.#scrollY;
      // Skip rows entirely outside the visible viewport.
      if (y + CONFIG.lineHeight <= viewportTop || y >= viewportBottom) return;

      this.#drawCheckbox(ctx, line, y, index);
      this.#drawDisplayText(ctx, line, y);
      this.#drawWeightControls(ctx, line, y, index);
    });

    ctx.restore();

    this.#drawScrollbar(ctx, viewportTop, viewportHeight, contentHeight);
  }

  #getActionRowY() {
    // Prefer the actual Edit button position so the row never overlaps it.
    const buttonY = this.#toggleButton?.last_y;
    const bottom =
      typeof buttonY === "number" && buttonY > CONFIG.topNodePadding
        ? buttonY - CONFIG.bottomPadding
        : this.#node.size[1] - CONFIG.fallbackBottomPadding;
    return bottom - CONFIG.actionButtonHeight;
  }

  #getViewportBottom() {
    return this.#getActionRowY() - CONFIG.bottomPadding;
  }

  #drawActionButtons(ctx) {
    const buttons = [
      { label: "All", action: PromptPaletteCanvasUI.ACTION.CHECK_ALL },
      { label: "None", action: PromptPaletteCanvasUI.ACTION.UNCHECK_ALL },
      { label: "Sort", action: PromptPaletteCanvasUI.ACTION.SORT },
    ];
    const y = this.#getActionRowY();
    const availableWidth = this.#node.size[0] - CONFIG.sideNodePadding * 2;
    const buttonWidth =
      (availableWidth - CONFIG.actionButtonGap * (buttons.length - 1)) /
      buttons.length;
    if (buttonWidth <= 0) return;

    buttons.forEach((button, index) => {
      const x =
        CONFIG.sideNodePadding +
        index * (buttonWidth + CONFIG.actionButtonGap);
      this.#drawActionButton(ctx, x, y, buttonWidth, button);
    });
  }

  #drawActionButton(ctx, x, y, width, button) {
    const height = CONFIG.actionButtonHeight;

    this.#clickableAreas.push({
      x: x,
      y: y,
      w: width,
      h: height,
      lineIndex: -1,
      action: button.action,
    });

    const colors = getColors();
    ctx.fillStyle = colors.weightButtonFillColor;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 4);
    ctx.fill();

    ctx.fillStyle = colors.weightButtonSymbolColor;
    ctx.font = `${CONFIG.actionButtonFontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(
      button.label,
      x + width / 2,
      y + height / 2 + CONFIG.actionButtonFontSize * 0.35,
    );
    ctx.textAlign = "left";
  }

  #drawScrollbar(ctx, viewportTop, viewportHeight, contentHeight) {
    this.#scrollbarThumb = null;
    if (this.#maxScrollY <= 0 || viewportHeight <= 0) return;

    const width = CONFIG.scrollbarWidth;
    const x = this.#node.size[0] - width - CONFIG.scrollbarMargin;
    const trackY = viewportTop;
    const trackH = viewportHeight;
    const radius = width / 2;

    const thumbH = Math.max(
      CONFIG.scrollbarMinThumb,
      (viewportHeight / contentHeight) * trackH,
    );
    const thumbY =
      trackY + (this.#scrollY / this.#maxScrollY) * (trackH - thumbH);

    const colors = getColors();
    ctx.fillStyle = colors.scrollbarTrackColor;
    ctx.beginPath();
    ctx.roundRect(x, trackY, width, trackH, radius);
    ctx.fill();

    ctx.fillStyle = colors.scrollbarThumbColor;
    ctx.beginPath();
    ctx.roundRect(x, thumbY, width, thumbH, radius);
    ctx.fill();

    this.#scrollbarThumb = { x, y: thumbY, w: width, h: thumbH, trackY, trackH };
  }

  #drawCheckbox(ctx, line, y, index) {
    const checkboxX = CONFIG.sideNodePadding;
    const checkboxY = y;
    const checkboxW = CONFIG.checkboxSize;
    const checkboxH = CONFIG.checkboxSize;

    this.#clickableAreas.push({
      x: checkboxX,
      y: checkboxY,
      w: checkboxW,
      h: checkboxH,
      lineIndex: index,
      action: PromptPaletteCanvasUI.ACTION.TOGGLE_COMMENT,
    });

    if (line.commentedOut) {
      ctx.strokeStyle = getColors().checkboxBorderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(checkboxX, checkboxY, checkboxW, checkboxH, 4);
      ctx.stroke();
    } else {
      ctx.fillStyle = getColors().checkboxFillColor;
      ctx.beginPath();
      ctx.roundRect(checkboxX, checkboxY, checkboxW, checkboxH, 4);
      ctx.fill();

      ctx.strokeStyle = getColors().checkboxSymbolColor;
      ctx.lineWidth = 2;
      const centerX = checkboxX + checkboxW / 2;
      const centerY = checkboxY + checkboxH / 2;
      const checkSize = checkboxW * 0.4;
      ctx.beginPath();
      ctx.moveTo(centerX - checkSize * 0.7, centerY + checkSize * 0.0);
      ctx.lineTo(centerX - checkSize * 0.3, centerY + checkSize * 0.5);
      ctx.lineTo(centerX + checkSize * 0.7, centerY - checkSize * 0.5);
      ctx.stroke();
    }
  }

  #drawDisplayText(ctx, line, y) {
    const colors = getColors();
    ctx.fillStyle = line.commentedOut
      ? colors.inactiveTextColor
      : colors.defaultTextColor;
    ctx.textAlign = "left";

    const isBold = line.weight !== 1.0;

    ctx.font = isBold
      ? `bold ${CONFIG.fontSize}px sans-serif`
      : `${CONFIG.fontSize}px sans-serif`;

    const checkboxCenter = y + CONFIG.checkboxSize / 2;
    const textBaseline = checkboxCenter + CONFIG.fontSize * 0.35;

    const textX =
      CONFIG.sideNodePadding + CONFIG.checkboxSize + CONFIG.checkboxMarginRight;

    // Calculate width of right-side elements
    const rightElementsWidth =
      CONFIG.weightLabelWidth +
      CONFIG.weightLabelMarginRight +
      CONFIG.weightButtonSize +
      CONFIG.weightButtonGap +
      CONFIG.weightButtonSize +
      CONFIG.sideNodePadding;
    const availableWidth = this.#node.size[0] - textX - rightElementsWidth;

    // Clip text to available width
    ctx.save();
    ctx.beginPath();
    ctx.rect(textX, y, availableWidth, CONFIG.lineHeight);
    ctx.clip();

    ctx.fillText(line.displayText, textX, textBaseline);

    ctx.restore();
  }

  #drawWeightControls(ctx, line, y, index) {
    const nodeWidth = this.#node.size[0];
    if (!line.hasPhraseText()) return;

    const weightText = line.weightText;
    const checkboxCenter = y + CONFIG.checkboxSize / 2;

    let currentX = nodeWidth - CONFIG.sideNodePadding;

    const plusButtonX = currentX - CONFIG.weightButtonSize;
    const plusButtonY = y;
    this.#drawWeightButton(
      ctx,
      plusButtonX,
      plusButtonY,
      "+",
      index,
      PromptPaletteCanvasUI.ACTION.WEIGHT_PLUS,
    );
    currentX = plusButtonX - CONFIG.weightButtonGap;

    const minusButtonX = currentX - CONFIG.weightButtonSize;
    const minusButtonY = y;
    this.#drawWeightButton(
      ctx,
      minusButtonX,
      minusButtonY,
      "-",
      index,
      PromptPaletteCanvasUI.ACTION.WEIGHT_MINUS,
    );
    currentX = minusButtonX - CONFIG.weightButtonGap;

    if (line.weight !== 1.0) {
      const textColors = getColors();
      ctx.fillStyle = line.commentedOut
        ? textColors.inactiveTextColor
        : textColors.defaultTextColor;
      ctx.textAlign = "right";
      ctx.font = `${CONFIG.fontSize}px sans-serif`;
      const textBaseline = checkboxCenter + CONFIG.fontSize * 0.35;
      ctx.fillText(
        weightText,
        currentX - CONFIG.weightLabelMarginRight,
        textBaseline,
      );
      ctx.textAlign = "left";
    }
  }

  #drawWeightButton(ctx, x, y, symbol, lineIndex, action) {
    const buttonSize = CONFIG.weightButtonSize;

    this.#clickableAreas.push({
      x: x,
      y: y,
      w: buttonSize,
      h: buttonSize,
      lineIndex: lineIndex,
      action: action,
    });

    ctx.fillStyle = getColors().weightButtonFillColor;
    ctx.beginPath();
    ctx.roundRect(x, y, buttonSize, buttonSize, 4);
    ctx.fill();

    ctx.strokeStyle = getColors().weightButtonSymbolColor;
    ctx.lineWidth = 2;
    const centerX = x + buttonSize / 2;
    const centerY = y + buttonSize / 2;
    const symbolSize = 6;

    ctx.beginPath();
    if (symbol === "+") {
      ctx.moveTo(centerX - symbolSize / 2, centerY);
      ctx.lineTo(centerX + symbolSize / 2, centerY);
      ctx.moveTo(centerX, centerY - symbolSize / 2);
      ctx.lineTo(centerX, centerY + symbolSize / 2);
    } else if (symbol === "-") {
      ctx.moveTo(centerX - symbolSize / 2, centerY);
      ctx.lineTo(centerX + symbolSize / 2, centerY);
    }
    ctx.stroke();
  }
}

// ========================================
// Color
// ========================================

function getColors() {
  // Cache theme-derived colors for performance.
  if (colorCache) {
    return colorCache;
  }
  const themeColors = getComfyUIThemeColors();
  colorCache = {
    defaultTextColor: themeColors.inputText,
    inactiveTextColor: themeColors.inputText + "66",
    checkboxBorderColor: themeColors.inputText + "80",
    checkboxFillColor: themeColors.inputText,
    checkboxSymbolColor: themeColors.comfyInputBg,
    weightButtonFillColor: themeColors.comfyInputBg,
    weightButtonSymbolColor: themeColors.inputText + "99",
    scrollbarTrackColor: themeColors.inputText + "22",
    scrollbarThumbColor: themeColors.inputText + "66",
  };
  return colorCache;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getComfyUIThemeColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    comfyInputBg:
      expandHexColor(style.getPropertyValue("--comfy-input-bg").trim()) ||
      "#222222",
    inputText:
      expandHexColor(style.getPropertyValue("--input-text").trim()) ||
      "#dddddd",
  };
}

function expandHexColor(color) {
  if (!color || !color.startsWith("#")) return color;
  if (color.length === 4) {
    return (
      "#" + color[1] + color[1] + color[2] + color[2] + color[3] + color[3]
    );
  }
  return color;
}
