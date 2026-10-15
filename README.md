# All Hallows' Night

A top-down slasher survival game in plain HTML5 canvas and JavaScript. It has no build step and no dependencies.

## Run it

```bash
cd "The Halloween Game" && python3 -m http.server 8731
```

Play: (https://spud88-stack.github.io/All-Hallow-s-Night/)

## Modes
| Killer | Map | Playstyle |
|---|---|---|
| **The Shape** (Michael Myers) | Haddonfield suburb + cemetery | Stalks from the dark to feed on your fear. Cuts power and phone lines, hides in closets to ambush you, moves faster when you aren't looking, and can grab you when your fear peaks. |
| **Jason** | Camp Crystal Lake | A brute who smashes doors. Shifts through the woods to get ahead of you, senses you when you're terrified, and kills the generator. |
| **Ghostface** | Woodsboro + a house party | Fast, with sprint-lunges. Calls you on the phone (answering gives away where you are), and hides in shadow until he's close. Keep your flashlight on him to expose him. |

## Systems
- **Fear.** Darkness, sightings, bodies, screams and being watched raise it. High fear causes a shaking flashlight, slower stamina, tunnel vision, audible breathing while hiding, and panic stumbles. The killer gains power from your fear.
- **Killer levels.** XP comes from stalking, scares, kills and sabotage, across three levels with new abilities at each.
- **Killer AI.** A utility planner with perception (light, line of sight, noise), memory, prediction of where you're heading, ambushes, sabotage, hiding-spot searches, and police evasion.
- **Residents.** Each has a personality, memory, and their own states: investigate, flee, hide, follow, call 911, or fight back. Talk to them to recruit them, get hints about the car keys, or get items.
- **Police escalation.** A patrol comes first, then backup, then the sheriff and tactical units. Escalation is driven by calls, gunfire, bodies and downed officers. An unverified first call is treated as a Halloween prank.
- **Escapes.** Car keys plus the car (a toolkit fixes sabotage), a police cruiser with an officer nearby, or surviving until 5:00 AM.

## OpenRouter (optional)
Go to **Settings & AI**, paste an OpenRouter key, and pick a model. With a key:
- An LLM "director" chooses the killer's tactics every N seconds. The built-in AI still handles moment-to-moment behavior.
- You can type free-form messages to residents, and they reply in character and choose actions.
- Ghostface writes his own phone taunts, and dispatch and cops get generated radio lines.

The key is stored in your browser's localStorage and sent only to `openrouter.ai`. Every AI call has a timeout and a scripted fallback.

## Graphics
- Colored light map multiplied over the scene: cold blue moonlight, warm lamps, blue TV glow, red flares, and police light bars.
- Line-of-sight fog of war, and shadows that characters cast away from your flashlight and nearby lamps.
- A volumetric flashlight beam with drifting dust.
- Electric lights stutter and die when the killer is near.
- Pre-rendered environment: 3/4-view wall faces (siding outside, wallpaper inside), moon shadows, ambient occlusion, rugs, cobwebs, puddles, Halloween yard displays, and ghosts and toilet paper hanging in the trees.
- Horror post-processing: chromatic aberration and VHS tearing at high fear, static when he's close, desaturation, a heartbeat camera pulse, blood on the screen, painted jump-scare close-ups, and bloody footprints after a kill.
- The Shape tilts his head when he stares at you.
- Settings has a **Brightness** slider. The grain/distortion toggle turns off the heavier effects.

## Art & audio
All character sprites are original pixel art drawn in code (`js/sprites.js`) to resemble the iconic looks. No copyrighted sprites or audio are included. All music and sound effects are synthesized live with the Web Audio API (`js/audio.js`). The music adapts to fear and threat, and each killer has an original theme.
