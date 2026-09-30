"""Writes prompts.json (every picture with its prompt) and specs.json (how proc.cjs post-processes it)."""
import json
I = []
M2 = "grok-imagine-image-2.0"
def a(name, prompt, kind="sprite", ar="1:1", model=M2): I.append({"name": name, "prompt": prompt, "kind": kind, "ar": ar, "model": model})
# menu
a("menu-bg", "Wide cinematic landscape: two survivors in tactical gear with backpacks stand on a rocky hill in the foreground seen from behind, looking over a vast post-apocalyptic valley with a river, forests, ruins of a megacity skyline and smoking factory chimneys on the horizon, dramatic sunset sky, golden light, haze.", "bg", "16:9")
a("menu-bg-tall", "Tall portrait composition: a lone survivor in tactical gear with a backpack stands on a rocky cliff next to a tattered black flag with a golden crown emblem, looking over a ruined megacity and a river at sunset, dramatic clouds, golden light, haze.", "bg", "9:16")
a("logo", "Emblem: a heavy golden crown made of welded scrap metal and gears, above a battered dark steel shield with rivets and scratches, two crossed rifles behind the shield.")
a("app-icon", "App icon: a golden scrap-metal crown on a battered dark steel shield, dark stormy post-apocalyptic sky with warm glow, square composition.", "bg")
a("panel-tex", "Seamless texture of dark worn gunmetal steel plate with subtle scratches, rust spots and rivets, flat even lighting, fills the whole frame, no objects.", "bg")
# settlement stages for the castle panel: stage 0 here, stages 1-3 by chained edit.py runs with prompts/city-<side>-<n>.txt
def city(n, p): I.append({"name": n, "prompt": p, "kind": "bg", "ar": "16:9", "model": M2})
city("city-player-0", "Isometric aerial view of a tiny survivor shelter in a post-apocalyptic wasteland: a single rusty shipping container and a tarp tent behind a low wall of sandbags, a campfire, a water barrel, a small plain white flag on a pole, surrounded by empty dusty ground, ruined city skyline far away at sunset. Wide cinematic strategy game city view, no text, no people close up.")
city("city-enemy-0", "Isometric aerial view of a tiny raider camp in a post-apocalyptic wasteland: a rusted bus turned into a shack, a fence of scrap metal spikes, burning barrels, a red rag flag on a pole, surrounded by empty dusty ground, toxic haze, ruined city skyline far away at sunset. Wide cinematic strategy game city view, no text, no people close up.")
# map objects
a("base-player", "A fortified survivor base: compound walled with concrete blocks, sandbags and scrap metal sheets, a tall wooden watchtower, container buildings with blue tarps, a small greenhouse, a radio mast, a flag pole with a plain white flag, warm lights.")
a("base-enemy", "A menacing raider mutant fortress: jagged walls of rusted scrap metal and spikes, a dark tower with red warning lights, burning barrels, toxic green smoke, skulls on poles.")
a("mine", "A scrap and metal mining outpost at a rocky cliff: rusty conveyor, mine shaft entrance with wooden supports, piles of metal ore, fuel barrels, a small crane.")
a("chest", "A military supply cache: an open olive-green ammo crate full of gold coins and ammunition, canned food and a jerrycan next to it.")
a("hero-player", "A survivor squad leader, a woman in tactical gear with a blue scarf, riding an armored off-road motorcycle with saddlebags, facing right.")
a("hero-enemy", "A raider warlord in a spiked leather armor and gas mask, riding a rusty armored war buggy with spikes and a red flag, facing right.")
# units
U = {
 "pike": "a post-apocalyptic militia fighter holding a long sharpened rebar spear and a scrap-metal shield, makeshift armor, blue armband",
 "halberd": "a heavily armored assault trooper with a riot shield and a heavy war axe, plate armor made of car parts, blue armband",
 "archer": "a survivor rifleman in a hoodie and tactical vest aiming a bolt-action rifle, blue armband",
 "marksman": "an elite sniper in a ghillie hood and tactical gear aiming a large sniper rifle, blue armband",
 "griffin": "a military quadcopter recon drone with a camera and small gun, hovering",
 "royalGriffin": "a large heavy combat drone with six rotors, armored hull, mounted machine gun and missile pods, hovering",
 "skeleton": "a feral ghoul mutant, emaciated grey skin, torn clothes, rusty pipe weapon, hunched",
 "ghost": "a translucent pale blue anomaly wraith made of glowing radioactive mist, humanoid, floating, glowing eyes",
 "lich": "a psionic mutant in a tattered dark hooded robe with a gas mask, glowing green energy orb in hand, purple veins",
 "wolf": "a large mutated grey wolf with patches of bare skin, scars, glowing eyes, snarling",
}
for k, v in U.items(): a("unit-" + k, "Photorealistic character sprite: " + v + ".", "unit")
# battle
a("battle-bg", "Straight top-down overhead drone view, looking directly down, no horizon, no sky: a ruined city square after heavy fighting at sunset. Around the edges of the frame: roofs of collapsed concrete buildings, a burned-out rusty bus seen from above, a wrecked tank seen from above, sandbag barricades, concrete blocks, burning cars with bright orange flames and drifting black smoke, rubble piles. The large centre area is open flat cracked dark asphalt with puddles reflecting orange fire light, a faded zebra crossing and small debris, clear for combat. No people. Warm fire glow against cool blue shadows, cinematic, ultra detailed, sharp.", "bg", "3:4")
TOP = "Straight top-down overhead drone view, looking directly down, no horizon, no sky: "
OPEN = " The large centre area is open flat ground clear for combat. No people. Cinematic, ultra detailed, sharp."
a("battle-bg-toxic", TOP + "a contaminated wasteland at dusk. Around the edges of the frame: glowing acid-green toxic pools and swamp water, rusted leaking chemical barrels, dead black trees, bones, a crashed rusty helicopter seen from above, mutant nests of twisted scrap and roots, drifting green mist. The centre is cracked grey-brown mud with small puddles reflecting green glow." + OPEN + " Sickly green glow against cold violet shadows.", "bg", "3:4")
a("battle-bg-forest", TOP + "a clearing in a dead burned pine forest at sunset. Around the edges of the frame: tops of dark pines and orange autumn trees, fallen logs, a rusted abandoned truck seen from above, a small stream, boulders, a ruined wooden watchtower, campfire smoke. The centre is dry grass, dirt paths and fallen needles." + OPEN + " Warm golden sunset light with long shadows, cool blue shade under the trees.", "bg", "3:4")
a("battle-bg-fort", TOP + "the approach to a fortified survivor outpost at dusk. Along the top edge of the frame: a thick wall of welded steel plates and shipping containers with a watchtower and floodlights. Around the other edges: sandbag bunkers, anti-tank hedgehogs, barbed wire, a burned armored vehicle seen from above, crates and fuel drums, scorch marks. The centre is packed gravel and cracked concrete road with tyre tracks." + OPEN + " Warm floodlight and fire glow against cool blue dusk shadows.", "bg", "3:4")
a("rock1", "A cover obstacle: a burned-out rusty car wreck.")
a("rock2", "A cover obstacle: a pile of concrete road barriers and sandbags.")
# heroes (screen)
a("hero-body-player", "Full body portrait of a female survivor commander named Elmira, mid 30s, determined face, dark hair in a ponytail, wearing a simple worn jacket, cargo pants and a blue scarf, holding a rifle, standing, facing the viewer, ruined city at sunset behind her.", "bg", "3:4")
a("hero-body-enemy", "Full body portrait of a raider warlord named Morgoth, huge scarred man, shaved head, wearing spiked leather armor and a gas mask hanging on the chest, holding a heavy machete, standing, facing the viewer, burning ruins behind him.", "bg", "3:4")
a("portrait-player", "Portrait bust of a determined female survivor commander, mid 30s, dark hair in a ponytail, worn tactical jacket with a blue scarf, dark background.", "bg")
a("portrait-enemy", "Portrait bust of a scarred raider warlord with a shaved head and a gas mask hanging on the chest, menacing, dark background.", "bg")
# icons
ART = {
 "sword": "a heavy combat machete with a taped handle", "shield": "a battered riot shield",
 "rookieMail": "a light kevlar tactical vest", "apprenticeRing": "a simple steel ring with a tiny blue circuit light",
 "boots": "a pair of worn military combat boots", "windCloak": "a tattered hooded desert poncho cloak",
 "luckAmulet": "military dog tags with a small lucky four-leaf clover charm", "valorPauldrons": "armored tactical shoulder pads",
 "mageRing": "a heavy ring with a glowing purple energy crystal", "crown": "a crown welded from scrap metal and gold",
 "ashHelm": "a blackened tactical helmet with glowing orange ember cracks", "ashMail": "a blackened plate carrier armor with glowing orange ember cracks",
 "ashBlade": "a blackened heated blade with glowing orange ember cracks", "stormOrb": "a glowing energy core crystal with crackling blue lightning in a metal cage",
}
for k, v in ART.items(): a("art-" + k, "Equipment item: " + v + ".", "icon")
SK = {"offense": "two crossed assault rifles", "armor": "a heavy steel armor plate", "sorcery": "a glowing blue energy crystal",
      "pathfinding": "a compass on a worn paper map", "luck": "a pair of dice and a horseshoe", "leadership": "a black flag with a golden crown on a pole"}
for k, v in SK.items(): a("skill-" + k, "Skill icon: " + v + ".", "icon")
SP = {"bolt": "an electric EMP blast with blue lightning", "heal": "a military first aid kit with a red cross", "haste": "an adrenaline syringe with a green glow"}
for k, v in SP.items(): a("spell-" + k, "Ability icon: " + v + ".", "icon")
B = {"griffinTower": "a drone hangar with a landing pad", "mageGuild": "a research lab container with antennas and glowing screens", "forge": "a workshop with a welding station and anvil, sparks"}
for k, v in B.items(): a("bld-" + k, "Building icon: " + v + ".", "icon")
a("res-gold", "Resource icon: a stack of gold coins and small gold bars.", "icon")
a("shop-banner", "A black cloth flag with a golden crown emblem on a steel pole.", "icon")
a("shop-premium", "A golden medal badge with a crown emblem and a red ribbon.", "icon")
a("shop-treasury", "An open steel briefcase full of gold coins and gold bars.", "icon")
json.dump(I, open("prompts.json", "w"), ensure_ascii=False, indent=1)

# processing specs for proc.cjs: sprite/icon = cut out the magenta background, bg = resize, tex = resize + make seamless.
# map-valley comes from edit.py (layout.png + prompts/map.txt), hero-body-*-1/2 from edit.py on hero-body-*-0.
names = [p["name"] for p in I if not p["name"].startswith(("hero-body-", "city-"))] + ["map-valley"]
names += [f"city-{side}-{n}" for side in ("player", "enemy") for n in range(4)]
names += [f"hero-body-{side}-{tier}" for side in ("player", "enemy") for tier in range(3)]
S = []
for n in names:
    if n == "menu-bg": s = {"kind": "bg", "w": 1600, "h": 900}
    elif n == "menu-bg-tall": s = {"kind": "bg", "w": 720, "h": 1280}
    elif n == "app-icon": s = {"kind": "bg", "w": 512, "h": 512}
    elif n == "panel-tex": s = {"kind": "tex", "w": 256, "h": 256}
    elif n == "map-valley": s = {"kind": "bg", "w": 896, "h": 1024, "q": 0.86}
    elif n.startswith("battle-bg"): s = {"kind": "bg", "w": 800, "h": 920}
    elif n.startswith("hero-body-"): s = {"kind": "bg", "w": 540, "h": 720}
    elif n.startswith("city-"): s = {"kind": "bg", "w": 1280, "h": 720, "q": 0.8}
    elif n.startswith("portrait-"): s = {"kind": "bg", "w": 256, "h": 256}
    elif n == "logo": s = {"kind": "sprite", "size": 640}
    elif n.startswith("rock"): s = {"kind": "sprite", "size": 192}
    elif n.split("-")[0] in ("art", "skill", "spell", "bld", "res", "shop"): s = {"kind": "icon", "size": 128}
    else: s = {"kind": "sprite", "size": 256}
    s["src"] = n
    s["out"] = n
    S.append(s)
json.dump(S, open("specs.json", "w"), indent=0)
print(len(I))
