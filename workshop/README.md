# Stop Guard Cook-Along workshop

Sources for the Claude Code hooks workshop. They are not part of the Nightshift plugin.

The published pages are private claude.ai artifacts:

- Guide: https://claude.ai/artifact/AesM1jTPBLdSQ1sVyzxjua
- Slides: https://claude.ai/artifact/GCUmbthf9LVVnGGmXYvYYt
- Cross-references between the two: https://claude.ai/artifact/R9HD7eDjWEgy3tzPfu94J9

## Layout

- `kit/step-0` to `kit/step-4`: the tested files for each step. Everything else is generated from them.
- `build-catchup.js` writes `catchup.js` from the kit. `build-guide.js` writes `guide.html` from `guide.src.html`, filling in the kit files, the expected hook outputs and `catchup.js`. Run both from this folder after changing the kit or the guide source.
- `deck/project`: the slide deck's `deck.json` and one HTML file per slide.
- `qa/proto`: `hold-questions.js` and its settings block, shown in the guide's Questions section.
- `where.js`: lists which guide sections contain given strings, used to build the cross-references.

The rehearsal harness and records from 3 October 2026 are not included.
