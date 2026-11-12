# Guides

Read this before you write a guide for `node S guide`.

A guide is a page in its own tab: steps, an explanation, reference material or your status. It
asks nothing. Put a question on a card.

## The Markdown file

- The first line `# Title` sets the tab label. Keep it short. Without it the label is the id.
- Each `## Heading` starts a section. Text before the first heading is a section without a title.
- The section id comes from the heading. Keep a heading the same when you change its text, so
  that only that section shows a new "updated" time.
- Section text uses the card text format (`references/cards.md`), or HTML for `--kind reference`.
- Label conventions: `Do: <topic>` for steps, `Learn: <topic>` for an explanation.

## Kinds

| `--kind` | Use | Archive button |
|---|---|---|
| `text` | Steps or an explanation (default) | Yes |
| `status` | What you do and what waits on the operator. Its tab comes first and shows a dot when it changed since the operator looked | No |
| `reference` | Tables and inline SVG, for example a site record. Change it with the script, never by a republish | Yes |

## The status guide

Use the id `status` and these four sections. Update it after each batch you handled.

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

When you archive or delete a guide whose work is done, say so under "Done".

## Reference HTML

The page keeps only an allowlist and drops the rest:

- Elements: text structure (`p`, `div`, `span`, `h1` to `h6`, lists, `pre`, `code`, `details`),
  inline marks, tables, and SVG shapes (`svg`, `g`, `path`, `rect`, `circle`, `line`, `polyline`,
  `polygon`, `text`, `defs`, `marker`, gradients, `use`). Everything else goes with its content.
- Attributes: layout and presentation attributes, `class`, `title`, `id`, `style`. Any value with a
  backslash or `/*` goes. A `url()` stays for a `#id` in the guide, or for an `https:` host on the
  config list `domains`. Every other `url()` goes with its attribute.
- `style` keeps only `color`, `background-color`, `border` and its parts, `margin`, `padding`,
  `width`, `height`, `max-width`, `min-width`, `font-size`, `font-weight`, `font-style`,
  `text-align`, `text-decoration`, `vertical-align`, `white-space`, `line-height`, `fill`,
  `stroke`, `stroke-width` and `display`, with plain values: no quotes and no function except
  `rgb()`, `rgba()`, `hsl()`, `hsla()`.
- Links: `href` on `a` only, for `https:`, `http:`, `#` and relative targets, never `//host`.
  Elsewhere, such as on `use`, only a `#` target or a host on `domains`. Ids get the prefix `ref-`.
- Nothing loads from the network, except from a host on `domains`. The claude.ai page can still
  block such a load. A wide table scrolls in its own box. Use colours that read on a
  light and a dark background, or `currentColor`.
