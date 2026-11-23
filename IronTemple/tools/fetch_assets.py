#!/usr/bin/env python3
"""Iron Temple CC0 asset fetcher (Python 3.7+, standard library only).

Downloads real, free CC0 .glb models and tiling textures into <project>/assets/,
validates every file before it is saved, writes assets/models/manifest.json and
assets/ASSET_CREDITS.md, and builds the first-person arms rig (models/hands/fps_arms.glb)
from the Quaternius "Universal Base Characters" male body.

    python tools/fetch_assets.py                  # fetch everything that is missing
    python tools/fetch_assets.py --force          # re-download and rebuild everything
    python tools/fetch_assets.py --check          # validate what is on disk (no network)
    python tools/fetch_assets.py --only gym,hands # limit to categories
    python tools/fetch_assets.py --list           # print the manifest

Exit code: 0 when every selected entry is present and valid, 1 otherwise.
A failed entry never leaves a partial file behind; the game has procedural fallbacks.

Every glb is checked before it is written: size > 5 KB, "glTF" magic, version 2, header
length == real length, first chunk is JSON and parses, JSON has "asset" and >= 1 mesh, and the
file is self-contained (no external buffers/images) with no extension Godot 4.4 cannot import.
Models that use KHR_mesh_quantization (3dassets.dev) are converted to plain float vertex data
on download, because Godot 4.4 refuses that required extension.
"""
import argparse
import hashlib
import io
import json
import math
import os
import posixpath
import re
import struct
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

TOOL_NAME = "tools/fetch_assets.py"
PROJECT_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = PROJECT_DIR / "assets"
MANIFEST_PATH = ASSETS_DIR / "models" / "manifest.json"
CREDITS_PATH = ASSETS_DIR / "ASSET_CREDITS.md"

CATEGORIES = ("characters", "hands", "gym", "street", "textures")
FOLDERS = ("models/characters", "models/hands", "models/gym", "models/street", "textures")
MIN_BYTES = 5 * 1024
MAX_DOWNLOAD_BYTES = 120 * 1024 * 1024
UA = "Mozilla/5.0 (compatible; IronTempleAssetFetcher/1.0; +CC0 asset tool)"
LICENSE_CC0 = "CC0 1.0"

# Extensions a *required* glTF extension list must not contain (Godot 4.4 cannot import them).
UNSUPPORTED_REQUIRED = {
    "KHR_mesh_quantization",
    "KHR_draco_mesh_compression",
    "EXT_meshopt_compression",
    "KHR_texture_basisu",
}

# --------------------------------------------------------------------------------------------
# MANIFEST
# --------------------------------------------------------------------------------------------
# Each entry: id, category, dest (relative to assets/), urls (mirrors tried in order), license,
# author, source (human page), optional zip_member, notes. URL forms:
#   https://...            plain download (GitHub raw URLs are pinned to a commit SHA)
#   kenney:<pack-slug>     kenney.nl pack zip; a fresh signed download link is requested at run time
# derived entries (no urls) are built locally from another entry.

MOORFALL_SHA = "1e83864f55ff8646e929ac9b73faa75df29161de"
MOORFALL_RAW = "https://raw.githubusercontent.com/Dallolz/moorfall-assets/" + MOORFALL_SHA + "/"
MOORFALL_CDN = "https://cdn.jsdelivr.net/gh/Dallolz/moorfall-assets@" + MOORFALL_SHA + "/"  # byte-identical mirror
QUATERNIUS_PAGE = "https://quaternius.com/packs/universalbasecharacters.html"


def _entry(eid, category, dest, urls, author, source, zip_member=None, notes="", license_=LICENSE_CC0, **extra):
    e = {
        "id": eid,
        "category": category,
        "dest": dest,
        "urls": list(urls),
        "license": license_,
        "author": author,
        "source": source,
        "notes": notes,
    }
    if zip_member:
        e["zip_member"] = zip_member
    e.update(extra)
    return e


def quaternius(name, subpath, notes):
    return _entry(
        "char_" + name, "characters", "models/characters/%s.glb" % name,
        [MOORFALL_RAW + subpath, MOORFALL_CDN + subpath], "Quaternius", QUATERNIUS_PAGE,
        notes=notes + " Mirrored in github.com/Dallolz/moorfall-assets (LICENSE.md states CC0); jsDelivr serves the same commit.",
    )


def da(category, name, asset_id, slug, title):
    """3dassets.dev model (CC0 1.0 per asset page JSON-LD); versioned CDN URL, quantized glb."""
    return _entry(
        "%s_%s" % (category, name), category, "models/%s/%s.glb" % (category, name),
        ["https://cdn.3dassets.dev/assets/%d/v1/model.glb" % asset_id],
        "3dassets.dev", "https://3dassets.dev/assets/" + slug,
        notes=title + ". +Y up, front faces +Z, metres, flat PBR materials, no textures.",
    )


def kenney(category, name, pack, folder, member, title):
    return _entry(
        "%s_%s" % (category, name), category, "models/%s/%s.glb" % (category, name),
        ["kenney:" + pack], "Kenney (kenney.nl)", "https://kenney.nl/assets/" + pack,
        zip_member="Models/%s/%s.glb" % (folder, member),
        notes=title + ". Kenney pack License.txt: CC0.",
    )


def ambientcg(name, asset, member_suffix, title):
    return _entry(
        "tex_" + name, "textures", "textures/%s.jpg" % name,
        ["https://ambientcg.com/get?file=%s_1K-JPG.zip" % asset],
        "ambientCG", "https://ambientcg.com/a/" + asset,
        zip_member="%s_1K-JPG_%s.jpg" % (asset, member_suffix),
        notes=title + " (1K JPG, tileable; NormalGL = Godot-compatible OpenGL normal map).",
    )


MANIFEST = [
    # ---- characters: Quaternius Universal Base Characters (CC0) ----
    quaternius("superhero_male", "characters/Superhero_Male.glb", "Rigged male body, 65-joint UE-style skeleton, embedded 2K texture."),
    quaternius("superhero_female", "characters/Superhero_Female.glb", "Rigged female body, same skeleton."),
    quaternius("hair_buzzed", "hair/Hair_Buzzed.glb", "Buzzed hair piece."),
    quaternius("hair_parted", "hair/Hair_SimpleParted.glb", "Simple parted hair piece."),
    quaternius("hair_long", "hair/Hair_Long.glb", "Long hair piece."),
    quaternius("hair_buns", "hair/Hair_Buns.glb", "Hair buns piece."),
    quaternius("hair_beard", "hair/Hair_Beard.glb", "Beard piece."),
    quaternius("hair_buzzed_female", "hair/Hair_BuzzedFemale.glb", "Buzzed hair piece (female)."),

    # ---- hands: derived locally ----
    _entry(
        "hands_fps_arms", "hands", "models/hands/fps_arms.glb", [], "Quaternius (derived by %s)" % TOOL_NAME,
        QUATERNIUS_PAGE,
        notes="Derived from superhero_male.glb (CC0): only the arm/hand triangles of the body mesh, same 65-joint "
              "skeleton and embedded texture; eyes/eyebrows removed.",
        derived_from="char_superhero_male", builder="fps_arms",
    ),

    # ---- gym props: 3dassets.dev "Gym and Fitness Studio" pack (CC0) ----
    da("gym", "dumbbell", 33560, "gym-and-fitness-studio-dumbbell-single-ad7c4a83", "Rubber Hex Dumbbell"),
    da("gym", "dumbbell_rack", 33561, "gym-and-fitness-studio-dumbbell-rack-loaded-89afa5b2", "Three-Tier Dumbbell Rack, Loaded"),
    da("gym", "barbell_loaded", 33563, "gym-and-fitness-studio-barbell-loaded-33928ba8", "Olympic Barbell with Bumper Plates"),
    da("gym", "barbell_bare", 33562, "gym-and-fitness-studio-barbell-empty-49e6d762", "Olympic Barbell, Bare"),
    da("gym", "kettlebell", 33564, "gym-and-fitness-studio-kettlebell-single-cf7fa12b", "Cast Kettlebell"),
    da("gym", "kettlebell_rack", 33565, "gym-and-fitness-studio-kettlebell-set-dc97b187", "Kettlebell Rack, Six Bells"),
    da("gym", "weight_plate_tree", 33566, "gym-and-fitness-studio-weight-plate-tree-e1ac8322", "Weight Plate Tree, Loaded"),
    da("gym", "bumper_plate_stack", 33567, "gym-and-fitness-studio-bumper-plate-stack-4cbca27c", "Bumper Plate Stack"),
    da("gym", "bench_flat", 33575, "gym-and-fitness-studio-flat-bench-7fd01050", "Flat Utility Bench"),
    da("gym", "bench_adjustable", 33576, "gym-and-fitness-studio-adjustable-bench-4624177a", "Adjustable Bench, Flat"),
    da("gym", "punching_bag", 33587, "gym-and-fitness-studio-punching-bag-on-stand-301be432", "Punching Bag on Weighted Stand"),
    da("gym", "locker_bank", 33593, "gym-and-fitness-studio-locker-bank-44c1032e", "Six-Door Locker Bank"),
    da("gym", "water_cooler", 33596, "gym-and-fitness-studio-water-cooler-ec5c67da", "Bottled Water Cooler"),
    da("gym", "water_bottle", 33588, "gym-and-fitness-studio-water-bottle-97b8b284", "Sports Water Bottle"),
    da("gym", "yoga_mat", 33583, "gym-and-fitness-studio-yoga-mat-flat-ea182435", "Yoga Mat, Unrolled"),
    da("gym", "yoga_mat_rolled", 33582, "gym-and-fitness-studio-yoga-mat-rolled-2550c2f5", "Yoga Mat, Rolled"),
    da("gym", "plyo_box", 33581, "gym-and-fitness-studio-plyo-box-b65bb5f6", "Three-in-One Plyo Box"),
    da("gym", "fan_standing", 33601, "gym-and-fitness-studio-standing-fan-4a03c434", "Free-Standing Pedestal Fan"),
    da("gym", "treadmill", 33568, "gym-and-fitness-studio-treadmill-b07460be", "Commercial Treadmill"),
    da("gym", "power_rack", 33574, "gym-and-fitness-studio-power-rack-f687de8e", "Power Rack"),
    da("gym", "medicine_ball_rack", 33580, "gym-and-fitness-studio-medicine-ball-rack-3aa9f5af", "Medicine Ball Rack, Loaded"),
    da("gym", "wall_clock", 33599, "gym-and-fitness-studio-wall-clock-02816a94", "Gym Wall Clock"),
    da("gym", "towel_folded", 33586, "gym-and-fitness-studio-towel-folded-337516d0", "Folded Gym Towel"),
    da("gym", "mirror_panel", 33591, "gym-and-fitness-studio-mirror-wall-panel-1f6389f5", "Mirrored Wall Panel Module"),
    da("gym", "exercise_bike", 33570, "gym-and-fitness-studio-exercise-bike-upright-7f281ff6", "Upright Exercise Bike"),
    da("gym", "spin_bike", 33571, "gym-and-fitness-studio-spin-bike-b1cd4b8d", "Studio Spin Bike"),
    da("gym", "lat_pulldown", 33572, "gym-and-fitness-studio-lat-pulldown-station-89339d36", "Lat Pulldown Station"),
    da("gym", "leg_press", 33573, "gym-and-fitness-studio-leg-press-machine-a8871369", "Forty-Five Degree Leg Press"),
    da("gym", "cable_crossover", 33578, "gym-and-fitness-studio-cable-crossover-frame-1fb97f17", "Cable Crossover Frame"),
    da("gym", "battle_ropes", 33579, "gym-and-fitness-studio-battle-ropes-c8b17275", "Battle Ropes and Wall Anchor"),
    da("gym", "foam_roller", 33584, "gym-and-fitness-studio-foam-roller-3dcea971", "Grid Foam Roller"),
    da("gym", "rowing_machine", 33569, "gym-and-fitness-studio-rowing-machine-3d9e95df", "Air Rowing Machine"),
    da("gym", "reception_desk", 33597, "gym-and-fitness-studio-reception-desk-924c4679", "Gym Reception Desk"),

    # ---- gym lounge / juice bar: Kenney Furniture Kit (CC0) ----
    kenney("gym", "sofa_lounge", "furniture-kit", "GLTF format", "loungeSofa", "Lounge sofa"),
    kenney("gym", "chair_lounge", "furniture-kit", "GLTF format", "loungeChair", "Lounge chair"),
    kenney("gym", "table_coffee", "furniture-kit", "GLTF format", "tableCoffee", "Coffee table"),
    kenney("gym", "potted_plant", "furniture-kit", "GLTF format", "pottedPlant", "Potted plant"),
    kenney("gym", "speaker", "furniture-kit", "GLTF format", "speaker", "Floor speaker"),
    kenney("gym", "radio_boombox", "furniture-kit", "GLTF format", "radio", "Radio / boombox"),
    kenney("gym", "stool_bar", "furniture-kit", "GLTF format", "stoolBar", "Bar stool"),
    kenney("gym", "blender", "furniture-kit", "GLTF format", "kitchenBlender", "Shake blender"),
    kenney("gym", "fridge_small", "furniture-kit", "GLTF format", "kitchenFridgeSmall", "Small fridge"),
    kenney("gym", "trashcan", "furniture-kit", "GLTF format", "trashcan", "Trash can"),
    kenney("gym", "tv_modern", "furniture-kit", "GLTF format", "televisionModern", "Wall TV"),

    # ---- street: Kenney Car Kit + City Kit Roads (CC0) ----
    kenney("street", "car_taxi", "car-kit", "GLB format", "taxi", "Taxi"),
    kenney("street", "car_sedan", "car-kit", "GLB format", "sedan", "Sedan"),
    kenney("street", "car_suv", "car-kit", "GLB format", "suv", "SUV"),
    kenney("street", "car_van", "car-kit", "GLB format", "van", "Van"),
    kenney("street", "car_police", "car-kit", "GLB format", "police", "Police car"),
    kenney("street", "car_hatchback", "car-kit", "GLB format", "hatchback-sports", "Sports hatchback"),
    kenney("street", "car_ambulance", "car-kit", "GLB format", "ambulance", "Ambulance"),
    kenney("street", "truck_delivery", "car-kit", "GLB format", "delivery", "Delivery truck"),
    kenney("street", "truck_garbage", "car-kit", "GLB format", "garbage-truck", "Garbage truck"),
    kenney("street", "traffic_cone", "car-kit", "GLB format", "cone", "Traffic cone"),
    kenney("street", "street_light_square", "city-kit-roads", "GLB format", "light-square", "Street light, square arm"),
    kenney("street", "street_light_curved", "city-kit-roads", "GLB format", "light-curved", "Street light, curved arm"),
    kenney("street", "dumpster", "city-kit-roads", "GLB format", "dumpster", "Dumpster"),
    kenney("street", "road_barrier", "city-kit-roads", "GLB format", "construction-barrier", "Construction barrier"),
    kenney("street", "sign_stop", "city-kit-roads", "GLB format", "road-sign-stop", "Stop sign"),

    # ---- street furniture: 3dassets.dev (CC0) ----
    da("street", "bench_street", 34224, "bus-station-and-city-transit-street-bench-8ba313af", "Street Bench"),
    da("street", "street_lamp", 34226, "bus-station-and-city-transit-street-lamp-2c6420cf", "Street Lamp"),
    da("street", "litter_bin", 34225, "bus-station-and-city-transit-street-litter-bin-80e6ebc3", "Street Litter Bin"),
    da("street", "traffic_light", 34229, "bus-station-and-city-transit-traffic-light-4b8313ca", "Traffic Light"),
    da("street", "cycle_rack", 34227, "bus-station-and-city-transit-cycle-rack-cc0e65b5", "Cycle Rack"),
    da("street", "bus_shelter", 34221, "bus-station-and-city-transit-bus-shelter-with-advertising-panel-3a7216ac", "Bus Shelter with Advertising Panel"),
    da("street", "bollard", 34223, "bus-station-and-city-transit-street-bollard-7db606aa", "Street Bollard"),
    da("street", "planter", 34230, "bus-station-and-city-transit-street-planter-9c898b1c", "Street Planter"),
    da("street", "fire_hydrant", 29047, "pixel-modern-city-street-fire-hydrant-ec6bd2ac", "Fire Hydrant"),
    da("street", "post_box", 29041, "pixel-modern-city-street-post-box-fbbc4f96", "Post Box"),
    da("street", "phone_kiosk", 29042, "pixel-modern-city-street-phone-kiosk-fe8444b1", "Phone Kiosk"),
    da("street", "vending_machine", 35117, "community-sports-hall-and-changing-rooms-foyer-vending-machine-3def4990", "Foyer Vending Machine"),
    da("street", "motorbike", 32542, "car-park-and-road-vehicle-fleet-motorbike-on-its-stand-8abc1635", "Motorbike on its stand"),
    da("street", "scooter", 32538, "car-park-and-road-vehicle-fleet-scooter-on-its-stand-2e680ced", "Scooter on its stand"),
    da("street", "tree_broadleaf", 33684, "city-park-and-playground-broadleaf-park-tree-0d7e2fa1", "Broadleaf Park Tree"),
    da("street", "tree_conifer", 33683, "city-park-and-playground-park-tree-conifer-f8c4d290", "Conifer Park Tree"),
    da("street", "shrub_clump", 33685, "city-park-and-playground-shrub-clump-6f521139", "Shrub Clump"),

    # ---- textures: ambientCG (CC0 1.0) ----
    ambientcg("leather_normal", "Leather037", "NormalGL", "Leather037 normal map"),
    ambientcg("fabric_normal", "Fabric077", "NormalGL", "Fabric077 (fine twill weave) normal map"),
    ambientcg("rubber_normal", "Rubber004", "NormalGL", "Rubber004 (gym floor rubber) normal map"),
    ambientcg("concrete_normal", "Concrete034", "NormalGL", "Concrete034 normal map"),
]

_ids = [e["id"] for e in MANIFEST]
assert len(_ids) == len(set(_ids)), "duplicate manifest ids"
_dests = [e["dest"] for e in MANIFEST]
assert len(_dests) == len(set(_dests)), "duplicate manifest dest"
assert all(re.fullmatch(r"[a-z0-9_/]+\.(glb|jpg|png)", d) for d in _dests), "dest must be lowercase snake_case"
BY_ID = {e["id"]: e for e in MANIFEST}


# --------------------------------------------------------------------------------------------
# GLB parsing, validation, building
# --------------------------------------------------------------------------------------------
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


class AssetError(Exception):
    pass


def parse_glb(data):
    """Return (json_dict, bin_bytes). Raises AssetError for anything that is not a well-formed glb 2.0."""
    if len(data) < 20:
        raise AssetError("too small to be a glb (%d bytes)" % len(data))
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise AssetError("missing glTF magic (got %r)" % (data[:4],))
    if version != 2:
        raise AssetError("glb version %d, expected 2" % version)
    if length != len(data):
        raise AssetError("header length %d != file length %d" % (length, len(data)))
    pos = 12
    doc = None
    binb = b""
    first = True
    while pos + 8 <= len(data):
        clen, ctype = struct.unpack_from("<II", data, pos)
        pos += 8
        chunk = data[pos:pos + clen]
        if len(chunk) != clen:
            raise AssetError("chunk overruns the file")
        pos += clen
        if first:
            if ctype != CHUNK_JSON:
                raise AssetError("first chunk is not JSON")
            try:
                doc = json.loads(chunk.decode("utf-8").rstrip(" \x00\t\r\n"))
            except (UnicodeDecodeError, ValueError) as exc:
                raise AssetError("JSON chunk does not parse: %s" % exc)
            first = False
        elif ctype == CHUNK_BIN and not binb:
            binb = bytes(chunk)
    if doc is None:
        raise AssetError("no JSON chunk")
    return doc, binb


def build_glb(doc, binb):
    jb = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    jb += b" " * (-len(jb) % 4)
    binb = bytes(binb) + b"\x00" * (-len(binb) % 4)
    total = 12 + 8 + len(jb) + (8 + len(binb) if binb else 0)
    out = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    out += struct.pack("<II", len(jb), CHUNK_JSON) + jb
    if binb:
        out += struct.pack("<II", len(binb), CHUNK_BIN) + binb
    return bytes(out)


def validate_glb(data):
    """Raise AssetError unless `data` is a usable, self-contained glb. Returns a short summary string."""
    if len(data) <= MIN_BYTES:
        raise AssetError("only %d bytes (<= 5 KB) - probably an error page" % len(data))
    doc, _ = parse_glb(data)
    if "asset" not in doc:
        raise AssetError("JSON has no 'asset'")
    meshes = doc.get("meshes") or []
    if not meshes:
        raise AssetError("JSON has no meshes")
    if doc.get("scenes") and "scene" not in doc:
        raise AssetError("no default 'scene' (Godot warns on import)")
    for kind in ("buffers", "images"):
        for item in doc.get(kind, []):
            uri = item.get("uri")
            if uri and not uri.startswith("data:"):
                raise AssetError("external %s uri %r - not self-contained" % (kind, uri))
    bad = UNSUPPORTED_REQUIRED.intersection(doc.get("extensionsRequired", []))
    if bad:
        raise AssetError("requires %s, which Godot 4.4 cannot import" % ", ".join(sorted(bad)))
    return "%d meshes, %d materials" % (len(meshes), len(doc.get("materials", [])))


def validate_image(data):
    if len(data) <= MIN_BYTES:
        raise AssetError("only %d bytes (<= 5 KB)" % len(data))
    if not (data.startswith(b"\x89PNG\r\n\x1a\n") or data.startswith(b"\xff\xd8\xff")):
        raise AssetError("not a PNG/JPEG (magic %r)" % (data[:8],))
    return "image"


def validate_bytes(dest, data):
    ext = dest.lower().rsplit(".", 1)[-1]
    if ext == "glb":
        return validate_glb(data)
    if ext in ("png", "jpg", "jpeg"):
        return validate_image(data)
    raise AssetError("unsupported file type .%s" % ext)


# ---- accessor helpers ----
_CT = {5120: ("b", 1, 127.0), 5121: ("B", 1, 255.0), 5122: ("h", 2, 32767.0), 5123: ("H", 2, 65535.0),
       5125: ("I", 4, None), 5126: ("f", 4, None)}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def _layout(doc, acc):
    bv = doc["bufferViews"][acc["bufferView"]]
    fmt, csz, maxv = _CT[acc["componentType"]]
    n = _NC[acc["type"]]
    esz = csz * n
    stride = bv.get("byteStride") or esz
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return base, stride, esz, fmt, n, maxv


def _read_elements(doc, buf, acc):
    if "bufferView" not in acc:
        raise AssetError("accessor without bufferView (sparse/zero accessors unsupported)")
    base, stride, _, fmt, n, _ = _layout(doc, acc)
    unpack = struct.Struct("<" + fmt * n).unpack_from
    return [unpack(buf, base + i * stride) for i in range(acc["count"])]


def _align4(buf):
    buf.extend(b"\x00" * (-len(buf) % 4))


def _append_view(doc, buf, payload, target=34962):
    _align4(buf)
    off = len(buf)
    buf.extend(payload)
    view = {"buffer": 0, "byteOffset": off, "byteLength": len(payload)}
    if target:
        view["target"] = target
    doc.setdefault("bufferViews", []).append(view)
    return len(doc["bufferViews"]) - 1


def _walk_textures(obj, fn):
    """Call fn(index)->index for every texture reference inside a material (including extensions)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.endswith("Texture") and isinstance(v, dict) and isinstance(v.get("index"), int):
                v["index"] = fn(v["index"])
            else:
                _walk_textures(v, fn)
    elif isinstance(obj, list):
        for v in obj:
            _walk_textures(v, fn)


def gc_glb(doc, binb, drop_nodes=()):
    """Drop nodes, then everything only they referenced; compact bufferViews and the BIN chunk."""
    drop = set(drop_nodes)
    nodes = doc.get("nodes", [])
    if drop:
        nmap, keep = {}, []
        for i in range(len(nodes)):
            if i not in drop:
                nmap[i] = len(keep)
                keep.append(i)
        doc["nodes"] = [nodes[i] for i in keep]
        for n in doc["nodes"]:
            if "children" in n:
                n["children"] = [nmap[c] for c in n["children"] if c in nmap]
                if not n["children"]:
                    del n["children"]
        for s in doc.get("scenes", []):
            s["nodes"] = [nmap[c] for c in s.get("nodes", []) if c in nmap]
        for sk in doc.get("skins", []):
            sk["joints"] = [nmap[c] for c in sk["joints"]]
            if "skeleton" in sk:
                sk["skeleton"] = nmap[sk["skeleton"]]
        for an in doc.get("animations", []):
            an["channels"] = [c for c in an["channels"] if c["target"].get("node") in nmap]
            for c in an["channels"]:
                c["target"]["node"] = nmap[c["target"]["node"]]
        nodes = doc["nodes"]

    def remap_list(key, used):
        old = doc.get(key, [])
        keep = sorted(used)
        mp = {o: i for i, o in enumerate(keep)}
        if key in doc:
            doc[key] = [old[i] for i in keep]
            if not doc[key]:
                del doc[key]
        return mp

    # meshes / skins used by the remaining nodes
    mmap = remap_list("meshes", {n["mesh"] for n in nodes if "mesh" in n})
    smap = remap_list("skins", {n["skin"] for n in nodes if "skin" in n})
    for n in nodes:
        if "mesh" in n:
            n["mesh"] = mmap[n["mesh"]]
        if "skin" in n:
            n["skin"] = smap[n["skin"]]

    # accessors / materials referenced by the remaining meshes, skins, animations
    acc_used, mat_used = set(), set()
    for m in doc.get("meshes", []):
        for p in m["primitives"]:
            acc_used.update(p.get("attributes", {}).values())
            if "indices" in p:
                acc_used.add(p["indices"])
            for t in p.get("targets", []):
                acc_used.update(t.values())
            if "material" in p:
                mat_used.add(p["material"])
    for sk in doc.get("skins", []):
        if "inverseBindMatrices" in sk:
            acc_used.add(sk["inverseBindMatrices"])
    for an in doc.get("animations", []):
        for s in an.get("samplers", []):
            acc_used.update((s["input"], s["output"]))

    # materials -> textures -> images / samplers
    mtmap = remap_list("materials", mat_used)
    tex_used = set()
    for mat in doc.get("materials", []):
        _walk_textures(mat, lambda i: (tex_used.add(i), i)[1])
    ttmap = remap_list("textures", tex_used)
    img_used, smp_used = set(), set()
    for t in doc.get("textures", []):
        if "source" in t:
            img_used.add(t["source"])
        if "sampler" in t:
            smp_used.add(t["sampler"])
        for ext in t.get("extensions", {}).values():
            if isinstance(ext, dict) and "source" in ext:
                img_used.add(ext["source"])
    imap = remap_list("images", img_used)
    spmap = remap_list("samplers", smp_used)
    for t in doc.get("textures", []):
        if "source" in t:
            t["source"] = imap[t["source"]]
        if "sampler" in t:
            t["sampler"] = spmap[t["sampler"]]
        for ext in t.get("extensions", {}).values():
            if isinstance(ext, dict) and "source" in ext:
                ext["source"] = imap[ext["source"]]
    for mat in doc.get("materials", []):
        _walk_textures(mat, lambda i: ttmap[i])
    for m in doc.get("meshes", []):
        for p in m["primitives"]:
            if "material" in p:
                p["material"] = mtmap[p["material"]]

    amap = remap_list("accessors", acc_used)
    for m in doc.get("meshes", []):
        for p in m["primitives"]:
            p["attributes"] = {k: amap[v] for k, v in p.get("attributes", {}).items()}
            if "indices" in p:
                p["indices"] = amap[p["indices"]]
            for t in p.get("targets", []):
                for k in list(t):
                    t[k] = amap[t[k]]
    for sk in doc.get("skins", []):
        if "inverseBindMatrices" in sk:
            sk["inverseBindMatrices"] = amap[sk["inverseBindMatrices"]]
    for an in doc.get("animations", []):
        for s in an.get("samplers", []):
            s["input"], s["output"] = amap[s["input"]], amap[s["output"]]

    # bufferViews used by the remaining accessors / images, then rebuild the BIN chunk
    bv_used = set()
    for a in doc.get("accessors", []):
        if "bufferView" in a:
            bv_used.add(a["bufferView"])
        sp = a.get("sparse")
        if sp:
            bv_used.add(sp["indices"]["bufferView"])
            bv_used.add(sp["values"]["bufferView"])
    for im in doc.get("images", []):
        if "bufferView" in im:
            bv_used.add(im["bufferView"])
    old_views = doc.get("bufferViews", [])
    new_bin = bytearray()
    new_views, bvmap = [], {}
    for old in sorted(bv_used):
        bv = dict(old_views[old])
        _align4(new_bin)
        off = bv.get("byteOffset", 0)
        payload = binb[off:off + bv["byteLength"]]
        bv["byteOffset"] = len(new_bin)
        new_bin.extend(payload)
        bvmap[old] = len(new_views)
        new_views.append(bv)
    for a in doc.get("accessors", []):
        if "bufferView" in a:
            a["bufferView"] = bvmap[a["bufferView"]]
        sp = a.get("sparse")
        if sp:
            sp["indices"]["bufferView"] = bvmap[sp["indices"]["bufferView"]]
            sp["values"]["bufferView"] = bvmap[sp["values"]["bufferView"]]
    for im in doc.get("images", []):
        if "bufferView" in im:
            im["bufferView"] = bvmap[im["bufferView"]]
    _align4(new_bin)
    if new_views:
        doc["bufferViews"] = new_views
    else:
        doc.pop("bufferViews", None)
    doc["buffers"] = [{"byteLength": len(new_bin)}] if new_bin else []
    if not doc["buffers"]:
        del doc["buffers"]
    return doc, bytes(new_bin)


def dequantize_glb(data):
    """Rewrite KHR_mesh_quantization vertex data as float32 and drop the extension. No-op otherwise."""
    doc, binb = parse_glb(data)
    ext_all = set(doc.get("extensionsUsed", [])) | set(doc.get("extensionsRequired", []))
    buf = bytearray(binb)
    accs = doc.get("accessors", [])
    refs = []
    for m in doc.get("meshes", []):
        for p in m["primitives"]:
            refs.extend(p.get("attributes", {}).items())
            for t in p.get("targets", []):
                refs.extend(t.items())
    changed = False
    done = set()
    for name, ai in refs:
        if ai in done:
            continue
        done.add(ai)
        acc = accs[ai]
        base = name.split("_")[0]
        if acc["componentType"] == 5126 or "bufferView" not in acc or base in ("JOINTS", "WEIGHTS"):
            continue
        if base not in ("POSITION", "NORMAL", "TANGENT") and "KHR_mesh_quantization" not in ext_all:
            continue
        ct = acc["componentType"]
        maxv = _CT[ct][2]
        signed = ct in (5120, 5122)
        normalized = bool(acc.get("normalized"))
        floats = []
        for el in _read_elements(doc, buf, acc):
            if normalized:
                vals = [max(c / maxv, -1.0) if signed else c / maxv for c in el]
            else:
                vals = [float(c) for c in el]
            if base == "NORMAL":
                ln = math.sqrt(sum(v * v for v in vals)) or 1.0
                vals = [v / ln for v in vals]
            floats.extend(vals)
        acc["bufferView"] = _append_view(doc, buf, struct.pack("<%df" % len(floats), *floats))
        acc["byteOffset"] = 0
        acc["componentType"] = 5126
        acc.pop("normalized", None)
        ncomp = _NC[acc["type"]]
        if base == "POSITION" and floats:
            cols = [floats[c::ncomp] for c in range(ncomp)]
            acc["min"] = [min(c) for c in cols]
            acc["max"] = [max(c) for c in cols]
        else:
            acc.pop("min", None)
            acc.pop("max", None)
        changed = True
    if not changed:
        return data
    for key in ("extensionsUsed", "extensionsRequired"):
        if key in doc:
            doc[key] = [x for x in doc[key] if x != "KHR_mesh_quantization"]
            if not doc[key]:
                del doc[key]
    doc, new_bin = gc_glb(doc, bytes(buf))
    return build_glb(doc, new_bin)


# --------------------------------------------------------------------------------------------
# fps_arms.glb: pure-Python glb surgery on Superhero_Male.glb
# --------------------------------------------------------------------------------------------
ARM_JOINT_RE = re.compile(r"^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_", re.I)


def _compact_accessor(doc, buf, ai, kept):
    """Append a copy of accessor `ai` that only holds elements `kept` (old vertex indices); returns new accessor index."""
    acc = doc["accessors"][ai]
    base, stride, esz, _, _, _ = _layout(doc, acc)
    chunk = bytearray()
    for v in kept:
        o = base + v * stride
        chunk += buf[o:o + esz]
    new = {k: v for k, v in acc.items() if k not in ("bufferView", "byteOffset", "count", "min", "max", "sparse")}
    new["bufferView"] = _append_view(doc, buf, bytes(chunk))
    new["byteOffset"] = 0
    new["count"] = len(kept)
    if "min" in acc and acc["componentType"] == 5126 and kept:
        n = _NC[acc["type"]]
        floats = struct.unpack("<%df" % (n * len(kept)), bytes(chunk))
        new["min"] = [min(floats[c::n]) for c in range(n)]
        new["max"] = [max(floats[c::n]) for c in range(n)]
    doc["accessors"].append(new)
    return len(doc["accessors"]) - 1


def build_fps_arms(src):
    """Keep only the arm/hand triangles of the body mesh. Returns (glb_bytes, stats_dict)."""
    doc, binb = parse_glb(src)
    nodes, accs = doc["nodes"], doc["accessors"]
    if not doc.get("skins"):
        raise AssetError("source glb has no skin")
    skin = doc["skins"][0]
    joint_is_arm = [bool(ARM_JOINT_RE.match(nodes[i].get("name", ""))) for i in skin["joints"]]
    if not any(joint_is_arm):
        raise AssetError("no arm joints (upperarm_*/hand_*/...) found in skin")

    body = max(range(len(doc["meshes"])), key=lambda m: accs[doc["meshes"][m]["primitives"][0]["attributes"]["POSITION"]]["count"])
    prim = doc["meshes"][body]["primitives"][0]
    attrs = prim["attributes"]
    if "JOINTS_0" not in attrs or "WEIGHTS_0" not in attrs:
        raise AssetError("body mesh has no JOINTS_0/WEIGHTS_0")
    vcount = accs[attrs["POSITION"]]["count"]
    buf = bytearray(binb)

    arm_weight = [0.0] * vcount
    set_idx = 0
    while "JOINTS_%d" % set_idx in attrs and "WEIGHTS_%d" % set_idx in attrs:
        jacc, wacc = accs[attrs["JOINTS_%d" % set_idx]], accs[attrs["WEIGHTS_%d" % set_idx]]
        joints = _read_elements(doc, buf, jacc)
        weights = _read_elements(doc, buf, wacc)
        wmax = _CT[wacc["componentType"]][2]
        for v in range(vcount):
            for jn, w in zip(joints[v], weights[v]):
                if joint_is_arm[jn]:
                    arm_weight[v] += (w / wmax) if (wmax and wacc.get("normalized")) else float(w)
        set_idx += 1
    is_arm = [w >= 0.5 for w in arm_weight]

    if "indices" in prim:
        flat = [e[0] for e in _read_elements(doc, buf, accs[prim["indices"]])]
    else:
        flat = list(range(vcount))
    tris_before = len(flat) // 3
    tris = [flat[i:i + 3] for i in range(0, len(flat) - 2, 3) if is_arm[flat[i]] and is_arm[flat[i + 1]] and is_arm[flat[i + 2]]]
    if not tris:
        raise AssetError("no triangles left after arm filtering")
    kept = sorted({v for t in tris for v in t})
    vmap = {old: new for new, old in enumerate(kept)}

    new_attrs = {name: _compact_accessor(doc, buf, ai, kept) for name, ai in attrs.items()}
    idx = [vmap[v] for t in tris for v in t]
    ctype, pack = (5123, "<%dH") if len(kept) < 65535 else (5125, "<%dI")
    view = _append_view(doc, buf, struct.pack(pack % len(idx), *idx), target=34963)
    accs.append({"bufferView": view, "byteOffset": 0, "componentType": ctype, "count": len(idx), "type": "SCALAR"})
    prim["attributes"] = new_attrs
    prim["indices"] = len(accs) - 1
    prim.pop("targets", None)

    drop = [i for i, n in enumerate(nodes) if "mesh" in n and n["mesh"] != body]
    doc, new_bin = gc_glb(doc, bytes(buf), drop_nodes=drop)
    out = build_glb(doc, new_bin)
    validate_glb(out)
    stats = {"verts_before": vcount, "verts_after": len(kept), "tris_before": tris_before, "tris_after": len(tris),
             "bytes_before": len(src), "bytes_after": len(out)}
    return out, stats


BUILDERS = {"fps_arms": build_fps_arms}


# --------------------------------------------------------------------------------------------
# Networking
# --------------------------------------------------------------------------------------------
class Net:
    timeout = 60
    retries = 2


def http_get(url, headers=None):
    """GET with retries. Permanent HTTP errors (4xx) are not retried."""
    hdrs = {"User-Agent": UA, "Accept": "*/*"}
    hdrs.update(headers or {})
    last = None
    for attempt in range(Net.retries + 1):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=Net.timeout) as resp:
                data = resp.read(MAX_DOWNLOAD_BYTES + 1)
            if len(data) > MAX_DOWNLOAD_BYTES:
                raise AssetError("download larger than %d MB" % (MAX_DOWNLOAD_BYTES // (1024 * 1024)))
            return data
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code in (400, 401, 403, 404, 410):
                break
        except (urllib.error.URLError, OSError, ValueError) as exc:
            last = exc
        if attempt < Net.retries:
            time.sleep(1.5 * (attempt + 1))
    raise AssetError("download failed: %s" % (last,))


def resolve_url(url):
    """kenney:<slug> -> a fresh signed zip URL (kenney.nl issues short-lived links); other URLs unchanged."""
    if not url.startswith("kenney:"):
        return url, None
    slug = url[len("kenney:"):]
    hexid = ("assets/" + slug).encode("ascii").hex()
    referer = {"Referer": "https://kenney.nl/assets/" + slug}
    try:
        meta = json.loads(http_get("https://kenney.nl/download-link/" + hexid, referer).decode("utf-8"))
        return meta["url"], referer
    except (ValueError, KeyError) as exc:
        raise AssetError("kenney.nl download-link for %r returned no url (%s)" % (slug, exc))


_ZIP_CACHE = {}


def fetch_zip(url):
    """Download (once per run) the zip behind `url`; failures are cached too so a dead host is tried once."""
    if url not in _ZIP_CACHE:
        try:
            real, hdr = resolve_url(url)
            data = http_get(real, hdr)
            if not zipfile.is_zipfile(io.BytesIO(data)):
                raise AssetError("response is not a zip (%d bytes)" % len(data))
            _ZIP_CACHE[url] = data
        except AssetError as exc:
            _ZIP_CACHE[url] = exc
    cached = _ZIP_CACHE[url]
    if isinstance(cached, Exception):
        raise cached
    return cached


def _zip_find(z, member):
    names = z.namelist()
    if member in names:
        return member
    low = member.lower()
    hits = [n for n in names if n.lower() == low]
    if not hits:
        tail = "/" + low.split("/")[-1]
        hits = [n for n in names if n.lower().endswith(tail)]
    if len(hits) != 1:
        raise AssetError("zip member %r not found (%d candidates)" % (member, len(hits)))
    return hits[0]


def extract_member(zdata, member):
    """Return (bytes, reader) where reader(relative_uri) reads a sibling file from the same zip."""
    z = zipfile.ZipFile(io.BytesIO(zdata))
    name = _zip_find(z, member)

    def read_relative(uri):
        path = posixpath.normpath(posixpath.join(posixpath.dirname(name), urllib.parse.unquote(uri)))
        return z.read(_zip_find(z, path))

    return z.read(name), read_relative


def embed_external_images(data, read_relative):
    """Kenney glbs point at Textures/colormap.png; copy such images into the BIN chunk so the file is self-contained."""
    doc, binb = parse_glb(data)
    todo = [im for im in doc.get("images", []) if im.get("uri") and not im["uri"].startswith("data:")]
    if not todo:
        return data
    buf = bytearray(binb)
    for im in todo:
        blob = read_relative(im["uri"])
        if blob.startswith(b"\x89PNG\r\n\x1a\n"):
            im["mimeType"] = "image/png"
        elif blob.startswith(b"\xff\xd8\xff"):
            im["mimeType"] = "image/jpeg"
        else:
            raise AssetError("external image %r is not PNG/JPEG" % im["uri"])
        del im["uri"]
        im["bufferView"] = _append_view(doc, buf, blob, target=None)
    _align4(buf)
    doc["buffers"] = [{"byteLength": len(buf)}]
    return build_glb(doc, bytes(buf))


def set_default_scene(data):
    """Godot warns when a glb does not name its load-time scene; point it at scene 0."""
    doc, binb = parse_glb(data)
    if "scene" in doc or not doc.get("scenes"):
        return data
    doc["scene"] = 0
    return build_glb(doc, binb)


def normalize_glb(data, read_relative=None):
    """Make a downloaded glb importable by Godot 4.4: embed external images, dequantize, name the default scene."""
    if read_relative is not None:
        data = embed_external_images(data, read_relative)
    return set_default_scene(dequantize_glb(data))


# --------------------------------------------------------------------------------------------
# Pipeline
# --------------------------------------------------------------------------------------------
def dest_path(entry):
    return ASSETS_DIR.joinpath(*entry["dest"].split("/"))


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, str(path))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def disk_state(entry):
    """('ok', bytes) | ('missing', msg) | ('invalid', msg)."""
    path = dest_path(entry)
    if not path.is_file():
        return "missing", "not on disk"
    data = path.read_bytes()
    try:
        validate_bytes(entry["dest"], data)
    except AssetError as exc:
        return "invalid", str(exc)
    return "ok", data


def acquire(entry):
    """Try each mirror in order. Returns (bytes, url_used). Raises AssetError listing every mirror failure."""
    errors = []
    for url in entry["urls"]:
        try:
            reader = None
            if entry.get("zip_member"):
                data, reader = extract_member(fetch_zip(url), entry["zip_member"])
            else:
                data = http_get(resolve_url(url)[0])
            if entry["dest"].endswith(".glb"):
                data = normalize_glb(data, reader)
            validate_bytes(entry["dest"], data)
            return data, url
        except (AssetError, zipfile.BadZipFile, KeyError, struct.error) as exc:
            errors.append("%s -> %s" % (url, exc))
    raise AssetError("; ".join(errors) if errors else "no urls configured")


def fmt_size(n):
    return "%.1f MB" % (n / 1048576.0) if n >= 1048576 else "%.0f KB" % (n / 1024.0)


class Run:
    def __init__(self, force):
        self.force = force
        self.used_url = {}      # id -> url used this run
        self.written = set()
        self.failed = []
        self.stats = {}


def process_download(entry, run):
    state, info = disk_state(entry)
    if state == "ok" and not run.force:
        print("[skip] %-24s %s (valid on disk, %s)" % (entry["id"], entry["dest"], fmt_size(len(info))))
        return True
    try:
        data, url = acquire(entry)
    except AssetError as exc:
        print("[FAIL] %-24s %s\n         %s" % (entry["id"], entry["dest"], exc))
        run.failed.append(entry["id"])
        return False
    atomic_write(dest_path(entry), data)
    run.used_url[entry["id"]] = url
    run.written.add(entry["id"])
    print("[ ok ] %-24s %s (%s)" % (entry["id"], entry["dest"], fmt_size(len(data))))
    return True


def process_derived(entry, run):
    src = BY_ID[entry["derived_from"]]
    state, info = disk_state(src)
    if state != "ok":
        print("[FAIL] %-24s source %s is %s: %s" % (entry["id"], src["id"], state, info))
        run.failed.append(entry["id"])
        return False
    own_state, own_info = disk_state(entry)
    if own_state == "ok" and not run.force and src["id"] not in run.written:
        print("[skip] %-24s %s (valid on disk, %s)" % (entry["id"], entry["dest"], fmt_size(len(own_info))))
        return True
    try:
        data, stats = BUILDERS[entry["builder"]](info)
        validate_bytes(entry["dest"], data)
    except (AssetError, KeyError, IndexError, struct.error) as exc:
        print("[FAIL] %-24s derive from %s failed: %s" % (entry["id"], src["id"], exc))
        run.failed.append(entry["id"])
        return False
    atomic_write(dest_path(entry), data)
    run.written.add(entry["id"])
    run.stats[entry["id"]] = stats
    print("[ ok ] %-24s %s (%s) derived: %d -> %d tris, %d -> %d verts"
          % (entry["id"], entry["dest"], fmt_size(len(data)), stats["tris_before"], stats["tris_after"],
             stats["verts_before"], stats["verts_after"]))
    return True


def sha256_file(path):
    h = hashlib.sha256()
    with open(str(path), "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_previous_urls():
    try:
        with open(str(MANIFEST_PATH), "r", encoding="utf-8") as fh:
            return {a["id"]: a.get("url") for a in json.load(fh).get("assets", [])}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def write_if_changed(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if path.read_text(encoding="utf-8") == text:
            return
    except OSError:
        pass
    atomic_write(path, text.encode("utf-8"))


def write_reports(run):
    prev = load_previous_urls()
    records = []
    for e in MANIFEST:
        state, _ = disk_state(e)
        if state != "ok":
            continue
        p = dest_path(e)
        rec = {
            "id": e["id"],
            "category": e["category"],
            "dest": "res://assets/" + e["dest"],
            "bytes": p.stat().st_size,
            "sha256": sha256_file(p),
            "url": run.used_url.get(e["id"]) or prev.get(e["id"]) or (e["urls"][0] if e["urls"] else None),
            "license": e["license"],
            "author": e["author"],
            "source": e["source"],
        }
        if e.get("zip_member"):
            rec["zip_member"] = e["zip_member"]
        if e.get("derived_from"):
            rec["derived_from"] = e["derived_from"]
        if e.get("notes"):
            rec["notes"] = e["notes"]
        records.append(rec)
    doc = {"tool": TOOL_NAME, "license_note": "All entries are CC0 1.0 Universal (public domain dedication).", "assets": records}
    write_if_changed(MANIFEST_PATH, json.dumps(doc, indent=2) + "\n")

    titles = {"characters": "Characters (Quaternius Universal Base Characters)", "hands": "First-person hands (derived)",
              "gym": "Gym props", "street": "Street props", "textures": "Textures"}
    lines = [
        "# Asset credits",
        "",
        "Every file under `assets/models/` and `assets/textures/` listed here is released under",
        "**CC0 1.0 Universal** (public domain dedication, https://creativecommons.org/publicdomain/zero/1.0/).",
        "No attribution is required; the credits below are a courtesy and a provenance record.",
        "",
        "This file and `assets/models/manifest.json` (ids, sha256, exact download URLs) are generated by",
        "`tools/fetch_assets.py`. To fetch / refresh the assets:",
        "",
        "```",
        "python tools/fetch_assets.py            # download what is missing, validate, rebuild reports",
        "python tools/fetch_assets.py --force    # re-download everything",
        "python tools/fetch_assets.py --check    # validate files on disk, no network",
        "python tools/fetch_assets.py --only gym,street",
        "```",
        "",
        "3dassets.dev models ship with KHR_mesh_quantization; the tool converts them to plain float vertex",
        "data so Godot 4.4 can import them. Kenney glbs reference an external `colormap.png`; the tool",
        "embeds it so every model is a single self-contained file. `models/hands/fps_arms.glb` is derived from",
        "`models/characters/superhero_male.glb` (CC0): body mesh reduced to the arm and hand triangles.",
        "",
    ]
    by_cat = {c: [r for r in records if r["category"] == c] for c in CATEGORIES}
    for cat in CATEGORIES:
        rows = by_cat[cat]
        if not rows:
            continue
        lines += ["## " + titles[cat], "", "| Asset | File | Author | License | Source |", "|---|---|---|---|---|"]
        for r in rows:
            e = BY_ID[r["id"]]
            note = (e["notes"].split(". ")[0].rstrip(".") if e.get("notes") else r["id"]).replace("|", "/")
            lines.append("| %s | `%s` | %s | %s | %s |" % (note, r["dest"][len("res://assets/"):], r["author"], r["license"], r["source"]))
        lines.append("")
    write_if_changed(CREDITS_PATH, "\n".join(lines))


# --------------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------------
def select(only):
    if not only:
        return list(MANIFEST)
    wanted = [c.strip() for c in only.split(",") if c.strip()]
    bad = [c for c in wanted if c not in CATEGORIES]
    if bad:
        raise SystemExit("unknown category %s (choose from %s)" % (", ".join(bad), ", ".join(CATEGORIES)))
    return [e for e in MANIFEST if e["category"] in wanted]


def cmd_list(entries):
    for e in entries:
        src = e["urls"][0] if e["urls"] else "(derived from %s)" % e["derived_from"]
        print("%-26s %-10s %-44s %s" % (e["id"], e["category"], e["dest"], src))
    print("%d entries" % len(entries))
    return 0


def cmd_check(entries):
    bad = 0
    for e in entries:
        state, info = disk_state(e)
        if state == "ok":
            print("[ ok ] %-26s %s (%s)" % (e["id"], e["dest"], fmt_size(len(info))))
        else:
            bad += 1
            print("[%s] %-26s %s: %s" % ("MISS" if state == "missing" else "BAD ", e["id"], e["dest"], info))
    print("%d ok, %d missing/invalid" % (len(entries) - bad, bad))
    return 1 if bad else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Fetch, validate and credit the CC0 assets used by Iron Temple.")
    ap.add_argument("--force", action="store_true", help="re-download / rebuild even if a valid file exists")
    ap.add_argument("--check", action="store_true", help="only validate files on disk (no network)")
    ap.add_argument("--only", metavar="CATEGORY[,CATEGORY]", help="limit to: " + ", ".join(CATEGORIES))
    ap.add_argument("--list", action="store_true", help="print the manifest and exit")
    ap.add_argument("--timeout", type=int, default=60, help="per-request timeout in seconds (default 60)")
    ap.add_argument("--retries", type=int, default=2, help="retries per URL after the first attempt (default 2)")
    args = ap.parse_args(argv)
    Net.timeout, Net.retries = args.timeout, args.retries

    entries = select(args.only)
    if args.list:
        return cmd_list(entries)
    if args.check:
        return cmd_check(entries)

    for folder in FOLDERS:
        (ASSETS_DIR / folder).mkdir(parents=True, exist_ok=True)

    run = Run(args.force)
    plain = [e for e in entries if not e.get("derived_from")]
    derived = [e for e in entries if e.get("derived_from")]
    needed_sources = {e["derived_from"] for e in derived} - {e["id"] for e in plain}
    for e in plain + [BY_ID[i] for i in sorted(needed_sources)]:
        process_download(e, run)
    for e in derived:
        process_derived(e, run)

    write_reports(run)
    total = len(entries)
    print("\n%d/%d entries ok%s. Manifest: %s" % (total - len(run.failed), total,
          (", FAILED: " + ", ".join(run.failed)) if run.failed else "",
          "assets/models/manifest.json"))
    if run.failed:
        print("Failed entries are optional: the game falls back to procedural meshes for them.")
    return 1 if run.failed else 0


if __name__ == "__main__":
    sys.exit(main())
