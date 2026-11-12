# Guides

A guide is a page in its own tab: steps, an explanation, reference material or your status. It
asks nothing; a question goes on a card.

## The Markdown file

- The first line `# Title` sets the tab label; keep it short. Without it the label is the id.
- Each `## Heading` starts a section; text before the first heading is a section without a title.
- The section id comes from the heading: keep a heading stable, so only a changed section shows a
  new "updated" time.
- Section text uses the card text format (`references/cards.md`), or HTML for `--kind reference`.
- Labels: `Do: <topic>` for steps, `Learn: <topic>` for an explanation.

## Kinds

| `--kind` | Use | Archive button |
|---|---|---|
| `text` | Steps or an explanation (default) | Yes |
| `status` | What you do and what waits on the operator. Its tab comes first and shows a dot when it changed since the operator looked | No |
| `reference` | Tables and inline SVG, for example a site record. Change it with the script only | Yes |

## The status guide

Use the id `status` and these four sections. Update it after each batch you handle.

```markdown
# Status

## Blocked on you
- What waits on the operator, with the card title.

## Done
- What you finished since the last update.

## Agent does next
- What you do next, without the operator.

## Held
- What waits on something else, and on what.
```

## Reference HTML

The page keeps only this allowlist and drops the rest:

- Elements: text structure (`p`, `div`, `span`, `h1` to `h6`, lists, `pre`, `code`, `details`),
  inline marks, tables, and SVG shapes (`svg`, `g`, `path`, `rect`, `circle`, `line`, `polyline`,
  `polygon`, `text`, `defs`, `marker`, gradients, `use`). Any other element goes with its content.
- Attributes: layout and presentation attributes, `class`, `title`, `id`, `style`. A value with a
  backslash or `/*` goes, and so does any function except `url()`, `rgb()`, `rgba()`, `hsl()`,
  `hsla()`, and the SVG transform functions in `transform`.
- `url()` stays for a `#id` in the guide or an `https:` host on the config list `domains`. claude.ai
  blocks images from every outside host, so draw with inline SVG and `url(#id)`.
- `style` keeps only `color`, `background-color`, `border` and its parts, `margin`, `padding`,
  `width`, `height`, `max-width`, `min-width`, `font-size`, `font-weight`, `font-style`,
  `text-align`, `text-decoration`, `vertical-align`, `white-space`, `line-height`, `fill`,
  `stroke`, `stroke-width` and `display`, with plain values: no quotes, and no function except
  `rgb()`, `rgba()`, `hsl()`, `hsla()`.
- Links: `href` on `a` only, for `https:`, `http:`, `#` and relative targets, never `//host`.
  Elsewhere, such as on `use`, only a `#` target or a host on `domains`. Ids get the prefix `ref-`.
- A wide table scrolls in its own box. Use colours that read on light and dark, or `currentColor`.
