# PYRAXIS

**Team PYRAXIS · NASA Space Apps 2026 · challenge "Flame in Freefall".** A dashboard and a set of small, honest AI models built on NASA's **Physical Sciences Informatics (PSI)** combustion data: 24 investigations of fire aboard the International Space Station and other spacecraft.

The question behind it: *astronauts are heading to the Moon and Mars with different air (more oxygen, lower pressure) than anything we tested on the ISS. What do 20 years of space-fire experiments tell us about keeping those crews safe, and where are the gaps?*

---

## 1. The idea in one picture

Spacecraft fire safety works in **three layers**. Each layer is built from different PSI investigations:

| Layer | The question | PSI investigations used | What we built |
|---|---|---|---|
| **1 · Prevention** | Which materials keep burning, and under what conditions? | BASS, BASS-II, Saffire, ACME BRE | Material burn outcomes + a classifier |
| **2 · Detection** | Will we notice a fire early? What smoke does each material make? | SAME, SAME-R, SPICE, DAFT | Smoke/detector dataset + 2 regression models |
| **3 · Suppression** | Does this atmosphere or agent put the flame out, and does it *stay* out? | FLEX, CFI (droplets), BASS (nitrogen) | 4 models with uncertainty |

On top of that sits **"Ask the data"**: a question box that answers from the PSI documents and NASA's official challenge resources, and shows its sources.

---

## 2. Our approach

1. **We started from the real NASA data, not a toy copy.** We used the PSI repository's own API to list every file in all 24 combustion investigations (60,000+ files, 13.5 TB). We downloaded only the parts that hold numbers and documents (~16 GB of tables, reports and instrument logs, about 0.1 % of the archive) and left out ~12 TB of raw video and images.
2. **One clean table, every value traceable.** Each investigation stores its results differently, so we wrote one small converter per investigation. All of them write to a single schema with SI units, oxygen as a fraction, and oxygen partial pressure. Every row keeps its **source file and row number**. When a value had to be assumed (e.g. ISS cabin pressure where a table omits it), it is flagged, never silently filled. While doing this we found and corrected several data-entry errors in the PSI tables (a 0 mmHg pressure, Excel turning "34" into "3400%").
3. **We went past the summary tables when they weren't enough.** For Detection we read the 1-second instrument logs of 120 smoke tests. For Prevention we read all 122 of the ISS crew's written test notes and labelled every test by hand (the labels are published in `pipeline/labels/`). For Suppression we added the CFI investigators' own data summary. That last step alone lifted our burning-rate model from R² 0.39 to 0.60.
4. **Small-data models that know when they don't know.** With hundreds (not millions) of experiments we use Gaussian processes. They give a prediction *and* an uncertainty, and the uncertainty is the point: it shows where NASA lacks data for Moon and Mars habitats.
5. **Strict, honest validation.** Models are scored only on test campaigns they never saw (grouped cross-validation; a random split would leak shared hardware and fuel batches and inflate the scores). Every score is shown next to simple baselines. Where a model is weak (Prevention), the dashboard says so.
6. **Answers with sources.** *Ask the data* searches 4,500+ passages from PSI reports, papers and NASA's official challenge resources (BM25 keyword retrieval). An AI model then answers **only from the retrieved passages**, with numbered citations. Without an AI key it falls back to plain search, so it never invents an answer.

**Use of AI:** AI models (Claude, with Groq / Hugging Face as fallbacks) power the *Ask the data* answers, always grounded in cited NASA sources. AI coding assistants helped write code and documentation. All scientific numbers come from NASA PSI data, and all models are standard, inspectable scikit-learn models.

---

## 3. The models, in plain words

All models are **small on purpose**. There are a few hundred space experiments, not millions, so we use **Gaussian processes (GPs)**. A GP gives a prediction *and* says how unsure it is. Deep neural networks need far more data and can't say "I don't know".

Every model is tested the same strict way: it is trained on some test campaigns and scored on **campaigns it never saw** (grouped cross-validation). It is always compared with simpler alternatives (predict-the-average, a straight-line model, gradient boosting). If it doesn't beat them, we say so.

How to read the scores:
- **R²**: 1.0 = perfect, 0 = no better than guessing the average, negative = worse than the average.
- **AUC**: 1.0 = always ranks risky cases above safe ones, 0.5 = coin flip.

**Seven models in total.** `pipeline/train_models.py` trains and tests each one, then does two things with it:
1. **Writes its predictions** into `dashboard/public/data/model.json` and `layers.json`. These files are what the dashboard shows, so the website needs no Python and loads instantly.
2. **Saves the fitted model** as `data/processed/models/<name>.joblib`. That's a ready-to-use copy for anyone who wants new predictions in Python (`joblib.load(...)`) without retraining, e.g. in the notebook.

### Suppression (droplet flames: FLEX + CFI, 501 tests)
A single fuel droplet burning in microgravity is the cleanest flame there is: a perfect sphere with no buoyancy. Inputs to these models: **oxygen fraction, pressure, helium, CO₂, droplet size, and the fuel** (described by carbon atoms, alcohol or not, and how branched it is, so one model learns across methanol, heptane, dodecane and farnesane).

| Model | What it predicts | Why it matters | Data | Score on unseen campaigns | Where you see it |
|---|---|---|---|---|---|
| `burning_rate` | How fast the droplet burns (burning-rate constant *K*, mm²/s) | Faster burning = more heat, harder to fight | 405 tests | R² **0.60** (boosting 0.59, linear 0.59, average −0.05); 92 % of tests inside its 95 % range | Predictions: habitat chart + O₂ × pressure heat map; habitat outlook table |
| `extinction_d` | The droplet size at which the flame goes out by itself (mm) | Bigger = the atmosphere snuffs flames earlier | 340 tests | R² **0.91** (boosting 0.85, linear 0.90) | Habitat outlook table (Predictions page and Layers → Suppression) |
| `outcome` | Does the flame go out cleanly, or does the droplet break apart? | Break-up scatters burning fuel | 234 FLEX tests | AUC **0.83** (logistic 0.81) | Habitat outlook: "Goes out cleanly" |
| `cool_flame` | After the visible flame dies, does an invisible "cool flame" keep burning? | A fire that looks out may not be: re-ignition risk | 145 CFI tests | AUC **0.77** (logistic 0.73) | Habitat outlook: "Cool flame lingers" |

**What they say about the Moon:** in Moon-habitat air (34 % O₂, 70 kPa) droplets burn ~26 % faster than on the ISS, and only ~9 % are predicted to go out cleanly, versus ~82 % on the ISS. That matches the 17 real tests near that air, where 15 droplets broke apart. Wide uncertainty bands mark where new experiments would teach us most.

### Prevention (solid materials: BASS, 102 labelled tests)
| Model | What it predicts | Data | Score | Where you see it |
|---|---|---|---|---|
| `prevention_sustained_burn` | Once lit, does a solid material (acrylic, cotton/fiberglass fabric, Nomex, wax…) **keep burning**? Inputs: oxygen, air flow, material type, shape, size | Every one of the 122 crew notes read and labelled by hand ("ignited, spread", "died when igniter turned off", "no joy") | AUC **0.92** (logistic 0.89); its probabilities beat the base rate | Layers → Prevention table: "Model: P(burns) in ISS air" per material (e.g. Nomex 18 %, acrylic 98 %) |

**Honest limit:** only 14 of 102 tests failed to keep burning, all in ISS-like air, and the model learns mostly from **material type** (Nomex rarely sustained a flame). Hand-checking the labels is what made it reliable: with automatic keyword labels it scored only AUC 0.74. No solid was ever tested at Moon/Mars conditions in the public archive. **This is the clearest data gap we found.**

**Suppression finding from the same notes:** The ISS crew aimed a nitrogen jet at 18 burning samples and it put out only 2 (part of the flame in 6 more); cutting the air flow put out 44. In microgravity, shutting off ventilation beats a gas jet, which can even stir fresh air into the flame.

### Detection (smoke: SAME, SAME-R, SPICE)
| Model / dataset | What it does | Data | Score | Where you see it |
|---|---|---|---|---|
| Smoke dataset | For every smoke test: which of 5 detectors responded (ISS photoelectric ×2, two ionisation, Shuttle), smoke mass, particle count, particle-size index | 120 smoke tests, 6 cabin materials, read from 1-second instrument logs | n/a | Layers → Detection: detector heat map + material table |
| `detection_smoke_mass` | How much smoke a heated material makes, from material + heater level + air flow + aging time | 69 tests | R² **0.57** (linear 0.58, boosting 0.47) | Material table: "Model: smoke at low / typical / high heat" |
| `detection_smoke_point` | How sooty a gas fuel is: the flame length at which it starts to smoke, for a given fuel and air speed | 70 SPICE flight flames | R² **0.56** (linear 0.57, boosting 0.17) | "What-if" chart: pick a fuel, see the predicted smoke point vs air speed with its 95 % range and the real flights |

**Key finding:** Teflon and Kapton (common spacecraft insulation) make the **smallest smoke particles (~0.7 µm)**. The ISS photoelectric *obscuration* signal responded to only ~38 % of those tests, versus over 90 % for other materials. This matches the SAME experiment's own conclusion: some cabin materials make smoke that today's detectors struggle to see.

### Data coverage (all 24 investigations, 1,709 test rows)
Not a model: a map of **where tests exist** in oxygen × pressure space. **Over 550 tests sit near ISS air, only 17 near the planned Moon-habitat air, and 0 near spacesuit conditions.**

**Solid materials have only ever been tested in ordinary cabin air in NASA's public archive.** All 262 solid-material tests sit at 13.6–22.7 % O₂ and ~1 atm. 298 tests did reach Moon-like oxygen (≥30 %), but all with gas flames or fuel droplets, and only 17 (all droplets) match Moon-base oxygen *and* pressure. NASA has flown solid-material tests in exploration atmospheres (Saffire-V), but that data is not in PSI yet.

---

## 4. The dashboard: where each layer lives

| Page | Purpose (why it exists) | Layer | What you see |
|---|---|---|---|
| **Mission Control** (`/`) | Start here: "how much do we actually know about fire in *this* habitat's air?" | Overview | Pick a habitat; test count near its atmosphere, data-gap warnings, and the PSI investigations ranked by relevance (hover for the reasons) |
| **Flammability Map** (`/map`) | Show at a glance where NASA has tested and where it hasn't | Prevention + Suppression | Every test plotted by oxygen × pressure, with the ISS, Moon, Mars and spacesuit zones; click a point for its source file and row |
| **Investigations** (`/investigations`) | Make the 24 PSI investigations easy to browse | All | Search and filter; each detail page has objectives, hypothesis, hardware, publications and the parsed tests |
| **Compare** (`/compare`) | Compare experiments side by side | All | Up to 4 investigations; rows that are identical are greyed so the differences stand out |
| **Fire-safety layers** (`/layers`) | Answer the challenge's three questions: prevent, detect, suppress | All three | One section per layer: the question, the data, charts, model scores next to baselines, and the limits |
| **Ask the data** (`/ask`) | Let anyone question 20 years of reports in plain English | All, mainly Detection | Answers written only from PSI documents and NASA resources, with numbered sources you can open |
| **Predictions** (`/model`) | Predict flames in atmospheres nobody has tested yet, and say how sure we are | Suppression | Burning rate per habitat with a 95 % range; prediction and uncertainty heat maps (bright = test here next); habitat outlook table with all four suppression models; model scores vs baselines |
| **Method & Earth** (`/about`) | Explain how it works and why it matters on Earth | Context | Method, stated limits, Earth uses (smoke detectors, firefighting gear, aircraft cabins), and **Download the data**: every dataset as CSV |

### How to use it: a 5-minute walkthrough

1. **Start at Mission Control** (`/`). Pick a habitat (ISS, Moon base, Mars, spacesuit). You see how many PSI tests come close to that air, the data-gap warnings, and the investigations ranked by relevance. Hover a ranking to see why it scored that way.
2. **Open Fire-safety layers** (`/layers`, sidebar → *Analyse*). The page reads top to bottom as three sections. The links under the title jump to each one.
   - **1 · Prevention.** The scatter plot shows every labelled BASS test by air flow and oxygen: blue dots kept burning, orange diamonds didn't. Hover a point to read the crew's own note. The table shows, per material, how many tests burned, **the model's predicted chance it keeps burning in ISS air**, the lowest oxygen that still burned, and how flames went out (air flow cut or nitrogen).
   - **2 · Detection.** The heat map shows, for each heated material, the share of tests each of the 5 detectors responded to. Look at the Teflon and Kapton rows under *ISS photoelectric (obscuration)*. The **what-if chart** lets you pick a gas fuel and see when it starts to smoke at each air speed (SPICE model, with its 95 % range and the real flights). The table gives smoke mass, particle count and particle size per material, plus **the model's predicted smoke at low, typical and high heating**.
   - **3 · Suppression.** Four score tiles for the droplet models, a table of how flames ended under each diluent gas (N₂, CO₂, He), two findings (cool flames that keep burning after the visible flame dies; nitrogen jets that rarely put flames out, while cutting the ventilation did), and the **habitat outlook table**: for each habitat's air, how fast a droplet burns, when its flame dies, the chance it goes out cleanly, and the chance a cool flame lingers.
   - **Every section** starts with its question and data source, shows each model's score **next to the simple baselines**, and ends with a **Limit** line. Read those first if a judge asks "how good is it?".
3. **Go to Predictions** (`/model`) for the Suppression models at each habitat (habitat chart, heat map, habitat outlook table and model scores). Each point has a 95 % range, and hollow points are extrapolations outside the tested range. The heat map toggles between the prediction and its uncertainty: bright areas = where to run the next experiment.
4. **Use the Flammability Map** (`/map`) to see every test in oxygen × pressure space against the habitat zones. Click a point to see its source file and row.
5. **Ask the data** (`/ask`). Type a question (e.g. *"How was smoke measured in SAME?"*, *"Which materials kept burning in BASS?"*). The answer cites numbered sources you can open.
6. **Investigations / Compare** let you browse the 24 PSI investigations, or put up to 4 side by side.
7. **Download the data** (Method & Earth page, or the buttons on the Map, investigation pages and layer sections): every dataset as CSV (all 1,709 test rows, the 120 smoke tests, the 70 SPICE smoke points, the hand-checked BASS labels), each row traceable to its NASA source.

---

## 5. How the project fits together

```
NASA PSI repository (psi.nasa.gov)
        │  scripts/psi_inventory.py   list every file of the 24 investigations  → data/inventory/
        │  scripts/psi_download.py    download tables + documents (tier 1/2)     → D:/psi_raw  (data/raw links there)
        ▼
pipeline/build_metadata.py      investigation descriptions          → investigations.json
pipeline/build_tests.py         every experimental table → one test table (1,709 rows)   → tests.json
pipeline/build_detection.py     SAME / SAME-R instrument logs → 120 smoke tests          → detection.json
pipeline/build_smoke_points.py  SPICE smoke points → 70 flight flames                    → smoke_points.json
pipeline/train_models.py        trains ALL models (3 layers), writes metrics + predictions → model.json, layers.json
pipeline/build_search_index.py  PSI PDFs + official NASA resources → passages for "Ask the data"
        ▼
dashboard/  (Next.js) reads dashboard/public/data/*.json and dashboard/data/search_chunks.json
```

Every value traces back to a **source file and row** (`source_file`, `source_row` columns). Anything assumed rather than read (e.g. ISS cabin pressure where a table omits it) is flagged, never silently invented.

---

## 6. Run it

**Python (pipeline + notebook):**
```bash
conda env create -f environment.yml        # once: creates env "spaceapp"
conda activate spaceapp
python pipeline/build_tests.py
python pipeline/build_detection.py         # ~10 min, reads the D: drive
python pipeline/build_smoke_points.py
python pipeline/train_models.py            # ~4 min
python pipeline/build_search_index.py      # ~4 min
```
Or open **`notebooks/02_train_models.ipynb`** (kernel *Python (spaceapp)*) and *Run All*: the same training, section by section, with tables and charts.

**Dashboard:**
```bash
cd dashboard
npm install
npm run dev            # http://localhost:3000  (if another app already uses 3000: npx next dev -p 3100)
```
"Ask the data" uses an AI model if a key is set in `dashboard/.env.local` (see `.env.example`). It tries Claude, then Groq, then Hugging Face. With no key it still works as a plain search over the sources.

---

## 7. Folder guide

| Path | What's in it |
|---|---|
| `pipeline/` | The data pipeline and model training (above) |
| `scripts/` | PSI inventory, download and comparison tools |
| `notebooks/01_data_tour.ipynb` | A guided look at the data |
| `notebooks/02_train_models.ipynb` | All model training, step by step |
| `data/inventory/` | List of every PSI file (60,826 files, 13.5 TB) with sizes |
| `data/raw` | Link to the downloaded PSI files on `D:/psi_raw` (not in the project folder) |
| `data/processed/` | Clean tables (`tests`, `detection`, `smoke_points`), metrics reports, fitted models |
| `data/official/` | The challenge's official NASA resources (Researcher's Guide, fact sheets, Apollo/Mir pages, spinoffs) |
| `dashboard/` | The web app |
| `environment.yml` | Python environment |

---

## 8. Limits we state openly

- **Small data:** 69–405 rows per model. Scores come from unseen campaigns, so they are realistic, but the uncertainty is real too.
- **Prevention** has few "did not burn" examples (14), learns mostly from material type, and has no Moon/Mars-condition tests.
- **Detection** "responded" means the signal rose clearly above its own noise. The flight detectors' real alarm thresholds are not in the data. The particle size is an index (mass ÷ count), not a direct measurement.
- **Predictions at Moon/Mars air** rest on 17 nearby FLEX tests; spacesuit conditions are pure extrapolation and shown as such.
- Not used: about 12 TB of video and images, and SLICE (42 GB). They need image processing beyond a hackathon.

*Data: NASA Physical Sciences Informatics, psi.nasa.gov. This project is not endorsed by NASA.*
