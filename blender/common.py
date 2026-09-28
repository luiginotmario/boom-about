"""Shared mesh plumbing for the Blender build scripts (page coordinates in, Blender out)."""
import bpy, bmesh, math
from mathutils import Vector

# ── mesh plumbing ───────────────────────────────────────────────────────
def to_bl(p):
    """three.js (x, y, z) → Blender (x, -z, y)."""
    return (p[0], -p[2], p[1])

COLL = bpy.data.collections.new('build')
bpy.context.scene.collection.children.link(COLL)

class MeshBuilder:
    def __init__(self):
        self.verts, self.faces, self.uvs = [], [], []
    def v(self, p):
        self.verts.append(to_bl(p))
        return len(self.verts) - 1
    def f(self, idx, uv=None):
        uv = uv or [(0.5, 0.5)] * len(idx)
        keep = [k for k in range(len(idx)) if idx[k] != idx[k - 1]]   # collapse repeated corners (tips)
        idx, uv = [idx[k] for k in keep], [uv[k] for k in keep]
        if len(set(idx)) < 3 or len(set(idx)) != len(idx): return
        self.faces.append(idx)
        self.uvs.append(uv)
    def build(self, name, sharp_deg=40, flip_outward=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.update()
        uvl = me.uv_layers.new(name='UVMap')
        for poly, uvs in zip(me.polygons, self.uvs):
            for li, uv in zip(poly.loop_indices, uvs):
                uvl.data[li].uv = uv
        ob = bpy.data.objects.new(name, me)
        COLL.objects.link(ob)
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        if flip_outward is not None:
            # flip_outward(center, normal) → True if the face points the wrong way (majority vote)
            wrong = sum(1 for fc in bm.faces if flip_outward(fc.calc_center_median(), fc.normal))
            if wrong > len(bm.faces) / 2:
                bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
        for p in me.polygons: p.use_smooth = True
        me.set_sharp_from_angle(angle=math.radians(sharp_deg))
        return ob

def grid_uv_faces(mb, rows, uvrows, flip=False):
    """Quads between consecutive rows of vertex indices (rows[i][j]) with matching UVs."""
    for i in range(len(rows) - 1):
        for j in range(len(rows[i]) - 1):
            a, b, c, d = rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]
            ua, ub, uc, ud = uvrows[i][j], uvrows[i + 1][j], uvrows[i + 1][j + 1], uvrows[i][j + 1]
            if flip: mb.f([a, d, c, b], [ua, ud, uc, ub])
            else: mb.f([a, b, c, d], [ua, ub, uc, ud])

def lathe(name, profile, seg=128, outward=True, sharp=35):
    """profile: [(radius, x)] in nacelle-local coords (axis +X, intake at x = 0)."""
    mb = MeshBuilder()
    rows, uvrows = [], []
    for k, (r, x) in enumerate(profile):
        if r < 1e-6:
            c = mb.v((x, 0.0, 0.0)); rows.append([c] * (seg + 1))
        else:
            ring = [mb.v((x, r * math.sin(a), r * math.cos(a))) for a in (j / seg * 2 * math.pi for j in range(seg))]
            rows.append(ring + [ring[0]])
        uvrows.append([(j / seg, k / max(1, len(profile) - 1)) for j in range(seg + 1)])
    grid_uv_faces(mb, rows, uvrows)
    def wrong(c, n):
        radial = Vector((0.0, c.y, c.z))
        return (n.dot(radial) < 0) == outward if radial.length > 1e-4 else False
    return mb.build(name, sharp_deg=sharp, flip_outward=wrong)

def join(objs, name):
    objs = [o for o in objs if o]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    return ob


def use_gpu(scene, samples=256):
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices: d.use = True
        scene.cycles.device = 'GPU'
    except Exception as ex:
        print('GPU unavailable, baking on CPU:', ex)
    scene.cycles.samples = samples
    if scene.world is None: scene.world = bpy.data.worlds.new('World')
