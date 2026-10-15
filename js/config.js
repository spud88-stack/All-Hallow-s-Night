'use strict';
// ---------------------------------------------------------------------------
// Static game data: tiles, items, killer profiles, difficulty, dialogue.
// ---------------------------------------------------------------------------
const TILE = 32;

const T = {
  GRASS: 0, FLOOR: 1, WALL: 2, DOOR: 3, WINDOW: 4, ROAD: 5, SIDEWALK: 6, TREE: 7, WATER: 8,
  FENCE: 9, TILEF: 10, CARPET: 11, DIRT: 12, HEDGE: 13, DRIVE: 14, SAND: 15, DOCK: 16, GRAVEL: 17,
};
const INDOOR_TILES = new Set([T.FLOOR, T.TILEF, T.CARPET]);

const ITEMS = {
  battery:   { name: 'Batteries', desc: 'Recharges your flashlight.', stack: true },
  bandage:   { name: 'Bandage', desc: 'Patch yourself up (+35 health).', stack: true },
  candy:     { name: 'Candy', desc: 'Sugar rush. Calms nerves, restores stamina.', stack: true },
  flare:     { name: 'Road Flare', desc: 'Bright light for 45s. Draws attention.', stack: true },
  knife:     { name: 'Kitchen Knife', desc: 'Stab him. It might buy you seconds.', weapon: { dmg: 26, stun: 1.1, range: 40, cd: 0.6, stamina: 12, sound: 'stab' } },
  bat:       { name: 'Baseball Bat', desc: 'Long reach, staggers hard.', weapon: { dmg: 16, stun: 2.0, range: 46, cd: 0.85, stamina: 18, knock: 70, sound: 'hit' } },
  keys:      { name: 'Car Keys', desc: 'Keys to the car. Get out of here.' },
  fuse:      { name: 'Fuse', desc: 'Restores power at a breaker box or transformer.' },
  toolkit:   { name: 'Toolkit', desc: 'Repair cut phone lines or a sabotaged car.' },
  cellphone: { name: 'Cell Phone', desc: 'Low battery. Enough for one or two calls.' },
};

// Per-killer profile. Arrays are indexed by evil level (0..2 => I, II, III).
const KILLERS = {
  myers: {
    id: 'myers', name: 'The Shape', fullName: 'Michael Myers', mapKind: 'haddonfield',
    location: 'Haddonfield, Illinois', date: 'October 31st', title: 'HALLOWEEN NIGHT',
    tagline: 'He came home. He watches. He never runs.',
    desc: 'Stalks from the dark and feeds on your fear. Cuts power and phone lines, hides in closets, and grows stronger every time you feel watched.',
    speeds: [72, 82, 92], unseenBoost: [1.5, 1.65, 1.85], sprint: null,
    dmg: [22, 32, 46], windup: [0.55, 0.45, 0.35], attackCd: 1.3, attackRange: 36,
    breakTime: [7, 5, 3.2], windowLevel: 1, stunResist: 0.8, hp: 140,
    xpLevels: [0, 120, 280],
    w: { chase: 0.85, stalk: 1.6, ambush: 1.25, sabotage: 1.3, hunt: 0.8, investigate: 1, search: 1, patrol: 1 },
    abilities: ['stalk', 'closet', 'tombstone'],
    music: 'shape', ambience: 'suburb', color: '#e8e2d0',
    persona: 'Michael Myers, "The Shape": silent, patient, inhuman. Prefers to watch from darkness, let fear build, cut lights and phone lines, hide in closets near where the victim will go, and strike when they are isolated. Never speaks. Walks, never runs.',
    victimTitle: 'babysitter', intro: 'October 31st.\nHaddonfield, Illinois.\n\nYou were only supposed to watch the house tonight.\nThe man across the street has been standing very still for a long time.',
  },
  jason: {
    id: 'jason', name: 'Jason', fullName: 'Jason Voorhees', mapKind: 'camp',
    location: 'Camp Crystal Lake', date: 'Friday the 13th', title: 'FRIDAY THE 13TH',
    tagline: 'Relentless. Unstoppable. Always closer than you think.',
    desc: 'A brute who smashes through doors and windows. He shifts through the woods to appear ahead of you, and senses you when you are terrified.',
    speeds: [76, 86, 98], unseenBoost: [1.15, 1.25, 1.35], sprint: null,
    dmg: [30, 42, 58], windup: [0.65, 0.55, 0.45], attackCd: 1.5, attackRange: 42,
    breakTime: [2.4, 1.5, 0.8], windowLevel: 0, stunResist: 0.55, hp: 220,
    xpLevels: [0, 110, 260],
    w: { chase: 1.5, stalk: 0.35, ambush: 0.8, sabotage: 0.9, hunt: 1.35, investigate: 1.2, search: 1.1, patrol: 1 },
    abilities: ['shift', 'sense', 'smash'],
    music: 'camp', ambience: 'camp', color: '#e2dcc6',
    persona: 'Jason Voorhees: a relentless, silent brute at Camp Crystal Lake. Hunts counselors one by one, smashes through doors, cuts the generator, appears ahead of fleeing victims through the woods. Never speaks. Driven by rage over his mother.',
    victimTitle: 'counselor', intro: 'Friday the 13th.\nCamp Crystal Lake.\n\nThe camp reopens tomorrow.\nThe locals said this place has a death curse.\nNobody listened.',
  },
  ghostface: {
    id: 'ghostface', name: 'Ghostface', fullName: 'Ghostface', mapKind: 'woodsboro',
    location: 'Woodsboro, California', date: 'Friday night', title: 'WOODSBORO',
    tagline: 'Do you like scary movies?',
    desc: 'Fast, cocky and cruel. Calls you on the phone, hides in shadows until he is on top of you, and lunges. Keep your light on him to expose him.',
    speeds: [94, 102, 110], unseenBoost: [1.1, 1.15, 1.2], sprint: [168, 178, 188],
    dmg: [20, 28, 38], windup: [0.32, 0.28, 0.24], attackCd: 0.95, attackRange: 34,
    breakTime: [6, 4.5, 3], windowLevel: 2, stunResist: 1.5, hp: 100,
    xpLevels: [0, 110, 250],
    w: { chase: 1.1, stalk: 1.1, ambush: 1.2, sabotage: 0.9, hunt: 1.2, investigate: 1, search: 1.1, patrol: 1 },
    abilities: ['shroud', 'calls', 'expose', 'sprint'],
    music: 'ghost', ambience: 'woodsboro', color: '#f0f0ea',
    persona: 'Ghostface: a cocky, horror-movie-obsessed killer in a black robe and white ghost mask. Taunts victims on the phone with movie trivia and threats, watches from hiding, lunges fast, stumbles comically when hit, picks off party guests, then goes for the "final girl".',
    victimTitle: 'final girl', intro: 'Woodsboro, California.\n\nThere\'s a party down the street tonight.\nYour phone has rung three times.\nNobody was there.',
  },
};

const DIFF = {
  easy:   { label: 'Trick', killerSpeed: 0.9, dmg: 0.7, policeEta: 70, xp: 0.75, fear: 0.8, think: 1.3, battery: 0.7 },
  normal: { label: 'Treat', killerSpeed: 1.0, dmg: 1.0, policeEta: 95, xp: 1.0, fear: 1.0, think: 1.0, battery: 1.0 },
  hard:   { label: 'Nightmare', killerSpeed: 1.08, dmg: 1.25, policeEta: 125, xp: 1.3, fear: 1.2, think: 0.75, battery: 1.3 },
};

const NAMES_F = ['Annie', 'Lynda', 'Judith', 'Marion', 'Sheila', 'Tina', 'Debra', 'Carol', 'Peggy', 'Denise', 'Ruth', 'Wendy', 'Karen', 'Holly', 'Joan', 'Becky', 'Tracy', 'Gale', 'Nancy', 'Ellen'];
const NAMES_M = ['Bob', 'Tommy', 'Lonnie', 'Paul', 'Doug', 'Earl', 'Frank', 'Gary', 'Hank', 'Jimmy', 'Keith', 'Larry', 'Ned', 'Ray', 'Stu', 'Walt', 'Randy', 'Vince', 'Dale', 'Ross'];
const SURNAMES = ['Wallace', 'Doyle', 'Elrod', 'Brackett', 'Henley', 'Strode', 'Keller', 'Mercer', 'Haines', 'Pruitt', 'Garner', 'Tolman', 'Briggs', 'Ashby', 'Fenwick', 'Dutton', 'Harlow', 'Maddox'];
const STREETS = { haddonfield: 'Lampkin Lane', camp: 'Camp Crystal Lake', woodsboro: 'Turner Lane' };

const PERSONALITIES = [
  { id: 'brave', label: 'brave and stubborn', bravery: 0.85, trust: 0.45 },
  { id: 'skeptic', label: 'skeptical, thinks it is a Halloween prank', bravery: 0.6, trust: 0.25 },
  { id: 'nervous', label: 'nervous and jumpy', bravery: 0.2, trust: 0.55 },
  { id: 'kind', label: 'kind and protective', bravery: 0.55, trust: 0.7 },
  { id: 'grumpy', label: 'grumpy old neighbor who hates being disturbed', bravery: 0.65, trust: 0.15 },
  { id: 'party', label: 'carefree party-goer, a little drunk', bravery: 0.4, trust: 0.5 },
];

// Scripted fallback lines (used without an LLM, or while it's thinking)
const LINES = {
  seeKiller: ['Oh my God... who is that?!', 'Someone\'s out there!', 'HELP! HE HAS A KNIFE!', 'Get away from me!', 'RUN!'],
  hearNoise: ['Hello? Who\'s there?', 'Is somebody there?', 'Not funny, guys.', 'Tommy, if that\'s you...', 'What was that?'],
  scream: ['AAAHHH!', 'NOOO!', 'HELP ME!', 'PLEASE, NO!'],
  follow: ['Okay... okay, I\'m right behind you.', 'Don\'t leave me alone.', 'Lead the way. Please hurry.'],
  refuse: ['I\'m not going out there.', 'You\'re crazy. I\'m staying put.', 'Get off my porch, it\'s Halloween, kid.', 'I\'m calling your parents.'],
  stay: ['I\'ll lock everything. Go!', 'I\'ll hide. Be careful.', 'Fine. Doors locked.'],
  greet: ['What do you want?', 'Little late for trick-or-treating.', 'Oh, hi. Everything okay?', 'You look like you\'ve seen a ghost.'],
  lineDead: ['The line\'s dead... why is the line dead?!', 'There\'s no dial tone!'],
  called: ['They said they\'re sending someone!', 'Police are on their way.'],
  hiding: ['(breathing hard)', '(whimpering)'],
  cop: {
    arrive: ['Haddonfield PD! Anyone here?', 'Police! Come out where we can see you!', 'Sheriff\'s department. Anybody home?'],
    see: ['FREEZE! Drop the knife!', 'Shots fired! Shots fired!', 'Suspect sighted, engaging!', 'Get down! Get DOWN!'],
    escort: ['Stay behind me. My car\'s out front.', 'You\'re safe now. Move, to the cruiser.', 'Stick close. We\'re leaving.'],
    down: ['Officer down! Officer down!', '10-99! Need backup now!'],
  },
  ghostCalls: [
    'Do you like scary movies?',
    'Hello, sweetheart. Is your door locked? ...Are you sure?',
    'I can see you. You\'re in the house. You keep looking at the windows.',
    'Name the killer in the first Friday the 13th. Wrong answer... you die.',
    'Your neighbors are having a party. Or... they WERE.',
    'Why are you hiding? This is the best part of the movie.',
    'Rule number one: never say "I\'ll be right back."',
    'Turn around.',
  ],
  shapeFlavor: ['You feel someone watching you.', 'A shape stands perfectly still in the dark.', 'The wind dies. Everything is quiet.', 'You hear slow, heavy footsteps.'],
  jasonFlavor: ['A twig snaps somewhere in the trees.', 'You hear heavy breathing between the cabins.', 'Something splashes in the lake.', 'Ch... ch... ch... ah... ah...'],
  ghostFlavor: ['A phone is ringing somewhere.', 'Footsteps run past the window.', 'A dark figure darts between houses.', 'The party music stopped.'],
};

const DISPATCH_LINES = {
  1: ['Dispatch: Unit 12 responding to a disturbance at {addr}. ETA {eta}s.', 'Dispatch: Patrol en route to {addr}. Stay on the line.'],
  2: ['Dispatch: All units, multiple calls from {loc}. Backup rolling, ETA {eta}s.', 'Dispatch: Officer requesting backup. Two more cars en route.'],
  3: ['Dispatch: Code 3, all available units to {loc}. Sheriff and tactical team en route, ETA {eta}s.', 'Dispatch: State police notified. Heavy response inbound.'],
};
