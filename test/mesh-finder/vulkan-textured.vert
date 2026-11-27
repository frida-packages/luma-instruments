#version 450

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_texcoord;
layout(push_constant) uniform Transform { mat4 mvp; } transform;
layout(location = 0) out vec3 v_color;
layout(location = 1) out vec2 v_uv;

void main()
{
    gl_Position = transform.mvp * vec4(a_position, 1.0);
    v_color = a_normal * 0.5 + 0.5;
    v_uv = a_texcoord;
}
