---
'tripsheet': patch
---

Move PDF export to puppeteer-core 25 and finish the zod 4 migration.

puppeteer-core 24 pulled in `extract-zip` (symlink path traversal, no fixed release),
`basic-ftp` 5 and a second copy of zod 3 through its browser downloader and BiDi layer.
25 drops all three. Its `setContent` no longer takes the network-idle waits; the PDF
template is self-contained, so `load` is the same wait.

The zod 4 bump left five deprecated calls (`z.string().email()`, `.url()`,
`ZodTypeAny`) that the linter rejects, which had `main` failing CI. They now use the
zod 4 forms.
