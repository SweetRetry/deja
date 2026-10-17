# Search eval

Measures text→image search on hand-labelled folders, so every change to the
model setup, query wording or vector width gets a number instead of a guess.

```bash
cd sidecar
HF_HUB_OFFLINE=1 .venv/bin/python eval/eval_search.py \
  --labels eval/labels.json,eval/labels-pinterest-eval-150.json
```

Defaults match what the app ships (512px thumbnail, 280 vision tokens, 512
dims, query wrapped as `<q>的照片`). Override `--images`, `--dims` or
`--template` to compare alternatives; image embeddings are cached in
`eval/.cache` per folder and variant.

## Label sets

- `labels.json` labels `assets/pinterest-home-50`. Hand-labelled, 8 queries.
- `labels-pinterest-eval-150.json` labels `assets/pinterest-eval-150`
  (148 Pinterest images over 12 topics, sources in
  `pinterest-eval-150.sources.json`). Graded per image by Haiku into
  `grades/`, spot-checked against a contact sheet, then built with
  `build_labels.py`. "m" grades are left out of scoring.

To add a folder, grade it into `grades/`-style JSON and run
`python3 eval/build_labels.py <folder> <grades...> > eval/labels-<folder>.json`.

## Results that set today's config

| Config | home-50 mAP | eval-150 mAP |
| --- | --- | --- |
| query vs filename text (old search) | 0.313 | n/a |
| raw query, 256 dims | 0.956 | 0.892 |
| raw query, 512 dims | 0.950 | 0.903 |
| `<q>的照片`, 512 dims (shipped) | 0.952 | 0.937 |
| `task: search result \| query: ` prefix | worse on both | worse on both |
| `a photo of <q>` | 0.924 | 0.805 |
| full image instead of 512px thumbnail | flat | +0.017 |
