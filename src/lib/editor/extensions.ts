import { Mark, Node, mergeAttributes, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { COLOR_TOKENS, CONTENT_WIDTH } from "./model";
import { safeLinkUrl } from "./urls";

/**
 * Palette-token text color. Parses only its own data attribute, so colors
 * pasted from Word/Docs (inline style="color:...") are discarded.
 */
export const BrandColor = Mark.create({
  name: "brandColor",
  addAttributes() {
    return {
      color: {
        default: "primary",
        parseHTML: (el) => el.getAttribute("data-color"),
        renderHTML: (a) => ({ "data-color": a.color, style: `color: var(--pal-${a.color})` }),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-color]",
        getAttrs: (el) => (COLOR_TOKENS.includes((el as HTMLElement).getAttribute("data-color") as never) ? null : false),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },
});

const dataAttr = (name: string, dflt: unknown, parse: (v: string | null) => unknown = (v) => v) => ({
  default: dflt,
  parseHTML: (el: HTMLElement) => parse(el.getAttribute(`data-${name}`)),
  renderHTML: (a: Record<string, unknown>) => (a[name] == null ? {} : { [`data-${name}`]: String(a[name]) }),
});

export const EmailImage = Node.create({
  name: "emailImage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: dataAttr("src", null),
      alt: dataAttr("alt", ""),
      href: dataAttr("href", null),
      align: dataAttr("align", "center"),
      width: dataAttr("width", CONTENT_WIDTH, (v) => (v ? Number(v) : CONTENT_WIDTH)),
      assetId: dataAttr("asset-id", null),
    };
  },
  // Only our own markup: pasted <img> tags (often data: URIs or hotlinks) are dropped.
  parseHTML() {
    return [{ tag: "figure[data-type=email-image]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes(HTMLAttributes, { "data-type": "email-image", class: `ed-image align-${node.attrs.align}` }),
      ["img", { src: node.attrs.src, alt: node.attrs.alt, style: `width:${node.attrs.width}px;max-width:100%` }],
    ];
  },
});

export const EmailButton = Node.create({
  name: "emailButton",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      label: dataAttr("label", "Button"),
      href: dataAttr("href", "https://"),
      color: dataAttr("color", "primary"),
      align: dataAttr("align", "center"),
    };
  },
  parseHTML() {
    return [{ tag: "div[data-type=email-button]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "email-button", class: `ed-button align-${node.attrs.align}` }),
      ["span", { class: `ed-button-inner color-${node.attrs.color}` }, node.attrs.label],
    ];
  },
});

export const Spacer = Node.create({
  name: "spacer",
  group: "block",
  atom: true,
  addAttributes() {
    return { height: dataAttr("height", 24, (v) => (v ? Number(v) : 24)) };
  },
  parseHTML() {
    return [{ tag: "div[data-type=spacer]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "spacer", class: "ed-spacer", style: `height:${node.attrs.height}px` })];
  },
});

export const TwoColumn = Node.create({
  name: "twoColumn",
  group: "block",
  content: "(paragraph | heading | bulletList | orderedList)+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      imageSrc: dataAttr("image-src", null),
      imageAlt: dataAttr("image-alt", ""),
      imageHref: dataAttr("image-href", null),
      imagePosition: dataAttr("image-position", "left"),
      assetId: dataAttr("asset-id", null),
    };
  },
  parseHTML() {
    return [{ tag: "div[data-type=two-column]", contentElement: ".ed-two-col-text" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "two-column", class: `ed-two-col pos-${node.attrs.imagePosition}` }),
      ["div", { class: "ed-two-col-img", contenteditable: "false" }, ["img", { src: node.attrs.imageSrc ?? "", alt: node.attrs.imageAlt }]],
      ["div", { class: "ed-two-col-text" }, 0],
    ];
  },
});

/** The complete, email-safe extension set. Used by the editor and by server-side HTML import. */
export function emailExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      blockquote: false,
      code: false,
      codeBlock: false,
      strike: false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        protocols: ["mailto", "tel"],
        isAllowedUri: (url) => safeLinkUrl(url) !== null,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      },
    }),
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }),
    BrandColor,
    EmailImage,
    EmailButton,
    Spacer,
    TwoColumn,
  ];
}
