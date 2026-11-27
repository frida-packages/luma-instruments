#define GL_SILENCE_DEPRECATION
#include <OpenGL/OpenGL.h>
#include <OpenGL/gl3.h>
#include <mach/mach_time.h>
#include <signal.h>
#include <unistd.h>
#include "meshes.h"
#include "gl-textures.h"

enum { SPHERE_OFFSET = 256, SPHERE_INDEX_OFFSET = 64 };

static const char *described_vertex =
    "#version 330 core\n"
    "layout(location = 0) in vec3 a_position;\n"
    "layout(location = 1) in vec3 a_normal;\n"
    "uniform mat4 u_mvp;\n"
    "out vec3 v_color;\n"
    "void main() { gl_Position = u_mvp * vec4(a_position, 1.0); v_color = a_normal * 0.5 + 0.5; }\n";

static const char *position_vertex =
    "#version 330 core\n"
    "in vec3 inPos;\n"
    "uniform mat4 u_mvp;\n"
    "out vec3 v_color;\n"
    "void main() { gl_Position = u_mvp * vec4(inPos, 1.0); v_color = vec3(1.0); }\n";

static const char *textured_vertex =
    "#version 330 core\n"
    "layout(location = 0) in vec3 a_position;\n"
    "layout(location = 1) in vec3 a_normal;\n"
    "layout(location = 2) in vec2 a_uv;\n"
    "uniform mat4 u_mvp;\n"
    "out vec3 v_color;\n"
    "out vec2 v_uv;\n"
    "void main() { gl_Position = u_mvp * vec4(a_position, 1.0); v_color = a_normal * 0.5 + 0.5; v_uv = a_uv; }\n";

static const char *shade =
    "#version 330 core\n"
    "in vec3 v_color;\n"
    "out vec4 color;\n"
    "void main() { color = vec4(v_color, 1.0); }\n";

static const char *shade_albedo =
    "#version 330 core\n"
    "in vec3 v_color;\n"
    "in vec2 v_uv;\n"
    "uniform sampler2D u_albedo;\n"
    "out vec4 color;\n"
    "void main() { color = texture(u_albedo, v_uv) * vec4(v_color, 1.0); }\n";

static const char *shade_albedo_and_normal_map =
    "#version 330 core\n"
    "in vec3 v_color;\n"
    "in vec2 v_uv;\n"
    "uniform sampler2D u_albedo;\n"
    "uniform sampler2D u_normalMap;\n"
    "out vec4 color;\n"
    "void main() { color = texture(u_albedo, v_uv) * vec4(v_color * texture(u_normalMap, v_uv).xyz, 1.0); }\n";

static volatile sig_atomic_t late_upload_requested;

static GLuint program_with(const char *vertex, const char *fragment, const char *position_name);
static void assign_unit(GLuint program, const char *sampler, GLint unit);
static GLuint texture_with(GLint unit, GLenum format, GLsizei width, GLsizei height, const void *texels);
static GLuint compressed_texture_with(GLint unit, GLenum format, GLsizei size, const void *blocks, GLsizei length);
static GLuint vao_new(void);
static void point_attribute(GLuint index, GLuint buffer, GLint size, GLsizei stride, size_t offset);
static void request_late_upload(int signal);
static void upload_late(const Mesh *mesh);
static GLuint buffer_with(GLenum target, const void *data, GLsizeiptr length);
static GLuint compile(GLenum kind, const char *source);

int main(int argc, char **argv)
{
    int repeats = (argc > 1) ? atoi(argv[1]) : 1;
    CGLPixelFormatAttribute attributes[] = {
        kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute) kCGLOGLPVersion_3_2_Core, kCGLPFAAccelerated, kCGLPFAColorSize, 24,
        kCGLPFADepthSize, 24, 0,
    };
    CGLPixelFormatObj format;
    GLint formats;
    CGLChoosePixelFormat(attributes, &format, &formats);
    CGLContextObj context;
    CGLCreateContext(format, NULL, &context);
    CGLSetCurrentContext(context);

    GLuint framebuffer, color, depth;
    glGenFramebuffers(1, &framebuffer);
    glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    glGenRenderbuffers(1, &color);
    glBindRenderbuffer(GL_RENDERBUFFER, color);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_RGBA8, 256, 256);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, color);
    glGenRenderbuffers(1, &depth);
    glBindRenderbuffer(GL_RENDERBUFFER, depth);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, 256, 256);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, depth);
    glViewport(0, 0, 256, 256);
    glEnable(GL_DEPTH_TEST);

    GLuint described = program_with(described_vertex, shade, NULL);
    GLuint positions_only = program_with(position_vertex, shade, "inPos");
    GLuint albedo_and_normal_map = program_with(textured_vertex, shade_albedo_and_normal_map, NULL);
    assign_unit(albedo_and_normal_map, "u_albedo", ALBEDO_UNIT);
    assign_unit(albedo_and_normal_map, "u_normalMap", NORMAL_MAP_UNIT);
    GLuint albedo_only = program_with(textured_vertex, shade_albedo, NULL);
    assign_unit(albedo_only, "u_albedo", BLOCK_TEXTURE_UNIT);

    texture_with(ALBEDO_UNIT, GL_RGBA8, ALBEDO_WIDTH, ALBEDO_HEIGHT, albedo_texels());
    texture_with(NORMAL_MAP_UNIT, GL_RGBA8, NORMAL_MAP_SIZE, NORMAL_MAP_SIZE, normal_map_texels());
    uint8_t blocks[4][BLOCK_BYTES];
    dxt1_blocks(blocks);
    compressed_texture_with(BLOCK_TEXTURE_UNIT, GL_COMPRESSED_RGB_S3TC_DXT1, BLOCK_TEXTURE_SIZE, blocks, sizeof(blocks));
    glActiveTexture(GL_TEXTURE0);

    Mesh cube = make_cube("cube", 0, 0, 0);
    Mesh sphere = make_sphere("sphere", 4, 0, 0, 1.5f, 16, 32);
    Mesh torus = make_torus("torus", 0, 4, 0, 1.2f, 0.4f, 48, 16);
    Mesh ribbon = make_ribbon("ribbon", 0, 0, 4, 20);
    Mesh octahedron = make_octahedron("octahedron", 0, -4, 0);
    Mesh pyramid = make_pyramid("pyramid", -4, 4, 0);
    Mesh hidden = make_torus("hidden-torus", -4, 0, 0, 2.0f, 0.5f, 32, 12);
    Mesh late = make_sphere("late-sphere", 0, 0, -4, 0.75f, 8, 12);

    GLuint cube_vao = vao_new();
    GLuint cube_vertices = buffer_with(GL_ARRAY_BUFFER, cube.vertices, cube.vertex_count * sizeof(Vertex));
    point_attribute(0, cube_vertices, 3, sizeof(Vertex), 0);
    point_attribute(1, cube_vertices, 3, sizeof(Vertex), 12);
    point_attribute(2, cube_vertices, 2, sizeof(Vertex), 24);
    uint16_t *cube_indices = indices16(&cube);
    buffer_with(GL_ELEMENT_ARRAY_BUFFER, cube_indices, cube.index_count * 2);

    GLuint sphere_vao = vao_new();
    uint8_t *padded_positions = calloc(1, SPHERE_OFFSET + sphere.vertex_count * 12);
    void *sphere_positions = positions_with_stride(&sphere, 12);
    memcpy(padded_positions + SPHERE_OFFSET, sphere_positions, sphere.vertex_count * 12);
    point_attribute(0, buffer_with(GL_ARRAY_BUFFER, padded_positions, SPHERE_OFFSET + sphere.vertex_count * 12), 3, 0, SPHERE_OFFSET);
    GLuint sphere_vertices = buffer_with(GL_ARRAY_BUFFER, sphere.vertices, sphere.vertex_count * sizeof(Vertex));
    point_attribute(1, sphere_vertices, 3, sizeof(Vertex), 12);
    point_attribute(2, sphere_vertices, 2, sizeof(Vertex), 24);
    uint8_t *padded_indices = calloc(1, SPHERE_INDEX_OFFSET + sphere.index_count * 4);
    memcpy(padded_indices + SPHERE_INDEX_OFFSET, sphere.indices, sphere.index_count * 4);
    buffer_with(GL_ELEMENT_ARRAY_BUFFER, padded_indices, SPHERE_INDEX_OFFSET + sphere.index_count * 4);

    GLuint torus_vao = vao_new();
    void *torus_vertices = pulled_vertices(&torus);
    GLuint torus_buffer = buffer_with(GL_ARRAY_BUFFER, torus_vertices, torus.vertex_count * 24);
    point_attribute(0, torus_buffer, 3, 24, 0);
    point_attribute(1, torus_buffer, 3, 24, 12);
    buffer_with(GL_ELEMENT_ARRAY_BUFFER, torus.indices, torus.index_count * 4);

    GLuint ribbon_vao = vao_new();
    GLuint ribbon_buffer = buffer_with(GL_ARRAY_BUFFER, ribbon.vertices, ribbon.vertex_count * sizeof(Vertex));
    point_attribute(0, ribbon_buffer, 3, sizeof(Vertex), 0);
    point_attribute(1, ribbon_buffer, 3, sizeof(Vertex), 12);

    GLuint shared_vao = vao_new();
    void *octahedron_positions = positions_with_stride(&octahedron, 16);
    GLuint octahedron_buffer = buffer_with(GL_ARRAY_BUFFER, octahedron_positions, octahedron.vertex_count * 16);
    void *pyramid_positions = positions_with_stride(&pyramid, 12);
    GLuint pyramid_buffer = buffer_with(GL_ARRAY_BUFFER, pyramid_positions, pyramid.vertex_count * 12);

    buffer_with(GL_ARRAY_BUFFER, hidden.vertices, hidden.vertex_count * sizeof(Vertex));
    uint16_t *hidden_indices = indices16(&hidden);
    buffer_with(GL_ARRAY_BUFFER, hidden_indices, hidden.index_count * 2);

    expect(&cube, "interleaved position, normal and uv; 16-bit indices; glDrawElements; RGBA8 albedo and a normal map", 12, 1);
    expect_texture(&cube, &albedo_expectation);
    expect(&sphere, "positions alone in their own buffer at an offset; 32-bit indices at an offset; DXT1 albedo",
        sphere.index_count / 3, 1);
    expect_texture(&sphere, &dxt1_expectation);
    expect(&torus, "interleaved position and normal; 32-bit indices; glDrawRangeElements", torus.index_count / 3, 1);
    expect(&ribbon, "triangle strip, glDrawArrays", ribbon.vertex_count - 2, 1);
    expect(&octahedron, "glDrawArrays with four-component positions, sharing a VAO", 8, 1);
    expect(&pyramid, "glDrawArrays after re-pointing the shared VAO", 6, 1);
    expect(&hidden, "uploaded before attach, never drawn", hidden.index_count / 3, 1);
    expect(&late, "uploaded after attach with glMapBufferRange, never drawn", late.index_count / 3, 1);

    signal(SIGUSR1, request_late_upload);
    GLint mvp = glGetUniformLocation(described, "u_mvp");
    GLint mvp_positions = glGetUniformLocation(positions_only, "u_mvp");
    GLint mvp_albedo_and_normal_map = glGetUniformLocation(albedo_and_normal_map, "u_mvp");
    GLint mvp_albedo = glGetUniformLocation(albedo_only, "u_mvp");
    printf("pid %d ready, %d draws per frame\n", getpid(), repeats * 6);
    fflush(stdout);

    mach_timebase_info_data_t timebase;
    mach_timebase_info(&timebase);
    double total = 0, worst = 0, submitting = 0;
    int frames = 0;
    for (uint64_t frame = 0;; frame++) {
        if (late_upload_requested) {
            late_upload_requested = 0;
            upload_late(&late);
        }
        uint64_t start = mach_absolute_time();
        float angle = frame * 0.01f;
        float matrix[16] = {
            cosf(angle) * 0.1f, 0, -sinf(angle) * 0.05f, 0,
            0, 0.1f, 0, 0,
            sinf(angle) * 0.1f, 0, cosf(angle) * 0.05f, 0,
            0, 0, 0.5f, 1,
        };
        glClearColor(0, 0, 0, 1);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

        for (int repeat = 0; repeat != repeats; repeat++) {
            glUseProgram(albedo_and_normal_map);
            glUniformMatrix4fv(mvp_albedo_and_normal_map, 1, GL_FALSE, matrix);
            glBindVertexArray(cube_vao);
            glDrawElements(GL_TRIANGLES, cube.index_count, GL_UNSIGNED_SHORT, NULL);
            glUseProgram(albedo_only);
            glUniformMatrix4fv(mvp_albedo, 1, GL_FALSE, matrix);
            glBindVertexArray(sphere_vao);
            glDrawElements(GL_TRIANGLES, sphere.index_count, GL_UNSIGNED_INT, (const void *) SPHERE_INDEX_OFFSET);
            glUseProgram(described);
            glUniformMatrix4fv(mvp, 1, GL_FALSE, matrix);
            glBindVertexArray(torus_vao);
            glDrawRangeElements(GL_TRIANGLES, 0, torus.vertex_count - 1, torus.index_count, GL_UNSIGNED_INT, NULL);
            glBindVertexArray(ribbon_vao);
            glDrawArrays(GL_TRIANGLE_STRIP, 0, ribbon.vertex_count);

            glUseProgram(positions_only);
            glUniformMatrix4fv(mvp_positions, 1, GL_FALSE, matrix);
            glBindVertexArray(shared_vao);
            point_attribute(3, octahedron_buffer, 4, 16, 0);
            glDrawArrays(GL_TRIANGLES, 0, octahedron.vertex_count);
            point_attribute(3, pyramid_buffer, 3, 12, 0);
            glDrawArrays(GL_TRIANGLES, 0, pyramid.vertex_count);
        }
        submitting += (mach_absolute_time() - start) * timebase.numer / (double) timebase.denom / 1e6;
        glFinish();
        double elapsed = (mach_absolute_time() - start) * timebase.numer / (double) timebase.denom / 1e6;
        total += elapsed;
        worst = fmax(worst, elapsed);
        if (++frames == 120) {
            printf("frame time: mean %.3f ms, worst %.3f ms; submitting: mean %.3f ms\n", total / frames, worst, submitting / frames);
            fflush(stdout);
            total = worst = submitting = 0;
            frames = 0;
        }
        usleep(16000);
    }
}

static GLuint program_with(const char *vertex, const char *fragment, const char *position_name)
{
    GLuint program = glCreateProgram();
    glAttachShader(program, compile(GL_VERTEX_SHADER, vertex));
    glAttachShader(program, compile(GL_FRAGMENT_SHADER, fragment));
    if (position_name != NULL) {
        glBindAttribLocation(program, 3, position_name);
    }
    glLinkProgram(program);
    return program;
}

static void assign_unit(GLuint program, const char *sampler, GLint unit)
{
    glUseProgram(program);
    glUniform1i(glGetUniformLocation(program, sampler), unit);
}

static GLuint texture_with(GLint unit, GLenum format, GLsizei width, GLsizei height, const void *texels)
{
    GLuint texture;
    glGenTextures(1, &texture);
    glActiveTexture(GL_TEXTURE0 + unit);
    glBindTexture(GL_TEXTURE_2D, texture);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexImage2D(GL_TEXTURE_2D, 0, format, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, texels);
    return texture;
}

static GLuint compressed_texture_with(GLint unit, GLenum format, GLsizei size, const void *blocks, GLsizei length)
{
    GLuint texture;
    glGenTextures(1, &texture);
    glActiveTexture(GL_TEXTURE0 + unit);
    glBindTexture(GL_TEXTURE_2D, texture);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glCompressedTexImage2D(GL_TEXTURE_2D, 0, format, size, size, 0, length, blocks);
    return texture;
}

static GLuint vao_new(void)
{
    GLuint vao;
    glGenVertexArrays(1, &vao);
    glBindVertexArray(vao);
    return vao;
}

static void point_attribute(GLuint index, GLuint buffer, GLint size, GLsizei stride, size_t offset)
{
    glBindBuffer(GL_ARRAY_BUFFER, buffer);
    glEnableVertexAttribArray(index);
    glVertexAttribPointer(index, size, GL_FLOAT, GL_FALSE, stride, (const void *) offset);
}

static void request_late_upload(int signal)
{
    late_upload_requested = 1;
}

static void upload_late(const Mesh *mesh)
{
    GLuint vertices;
    glGenBuffers(1, &vertices);
    glBindBuffer(GL_ARRAY_BUFFER, vertices);
    glBufferData(GL_ARRAY_BUFFER, mesh->vertex_count * sizeof(Vertex), NULL, GL_STATIC_DRAW);
    void *mapped = glMapBufferRange(GL_ARRAY_BUFFER, 0, mesh->vertex_count * sizeof(Vertex),
        GL_MAP_WRITE_BIT | GL_MAP_INVALIDATE_BUFFER_BIT);
    memcpy(mapped, mesh->vertices, mesh->vertex_count * sizeof(Vertex));
    glUnmapBuffer(GL_ARRAY_BUFFER);
    uint16_t *narrow = indices16(mesh);
    buffer_with(GL_ARRAY_BUFFER, narrow, mesh->index_count * 2);
    free(narrow);
    printf("uploaded the late mesh\n");
    fflush(stdout);
}

static GLuint buffer_with(GLenum target, const void *data, GLsizeiptr length)
{
    GLuint buffer;
    glGenBuffers(1, &buffer);
    glBindBuffer(target, buffer);
    glBufferData(target, length, data, GL_STATIC_DRAW);
    return buffer;
}

static GLuint compile(GLenum kind, const char *source)
{
    GLuint shader = glCreateShader(kind);
    glShaderSource(shader, 1, &source, NULL);
    glCompileShader(shader);
    GLint ok;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[1024];
        glGetShaderInfoLog(shader, sizeof(log), NULL, log);
        fprintf(stderr, "%s\n", log);
        exit(1);
    }
    return shader;
}
