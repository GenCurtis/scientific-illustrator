# profile: slides

Presentation slides projected to an audience, narrated live, consumed page by page.

## 质量检查清单

- **One message per slide**; one primary visual per slide.
- **Narrative line** — background → question → method → results → conclusion; hook first, takeaway last, backup slides after.
- **Back-of-room readability** — body text at effective projection size; high contrast; minimal words.
- **Master consistency** — fonts, palette, footer, page numbers, and logo placement stable across slides.
- **Progressive disclosure** — complex processes split across builds or slides rather than crammed.
- **Projection-adapted figures** — fewer details and larger labels than the paper version; never a paper figure pasted in.

## profile_settings（宽松默认）

`aspect`, `venue`, `min_font_pt`, `max_bullets`, `animation_policy`. Deck-level parameters (theme, narrative, slide inventory) belong to `deck.json` in the Advanced stage.

## Recreation policy interplay

`faithful` recreation of a reference deck keeps the reference design; `publication-ready` may improve readability (size, contrast) and master consistency.

## 常见失败模式

- Paper figures on slides (unreadable labels).
- Paragraph text; multiple messages per slide.
- Inconsistent masters; animations that do not render in the target backend (draw.io has none).
