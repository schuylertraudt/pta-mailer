import { randomBytes } from "node:crypto";

/**
 * React cannot emit HTML comments, which Outlook's conditional (MSO) markup
 * needs. Components insert an opaque placeholder; the final string is patched.
 * The nonce keeps user text from ever matching a placeholder.
 */
export class RawHtml {
  private nonce = randomBytes(8).toString("hex");
  private items: string[] = [];
  add(html: string): string {
    this.items.push(html);
    return `%%RAW_${this.nonce}_${this.items.length - 1}%%`;
  }
  apply(html: string): string {
    return html.replace(new RegExp(`%%RAW_${this.nonce}_(\\d+)%%`, "g"), (_, i) => this.items[Number(i)]);
  }
}
