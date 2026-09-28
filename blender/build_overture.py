"""
Overture airframe, built in Blender from the page's own mould lines (src/world/shape.js).

    blender -b --factory-startup -P blender/build_overture.py

Writes models/overture.glb and models/ao/*.jpg. Geometry is authored in the page's
coordinates (three.js: metres, Y up, nose toward -X, left side toward +Z) and converted to
Blender's Z-up on the way in, so the exported glTF lands back in the page's space exactly.

UV0 keeps the page's conventions, so the canvas-painted livery, the wing panel map and the
analytic window shader all carry over untouched. UV1 is a lightmap unwrap for baked AO.
Left-side parts only: the page mirrors them for the right side.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'models')
AO_DIR = os.path.join(OUT_DIR, 'ao')
os.makedirs(AO_DIR, exist_ok=True)
FAST = '--fast' in sys.argv          # quick geometry check: skip the bake

# ── shape.js, ported ────────────────────────────────────────────────────
NOSE, TAIL = -30.5, 30.5
LENGTH = TAIL - NOSE
R, SY = 1.55, 1.05
CABIN_START, CABIN_END = -12.0, 10.0
TAIL_TOP, TAIL_BOTTOM = 0.5, 0.4

def smooth(a, b, v):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)

def tailS(x): return (x - CABIN_END) / (TAIL - CABIN_END)
def tailTop(s): return R * SY - (R * SY - TAIL_TOP) * s ** 1.4
def tailBottom(s): return -R * SY + (R * SY + TAIL_BOTTOM) * s ** 1.25

def radiusAt(x):
    if x < CABIN_START:
        s = (x - NOSE) / (CABIN_START - NOSE)
        return R * max(0.0, math.sin(s * math.pi / 2)) ** 0.95
    if x > CABIN_END:
        return R * (1 - 0.8 * tailS(x) ** 1.5)
    return R * (1 - 0.035 * smooth(-2, 6, x) * (1 - smooth(6, 10, x)))

def halfHeightAt(x):
    if x > CABIN_END:
        s = tailS(x)
        return (tailTop(s) - tailBottom(s)) / 2
    return radiusAt(x) * SY

def centerYAt(x):
    if x < CABIN_START:
        s = (x - NOSE) / (CABIN_START - NOSE)
        return -0.34 * (1 - s) * (1 - s)
    if x > CABIN_END:
        s = tailS(x)
        return (tailTop(s) + tailBottom(s)) / 2
    return 0.0

WING_LE = [[0.9, -13.5], [1.6, -10.0], [2.6, -6.2], [4.0, -2.4], [5.8, 1.6], [7.8, 5.2], [16.2, 19.6]]
WING_TE = [[0.9, 23.6], [3.2, 22.0], [5.4, 21.3], [16.2, 21.7]]
WING_ROOT, WING_TIP, WING_T0, WING_T1 = 0.9, 16.2, 0.66, 0.05

def piecewise(pts, z):
    if z <= pts[0][0]: return pts[0][1]
    for (z0, v0), (z1, v1) in zip(pts, pts[1:]):
        if z <= z1: return v0 + (z - z0) / (z1 - z0) * (v1 - v0)
    return pts[-1][1]

def wingYAt(z):
    return -1.22 - 0.05 * min(max(z - 1.3, 0), 4.6) + 0.035 * max(z - 5.9, 0)

def biconvex(tm, u):
    return (tm / 2) * max(0.0, 1 - (2 * u - 1) ** 2) ** 0.7

def wingHalf(z, u):
    w = (z - WING_ROOT) / (WING_TIP - WING_ROOT)
    return biconvex(WING_T0 + (WING_T1 - WING_T0) * w, u)

def wingU(x, z):
    le, te = piecewise(WING_LE, z), piecewise(WING_TE, z)
    return min(1.0, max(0.0, (x - le) / (te - le)))

def wingUpperY(x, z): return wingYAt(z) + wingHalf(z, wingU(x, z)) + TE_T * wingU(x, z)
def wingLowerY(x, z): return wingYAt(z) - wingHalf(z, wingU(x, z)) - TE_T * wingU(x, z)

NAC_L, NAC_R = 11.0, 0.74
TE_T = 0.004  # trailing edges are blunt, a few millimetres thick, like the real thing

def _engine(z, x0):
    lowest = min(wingYAt(z) - wingHalf(z, wingU(x0 + i * 0.25, z)) for i in range(int(NAC_L / 0.25) + 1))
    return dict(z=z, x0=x0, y=lowest - NAC_R - 0.05)
ENGINES = [_engine(5.0, 7.8), _engine(8.6, 9.6)]

# ── mesh plumbing ───────────────────────────────────────────────────────
def to_bl(p):
    """three.js (x, y, z) → Blender (x, -z, y)."""
    return (p[0], -p[2], p[1])

COLL = bpy.data.collections.new('overture')
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

# ── fuselage ────────────────────────────────────────────────────────────
RADIAL = 192

def fuselage_section(name, x0, x1, seg):
    mb = MeshBuilder()
    rows, uvrows = [], []
    for i in range(seg + 1):
        s = i / seg
        x = x0 + (x1 - x0) * (1 - (1 - s) ** 1.6 if x0 == NOSE else s)
        r, hh, yc = radiusAt(x), halfHeightAt(x), centerYAt(x)
        u = (x - NOSE) / LENGTH
        if r < 1e-6:                                   # the nose tip: one vertex
            tip = mb.v((x, yc, 0.0))
            rows.append([tip] * (RADIAL + 1))
        else:
            ring = [mb.v((x, yc + hh * math.sin(th), r * math.cos(th)))
                    for th in (j / RADIAL * 2 * math.pi - math.pi / 2 for j in range(RADIAL))]
            rows.append(ring + [ring[0]])             # welded ring, UV seam at the belly
        uvrows.append([(u, j / RADIAL) for j in range(RADIAL + 1)])
    grid_uv_faces(mb, rows, uvrows)
    if x1 == TAIL:                                     # close the blade at the tail tip
        ring = rows[-1][:-1]
        mb.f(ring, [(1.0, j / RADIAL) for j in range(RADIAL)])
    def wrong(c, n):
        axis = Vector((c.x, 0.0, centerYAt(c.x)))      # Blender coords: y = -z3, z = y3
        return n.dot(c - axis) < 0
    return mb.build(name, sharp_deg=60, flip_outward=wrong)

# ── lifting surfaces ────────────────────────────────────────────────────
def cosine_ticks(n, extra=()):
    ts = {round(0.5 - 0.5 * math.cos(math.pi * i / n), 6) for i in range(n + 1)}
    ts |= {round(e, 6) for e in extra}
    return sorted(ts)

def lin_ticks(n, extra=()):
    ts = {round(i / n, 6) for i in range(n + 1)} | {round(e, 6) for e in extra}
    return sorted(ts)

def lifting_surface(name, *, frame, le, te, z0, z1, t0, t1, yAt, u_ticks, w_ticks,
                    hole=None, uv=None, u_range=(0.0, 1.0), w_range=(0.0, 1.0), caps=('tip',)):
    """
    A closed wing-like solid. frame(x, y, zspan) → three.js point. hole = (u0, w0, w1): a
    rectangular cut-out running from chord fraction u0 to the trailing edge, closed with
    faces where the control surface sits. caps: 'tip' (outboard end), 'root', 'le' (for
    control surfaces, whose leading edge is a hinge face rather than a knife edge).
    """
    mb = MeshBuilder()
    U = [t for t in u_ticks if u_range[0] - 1e-9 <= t <= u_range[1] + 1e-9]
    Wt = [t for t in w_ticks if w_range[0] - 1e-9 <= t <= w_range[1] + 1e-9]
    uvf = uv or (lambda u, w, p: (u, w))
    top, bot, uvt, uvb = [], [], [], []
    for w in Wt:
        z = z0 + (z1 - z0) * w
        xl, xt = piecewise(le, z), piecewise(te, z)
        tm = t0 + (t1 - t0) * w
        rt, rb, ut, ub = [], [], [], []
        for u in U:
            half = biconvex(tm, u) + TE_T * u
            x = xl + (xt - xl) * u
            pt, pb = frame(x, yAt(z) + half, z), frame(x, yAt(z) - half, z)
            it = mb.v(pt)
            ib = it if half < 1e-7 else mb.v(pb)        # knife leading edge: shared vertex
            rt.append(it); rb.append(ib)
            ut.append(uvf(u, w, pt)); ub.append(uvf(u, w, pb))
        top.append(rt); bot.append(rb); uvt.append(ut); uvb.append(ub)
    nW, nU = len(Wt), len(U)
    in_hole = lambda iw, iu: hole and U[iu] >= hole[0] - 1e-9 and Wt[iw] >= hole[1] - 1e-9 and Wt[iw + 1] <= hole[2] + 1e-9
    for iw in range(nW - 1):
        for iu in range(nU - 1):
            if in_hole(iw, iu): continue
            a, b, c, d = top[iw][iu], top[iw + 1][iu], top[iw + 1][iu + 1], top[iw][iu + 1]
            mb.f([a, b, c, d], [uvt[iw][iu], uvt[iw + 1][iu], uvt[iw + 1][iu + 1], uvt[iw][iu + 1]])
            a, b, c, d = bot[iw][iu], bot[iw + 1][iu], bot[iw + 1][iu + 1], bot[iw][iu + 1]
            mb.f([a, d, c, b], [uvb[iw][iu], uvb[iw][iu + 1], uvb[iw + 1][iu + 1], uvb[iw + 1][iu]])
    def strip(ts, bs, uts, ubs, rev=False):
        for k in range(len(ts) - 1):
            q = [ts[k], ts[k + 1], bs[k + 1], bs[k]]
            quv = [uts[k], uts[k + 1], ubs[k + 1], ubs[k]]
            if rev: q, quv = q[::-1], quv[::-1]
            mb.f(q, quv)
    # trailing edge (blunt) — skipped along the cut-out
    iu = nU - 1
    for iw in range(nW - 1):
        if hole and Wt[iw] >= hole[1] - 1e-9 and Wt[iw + 1] <= hole[2] + 1e-9: continue
        mb.f([top[iw][iu], bot[iw][iu], bot[iw + 1][iu], top[iw + 1][iu]],
             [uvt[iw][iu], uvb[iw][iu], uvb[iw + 1][iu], uvt[iw + 1][iu]])
    if hole:
        ih = U.index(min(U, key=lambda t: abs(t - hole[0])))
        iwa = Wt.index(min(Wt, key=lambda t: abs(t - hole[1])))
        iwb = Wt.index(min(Wt, key=lambda t: abs(t - hole[2])))
        # hinge face along the cut, and the two side walls
        strip([top[iw][ih] for iw in range(iwa, iwb + 1)], [bot[iw][ih] for iw in range(iwa, iwb + 1)],
              [uvt[iw][ih] for iw in range(iwa, iwb + 1)], [uvb[iw][ih] for iw in range(iwa, iwb + 1)])
        strip(top[iwa][ih:], bot[iwa][ih:], uvt[iwa][ih:], uvb[iwa][ih:], rev=True)
        strip(top[iwb][ih:], bot[iwb][ih:], uvt[iwb][ih:], uvb[iwb][ih:])
    if 'le' in caps:
        strip([top[iw][0] for iw in range(nW)], [bot[iw][0] for iw in range(nW)],
              [uvt[iw][0] for iw in range(nW)], [uvb[iw][0] for iw in range(nW)], rev=True)
    for which, iw in (('tip', nW - 1), ('root', 0)):
        if which not in caps: continue
        ring = top[iw] + bot[iw][::-1][1:-1] if top[iw][0] == bot[iw][0] else top[iw] + bot[iw][::-1]
        ringuv = uvt[iw] + uvb[iw][::-1][1:-1] if top[iw][0] == bot[iw][0] else uvt[iw] + uvb[iw][::-1]
        mb.f(ring, ringuv)
    ob = mb.build(name, sharp_deg=38)
    # recompute a consistent outward orientation for the closed-ish solid
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free()
    ob.data.set_sharp_from_angle(angle=math.radians(38))
    return ob

wing_frame = lambda x, y, z: (x, y, z)
fin_frame = lambda x, y, z: (x, z, -y)          # built flat, stood up: span → +Y

ELEVON_BREAKS = [0.2, 0.46, 0.72, 0.97]
HINGE_U = 0.815                      # wing ends here; elevons start a finger-width aft
SPAN = WING_TIP - WING_ROOT
GAP_W = 0.035 / SPAN                 # 3.5 cm gaps between elevons

def build_wing():
    u_ticks = cosine_ticks(64, extra=[HINGE_U, HINGE_U + 0.012])
    w_ticks = lin_ticks(110, extra=ELEVON_BREAKS + [b + s * GAP_W for b in ELEVON_BREAKS for s in (-1, 1)])
    wing = lifting_surface('wing', frame=wing_frame, le=WING_LE, te=WING_TE, z0=WING_ROOT, z1=WING_TIP,
                           t0=WING_T0, t1=WING_T1, yAt=wingYAt, u_ticks=u_ticks, w_ticks=w_ticks,
                           hole=(HINGE_U, ELEVON_BREAKS[0], ELEVON_BREAKS[-1]))
    elevons = []
    for i, (a, b) in enumerate(zip(ELEVON_BREAKS, ELEVON_BREAKS[1:])):
        elevons.append(lifting_surface(f'elevon{i + 1}', frame=wing_frame, le=WING_LE, te=WING_TE,
                                       z0=WING_ROOT, z1=WING_TIP, t0=WING_T0, t1=WING_T1, yAt=wingYAt,
                                       u_ticks=cosine_ticks(64, extra=[HINGE_U + 0.012]),
                                       w_ticks=lin_ticks(110, extra=[a + GAP_W / 2, b - GAP_W / 2]),
                                       u_range=(HINGE_U + 0.012, 1.0), w_range=(a + GAP_W / 2, b - GAP_W / 2),
                                       caps=('tip', 'root', 'le')))
    return wing, join(elevons, 'elevons')

STAB_Y = centerYAt(27.5)
def build_stab():
    return lifting_surface('stabilizer', frame=wing_frame, le=[[0.2, 23.8], [5.6, 28.4]], te=[[0.2, 30.3], [5.6, 30.4]],
                           z0=0.2, z1=5.6, t0=0.26, t1=0.03, yAt=lambda z: STAB_Y + 0.06 * z,
                           u_ticks=cosine_ticks(40), w_ticks=lin_ticks(40))

FIN_LE = [[0.3, 16.8], [1.05, 20.6], [1.85, 23.2], [2.75, 24.9], [3.55, 25.8], [4.3, 26.15]]
FIN_TE = [[0.3, 28.3], [4.3, 27.95]]
FIN_UV = dict(x0=16.4, y0=0.2, size=12.5)
RUDDER = (0.72, 0.1, 0.93)
def build_fin():
    uvf = lambda u, w, p: ((p[0] - FIN_UV['x0']) / FIN_UV['size'], (p[1] - FIN_UV['y0']) / FIN_UV['size'])
    common = dict(frame=fin_frame, le=FIN_LE, te=FIN_TE, z0=0.3, z1=4.3, t0=0.5, t1=0.06, yAt=lambda z: 0.0, uv=uvf)
    gw = 0.03 / 4.0
    fin = lifting_surface('fin', **common, u_ticks=cosine_ticks(48, extra=[RUDDER[0]]),
                          w_ticks=lin_ticks(56, extra=[RUDDER[1], RUDDER[2]]), hole=RUDDER)
    rudder = lifting_surface('rudder', **common, u_ticks=cosine_ticks(48, extra=[RUDDER[0] + 0.012]),
                             w_ticks=lin_ticks(56, extra=[RUDDER[1] + gw, RUDDER[2] - gw]),
                             u_range=(RUDDER[0] + 0.012, 1.0), w_range=(RUDDER[1] + gw, RUDDER[2] - gw),
                             caps=('tip', 'root', 'le'))
    return fin, rudder

# ── wing-to-body fairing ────────────────────────────────────────────────
def fuselage_half_width(x, y):
    r, hh, yc = radiusAt(x), halfHeightAt(x), centerYAt(x)
    q = (y - yc) / hh
    return r * math.sqrt(max(0.0, 1 - q * q))

def build_fairing():
    """
    Left half. A concave fillet where the wing's upper surface meets the fuselage (a keel
    wall where the tail cone has risen above the wing), plus a belly panel that closes the
    underside between the wing roots.
    """
    xle, xte = piecewise(WING_LE, WING_ROOT), piecewise(WING_TE, WING_ROOT)
    N, K = 220, 10
    mb = MeshBuilder()
    fil_rows, bel_rows = [], []
    for i in range(N + 1):
        s = i / N
        s = 0.5 - 0.5 * math.cos(math.pi * s)          # denser at the ends
        x = xle + (xte - xle) * s
        u = s
        d = 0.32 * math.sin(math.pi * u) ** 0.7
        r, hh, yc = radiusAt(x), halfHeightAt(x), centerYAt(x)
        g = lambda z: fuselage_half_width(x, wingUpperY(x, z)) - z
        if g(WING_ROOT) > 0 and g(3.5) < 0:
            lo, hi = WING_ROOT, 3.5
            for _ in range(40):
                mid = (lo + hi) / 2
                if g(mid) > 0: lo = mid
                else: hi = mid
            zi = (lo + hi) / 2; yi = wingUpperY(x, zi)
            yF = min(yi + d, yc + hh * 0.2)
            F = (fuselage_half_width(x, yF), yF)
            C = (zi, yi)
            zW = zi + d
        else:
            th = math.radians(-68)
            F = (r * math.cos(th), yc + hh * math.sin(th))
            zW = max(WING_ROOT, F[0]) + d
            C = (F[0], wingUpperY(x, zW))
        W = (zW, wingUpperY(x, zW))
        row = []
        for k in range(K + 1):
            t = k / K
            zz = (1 - t) ** 2 * F[0] + 2 * (1 - t) * t * C[0] + t * t * W[0]
            yy = (1 - t) ** 2 * F[1] + 2 * (1 - t) * t * C[1] + t * t * W[1]
            row.append(mb.v((x, yy, zz)))
        fil_rows.append(row)
        yb = wingLowerY(x, WING_ROOT)
        sag = 0.06 * math.sin(math.pi * u) ** 0.5
        bel_rows.append([mb.v((x, yb - sag * (1 - (zz / WING_ROOT) ** 2), zz))
                         for zz in (WING_ROOT * k / 12 for k in range(13))])
    uvs = [[(0.5, 0.5)] * (K + 1) for _ in fil_rows]
    grid_uv_faces(mb, fil_rows, uvs)
    grid_uv_faces(mb, bel_rows, [[(0.5, 0.5)] * 13 for _ in bel_rows], flip=True)
    ob = mb.build('fairing', sharp_deg=50)
    return ob

# ── nacelles ────────────────────────────────────────────────────────────
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

def build_nacelle():
    L, Rn = NAC_L, NAC_R
    f = lambda t: t * L
    # thick, rounded intake lip, then the long cowl to a blunt nozzle
    cowl = lathe('cowl', [
        (Rn * 0.835, 0.03), (Rn * 0.842, 0.012), (Rn * 0.856, 0.002), (Rn * 0.872, 0.0), (Rn * 0.888, 0.006),
        (Rn * 0.92, f(0.006)), (Rn * 0.97, f(0.03)), (Rn, f(0.1)), (Rn, f(0.7)), (Rn * 0.97, f(0.86)),
        (Rn * 0.9, f(0.96)), (Rn * 0.86, L),
    ])
    duct = lathe('duct', [
        (Rn * 0.835, 0.03), (Rn * 0.82, f(0.03)), (Rn * 0.8, f(0.12)), (Rn * 0.79, f(0.8)), (Rn * 0.8, L),
    ], outward=False)
    # nozzle lip: the annulus that closes cowl and duct at the exhaust
    nozzle = lathe('nozzle', [(Rn * 0.8, L), (Rn * 0.83, L + 0.004), (Rn * 0.86, L)], sharp=60)
    spike = lathe('spike', [(0.0, -1.35), (Rn * 0.5, 0.65), (Rn * 0.42, 2.05), (Rn * 0.2, 2.25), (0.0, 2.3)], sharp=25)
    plug = lathe('plug', [(0.0, L - 1.7), (Rn * 0.4, L - 1.6), (Rn * 0.3, L - 1.0), (0.0, L - 0.2)], sharp=25)
    return cowl, duct, nozzle, spike, plug

def build_pylon(e, name):
    """Aerofoil-section pylon from the nacelle crown up into the wing (engine-local coords)."""
    L = NAC_L
    x0, x1 = 0.12 * L, 0.86 * L
    mb = MeshBuilder()
    NU, NH = 40, 8
    Us = cosine_ticks(NU)
    rowsL, rowsR = [], []
    for ih in range(NH + 1):
        hfrac = ih / NH
        rl, rr = [], []
        for u in Us:
            x = x0 + (x1 - x0) * u
            top = wingLowerY(e['x0'] + x, e['z']) - e['y'] + 0.06
            y = NAC_R * 0.85 + (top - NAC_R * 0.85) * hfrac
            half = 0.09 * max(0.0, 1 - (2 * u - 1) ** 2) ** 0.55 + 0.003 * u
            a = mb.v((x, y, half))
            b = a if half < 1e-7 else mb.v((x, y, -half))
            rl.append(a); rr.append(b)
        rowsL.append(rl); rowsR.append(rr)
    uvs = [[(0.5, 0.5)] * len(Us) for _ in range(NH + 1)]
    grid_uv_faces(mb, rowsL, uvs)
    grid_uv_faces(mb, rowsR, uvs, flip=True)
    for ih in range(NH):   # blunt trailing edge
        mb.f([rowsL[ih][-1], rowsR[ih][-1], rowsR[ih + 1][-1], rowsL[ih + 1][-1]])
    ob = mb.build(name, sharp_deg=45)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free()
    return ob

# ── small parts ─────────────────────────────────────────────────────────
def join(objs, name):
    objs = [o for o in objs if o]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    return ob

def prim(kind, loc3, rot_bl=(0, 0, 0), scale=(1, 1, 1), **kw):
    """A primitive placed in three.js coordinates (rotation given in Blender Euler)."""
    getattr(bpy.ops.mesh, f'primitive_{kind}_add')(location=to_bl(loc3), rotation=rot_bl, **kw)
    ob = bpy.context.active_object
    ob.scale = scale
    for c in ob.users_collection: c.objects.unlink(ob)
    COLL.objects.link(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for p in ob.data.polygons: p.use_smooth = True
    return ob

def skin_point(x, y):
    """Point on the left (+Z) side of the fuselage at height y, and the outward normal (three.js)."""
    r, hh, yc = radiusAt(x), halfHeightAt(x), centerYAt(x)
    th = math.asin(max(-1, min(1, (y - yc) / hh)))
    p = (x, yc + hh * math.sin(th), r * math.cos(th))
    n = Vector((0, math.sin(th) / hh, math.cos(th) / r)).normalized()
    return p, n

def build_probes():
    parts = []
    for x, y in ((-23.2, -0.12), (-22.4, 0.28)):
        p, n = skin_point(x, y)
        # strut sticking out of the skin, then a forward-pointing pitot tube
        tip = (p[0], p[1] + n.y * 0.14, p[2] + n.z * 0.14)
        mid = tuple((a + b) / 2 for a, b in zip(p, tip))
        parts.append(prim('cylinder', mid, rot_bl=(math.pi / 2 - math.atan2(n.y, n.z), 0, 0),
                          vertices=16, radius=0.018, depth=0.15))
        parts.append(prim('cylinder', (tip[0] - 0.12, tip[1], tip[2]), rot_bl=(0, math.pi / 2, 0),
                          vertices=16, radius=0.012, depth=0.3))
    # angle-of-attack vane
    p, n = skin_point(-21.2, 0.05)
    parts.append(prim('cube', (p[0], p[1], p[2] + 0.04), scale=(0.06, 0.04, 0.004)))   # thin plate standing off the skin
    return join(parts, 'probes')

def build_lights():
    tip_z = WING_TIP + 0.02
    tip_x = (piecewise(WING_LE, WING_TIP) + piecewise(WING_TE, WING_TIP)) / 2
    nav = prim('uv_sphere', (tip_x - 0.3, wingYAt(WING_TIP), tip_z), scale=(0.11, 0.03, 0.028), segments=24, ring_count=12)
    nav.name = nav.data.name = 'navlight'
    beacons = []
    for x, up in ((-0.5, 1), (-7.0, -1)):
        yc, hh = centerYAt(x), halfHeightAt(x)
        beacons.append(prim('uv_sphere', (x, yc + up * (hh - 0.01), 0.0), scale=(0.11, 0.11, 0.05), segments=24, ring_count=12))
    beacon = join(beacons, 'beacons')
    tail = prim('uv_sphere', (TAIL + 0.02, centerYAt(TAIL), 0.0), scale=(0.05, 0.05, 0.05), segments=16, ring_count=8)
    tail.name = tail.data.name = 'taillight'
    return nav, beacon, tail

def build_wicks():
    wicks = []
    for w in (0.84, 0.9, 0.955):
        z = WING_ROOT + SPAN * w
        x = piecewise(WING_TE, z)
        wicks.append(prim('cylinder', (x + 0.14, wingYAt(z), z), rot_bl=(0, math.pi / 2, 0), vertices=8, radius=0.006, depth=0.3))
    for w in (0.8, 0.95):
        z = 0.2 + 5.4 * w
        x = piecewise([[0.2, 30.3], [5.6, 30.4]], z)
        wicks.append(prim('cylinder', (x + 0.12, STAB_Y + 0.06 * z, z), rot_bl=(0, math.pi / 2, 0), vertices=8, radius=0.005, depth=0.24))
    return join(wicks, 'wicks')

# ── build ───────────────────────────────────────────────────────────────
for o in list(bpy.data.objects): bpy.data.objects.remove(o)

fus = [
    fuselage_section('nose', NOSE, -13, 240),
    fuselage_section('forward-fuselage', -13, -1, 90),
    fuselage_section('aft-fuselage', -1, 12, 90),
    fuselage_section('tail-cone', 12, TAIL, 150),
]
wing, elevons = build_wing()
fairing = build_fairing()
stab = build_stab()
fin, rudder = build_fin()
cowl, duct, nozzle, spike, plug = build_nacelle()
pylons = [build_pylon(e, f'pylon{i + 1}') for i, e in enumerate(ENGINES)]
probes = build_probes()
nav, beacons, taillight = build_lights()
wicks = build_wicks()

nacelle_parts = [cowl, duct, nozzle, spike, plug]
exported = fus + [wing, elevons, fairing, stab, fin, rudder] + nacelle_parts + pylons + [probes, nav, beacons, taillight, wicks]

# ── ambient occlusion bake ──────────────────────────────────────────────
def mirror_copy(ob):
    c = ob.copy(); c.data = ob.data.copy()
    c.name = ob.name + '.mirror'
    COLL.objects.link(c)
    c.matrix_world = Matrix.Scale(-1, 4, Vector((0, 1, 0))) @ ob.matrix_world   # three.js Z → Blender -Y
    return c

def at_engine(ob, e, side=1):
    c = ob.copy(); c.data = ob.data
    c.name = f'{ob.name}.{e["z"]}.{side}'
    COLL.objects.link(c)
    c.location = Vector(to_bl((e['x0'], e['y'], e['z'] * side)))
    return c

BAKE = [  # (image name, resolution, objects, uv: 'UVMap' reuses UV0, else a lightmap unwrap)
    ('fuselage', (4096, 1024), fus, 'UVMap'),
    ('wing', (2048, 2048), [wing], None),
    ('elevons', (1024, 1024), [elevons], None),
    ('fairing', (1024, 1024), [fairing], None),
    ('stabilizer', (1024, 1024), [stab], None),
    ('fin', (1024, 1024), [fin, rudder], None),
    ('nacelle', (1024, 1024), [cowl, duct, nozzle], None),
    ('pylon', (1024, 1024), pylons, None),
]

def lightmap_uv(objs):
    for ob in objs:
        me = ob.data
        if 'AO' not in me.uv_layers: me.uv_layers.new(name='AO')
        me.uv_layers.active = me.uv_layers['AO']
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs: ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.004, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')

def copy_uv0(objs):
    for ob in objs:
        me = ob.data
        if 'AO' not in me.uv_layers:
            ao = me.uv_layers.new(name='AO')
            src = me.uv_layers['UVMap']
            for i, d in enumerate(src.data): ao.data[i].uv = d.uv
        me.uv_layers.active = me.uv_layers['AO']

if not FAST:
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices: d.use = True
        scene.cycles.device = 'GPU'
    except Exception as ex:
        print('GPU unavailable, baking on CPU:', ex)
    scene.cycles.samples = 256
    if scene.world is None: scene.world = bpy.data.worlds.new('World')
    scene.world.light_settings.distance = 2.6          # AO reach, metres

    # stand-ins so everything shades everything: right side, all four engines
    occluders = [mirror_copy(o) for o in fus[:0]]      # fuselage is whole already
    for o in [wing, elevons, fairing, stab]: occluders.append(mirror_copy(o))
    for side in (1, -1):
        for e_i, e in enumerate(ENGINES):
            for part in nacelle_parts + [pylons[e_i]]:
                occluders.append(at_engine(part, e, side))
    # the baked nacelle/pylons are the left outboard ones; move the originals into place
    home = {o.name: o.matrix_world.copy() for o in nacelle_parts + pylons}
    for o in nacelle_parts: o.location = Vector(to_bl((ENGINES[1]['x0'], ENGINES[1]['y'], ENGINES[1]['z'])))
    for i, o in enumerate(pylons): o.location = Vector(to_bl((ENGINES[i]['x0'], ENGINES[i]['y'], ENGINES[i]['z'])))
    # hide the duplicates we just placed at the baked engine's own position
    for o in occluders:
        if any(o.name.startswith(p.name + '.') and abs(o.location.x - p.location.x) < 1e-4 and abs(o.location.y - p.location.y) < 1e-4
               for p in nacelle_parts + pylons):
            o.hide_render = True

    for img_name, (w, h), objs, uvsrc in BAKE:
        if uvsrc == 'UVMap': copy_uv0(objs)
        else: lightmap_uv(objs)
        img = bpy.data.images.new(f'ao_{img_name}', w, h, alpha=False, float_buffer=False)
        img.colorspace_settings.name = 'Non-Color'
        for ob in objs:
            mat = bpy.data.materials.new(f'bake_{ob.name}')
            mat.use_nodes = True
            node = mat.node_tree.nodes.new('ShaderNodeTexImage')
            node.image = img
            mat.node_tree.nodes.active = node
            ob.data.materials.clear(); ob.data.materials.append(mat)
        bpy.ops.object.select_all(action='DESELECT')
        for ob in objs: ob.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        print(f'baking {img_name} …', flush=True)
        bpy.ops.object.bake(type='AO', margin=16, use_clear=True)
        img.filepath_raw = os.path.join(AO_DIR, f'{img_name}.png')
        img.file_format = 'PNG'
        img.save()

    for o in occluders: bpy.data.objects.remove(o)
    for o in nacelle_parts + pylons: o.matrix_world = home[o.name]
    for ob in exported: ob.data.materials.clear()

# ── export ──────────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='DESELECT')
for ob in exported:
    ob.select_set(True)
    for uv in ob.data.uv_layers: uv.active_render = (uv.name == 'UVMap')
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT_DIR, 'overture.glb'), export_format='GLB', use_selection=True,
    export_yup=True, export_normals=True, export_texcoords=True, export_materials='NONE',
    export_apply=True,
)
print('done', flush=True)
