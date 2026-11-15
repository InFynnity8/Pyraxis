"""Record a captioned walkthrough video of the dashboard (for the team, not the submission video).

Usage:
    1. Start the dashboard:   cd dashboard && npm run dev      (note the port it prints)
    2. python scripts/record_demo.py --url http://localhost:3000 --out team_demo/dashboard_tour.mp4

Drives the installed Microsoft Edge with Playwright, visits every page, scrolls through each section,
clicks the main toggles, asks one question in "Ask the data", and shows an on-screen caption explaining
what you're looking at. Needs: pip install playwright, and ffmpeg on PATH (to convert .webm -> .mp4).
"""
import argparse, pathlib, shutil, subprocess, tempfile, time
from playwright.sync_api import sync_playwright

W, H = 1440, 900

CAPTION_JS = """
(text) => {
  let el = document.getElementById('__demo_caption');
  if (!el) {
    el = document.createElement('div'); el.id = '__demo_caption';
    Object.assign(el.style, {position:'fixed', left:'50%', bottom:'28px', transform:'translateX(-50%)', zIndex:2147483647,
      maxWidth:'1100px', padding:'14px 22px', borderRadius:'12px', background:'rgba(10,12,16,.88)', color:'#f5f6f8',
      font:'500 20px/1.4 system-ui, Segoe UI, sans-serif', boxShadow:'0 8px 30px rgba(0,0,0,.45)', textAlign:'center',
      border:'1px solid rgba(255,255,255,.12)', transition:'opacity .25s'});
    document.body.appendChild(el);
  }
  el.style.opacity = text ? '1' : '0';
  el.innerHTML = text || '';
}
"""

CARD_JS = """
([title, sub]) => {
  let el = document.getElementById('__demo_card');
  if (!title) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = '__demo_card'; document.body.appendChild(el); }
  Object.assign(el.style, {position:'fixed', inset:'0', zIndex:2147483646, display:'flex', flexDirection:'column',
    alignItems:'center', justifyContent:'center', gap:'14px', background:'#0d0f12', color:'#f5f6f8',
    font:'600 46px/1.2 system-ui, Segoe UI, sans-serif', textAlign:'center', padding:'40px'});
  el.innerHTML = `<div>${title}</div><div style="font:400 22px/1.5 system-ui,Segoe UI,sans-serif;color:#aab1bd;max-width:900px">${sub}</div>`;
}
"""


class Demo:
    def __init__(self, page, base):
        self.p, self.base = page, base.rstrip("/")

    def go(self, path, wait=2.5):
        self.p.goto(self.base + path, wait_until="networkidle", timeout=180_000)
        self.p.wait_for_timeout(int(wait * 1000))

    def say(self, text, secs=4.0):
        self.p.evaluate(CAPTION_JS, text)
        self.p.wait_for_timeout(int(secs * 1000))

    def card(self, title, sub, secs=4.0):
        self.p.evaluate(CARD_JS, [title, sub]); self.p.wait_for_timeout(int(secs * 1000)); self.p.evaluate(CARD_JS, [None, None])

    def scroll_to(self, selector=None, y=None, secs=1.5):
        if selector:
            self.p.evaluate("(s)=>{const e=document.querySelector(s); if(e) e.scrollIntoView({behavior:'smooth', block:'start'})}", selector)
        else:
            self.p.evaluate("(y)=>window.scrollTo({top:y, behavior:'smooth'})", y)
        self.p.wait_for_timeout(int(secs * 1000))

    def scroll_text(self, text, secs=1.5):
        loc = self.p.get_by_text(text, exact=False).first
        try:
            loc.scroll_into_view_if_needed(timeout=5000)
            self.p.evaluate("()=>window.scrollBy({top:-90, behavior:'smooth'})")
        except Exception:
            pass
        self.p.wait_for_timeout(int(secs * 1000))

    def click_text(self, text, secs=2.0):
        try:
            self.p.get_by_text(text, exact=True).first.click(timeout=5000)
        except Exception:
            pass
        self.p.wait_for_timeout(int(secs * 1000))

    def glide(self, px, steps=6, secs=3.0):
        for _ in range(steps):
            self.p.mouse.wheel(0, px / steps); self.p.wait_for_timeout(int(secs * 1000 / steps))


def tour(d: Demo):
    d.go("/")
    d.card("PYRAXIS", "Flame in Freefall challenge · dashboard tour · current state · NASA Space Apps 2026<br/>Built on NASA PSI combustion data (24 investigations)", 5)

    # ---- Mission Control
    d.say("<b>Mission Control</b> - start here. Pick a habitat and see how much NASA actually knows about fire in that air.", 5)
    d.click_text("Moon base", 2)
    d.say("Moon base selected: only a handful of tests come close to its air (34% O₂, 70 kPa). Data-gap warnings appear here.", 5)
    d.glide(500, secs=3)
    d.say("Below: the 24 PSI investigations <b>ranked by relevance</b> to this habitat. Hover a score to see why it ranked there.", 5)
    d.click_text("Spacecraft / ISS", 2)
    d.say("Switch to the ISS: hundreds of tests nearby. That contrast is our headline finding.", 4)

    # ---- Flammability Map
    d.go("/map")
    d.say("<b>Flammability Map</b> - every test from all 24 investigations, plotted by oxygen and pressure.", 5)
    d.say("Shaded zones are habitat atmospheres. The ISS zone is crowded; the Moon-base zone is almost empty. Click any point to see its source file and row.", 6)
    d.click_text("O₂ partial pressure", 3)
    d.say("Toggle to oxygen partial pressure: the amount of oxygen a flame actually 'feels'.", 4)
    d.say("Green cluster near the Moon box: CFI-G gas flames at 35-40% O₂. No solid material was ever tested above 23% O₂ in the public archive.", 6)
    d.say("Everything is downloadable: one clean CSV of all 1,709 test rows, each traceable to its NASA source.", 4)
    d.click_text("Total pressure", 1.5)

    # ---- Investigations
    d.go("/investigations")
    d.say("<b>Investigations</b> - search and filter all 24 NASA experiments (prevention, detection, suppression...).", 5)
    d.click_text("Detection", 2.5)
    d.say("Filtered to detection: the smoke experiments SAME, SAME-R and DAFT.", 3.5)
    d.go("/investigations/PSI-69", 2)
    d.say("Each investigation has a detail page: objectives, hypothesis, hardware, publications, and its parsed test data (here: FLEX).", 5)
    d.glide(900, secs=4)

    # ---- Compare
    d.go("/compare")
    d.say("<b>Compare</b> - put up to 4 investigations side by side; identical rows are greyed so differences stand out.", 5)
    d.glide(500, secs=3)

    # ---- Fire simulator
    d.go("/simulator", 1.5)
    d.say("<b>Fire simulator</b> - a live physics simulation: two habitat atmospheres side by side, from ignition to detection to suppression.", 6)
    d.click_text("Fans off: ISS vs Earth", 1)
    d.say("Same fire, fans shut off: in orbit the flame starves and goes out; on Earth buoyancy keeps feeding it - exactly what BASS saw.", 9)
    d.click_text("Hidden smoke: overheated wiring", 1)
    d.say("Overheated wire insulation: the ionisation detector catches its fine smoke - the photoelectric one does not (the SAME finding).", 9)
    d.click_text("Apollo 1 vs today's ISS", 1)
    d.say("Apollo 1's pure-oxygen cabin vs today's ISS air. Below each panel: how many real NASA tests back that scenario.", 8)
    d.glide(600, secs=3)

    # ---- Fire-safety layers
    d.go("/layers")
    d.say("<b>Fire-safety layers</b> - the heart of the project: <b>prevent</b> fires, <b>detect</b> them early, <b>suppress</b> them for good.", 5)
    d.scroll_to("#prevention")
    d.say("<b>1 · Prevention</b> (BASS): will a solid material keep burning once lit? Labels come from the ISS crew's own test notes.", 5)
    d.glide(420, secs=2.5)
    d.say("Each dot is one ISS test: blue kept burning, orange did not. Almost everything burned in ISS-like air - even at 16-17% oxygen.", 6)
    d.glide(520, secs=2.5)
    d.say("Per material: the model's chance it keeps burning in ISS air (Nomex 18%, acrylic 98%), lowest O₂ that burned, and how flames went out.", 6)
    d.say("Every crew note was checked by hand. Honest limit: only 14 tests failed to burn, all in ISS-like air - the biggest data gap we found.", 5)

    d.scroll_to("#detection")
    d.say("<b>2 · Detection</b> (SAME, SAME-R, SPICE): which smoke can today's detectors see? 120 smoke tests read from 1-second instrument logs.", 6)
    d.glide(380, secs=2.5)
    d.say("Left: how often each detector reacted to each material's smoke. Teflon and Kapton make the smallest particles - the ISS obscuration detector caught only ~38%.", 7)
    d.say("Right: a what-if model - pick a fuel and see when its flame starts to smoke at each air speed, with a 95% range and the real ISS flights.", 5)
    d.click_text("ethylene", 2); d.click_text("propylene 50%", 2); d.click_text("propylene", 2)
    d.glide(450, secs=2.5)
    d.say("Table: smoke amount, particle count and size per material, plus the model's predicted smoke at low / typical / high heating.", 5)

    d.scroll_to("#suppression")
    d.say("<b>3 · Suppression</b> (FLEX + CFI, 501 droplet tests): does the atmosphere put the flame out - and does it stay out?", 5)
    d.glide(380, secs=2.5)
    d.say("Diluent gases (CO₂, helium, nitrogen) vs how flames ended; invisible 'cool flames' kept burning after the visible flame died in 124 of 146 CFI tests.", 6)
    d.glide(500, secs=2.5)
    d.say("Habitat outlook: all four suppression models. In Moon-base air only ~9% of droplets go out cleanly - most burst and scatter fuel.", 6)
    d.scroll_to("#equipment")
    d.say("<b>From data to equipment</b> - what the research means for real hardware: detectors, alarm thresholds, suppressant choice, ventilation, material screening.", 6)
    d.glide(500, secs=3)
    d.say("Every card names its NASA evidence, and the numbers are read straight from the data.", 4)

    # ---- Predictions
    d.go("/model")
    d.say("<b>Predictions</b> - burning rate in each habitat's air with a 95% range. Hollow dots = outside tested conditions (a guess).", 6)
    d.click_text("Uncertainty", 2.5)
    d.say("Uncertainty map: bright areas are where the model is guessing - exactly where NASA's next experiment would teach us most.", 5)
    d.click_text("Prediction", 1)
    d.glide(700, secs=3)
    d.say("Habitat outlook table, then every model's score next to simple baselines - tested only on campaigns it never saw.", 5)
    d.glide(600, secs=3)

    # ---- Ask the data
    d.go("/ask")
    d.say("<b>Ask the data</b> - ask in plain English. Answers come only from NASA documents, with numbered sources.", 4)
    box = d.p.locator("textarea").first
    try:
        box.click(); box.type("How was smoke measured in SAME and SAME-R?", delay=45); box.press("Enter")
        d.say("Searching 4,500+ passages from PSI reports and NASA's official resources...", 1)
        try:  # wait for the real answer (AI call can take a while); falls through after 90 s
            d.p.get_by_text("Answer written from the sources below", exact=False).first.wait_for(timeout=90_000)
        except Exception:
            pass
        d.p.wait_for_timeout(2000)
    except Exception:
        pass
    d.say("Every claim cites a source you can open. With no AI key it still works as a plain search.", 5)
    d.glide(500, secs=3)

    # ---- Method & Earth
    d.go("/about")
    d.say("<b>Method & Earth</b> - how it works, its stated limits, and why it matters on Earth: smoke detectors, firefighting, aircraft cabins.", 6)
    d.glide(800, secs=4)

    d.say("", 0.3)
    d.card("That's the current state", "Next: polish, the 30-second submission video, and the write-up.<br/>Questions → the team chat.", 5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:3000")
    ap.add_argument("--out", default="team_demo/dashboard_tour.mp4")
    ap.add_argument("--light", action="store_true", help="record in light theme (default dark)")
    a = ap.parse_args()
    out = pathlib.Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    import urllib.request
    try:
        urllib.request.urlopen(a.url, timeout=10)
    except Exception:
        raise SystemExit(f"No dashboard answering at {a.url}. Start it first:  cd dashboard && npm run dev"
                         "   (then pass the port it prints with --url)")
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="demo_"))
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="msedge", headless=True)
        scheme = "light" if a.light else "dark"
        # 1) warm up every route in a NON-recording session (dev server compiles on first visit)
        warm = br.new_context(viewport={"width": W, "height": H}, color_scheme=scheme)
        wp = warm.new_page()
        for r in ["/", "/map", "/investigations", "/investigations/PSI-69", "/compare", "/layers", "/model", "/ask", "/about"]:
            wp.goto(a.url.rstrip("/") + r, wait_until="networkidle", timeout=300_000)
        warm.close()
        # 2) record only the tour
        t0 = time.time()
        ctx = br.new_context(viewport={"width": W, "height": H}, record_video_dir=str(tmp), record_video_size={"width": W, "height": H},
                             color_scheme=scheme, device_scale_factor=1)
        page = ctx.new_page()
        tour(Demo(page, a.url))
        video = page.video.path(); dur = time.time() - t0
        ctx.close(); br.close()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-c:v", "libx264", "-preset", "medium",
                    "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)], check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"wrote {out}  ({dur:.0f} s)")


if __name__ == "__main__":
    main()
