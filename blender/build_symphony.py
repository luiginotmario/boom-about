"""
Symphony internals, built in Blender for the nacelle cutaway.

    blender -b --factory-startup -P blender/build_symphony.py

Writes models/symphony.glb. Authored in the engine's local frame used by src/world/symphony.js
(intake at x = 0, axis +X, 8.6 long, core radius ~0.4); the page scales it into the nacelle
(x × 11/8.6, radius × 0.74/0.72), so blade chords are pre-shrunk axially to land true.

Rotating parts are split by spool (fan / booster / lpt / shaft on the LP spool, hpc / hpt on
the HP spool) so the page can spin them; everything else is static. Ambient occlusion is baked
into a vertex colour: hundreds of small blades bake far better per-vertex than into a texture.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import COLL, MeshBuilder, grid_uv_faces, lathe, join, use_gpu

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'models', 'symphony.glb')
FAST = '--fast' in sys.argv

SX, SR = 11.0 / 8.6, 0.74 / 0.72
KX = SX / SR           # axial pre-shrink so blades keep their true proportions once scaled

for o in list(bpy.data.objects): bpy.data.objects.remove(o)

# ── blades ──────────────────────────────────────────────────────────────
def airfoil(c, stagger, camber, tmax, n):
    """Closed loop of (axial, tangential) points: cambered NACA-style section, stagger in radians."""
    us = [0.5 - 0.5 * math.cos(math.pi * i / n) for i in range(n + 1)]
    def pt(u, side):
        yt = 5 * tmax * c * (0.2969 * math.sqrt(u) - 0.126 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4)
        yc = camber * c * 4 * u * (1 - u)
        s, nrm = (u - 0.5) * c, yc + side * yt
        ax = s * math.cos(stagger) - nrm * math.sin(stagger)
        tg = s * math.sin(stagger) + nrm * math.cos(stagger)
        return (ax / KX, tg)
    upper = [pt(u, 1) for u in us]
    lower = [pt(u, -1) for u in reversed(us[1:-1])]
    return upper + lower

def blade_row(mb, *, x, count, hub, tip, chord, stagger, camber=0.06, tmax=0.06, ns=4, n=6, phase=0.0, sweep=0.0):
    """
    count blades around the axis at station x. chord / stagger / tmax may be (root, tip) pairs.
    Blade radial axis along +Y at angle 0, tangential along +Z; copies rotate about +X.
    """
    pair = lambda v: v if isinstance(v, tuple) else (v, v)
    ch, st, tm = pair(chord), pair(stagger), pair(tmax)
    sections = []
    for k in range(ns + 1):
        f = k / ns
        r = hub - 0.01 + (tip - hub + 0.01) * f
        loop = airfoil(ch[0] + (ch[1] - ch[0]) * f, math.radians(st[0] + (st[1] - st[0]) * f),
                       camber * (1 - 0.5 * f), tm[0] + (tm[1] - tm[0]) * f, n)
        sections.append([(x + ax + sweep * f, r, tg) for ax, tg in loop])
    for b in range(count):
        a = phase + 2 * math.pi * b / count
        ca, sa = math.cos(a), math.sin(a)
        rows = []
        for sec in sections:
            rows.append([mb.v((px, r * ca - t * sa, r * sa + t * ca)) for px, r, t in sec])
        L = len(rows[0])
        for k in range(len(rows) - 1):
            for j in range(L):
                j2 = (j + 1) % L
                mb.f([rows[k][j], rows[k][j2], rows[k + 1][j2], rows[k + 1][j]])
        mb.f(list(reversed(rows[-1])))          # tip cap

def blades(name, rows, sharp=50):
    mb = MeshBuilder()
    for r in rows: blade_row(mb, **r)
    ob = mb.build(name, sharp_deg=sharp)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free()
    return ob

def ring_profile(name, profile, seg=96, outward=True, sharp=40):
    return lathe(name, [(r, x) for r, x in profile], seg=seg, outward=outward, sharp=sharp)

# ── LP spool: spinner + fan, booster, low-pressure turbine, shaft ───────
fan_blades = blades('fan_blades', [dict(
    x=1.08, count=20, hub=0.17, tip=0.57, chord=(0.30, 0.25), stagger=(22, 62), camber=0.08,
    tmax=(0.075, 0.03), ns=12, n=14, sweep=0.03)], sharp=60)
spinner = ring_profile('spinner', [(0.0, 0.66), (0.05, 0.7), (0.1, 0.78), (0.15, 0.89), (0.18, 0.98),
                                    (0.19, 1.2), (0.2, 1.32), (0.2, 1.42), (0.0, 1.45)], seg=96, sharp=70)
fan = join([fan_blades, spinner], 'fan')

booster = join([
    blades('booster_blades', [dict(x=x, count=30, hub=0.2, tip=0.38, chord=0.1, stagger=(35, 50), tmax=0.07)
                              for x in (1.6, 1.85)]),
    ring_profile('booster_drum', [(0.2, 1.42), (0.205, 1.55), (0.205, 1.95), (0.2, 2.05)], outward=True),
], 'booster')

lpt = join([
    blades('lpt_blades', [dict(x=x, count=c, hub=0.22, tip=t, chord=0.1, stagger=(-38, -52), camber=0.14, tmax=0.09)
                          for x, c, t in ((4.85, 44, 0.36), (5.15, 46, 0.39), (5.45, 48, 0.42))]),
    ring_profile('lpt_drum', [(0.2, 4.72), (0.22, 4.78), (0.22, 5.55), (0.2, 5.6)]),
], 'lpt')

shaft = ring_profile('shaft', [(0.0, 1.0), (0.05, 1.02), (0.05, 5.95), (0.0, 6.0)], seg=24)

# ── HP spool: six-stage compressor, one-stage turbine ───────────────────
hpc_rows = []
for i in range(6):
    k = i / 5
    hpc_rows.append(dict(x=2.2 + i * 0.24, count=36 + 2 * i, hub=0.2 - 0.03 * k, tip=0.36 - 0.11 * k,
                         chord=0.08, stagger=(34, 48), tmax=0.05, phase=0.05 * i))
hpc = join([
    blades('hpc_blades', hpc_rows),
    # compressor drum: disks bolted into one rotor, stepping in with the flowpath
    ring_profile('hpc_drum', [(0.19, 2.08), (0.2, 2.12)] + [(0.2 - 0.03 * (i / 5), 2.2 + i * 0.24) for i in range(6)] +
                 [(0.17, 3.48), (0.12, 3.56), (0.12, 4.36), (0.18, 4.4), (0.21, 4.42), (0.21, 4.5), (0.12, 4.56)]),
], 'hpc')
hpt = blades('hpt', [dict(x=4.45, count=42, hub=0.21, tip=0.31, chord=0.09, stagger=(-44, -54), camber=0.16, tmax=0.11)])

# ── static: vanes, casing, combustor, centre body ───────────────────────
stator_rows = [dict(x=1.55, count=40, hub=0.44, tip=0.6, chord=0.12, stagger=(4, 10), camber=0.06, tmax=0.05, n=7)]  # fan exit guide vanes
stator_rows += [dict(x=x, count=34, hub=0.2, tip=0.39, chord=0.08, stagger=(-20, -28), tmax=0.06) for x in (1.73, 1.98)]
for i in range(6):
    k = i / 5
    stator_rows.append(dict(x=2.2 + i * 0.24 + 0.12, count=40 + 2 * i, hub=0.2 - 0.03 * k, tip=0.36 - 0.11 * k - 0.005,
                            chord=0.07, stagger=(-22, -30), tmax=0.05, phase=0.03))
stators = blades('stators', stator_rows)
ngv = blades('ngv', [dict(x=4.3, count=32, hub=0.21, tip=0.32, chord=0.1, stagger=(40, 44), camber=0.18, tmax=0.14)] +
             [dict(x=x, count=c, hub=0.22, tip=t, chord=0.09, stagger=(34, 42), camber=0.15, tmax=0.1)
              for x, c, t in ((4.7, 36, 0.36), (5.0, 38, 0.39), (5.3, 40, 0.42))])

# Core casing as one closed shell of revolution: the inner flowpath shroud (stepping in over the
# compressor, out over the combustor and turbines), the splitter lip, and the smooth outer cowl.
casing_shell = ring_profile('casing_shell', [
    (0.43, 5.78), (0.43, 5.5), (0.40, 5.15), (0.37, 4.85), (0.33, 4.55), (0.325, 4.3), (0.36, 4.2), (0.365, 3.7),
    (0.28, 3.56), (0.265, 3.42), (0.37, 2.18), (0.395, 2.02), (0.395, 1.5), (0.4, 1.4),
    (0.408, 1.36), (0.418, 1.35), (0.43, 1.37), (0.44, 1.45), (0.448, 1.7), (0.452, 2.3), (0.455, 5.0),
    (0.452, 5.6), (0.44, 5.8), (0.43, 5.78),
], seg=128, sharp=35)
flanges, bolts = [], []
for x in (2.1, 3.58, 4.35, 5.25):
    flanges.append(ring_profile(f'flange{x}', [(0.45, x - 0.018), (0.474, x - 0.016), (0.476, x), (0.474, x + 0.016), (0.45, x + 0.018)], seg=128, sharp=60))
    for b in range(48):
        a = 2 * math.pi * b / 48
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.007, depth=0.012,
                                            location=(x, -math.sin(a) * 0.48, math.cos(a) * 0.48),
                                            rotation=(a, 0, 0))
        ob = bpy.context.active_object
        for c in ob.users_collection: c.objects.unlink(ob)
        COLL.objects.link(ob)
        bolts.append(ob)
casing = join([casing_shell] + flanges + bolts, 'casing')

# Annular combustor: outer and inner liners, and a dome with eighteen fuel-nozzle swirl cups.
liner_outer = ring_profile('liner_outer', [(0.335, 3.64), (0.345, 3.8), (0.34, 4.1), (0.32, 4.26)], seg=96, outward=False)
liner_inner = ring_profile('liner_inner', [(0.235, 3.64), (0.228, 3.8), (0.23, 4.1), (0.235, 4.26)], seg=96)
combustor = join([liner_outer, liner_inner], 'combustor')

dome_parts = [ring_profile('dome', [(0.235, 3.64), (0.25, 3.6), (0.285, 3.585), (0.32, 3.6), (0.335, 3.64)], seg=96, sharp=70),
              ring_profile('diffuser', [(0.17, 3.48), (0.2, 3.56), (0.22, 3.64), (0.23, 4.26), (0.21, 4.3)], seg=96)]
for b in range(18):
    a = 2 * math.pi * b / 18
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.022, depth=0.07,
                                        location=(3.6, -math.sin(a) * 0.285, math.cos(a) * 0.285), rotation=(0, math.pi / 2, 0))
    ob = bpy.context.active_object
    for c in ob.users_collection: c.objects.unlink(ob)
    COLL.objects.link(ob)
    dome_parts.append(ob)
dome = join(dome_parts, 'dome')

centerbody = ring_profile('centerbody', [(0.0, 5.56), (0.2, 5.58), (0.22, 5.62), (0.24, 6.2), (0.27, 6.9), (0.288, 7.27), (0.0, 7.3)], seg=96)

exported = [fan, booster, lpt, shaft, hpc, hpt, stators, ngv, casing, combustor, dome, centerbody]
for ob in exported:
    for p in ob.data.polygons: p.use_smooth = True

# ── AO baked to a vertex colour ─────────────────────────────────────────
if not FAST:
    scene = bpy.context.scene
    use_gpu(scene, samples=192)
    scene.world.light_settings.distance = 0.12          # contact-scale AO: blade roots, disk rims, vane rows
    for ob in exported:
        me = ob.data
        ca = me.color_attributes.new(name='AO', type='FLOAT_COLOR', domain='POINT')
        me.color_attributes.active_color = ca
        mat = bpy.data.materials.new(f'bake_{ob.name}')
        mat.use_nodes = True
        me.materials.clear(); me.materials.append(mat)
    # The casing is cut open on the page, so it must not darken what it encloses:
    # bake the hardware with the casing hidden, then the casing on its own.
    def bake(objs):
        bpy.ops.object.select_all(action='DESELECT')
        for ob in objs: ob.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    print('baking AO to vertex colours …', flush=True)
    casing.hide_render = True
    bake([o for o in exported if o is not casing])
    casing.hide_render = False
    bake([casing])
    for ob in exported: ob.data.materials.clear()

bpy.ops.object.select_all(action='DESELECT')
for ob in exported: ob.select_set(True)
kw = dict(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_normals=True,
          export_texcoords=False, export_materials='NONE', export_apply=True)
try:
    bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
except TypeError:
    bpy.ops.export_scene.gltf(**kw, export_colors=True)
print('done', flush=True)
