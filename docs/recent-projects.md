# Recent project logos

The profile updater discovers logos on each repository's default branch. Commit
and push your logo to any of these locations; no project registration is needed.

The search order is:

1. `logo.svg`
2. `<repository-name>.svg`
3. `assets/logo.svg`
4. `assets/<repository-name>.svg`
5. `logo.png`
6. `<repository-name>.png`
7. `assets/logo.png`
8. `assets/<repository-name>.png`

All SVGs are preferred over PNGs, even when the PNG is in the root and the SVG
is in `assets/`. Within a format, root files take priority over assets files,
and `logo` takes priority over the repository name.

There are no project-specific overrides or custom fallback paths. Card titles
use the repository name directly.

File and assets-directory matching ignores capitalization: `Pixen.svg`,
`pixen.svg`, and `PIXEN.SVG` all match the `pixen` repository. The updater keeps
the actual path's capitalization when downloading the logo.

Use a square logo with a transparent background. The card fits the image into a
square without stretching it. If no logo is found, the card displays the
project's initial. Missing files are skipped; API and network errors stop the
refresh so a temporary failure does not replace existing logos with initials.

The workflow refreshes every 30 minutes and can also be run manually from
GitHub Actions. It selects the five most recently pushed public, nonempty,
non-forked, non-archived repositories owned by `poziel`, excluding this profile
repository.
