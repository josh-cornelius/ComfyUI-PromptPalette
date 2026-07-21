import { Line } from "./line.js";

export class TextLines {
  #lines;

  constructor(text) {
    this.#lines = text.split("\n");
  }

  toggleCommentAt(index) {
    const line = this.#getLineAt(index);
    if (!line) return;
    line.toggleCommentedOut();
    this.#lines[index] = line.buildText();
  }

  adjustWeightAt(index, delta) {
    const line = this.#getLineAt(index);
    if (!line) return;
    line.adjustWeight(delta);
    this.#lines[index] = line.buildText();
  }

  // Comment out (or uncomment) every line that has phrase text.
  // Lines already in the target state keep their original formatting.
  setAllCommented(commentedOut) {
    this.#lines = this.#lines.map((rawText) => {
      const line = new Line(rawText);
      if (!line.hasPhraseText()) return rawText;
      if (line.commentedOut === commentedOut) return rawText;
      line.toggleCommentedOut();
      return line.buildText();
    });
  }

  // Sort lines alphabetically by phrase text, with unchecked (commented out)
  // lines after checked ones. Lines without phrase text move to the end,
  // keeping their original relative order.
  sortByPhrase() {
    const sortGroup = (line) => {
      if (!line.hasPhraseText()) return 2;
      return line.commentedOut ? 1 : 0;
    };
    this.#lines = this.#lines
      .map((rawText) => ({ rawText, line: new Line(rawText) }))
      .sort((a, b) => {
        const groupDiff = sortGroup(a.line) - sortGroup(b.line);
        if (groupDiff !== 0) return groupDiff;
        return a.line.phraseText.localeCompare(b.line.phraseText, undefined, {
          sensitivity: "base",
        });
      })
      .map((entry) => entry.rawText);
  }

  #getLineAt(index) {
    if (index < 0 || index >= this.#lines.length) return null;
    return new Line(this.#lines[index]);
  }

  toString() {
    return this.#lines.join("\n");
  }
}
