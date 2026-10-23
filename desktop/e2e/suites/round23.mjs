// Equalizer persistence and real browser DSP, including a WebKit-style output bridge.
import { open, check, nav, done } from "../harness.mjs";
const root = "/home/u/Music";
const song = (title) => ({ path: `${root}/${title}.mp3`, title, artist: "Band", album_artist: "", album: "Album", genre: "Rock", year: 2024, track: null, disc: null, duration: 30, bitrate: 192, sample_rate: 44100, bit_depth: null, channels: 2, format: "MP3", size: 1000, modified: 1000, added: 1000, has_cover: false, loudness: -18 });
let page = await open({ mock: { library: [song("Alpha"), song("Beta")], audioSeconds: 30 } });
await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("Playback");
const eq = page.getByRole("region", { name: "Equalizer", exact: true });
await eq.getByLabel("Enable equalizer", { exact: true }).check();
await eq.getByLabel("Equalizer preset", { exact: true }).selectOption("Bass boost");
check("EQ: ten bands and preamp are available", await eq.getByRole("slider").count() === 11);
check("EQ: presets persist bounded gains", await page.evaluate(() => { const eq = JSON.parse(localStorage.getItem("__store")).settings.equalizer; return eq.enabled && eq.bands.length === 10 && eq.bands[0] === 6 && eq.autoHeadroom; }));
await eq.getByLabel("Equalizer 1 kHz", { exact: true }).fill("3.5");
check("EQ: individual adjustment selects Custom", await eq.getByLabel("Equalizer preset", { exact: true }).inputValue() === "Custom");
await page.reload(); await nav(page, "Settings").click(); await page.getByLabel("Settings section", { exact: true }).selectOption("Playback");
check("EQ: gains and enabled state survive restart", await eq.getByLabel("Equalizer 1 kHz", { exact: true }).inputValue() === "3.5" && await eq.getByLabel("Enable equalizer", { exact: true }).isChecked());
await nav(page, "Library").click(); await page.getByRole("button", { name: "Play Alpha", exact: true }).click();
await page.getByRole("region", { name: "Music player", exact: true }).getByRole("button", { name: "Equalizer", exact: true }).click();
const modal = page.getByRole("dialog", { name: "Audio equalizer", exact: true });
await modal.getByText(/Equalizer active/).waitFor();
check("EQ: real-time processor is active during playback", true);
await modal.getByLabel("Enable equalizer", { exact: true }).uncheck();
check("EQ: bypass retains gains", await modal.getByLabel("Equalizer 1 kHz", { exact: true }).inputValue() === "3.5" && (await modal.innerText()).includes("Bypassed"));
await modal.getByRole("button", { name: "Reset equalizer", exact: true }).click();
check("EQ: reset returns all bands and preamp to flat", await modal.getByLabel("Equalizer preset", { exact: true }).inputValue() === "Flat");
await page.setViewportSize({ width: 760, height: 540 });
check("EQ: minimum-window dialog fits", await modal.evaluate((el) => el.getBoundingClientRect().width <= innerWidth && el.getBoundingClientRect().height <= innerHeight));
await page.screenshot({ path: "src-tauri/target/equalizer.png" });
await modal.getByRole("button", { name: "Done", exact: true }).click();
await page.getByRole("button", { name: "Open full-screen player", exact: true }).click();
await page.getByRole("dialog", { name: "Full-screen player", exact: true }).getByRole("button", { name: "Equalizer", exact: true }).click();
await modal.waitFor(); await page.keyboard.press("Escape");
check("EQ: fullscreen EQ closes without exiting the player", await modal.count() === 0 && await page.getByRole("dialog", { name: "Full-screen player", exact: true }).count() === 1);

const dsp = await page.evaluate(async () => {
  const { defaultEqualizer } = await import("/src/lib/equalizer.ts");
  const { EqualizerGraph } = await import("/src/lib/equalizerGraph.ts");
  const render = async (boost, autoHeadroom, enabled = true) => {
    const context = new OfflineAudioContext(1, 48000, 48000);
    const source = context.createOscillator(); source.frequency.value = 1000;
    const input = context.createGain(); input.gain.value = 0.1; source.connect(input);
    const settings = { ...defaultEqualizer(), enabled, autoHeadroom }; settings.bands[5] = boost;
    // Feed a real oscillator into the production graph, substituting only the media-source decoder boundary.
    context.createMediaElementSource = () => input;
    const graph = new EqualizerGraph(() => context); graph.configure(settings); graph.attach({});
    const effective = graph.status().effectivePreamp;
    source.start(); const buffer = await context.startRendering(); const samples = buffer.getChannelData(0).slice(24000);
    return { rms: Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length), effective };
  };
  return { flat: await render(0, false), boost: await render(6, false), cut: await render(-6, false), guarded: await render(6, true), bypass: await render(6, false, false) };
});
check("DSP: +6 dB doubles the target-frequency amplitude", Math.abs(dsp.boost.rms / dsp.flat.rms - Math.pow(10, 6 / 20)) < 0.02);
check("DSP: -6 dB attenuates the target frequency", Math.abs(dsp.cut.rms / dsp.flat.rms - Math.pow(10, -6 / 20)) < 0.02);
check("DSP: automatic headroom offsets the boosted response", dsp.guarded.effective < -5.9 && Math.abs(dsp.guarded.rms / dsp.flat.rms - 1) < 0.02);
check("DSP: bypass produces flat output", Math.abs(dsp.bypass.rms / dsp.flat.rms - 1) < 0.01);

const bridge = await page.evaluate(async () => {
  const { EqualizerGraph } = await import("/src/lib/equalizerGraph.ts");
  const { defaultEqualizer } = await import("/src/lib/equalizer.ts");
  const context = new AudioContext(); Object.defineProperty(context, "setSinkId", { value: undefined });
  const outputs = [];
  let sink;
  const graph = new EqualizerGraph(() => context, () => { const output = sink = new Audio(); output.setSinkId = async (id) => { outputs.push(id); }; return output; });
  graph.configure({ ...defaultEqualizer(), enabled: true }); await graph.activate();
  await graph.setOutput("headphones"); await graph.setOutput("");
  await graph.activate(); const paused = sink.paused;
  graph.dispose(); return { outputs, paused, closed: context.state === "closed" };
});
check("output: WebKit-style bridge supports a selected device and default fallback", bridge.outputs.includes("headphones") && bridge.paused && bridge.closed);
await page.context().close(); await done();
