"""Writes prompts.json: every picture of the game with its prompt (see docs art list)."""
import json
I = []
def a(name, prompt, kind="sprite", ar="1:1"): I.append({"name": name, "prompt": prompt, "kind": kind, "ar": ar})
# menu
a("menu-bg", "Wide landscape: scorched wasteland, a castle on a hill with a crown emblem banner, dramatic sunset sky, no characters.", "bg", "16:9")
a("menu-bg-tall", "Tall portrait landscape: scorched cracked wasteland with glowing embers, a grey stone castle on a rocky hill with a red banner bearing a golden crown, dramatic fiery sunset sky filling the upper half, no characters.", "bg", "9:16")
a("logo", "Emblem: a large ornate golden royal crown with red rubies floating above a dark steel heraldic shield with gold trim, crossed swords behind the shield.")
a("app-icon", "App icon: a golden royal crown on a dark blue heraldic shield with gold trim, centered, dark stormy background with warm glow, square composition.", "bg", "1:1")
a("panel-tex", "Seamless texture of dark weathered wood planks with subtle iron studs, top-down flat even lighting, fills the whole frame, no objects.", "bg", "1:1")
# map terrain textures
a("tex-grass", "Seamless top-down texture of lush green meadow grass with tiny flowers, flat even lighting, seen from directly above, fills the whole frame, no objects, no shadows.", "bg")
a("tex-water", "Seamless tileable texture of blue water surface seen from directly above (top-down, orthographic), small uniform ripples evenly distributed everywhere, no horizon, no perspective, no shore, uniform color, fills the whole frame.", "bg")
a("forest1", "A dense cluster of five green pine and oak trees, compact round group.")
a("forest2", "A dense cluster of dark green fir trees, compact group.")
a("mount1", "A rocky grey mountain peak with a little snow on the top, compact.")
a("mount2", "Two jagged brown rocky mountain peaks, compact.")
a("castle-castle", "A bright white stone knight castle with blue roofed towers and spires, gatehouse in front, plain white flag.")
a("castle-necro", "A dark gothic necromancer castle of black stone with bones and skulls, glowing green windows, eerie green mist at its base.")
a("mine", "A gold mine entrance dug into a rocky cliff, wooden supports, mine cart full of gold nuggets.")
a("chest", "A wooden treasure chest bound with iron, lid open, overflowing with gold coins.")
a("hero-knight", "A knight hero in shining steel armor with a blue cape riding a white warhorse, facing right, holding a lance.")
a("hero-necro", "A necromancer hero in a dark hooded robe with a skull staff riding a skeletal black horse, facing right.")
# units (face right)
U = {
 "pike": "a medieval pikeman soldier in steel helmet and chainmail with a long pike and blue tabard",
 "halberd": "a heavily armored halberdier with a large halberd, plate armor and blue tabard, elite soldier",
 "archer": "a medieval archer in leather armor and green hood drawing a longbow",
 "marksman": "an elite crossbowman marksman in a feathered hat and blue coat aiming a heavy crossbow",
 "griffin": "a griffin, eagle head and wings with a lion body, golden brown feathers, wings spread",
 "royalGriffin": "a majestic royal griffin with white and gold feathers and a small golden crown, wings spread",
 "skeleton": "an undead skeleton warrior with a rusty sword and a broken round shield",
 "ghost": "a translucent pale blue ghost wraith in tattered robes with glowing eyes, floating",
 "lich": "a lich undead sorcerer in dark purple robes with a glowing green staff and a skull face",
 "wolf": "a large grey wolf snarling, full body",
}
for k, v in U.items(): a("unit-" + k, "Battle creature sprite: " + v + ", full body, facing right, side three-quarter view.")
# battle
a("battle-bg", "Battlefield seen from above at a steep angle: a wide green grassy plain with small patches of dirt and flowers, even lighting, the center completely open and flat, no characters, no trees in the middle, a few bushes only at the far edges.", "bg", "3:4")
a("rock1", "A mossy grey boulder, battlefield obstacle.")
a("rock2", "A pile of large grey rocks, battlefield obstacle.")
# icons
ART = {
 "sword": "a glowing steel longsword with golden hilt", "shield": "a sturdy steel kite shield with gold trim",
 "rookieMail": "a simple steel breastplate cuirass", "apprenticeRing": "a simple silver ring with a small blue gem",
 "boots": "a pair of brown leather traveling boots", "windCloak": "a flowing light blue cloak swirling with wind",
 "luckAmulet": "a golden amulet with a green four-leaf clover gem", "valorPauldrons": "a pair of ornate golden shoulder pauldrons",
 "mageRing": "a golden ring with a large glowing purple gem", "crown": "an ornate golden royal crown with rubies",
 "ashHelm": "a dark charcoal helmet with glowing orange ember cracks", "ashMail": "a dark charcoal breastplate with glowing orange ember cracks",
 "ashBlade": "a dark charcoal sword with glowing orange ember cracks", "stormOrb": "a crystal orb with crackling blue lightning inside on a small stand",
}
for k, v in ART.items(): a("art-" + k, "Artifact: " + v + ".", "icon")
SK = {"offense": "two crossed swords", "armor": "a heavy round shield", "sorcery": "an open spellbook with glowing runes",
      "pathfinding": "a compass on a map", "luck": "a four-leaf clover with golden sparkle", "leadership": "a war banner on a pole with a golden eagle"}
for k, v in SK.items(): a("skill-" + k, "Skill icon: " + v + ".", "icon")
SP = {"bolt": "a bright blue lightning bolt striking", "heal": "glowing golden healing light with a white cross of light", "haste": "a winged boot with speed trails"}
for k, v in SP.items(): a("spell-" + k, "Spell icon: " + v + ".", "icon")
B = {"griffinTower": "a tall stone tower with a griffin nest on top", "mageGuild": "a small blue-roofed mage tower with glowing windows", "forge": "a blacksmith forge with anvil and glowing fire"}
for k, v in B.items(): a("bld-" + k, "Building icon: " + v + ".", "icon")
a("res-gold", "Resource icon: a pile of shiny gold coins.", "icon")
a("shop-banner", "A white cloth war banner on a wooden pole with a golden finial, plain white flag.", "icon")
a("shop-premium", "A golden royal seal medallion with a crown emblem and red ribbon.", "icon")
a("shop-treasury", "An open treasure chest overflowing with gold coins and jewels.", "icon")
a("portrait-knight", "Portrait bust of a brave knight commander, short brown beard, steel armor with blue cape, heroic look, dark background.", "bg")
a("portrait-necro", "Portrait bust of a pale sinister necromancer in a dark hood with glowing green eyes, dark background.", "bg")
json.dump(I, open("prompts.json", "w"), ensure_ascii=False, indent=1)

# processing specs for proc.cjs: sprite/icon = cut out the magenta background, bg = resize, tex = resize + make seamless
S = []
for p in I:
    n = p["name"]
    if n == "menu-bg": s = {"kind": "bg", "w": 1280, "h": 720}
    elif n == "menu-bg-tall": s = {"kind": "bg", "w": 720, "h": 1280}
    elif n == "app-icon": s = {"kind": "bg", "w": 512, "h": 512}
    elif n == "panel-tex" or n.startswith("tex-"): s = {"kind": "tex", "w": 256, "h": 256}
    elif n == "battle-bg": s = {"kind": "bg", "w": 800, "h": 920}
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
