#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    float position[3];
    float normal[3];
    float uv[2];
} Vertex;

typedef struct {
    const char *name;
    Vertex *vertices;
    uint32_t vertex_count;
    uint32_t *indices;
    uint32_t index_count;
} Mesh;

typedef enum { CONTENTS_GPU_ONLY, CONTENTS_CPU_VISIBLE, CONTENTS_UNLOCATED } Contents;

static const char *const contents_names[] = { "gpu-only", "cpu-visible", "unlocated" };

typedef enum { PRESENCE_LISTED, PRESENCE_ABSENT } Presence;

static const char *const presence_names[] = { "listed", "absent" };

typedef struct {
    uint32_t width;
    uint32_t height;
    const char *format;
    uint8_t corners[4][4];
} TextureExpectation;

char mesh_finder_expectations[16384];

static Mesh mesh_alloc(const char *name, uint32_t vertex_count, uint32_t index_count);
static void set_vertex(Vertex *v, float x, float y, float z, float nx, float ny, float nz, float u, float t);
static void record_expectation(const Mesh *mesh, const char *how, uint32_t triangle_count, Contents contents, Presence presence);
static void used_range(const Mesh *mesh, uint32_t *first, uint32_t *last);

static Mesh make_cube(const char *name, float cx, float cy, float cz)
{
    static const float faces[6][3] = { { 1, 0, 0 }, { -1, 0, 0 }, { 0, 1, 0 }, { 0, -1, 0 }, { 0, 0, 1 }, { 0, 0, -1 } };
    Mesh mesh = mesh_alloc(name, 24, 36);
    for (int f = 0; f != 6; f++) {
        const float *n = faces[f];
        float u[3] = { n[1], n[2], n[0] };
        float w[3] = { n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0] };
        for (int c = 0; c != 4; c++) {
            float a = (c == 1 || c == 2) ? 1 : -1;
            float b = (c >= 2) ? 1 : -1;
            set_vertex(&mesh.vertices[f * 4 + c],
                cx + n[0] + a * u[0] + b * w[0], cy + n[1] + a * u[1] + b * w[1], cz + n[2] + a * u[2] + b * w[2],
                n[0], n[1], n[2], (a + 1) / 2, (b + 1) / 2);
        }
        uint32_t base = f * 4;
        uint32_t quad[6] = { base, base + 1, base + 2, base, base + 2, base + 3 };
        memcpy(&mesh.indices[f * 6], quad, sizeof(quad));
    }
    return mesh;
}

static Mesh make_sphere(const char *name, float cx, float cy, float cz, float radius, int rings, int segments)
{
    Mesh mesh = mesh_alloc(name, (rings + 1) * (segments + 1), segments * (rings - 1) * 6);
    for (int r = 0; r <= rings; r++) {
        float phi = M_PI * r / rings;
        for (int s = 0; s <= segments; s++) {
            float theta = 2 * M_PI * s / segments;
            float nx = sinf(phi) * cosf(theta), ny = cosf(phi), nz = sinf(phi) * sinf(theta);
            set_vertex(&mesh.vertices[r * (segments + 1) + s], cx + radius * nx, cy + radius * ny, cz + radius * nz, nx, ny, nz,
                (float) s / segments, (float) r / rings);
        }
    }
    uint32_t *out = mesh.indices;
    for (int r = 0; r != rings; r++) {
        for (int s = 0; s != segments; s++) {
            uint32_t a = r * (segments + 1) + s, b = a + segments + 1;
            if (r != 0) {
                *out++ = a; *out++ = b; *out++ = a + 1;
            }
            if (r != rings - 1) {
                *out++ = a + 1; *out++ = b; *out++ = b + 1;
            }
        }
    }
    return mesh;
}

static Mesh make_torus(const char *name, float cx, float cy, float cz, float major, float minor, int major_segments, int minor_segments)
{
    Mesh mesh = mesh_alloc(name, (major_segments + 1) * (minor_segments + 1), major_segments * minor_segments * 6);
    for (int i = 0; i <= major_segments; i++) {
        float u = 2 * M_PI * i / major_segments;
        for (int j = 0; j <= minor_segments; j++) {
            float v = 2 * M_PI * j / minor_segments;
            float ring = major + minor * cosf(v);
            set_vertex(&mesh.vertices[i * (minor_segments + 1) + j],
                cx + ring * cosf(u), cy + minor * sinf(v), cz + ring * sinf(u),
                cosf(v) * cosf(u), sinf(v), cosf(v) * sinf(u), (float) i / major_segments, (float) j / minor_segments);
        }
    }
    uint32_t *out = mesh.indices;
    for (int i = 0; i != major_segments; i++) {
        for (int j = 0; j != minor_segments; j++) {
            uint32_t a = i * (minor_segments + 1) + j, b = a + minor_segments + 1;
            *out++ = a; *out++ = b; *out++ = a + 1;
            *out++ = a + 1; *out++ = b; *out++ = b + 1;
        }
    }
    return mesh;
}

static Mesh make_ribbon(const char *name, float cx, float cy, float cz, int columns)
{
    Mesh mesh = mesh_alloc(name, 2 * (columns + 1), 0);
    for (int c = 0; c <= columns; c++) {
        float x = -2 + 4.0f * c / columns;
        float z = 0.3f * sinf(x * 2);
        for (int row = 0; row != 2; row++) {
            set_vertex(&mesh.vertices[c * 2 + row], cx + x, cy + row - 0.5f, cz + z, 0, 0, 1, (float) c / columns, row);
        }
    }
    return mesh;
}

static Mesh make_octahedron(const char *name, float cx, float cy, float cz)
{
    static const float tips[6][3] = { { 1, 0, 0 }, { -1, 0, 0 }, { 0, 1, 0 }, { 0, -1, 0 }, { 0, 0, 1 }, { 0, 0, -1 } };
    static const int faces[8][3] = {
        { 0, 2, 4 }, { 2, 1, 4 }, { 1, 3, 4 }, { 3, 0, 4 }, { 2, 0, 5 }, { 1, 2, 5 }, { 3, 1, 5 }, { 0, 3, 5 },
    };
    Mesh mesh = mesh_alloc(name, 24, 0);
    for (int f = 0; f != 8; f++) {
        for (int k = 0; k != 3; k++) {
            const float *t = tips[faces[f][k]];
            set_vertex(&mesh.vertices[f * 3 + k], cx + t[0], cy + t[1], cz + t[2], t[0], t[1], t[2], 0, 0);
        }
    }
    return mesh;
}

static Mesh make_pyramid(const char *name, float cx, float cy, float cz)
{
    static const float corners[5][3] = { { -1, 0, -1 }, { 1, 0, -1 }, { 1, 0, 1 }, { -1, 0, 1 }, { 0, 1.5f, 0 } };
    static const int faces[6][3] = { { 0, 1, 4 }, { 1, 2, 4 }, { 2, 3, 4 }, { 3, 0, 4 }, { 0, 2, 1 }, { 0, 3, 2 } };
    Mesh mesh = mesh_alloc(name, 18, 0);
    for (int f = 0; f != 6; f++) {
        for (int k = 0; k != 3; k++) {
            const float *c = corners[faces[f][k]];
            set_vertex(&mesh.vertices[f * 3 + k], cx + c[0], cy + c[1], cz + c[2], 0, 1, 0, 0, 0);
        }
    }
    return mesh;
}

static void *positions_with_stride(const Mesh *mesh, size_t stride)
{
    uint8_t *packed = calloc(mesh->vertex_count, stride);
    for (uint32_t i = 0; i != mesh->vertex_count; i++) {
        float *out = (float *) (packed + i * stride);
        memcpy(out, mesh->vertices[i].position, 12);
        if (stride >= 16) {
            out[3] = 1.0f;
        }
    }
    return packed;
}

static void *pulled_vertices(const Mesh *mesh)
{
    float *packed = calloc(mesh->vertex_count, 24);
    for (uint32_t i = 0; i != mesh->vertex_count; i++) {
        memcpy(&packed[i * 6], mesh->vertices[i].position, 12);
        memcpy(&packed[i * 6 + 3], mesh->vertices[i].normal, 12);
    }
    return packed;
}

static uint16_t *indices16(const Mesh *mesh)
{
    uint16_t *narrow = calloc(mesh->index_count, 2);
    for (uint32_t i = 0; i != mesh->index_count; i++) {
        narrow[i] = (uint16_t) mesh->indices[i];
    }
    return narrow;
}

static void expect(const Mesh *mesh, const char *how, uint32_t triangle_count, Contents contents)
{
    record_expectation(mesh, how, triangle_count, contents, PRESENCE_LISTED);
}

static void expect_texture(const Mesh *mesh, const TextureExpectation *texture)
{
    uint32_t first, last;
    used_range(mesh, &first, &last);
    size_t used = strlen(mesh_finder_expectations) - 1;
    const uint8_t (*c)[4] = texture->corners;
    const float *a = mesh->vertices[first].uv, *b = mesh->vertices[first + 1].uv, *d = mesh->vertices[first + 2].uv;
    snprintf(mesh_finder_expectations + used, sizeof(mesh_finder_expectations) - used,
        ",\"texture\":{\"width\":%u,\"height\":%u,\"format\":\"%s\",\"corners\":[[%u,%u,%u,%u],[%u,%u,%u,%u],[%u,%u,%u,%u],[%u,%u,%u,%u]]},"
        "\"texcoords\":[[%g,%g],[%g,%g],[%g,%g]]}",
        texture->width, texture->height, texture->format, c[0][0], c[0][1], c[0][2], c[0][3], c[1][0], c[1][1], c[1][2], c[1][3],
        c[2][0], c[2][1], c[2][2], c[2][3], c[3][0], c[3][1], c[3][2], c[3][3], a[0], a[1], b[0], b[1], d[0], d[1]);
}

static Mesh mesh_alloc(const char *name, uint32_t vertex_count, uint32_t index_count)
{
    Mesh mesh = { name, calloc(vertex_count, sizeof(Vertex)), vertex_count, calloc(index_count ? index_count : 1, 4), index_count };
    return mesh;
}

static void set_vertex(Vertex *v, float x, float y, float z, float nx, float ny, float nz, float u, float t)
{
    v->position[0] = x; v->position[1] = y; v->position[2] = z;
    v->normal[0] = nx; v->normal[1] = ny; v->normal[2] = nz;
    v->uv[0] = u; v->uv[1] = t;
}

static void record_expectation(const Mesh *mesh, const char *how, uint32_t triangle_count, Contents contents, Presence presence)
{
    uint32_t first, last;
    used_range(mesh, &first, &last);
    float lo[3] = { INFINITY, INFINITY, INFINITY }, hi[3] = { -INFINITY, -INFINITY, -INFINITY };
    for (uint32_t i = first; i <= last; i++) {
        for (int k = 0; k != 3; k++) {
            lo[k] = fminf(lo[k], mesh->vertices[i].position[k]);
            hi[k] = fmaxf(hi[k], mesh->vertices[i].position[k]);
        }
    }
    size_t used = strlen(mesh_finder_expectations);
    const float *a = mesh->vertices[first].position, *b = mesh->vertices[first + 1].position, *c = mesh->vertices[first + 2].position;
    snprintf(mesh_finder_expectations + used, sizeof(mesh_finder_expectations) - used,
        "%s{\"name\":\"%s\",\"how\":\"%s\",\"vertices\":%u,\"triangles\":%u,\"contents\":\"%s\",\"presence\":\"%s\","
        "\"min\":[%g,%g,%g],\"max\":[%g,%g,%g],\"first\":[[%g,%g,%g],[%g,%g,%g],[%g,%g,%g]]}",
        used == 0 ? "" : ",", mesh->name, how, last - first + 1, triangle_count, contents_names[contents], presence_names[presence],
        lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

static void used_range(const Mesh *mesh, uint32_t *first, uint32_t *last)
{
    *first = 0;
    *last = mesh->vertex_count - 1;
    if (mesh->index_count != 0) {
        *first = UINT32_MAX;
        *last = 0;
        for (uint32_t i = 0; i != mesh->index_count; i++) {
            *first = (mesh->indices[i] < *first) ? mesh->indices[i] : *first;
            *last = (mesh->indices[i] > *last) ? mesh->indices[i] : *last;
        }
    }
}
