# Retained-release fixtures

`bootstrap-3.1.0.cjs` preserves the original `internal/releases/bootstrap.js` bytes from commit `dd6ead2d2b8f686f9ec43f84c6dfddf597062bfb` (published Nightshift 3.1.0). Tests copy it into a package before regenerating that fixture's manifest. This exercises the actual historical bootstrap routing rather than labeling the current router as an older version.
