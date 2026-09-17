# Web performance budget

The researcher dashboard has a deliberately small initial bundle budget so
analysis features cannot grow without a visible CI signal. The budget is based
on gzip transfer size, which approximates the bytes delivered by Vercel with
compression enabled.

| Asset group | Gzip budget |
| --- | ---: |
| JavaScript | 155 KiB |
| CSS | 12 KiB |
| Combined | 170 KiB |

The current bundle leaves a modest margin for maintenance while making a large
dependency or an accidentally eager-loaded analysis feature fail CI. A change
that needs more capacity must update this document and the checker together,
with the reason and measured user impact described in its pull request.

Run the same gate locally:

```bash
npm run build:web
npm run check:bundle-budget
```

This is a transfer-size guard, not a substitute for runtime profiling. Large
session rendering, interaction latency, and memory use remain separate concerns.
