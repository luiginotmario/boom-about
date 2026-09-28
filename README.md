# Overture — an interactive about page (concept)

A redesign concept for Boom Supersonic's Overture page: one continuous, scroll-scrubbed 3D shot
that starts outside the aircraft at 60,000 ft and ends at the silicon.

Everything is rendered live in the browser. No video, no pre-rendered frames, no model files:
the aircraft, cabin, Symphony engine, carbon plies, chip die, sky and shockwaves are all built
in code.

## The shot

| # | Chapter | What happens |
|---|---------|--------------|
| 01 | Overture | Overture over the cloud deck, the Earth's curvature ray-traced in the sky shader |
| 02 | By the Numbers | Tracking pass along the fuselage; Boom's stats roll in as odometers |
| 03 | Approach | Push in on one cabin window until it fills the frame, then through the glass |
| 04 | Cabin | The all-premium cabin from Boom's rendering. Mouse-look plus hotspots |
| 05 | Airframe | Rise through the ceiling as the airframe separates into a blueprint |
| 06 | Carbon | Composite plies peel off the nose skin one angle at a time |
| 07 | Silicon | Flight computer → processor → the lid slides off → a live die |
| 08 | Symphony | The aircraft reassembles; a nacelle cuts away to show fan, compressor, combustor, turbine |
| 09 | Mach 1.7 | The Mach cone forms and sharpens live: μ = asin(1/M) |
| 10 | Boomless Cruise | Mach-cutoff rays refract back upward before reaching the ground |
| 11 | Airlines | Closing beauty shot, orders & pre-orders, calls to action |

## Principles

- **Scroll position is the camera.** GSAP ScrollTrigger (`scrub: true`) maps scroll to a target
  progress; the frame loop damps it and samples one monotone-cubic camera path. Scroll is never
  animated or hijacked, so the page scrubs freely in both directions.
- **One clock.** Lenis, ScrollTrigger and the renderer all run on `gsap.ticker`. There is no second
  `requestAnimationFrame` loop.
- **Everything is a function of progress.** `src/story.js` holds every camera keyframe and every
  scene state (x-ray, explode, cutaway, Mach…) as pure functions of `p`, so the choreography is
  deterministic and can be read and retimed in one place.
- **Light.** No build step, no model or texture downloads. Livery, seat-back maps and PCB traces
  are painted to canvases at startup. CDN versions are pinned: three 0.170.0, gsap 3.12.5,
  lenis 1.1.0.

## Run it

ES modules plus an import map need to be served over HTTP (double-clicking the file won't work):

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173. Append `?p=0.64` to jump straight to any moment (0–1).

## Layout

```
index.html          copy, captions, labels, import map
styles.css          type, HUD, odometers, hotspots, responsive rules
src/story.js        camera keyframes + chapter windows + scene states (the choreography)
src/camera-path.js  non-overshooting monotone cubic interpolation over keyframes
src/main.js         renderer, Lenis/ScrollTrigger bridge, the single frame loop
src/post.js         HDR composer: bloom → ACES → vignette + grain
src/ui.js           captions, HUD, odometers, 3D-anchored labels
src/world/
  shape.js          Overture's outer mould line as analytic curves
  sky.js            ray-traced Earth, cloud deck and sun; baked to the environment map
  livery.js         fuselage / fin / seat-back screen painted to canvases
  overture.js       fuselage sections, gull wing, fin, nacelles, analytic windows, x-ray
  cabin.js          walls with real window cut-outs, window wells, instanced seats, lighting
  symphony.js       medium-bypass turbofan internals + shader airflow
  silicon.js        carbon plies, flight-computer board, procedural die shader
  shock.js          Mach cone, vapor cone, Mach-cutoff rays
```

Facts and copy come from boomsupersonic.com (Overture, Symphony, Boomless Cruise and FAQ pages).
This is an unaffiliated design concept.
