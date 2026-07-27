# Asset organization

This directory is organized by **asset role**, not by creation date or approval
status. Import production assets through `src/assets/index.ts`.

## Directory map

```text
assets/
├── index.ts                    # Public import registry for UI code
├── brand/                      # Current logos and brand marks
├── backgrounds/                # Full-canvas backgrounds without UI text
├── characters/
│   └── kokoro/                 # Kokoro character renders and avatars
├── media-demo/                 # Mock posts, chat attachments and stickers
└── _archive/                   # Deprecated concepts; never import in new UI
```

## Current production assets

| Export | File | Intended usage |
|---|---|---|
| `kokoroLogo` | `brand/kokoro-logo-primary.png` | Main Kokoro logo on welcome, auth and sidebar |
| `heroBackground` | `backgrounds/kokoro-hero-gradient.png` | Full-screen welcome/auth background |
| `heroCharacter` | `characters/kokoro/kokoro-hero-transparent.png` | Transparent hero character layer |
| `profilePortrait` | `characters/kokoro/kokoro-profile-portrait.png` | Profile, chat, call and studio portrait |
| `welcomeNeon` | `characters/kokoro/kokoro-welcome-neon.png` | Neon welcome render and demo media |
| `avatarDark` | `characters/kokoro/kokoro-avatar-dark.jpg` | Compact mock avatar |
| `avatarWide` | `characters/kokoro/kokoro-avatar-wide.jpg` | Wide mock avatar/self-view |
| `neonScene` | `media-demo/kokoro-neon-scene.jpg` | Demo banner, post and chat attachment |

`media-demo/kokoro-chat-sticker.png` is retained as optional demo content but is
not exported because no current screen uses it.

## Naming convention

- Use lowercase kebab-case: `subject-role-variant.ext`.
- Describe usage, not workflow state. Prefer `kokoro-profile-portrait.png`; avoid
  names such as `new`, `final`, `approved`, `v2` or `reference`.
- Use `-transparent` when alpha transparency is required.
- Keep one current primary logo in `brand/`; move discarded concepts to
  `_archive/brand/`.
- Put user-generated demo content in `media-demo/`, not in `characters/`.

## Rules for future contributors and AI agents

1. Import assets from `src/assets/index.ts`.
2. Do not import anything from `_archive` into production code.
3. Do not overwrite the primary logo or character render silently. Add the new
   file, update `index.ts`, verify the UI, then archive the replaced file.
4. Preserve transparent PNGs when positioning character layers over a separate
   background.
5. Run `npm.cmd run build` after moving, renaming or replacing an asset.
